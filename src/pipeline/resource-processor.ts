// pipeline/resource-processor.ts — Gathering progress, tree growth, depletion

import type {
  EntityId,
  Tick,
  Agent,
  Resource,
} from '../types/index.js';
import type { WorldState } from '../server/world.js';
import {
  TREE_GATHER_TICKS,
  GOLD_GATHER_TICKS,
  SEED_DROP_CHANCE,
  SAPLING_GROWTH_TICKS,
  WATER_SPEED_BONUS,
} from '../shared/constants.js';
import { generateResourceId } from '../shared/utils.js';

interface GatheringState {
  agentId: EntityId;
  resourceId: EntityId;
  ticksRemaining: number;
}

export class ResourceProcessor {
  /** Tracks active gathering progress per agent */
  private gatheringProgress: Map<EntityId, GatheringState> = new Map();

  tick(world: WorldState, tick: Tick): void {
    this.advanceGathering(world, tick);
    this.advanceSaplingGrowth(world, tick);
  }

  /** Called by executor when a gather action starts */
  startGathering(agentId: EntityId, resourceId: EntityId, resource: Resource): void {
    const ticksNeeded = resource.type === 'gold_vein'
      ? GOLD_GATHER_TICKS
      : TREE_GATHER_TICKS;

    this.gatheringProgress.set(agentId, {
      agentId,
      resourceId,
      ticksRemaining: ticksNeeded,
    });
  }

  /** Cancel gathering when agent does something else */
  cancelGathering(agentId: EntityId): void {
    this.gatheringProgress.delete(agentId);
  }

  private advanceGathering(world: WorldState, tick: Tick): void {
    const completed: EntityId[] = [];

    for (const [agentId, state] of this.gatheringProgress) {
      const agent = world.agents.get(agentId);
      if (!agent || agent.status !== 'gathering') {
        completed.push(agentId);
        continue;
      }

      const resource = world.resources.get(state.resourceId);
      if (!resource || resource.state === 'depleted') {
        agent.status = 'idle';
        completed.push(agentId);
        continue;
      }

      state.ticksRemaining--;

      if (state.ticksRemaining <= 0) {
        // Gathering cycle complete — yield item
        if (resource.type === 'tree') {
          this.gatherTree(agent, resource, world, tick);
        } else if (resource.type === 'gold_vein') {
          this.gatherGold(agent, resource, world, tick);
        }

        // Check if resource still has remaining
        if (resource.remaining <= 0) {
          this.depleteResource(resource, world, tick);
          agent.status = 'idle';
          completed.push(agentId);
        } else {
          // Reset timer for next cycle
          state.ticksRemaining = resource.type === 'gold_vein'
            ? GOLD_GATHER_TICKS
            : TREE_GATHER_TICKS;
        }
      }
    }

    for (const agentId of completed) {
      this.gatheringProgress.delete(agentId);
    }
  }

  private gatherTree(agent: Agent, resource: Resource, world: WorldState, tick: Tick): void {
    const quantity = 1;
    resource.remaining -= quantity;

    // Add log to inventory
    const existing = agent.inventory.find((i) => i.id === 'log');
    if (existing) {
      existing.quantity += quantity;
    } else {
      agent.inventory.push({ id: 'log', quantity });
    }

    world.tickEvents.push({
      type: 'resource_gathered',
      agentId: agent.id,
      resourceId: resource.id,
      item: 'log',
      quantity,
    });
  }

  private gatherGold(agent: Agent, resource: Resource, world: WorldState, tick: Tick): void {
    const quantity = Math.min(5, resource.remaining);
    resource.remaining -= quantity;
    agent.gold += quantity;

    world.tickEvents.push({
      type: 'resource_gathered',
      agentId: agent.id,
      resourceId: resource.id,
      item: 'gold',
      quantity,
    });
  }

  private depleteResource(resource: Resource, world: WorldState, tick: Tick): void {
    resource.state = 'depleted';

    world.tickEvents.push({
      type: 'resource_depleted',
      resourceId: resource.id,
      position: { ...resource.position },
    });

    // Tree depletion: chance to drop seed
    if (resource.type === 'tree') {
      // Use a simple deterministic check based on tick + resource id hash
      const seedChance = this.seedDropRoll(resource.id, tick);
      if (seedChance < SEED_DROP_CHANCE) {
        // Find the agent who was gathering this tree and give them a seed
        for (const [, agent] of world.agents) {
          // The agent who depleted it is the one still near it
          // We check all agents — the one gathering this resource
          if (agent.status === 'idle' || agent.status === 'gathering') {
            // Check if there's a gathering state pointing to this resource
            // Since we already cleaned up, look for agents near the resource
          }
        }
        // Simpler: just drop a seed to the last gatherer. We track this via events.
        // The last resource_gathered event this tick for this resource tells us the agent.
        const lastGatherEvent = world.tickEvents
          .filter((e) => e.type === 'resource_gathered' && e.resourceId === resource.id)
          .pop();
        if (lastGatherEvent && lastGatherEvent.type === 'resource_gathered') {
          const gatherer = world.agents.get(lastGatherEvent.agentId);
          if (gatherer) {
            const existingSeed = gatherer.inventory.find((i) => i.id === 'tree_seed');
            if (existingSeed) {
              existingSeed.quantity += 1;
            } else {
              gatherer.inventory.push({ id: 'tree_seed', quantity: 1 });
            }
          }
        }
      }
    }
  }

  /** Deterministic seed drop roll based on resource ID and tick */
  private seedDropRoll(resourceId: string, tick: Tick): number {
    let hash = 0;
    const str = `${resourceId}_${tick}`;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash + char) | 0;
    }
    return Math.abs(hash % 100) / 100;
  }

  private advanceSaplingGrowth(world: WorldState, tick: Tick): void {
    for (const [, resource] of world.resources) {
      if (resource.type === 'sapling' && resource.state === 'growing') {
        if (resource.growthCompleteTick !== null && tick >= resource.growthCompleteTick) {
          // Sapling becomes a full tree
          resource.type = 'tree';
          resource.state = 'available';
          resource.remaining = resource.maxCapacity;
          resource.growthStartTick = null;
          resource.growthCompleteTick = null;

          world.tickEvents.push({
            type: 'tree_grown',
            position: { ...resource.position },
          });
        }
      }
    }
  }

  /** Called by executor when a plant action executes */
  plantSapling(
    agentId: EntityId,
    position: { x: number; y: number },
    world: WorldState,
    tick: Tick,
  ): void {
    const agent = world.agents.get(agentId);
    if (!agent) return;

    // Remove seed from inventory
    const seedItem = agent.inventory.find((i) => i.id === 'tree_seed');
    if (!seedItem || seedItem.quantity < 1) return;
    seedItem.quantity -= 1;
    if (seedItem.quantity <= 0) {
      agent.inventory = agent.inventory.filter((i) => i.id !== 'tree_seed');
    }

    // Create sapling resource
    const sapling: Resource = {
      id: generateResourceId(),
      type: 'sapling',
      position: { x: position.x, y: position.y },
      remaining: 0,
      maxCapacity: 5, // will become a tree with 5 logs
      state: 'growing',
      growthStartTick: tick,
      growthCompleteTick: tick + SAPLING_GROWTH_TICKS,
      createdAt: tick,
    };

    world.addResource(sapling);

    world.tickEvents.push({
      type: 'tree_planted',
      agentId,
      position: { ...position },
    });
  }

  /** Called by executor when a water action executes */
  waterSapling(
    position: { x: number; y: number },
    world: WorldState,
    tick: Tick,
  ): void {
    // Find sapling at position
    for (const [, resource] of world.resources) {
      if (
        resource.type === 'sapling' &&
        resource.position.x === position.x &&
        resource.position.y === position.y &&
        resource.growthCompleteTick !== null
      ) {
        resource.growthCompleteTick = Math.max(
          tick + 1, // can't complete before next tick
          resource.growthCompleteTick - WATER_SPEED_BONUS,
        );
        break;
      }
    }
  }
}
