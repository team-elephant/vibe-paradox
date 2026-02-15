// pipeline/behemoth-processor.ts — Behemoth lifecycle management

import type {
  Tick,
  Behemoth,
  EntityId,
} from '../types/index.js';
import { distance } from '../types/index.js';
import type { WorldState } from '../server/world.js';
import {
  BEHEMOTH_UNCONSCIOUS_TICKS,
  BEHEMOTH_FEED_THRESHOLD,
  BEHEMOTH_ORE_GROWTH_TICKS,
  BEHEMOTH_THROW_DAMAGE_PERCENT,
  BEHEMOTH_SPEED,
  RESPAWN_TICKS,
} from '../shared/constants.js';

/** Info about agents thrown off during a behemoth wake */
export interface ThrowOffResult {
  behemothId: EntityId;
  agentIds: EntityId[];
}

export class BehemothProcessor {
  /** Tracks which agents are currently climbing each behemoth */
  private climbingAgents: Map<EntityId, Set<EntityId>> = new Map();

  /** Tracks when ore growth will complete for a behemoth */
  private oreGrowthTick: Map<EntityId, Tick> = new Map();

  registerClimber(behemothId: EntityId, agentId: EntityId): void {
    let climbers = this.climbingAgents.get(behemothId);
    if (!climbers) {
      climbers = new Set();
      this.climbingAgents.set(behemothId, climbers);
    }
    climbers.add(agentId);
  }

  removeClimber(behemothId: EntityId, agentId: EntityId): void {
    const climbers = this.climbingAgents.get(behemothId);
    if (climbers) {
      climbers.delete(agentId);
    }
  }

  getClimbers(behemothId: EntityId): ReadonlySet<EntityId> {
    return this.climbingAgents.get(behemothId) ?? new Set();
  }

  tick(world: WorldState, tick: Tick): ThrowOffResult[] {
    const throwOffs: ThrowOffResult[] = [];

    for (const [, behemoth] of world.behemoths) {
      switch (behemoth.status) {
        case 'roaming':
          this.processRoaming(behemoth, world, tick);
          break;
        case 'unconscious': {
          const result = this.processUnconscious(behemoth, world, tick);
          if (result) throwOffs.push(result);
          break;
        }
        case 'waking':
          // Should not persist across ticks, but handle defensively
          break;
      }
    }

    return throwOffs;
  }

  private processRoaming(behemoth: Behemoth, world: WorldState, tick: Tick): void {
    // Advance waypoint movement
    this.advanceWaypointMovement(behemoth, world);

    // Check if ore growth timer has completed
    const growthTick = this.oreGrowthTick.get(behemoth.id);
    if (growthTick !== undefined && tick >= growthTick) {
      // Ore growth complete — ore becomes available based on fed amount
      const oreAmount = Math.min(
        5 + Math.floor(behemoth.fedAmount / BEHEMOTH_FEED_THRESHOLD) * 5,
        behemoth.oreMax,
      );
      behemoth.oreAmount = oreAmount;
      this.oreGrowthTick.delete(behemoth.id);
    }

    // Check if behemoth health has dropped to 0 (from combat)
    if (behemoth.health <= 0) {
      this.knockOut(behemoth, world, tick);
    }
  }

  private processUnconscious(
    behemoth: Behemoth,
    world: WorldState,
    tick: Tick,
  ): ThrowOffResult | null {
    if (behemoth.unconsciousUntilTick !== null && tick >= behemoth.unconsciousUntilTick) {
      return this.processWaking(behemoth, world, tick);
    }
    return null;
  }

  private processWaking(
    behemoth: Behemoth,
    world: WorldState,
    tick: Tick,
  ): ThrowOffResult {
    // Collect climbing agents to throw off — agent mutations handled by executor
    const climbers = this.climbingAgents.get(behemoth.id);
    const thrownOff: EntityId[] = [];

    if (climbers && climbers.size > 0) {
      for (const agentId of climbers) {
        const agent = world.agents.get(agentId);
        if (agent && agent.status === 'climbing') {
          thrownOff.push(agentId);
        }
      }
      climbers.clear();
    }

    // Emit behemoth_wake event
    world.tickEvents.push({
      type: 'behemoth_wake',
      behemothId: behemoth.id,
      thrownOff,
    });

    // Reset behemoth state (behemoth mutations are this processor's domain)
    behemoth.status = 'roaming';
    behemoth.health = behemoth.maxHealth;
    behemoth.oreAmount = 0;
    behemoth.fedAmount = 0;
    behemoth.unconsciousUntilTick = null;
    this.oreGrowthTick.delete(behemoth.id);

    return { behemothId: behemoth.id, agentIds: thrownOff };
  }

  /** Called when behemoth health reaches 0 */
  private knockOut(behemoth: Behemoth, world: WorldState, tick: Tick): void {
    behemoth.status = 'unconscious';
    behemoth.health = 0;
    behemoth.unconsciousUntilTick = tick + BEHEMOTH_UNCONSCIOUS_TICKS;

    world.tickEvents.push({
      type: 'behemoth_knockout',
      behemothId: behemoth.id,
      attackers: [],
    });
  }

  /** Process feeding a behemoth */
  feedBehemoth(behemoth: Behemoth, tick: Tick): void {
    behemoth.fedAmount++;

    // When fed enough, start ore growth timer
    if (behemoth.fedAmount >= BEHEMOTH_FEED_THRESHOLD && !this.oreGrowthTick.has(behemoth.id)) {
      this.oreGrowthTick.set(behemoth.id, tick + BEHEMOTH_ORE_GROWTH_TICKS);
    }
  }

  private advanceWaypointMovement(behemoth: Behemoth, world: WorldState): void {
    if (behemoth.route.length === 0) return;

    const target = behemoth.route[behemoth.currentWaypoint]!;
    const remaining = distance(behemoth.position, target);

    if (remaining <= BEHEMOTH_SPEED) {
      // Arrived at waypoint
      world.moveBehemoth(behemoth.id, { x: target.x, y: target.y });
      behemoth.currentWaypoint = (behemoth.currentWaypoint + 1) % behemoth.route.length;
    } else {
      // Move toward waypoint
      const dx = target.x - behemoth.position.x;
      const dy = target.y - behemoth.position.y;
      const norm = Math.sqrt(dx * dx + dy * dy);
      const newX = behemoth.position.x + (dx / norm) * BEHEMOTH_SPEED;
      const newY = behemoth.position.y + (dy / norm) * BEHEMOTH_SPEED;
      world.moveBehemoth(behemoth.id, { x: newX, y: newY });
    }
  }
}
