// tests/resource.test.ts — Tests for ResourceProcessor

import { describe, it, expect, beforeEach } from 'vitest';
import { ResourceProcessor } from '../src/pipeline/resource-processor.js';
import { ActionExecutor } from '../src/pipeline/executor.js';
import { WorldState } from '../src/server/world.js';
import type {
  Agent,
  Resource,
  ValidatedAction,
  ActionParams,
} from '../src/types/index.js';
import {
  TREE_GATHER_TICKS,
  GOLD_GATHER_TICKS,
  SAPLING_GROWTH_TICKS,
  WATER_SPEED_BONUS,
} from '../src/shared/constants.js';

function createAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: 'agent_test001',
    name: 'TestMerchant',
    role: 'merchant',
    position: { x: 100, y: 100 },
    destination: null,
    status: 'idle',
    stats: {
      health: 50,
      maxHealth: 50,
      attack: 0,
      defense: 5,
      speed: 3,
      visionRadius: 80,
    },
    gold: 0,
    inventory: [],
    equipment: { weapon: null, armor: null, tool: null },
    alliance: null,
    kills: 0,
    monsterEats: 0,
    evolutionStage: 1,
    actionCooldown: 0,
    respawnTick: null,
    connectedAt: 0,
    lastActionTick: 0,
    isAlive: true,
    isConnected: true,
    ...overrides,
  };
}

function createResource(overrides: Partial<Resource> = {}): Resource {
  return {
    id: 'res_test001',
    type: 'tree',
    position: { x: 102, y: 100 },
    remaining: 5,
    maxCapacity: 5,
    state: 'available',
    growthStartTick: null,
    growthCompleteTick: null,
    createdAt: 0,
    ...overrides,
  };
}

function makeValidatedAction(
  agentId: string,
  params: ActionParams,
): ValidatedAction {
  return {
    agentId,
    action: params.type,
    params,
    valid: true,
  };
}

describe('ResourceProcessor', () => {
  let processor: ResourceProcessor;
  let executor: ActionExecutor;
  let world: WorldState;

  beforeEach(() => {
    processor = new ResourceProcessor();
    executor = new ActionExecutor();
    executor.setResourceProcessor(processor);
    world = new WorldState(42);
  });

  describe('Tree Gathering', () => {
    it('should yield 1 log after TREE_GATHER_TICKS ticks', () => {
      const agent = createAgent();
      const tree = createResource({ remaining: 5 });
      world.addAgent(agent);
      world.addResource(tree);

      // Execute gather action
      const action = makeValidatedAction('agent_test001', {
        type: 'gather',
        targetId: 'res_test001',
      });
      executor.executeBatch([action], world, 1);

      expect(agent.status).toBe('gathering');
      expect(tree.state).toBe('being_gathered');

      // Tick through TREE_GATHER_TICKS - 1 ticks (no log yet)
      for (let t = 1; t < TREE_GATHER_TICKS; t++) {
        processor.tick(world, t);
      }
      expect(agent.inventory.find((i) => i.id === 'log')).toBeUndefined();

      // Final tick yields log
      processor.tick(world, TREE_GATHER_TICKS);

      const logItem = agent.inventory.find((i) => i.id === 'log');
      expect(logItem).toBeDefined();
      expect(logItem!.quantity).toBe(1);
      expect(tree.remaining).toBe(4);
    });

    it('should continue gathering for multiple cycles', () => {
      const agent = createAgent();
      const tree = createResource({ remaining: 3 });
      world.addAgent(agent);
      world.addResource(tree);

      const action = makeValidatedAction('agent_test001', {
        type: 'gather',
        targetId: 'res_test001',
      });
      executor.executeBatch([action], world, 1);

      // Gather 2 logs (2 cycles)
      for (let t = 1; t <= TREE_GATHER_TICKS * 2; t++) {
        processor.tick(world, t);
      }

      const logItem = agent.inventory.find((i) => i.id === 'log');
      expect(logItem).toBeDefined();
      expect(logItem!.quantity).toBe(2);
      expect(tree.remaining).toBe(1);
    });

    it('should deplete tree when remaining reaches 0', () => {
      const agent = createAgent();
      const tree = createResource({ remaining: 1, maxCapacity: 1 });
      world.addAgent(agent);
      world.addResource(tree);

      const action = makeValidatedAction('agent_test001', {
        type: 'gather',
        targetId: 'res_test001',
      });
      executor.executeBatch([action], world, 1);

      for (let t = 1; t <= TREE_GATHER_TICKS; t++) {
        processor.tick(world, t);
      }

      expect(tree.state).toBe('depleted');
      expect(tree.remaining).toBe(0);
      expect(agent.status).toBe('idle');

      // Check depletion event
      const depletionEvent = world.tickEvents.find(
        (e) => e.type === 'resource_depleted',
      );
      expect(depletionEvent).toBeDefined();
    });

    it('should emit resource_gathered events', () => {
      const agent = createAgent();
      const tree = createResource({ remaining: 5 });
      world.addAgent(agent);
      world.addResource(tree);

      const action = makeValidatedAction('agent_test001', {
        type: 'gather',
        targetId: 'res_test001',
      });
      executor.executeBatch([action], world, 1);

      for (let t = 1; t <= TREE_GATHER_TICKS; t++) {
        processor.tick(world, t);
      }

      const gatherEvent = world.tickEvents.find(
        (e) => e.type === 'resource_gathered',
      );
      expect(gatherEvent).toBeDefined();
      if (gatherEvent && gatherEvent.type === 'resource_gathered') {
        expect(gatherEvent.agentId).toBe('agent_test001');
        expect(gatherEvent.resourceId).toBe('res_test001');
        expect(gatherEvent.item).toBe('log');
        expect(gatherEvent.quantity).toBe(1);
      }
    });
  });

  describe('Gold Gathering', () => {
    it('should yield 5 gold after GOLD_GATHER_TICKS ticks', () => {
      const agent = createAgent({ role: 'fighter', stats: {
        health: 100, maxHealth: 100, attack: 15, defense: 10, speed: 4, visionRadius: 100,
      }});
      const goldVein = createResource({
        id: 'res_gold001',
        type: 'gold_vein',
        remaining: 100,
        maxCapacity: 100,
        position: { x: 102, y: 100 },
      });
      world.addAgent(agent);
      world.addResource(goldVein);

      const action = makeValidatedAction('agent_test001', {
        type: 'gather',
        targetId: 'res_gold001',
      });
      executor.executeBatch([action], world, 1);

      for (let t = 1; t <= GOLD_GATHER_TICKS; t++) {
        processor.tick(world, t);
      }

      expect(agent.gold).toBe(5);
      expect(goldVein.remaining).toBe(95);
    });

    it('should deplete gold vein when empty', () => {
      const agent = createAgent({ role: 'fighter', stats: {
        health: 100, maxHealth: 100, attack: 15, defense: 10, speed: 4, visionRadius: 100,
      }});
      const goldVein = createResource({
        id: 'res_gold001',
        type: 'gold_vein',
        remaining: 3,
        maxCapacity: 3,
        position: { x: 102, y: 100 },
      });
      world.addAgent(agent);
      world.addResource(goldVein);

      const action = makeValidatedAction('agent_test001', {
        type: 'gather',
        targetId: 'res_gold001',
      });
      executor.executeBatch([action], world, 1);

      for (let t = 1; t <= GOLD_GATHER_TICKS; t++) {
        processor.tick(world, t);
      }

      // Should gather min(5, 3) = 3 gold
      expect(agent.gold).toBe(3);
      expect(goldVein.remaining).toBe(0);
      expect(goldVein.state).toBe('depleted');
      expect(agent.status).toBe('idle');
    });
  });

  describe('Planting', () => {
    it('should create a sapling at position when merchant plants seed', () => {
      const agent = createAgent({
        inventory: [{ id: 'tree_seed', quantity: 2 }],
      });
      world.addAgent(agent);

      const action = makeValidatedAction('agent_test001', {
        type: 'plant',
        seedId: 'tree_seed',
        x: 150,
        y: 150,
      });
      executor.executeBatch([action], world, 10);

      // Seed consumed
      const seedItem = agent.inventory.find((i) => i.id === 'tree_seed');
      expect(seedItem).toBeDefined();
      expect(seedItem!.quantity).toBe(1);

      // Sapling created
      let foundSapling = false;
      for (const [, resource] of world.resources) {
        if (
          resource.type === 'sapling' &&
          resource.position.x === 150 &&
          resource.position.y === 150
        ) {
          foundSapling = true;
          expect(resource.state).toBe('growing');
          expect(resource.growthStartTick).toBe(10);
          expect(resource.growthCompleteTick).toBe(10 + SAPLING_GROWTH_TICKS);
          break;
        }
      }
      expect(foundSapling).toBe(true);

      // Event emitted
      const plantEvent = world.tickEvents.find((e) => e.type === 'tree_planted');
      expect(plantEvent).toBeDefined();
    });

    it('should remove seed from inventory when planting last one', () => {
      const agent = createAgent({
        inventory: [{ id: 'tree_seed', quantity: 1 }],
      });
      world.addAgent(agent);

      const action = makeValidatedAction('agent_test001', {
        type: 'plant',
        seedId: 'tree_seed',
        x: 150,
        y: 150,
      });
      executor.executeBatch([action], world, 10);

      expect(agent.inventory.find((i) => i.id === 'tree_seed')).toBeUndefined();
    });
  });

  describe('Sapling Growth', () => {
    it('should grow sapling into tree after SAPLING_GROWTH_TICKS', () => {
      const sapling = createResource({
        id: 'res_sapling01',
        type: 'sapling',
        state: 'growing',
        remaining: 0,
        maxCapacity: 5,
        growthStartTick: 10,
        growthCompleteTick: 10 + SAPLING_GROWTH_TICKS,
        position: { x: 200, y: 200 },
      });
      world.addResource(sapling);

      // Tick just before completion
      processor.tick(world, 10 + SAPLING_GROWTH_TICKS - 1);
      expect(sapling.type).toBe('sapling');

      // Tick at completion
      processor.tick(world, 10 + SAPLING_GROWTH_TICKS);
      expect(sapling.type).toBe('tree');
      expect(sapling.state).toBe('available');
      expect(sapling.remaining).toBe(5);
      expect(sapling.growthStartTick).toBeNull();
      expect(sapling.growthCompleteTick).toBeNull();

      // Event emitted
      const growthEvent = world.tickEvents.find((e) => e.type === 'tree_grown');
      expect(growthEvent).toBeDefined();
      if (growthEvent && growthEvent.type === 'tree_grown') {
        expect(growthEvent.position).toEqual({ x: 200, y: 200 });
      }
    });
  });

  describe('Watering', () => {
    it('should reduce growth time by WATER_SPEED_BONUS', () => {
      const sapling = createResource({
        id: 'res_sapling01',
        type: 'sapling',
        state: 'growing',
        remaining: 0,
        maxCapacity: 5,
        growthStartTick: 10,
        growthCompleteTick: 10 + SAPLING_GROWTH_TICKS,
        position: { x: 200, y: 200 },
      });
      world.addResource(sapling);

      const agent = createAgent({
        position: { x: 200, y: 200 },
      });
      world.addAgent(agent);

      const originalCompleteTick = sapling.growthCompleteTick!;

      const action = makeValidatedAction('agent_test001', {
        type: 'water',
        x: 200,
        y: 200,
      });
      executor.executeBatch([action], world, 20);

      expect(sapling.growthCompleteTick).toBe(originalCompleteTick - WATER_SPEED_BONUS);
    });

    it('should not reduce growth time below tick + 1', () => {
      const sapling = createResource({
        id: 'res_sapling01',
        type: 'sapling',
        state: 'growing',
        remaining: 0,
        maxCapacity: 5,
        growthStartTick: 10,
        growthCompleteTick: 30, // very close to current tick
        position: { x: 200, y: 200 },
      });
      world.addResource(sapling);

      const agent = createAgent({
        position: { x: 200, y: 200 },
      });
      world.addAgent(agent);

      const action = makeValidatedAction('agent_test001', {
        type: 'water',
        x: 200,
        y: 200,
      });
      // Watering at tick 29, original complete = 30, bonus = 50 → would go to -20
      // Should be capped at tick + 1 = 30
      executor.executeBatch([action], world, 29);

      expect(sapling.growthCompleteTick).toBe(30);
    });

    it('should allow watering to make sapling grow faster, then complete on tick', () => {
      const startTick = 10;
      const sapling = createResource({
        id: 'res_sapling01',
        type: 'sapling',
        state: 'growing',
        remaining: 0,
        maxCapacity: 7,
        growthStartTick: startTick,
        growthCompleteTick: startTick + SAPLING_GROWTH_TICKS,
        position: { x: 200, y: 200 },
      });
      world.addResource(sapling);

      const agent = createAgent({ position: { x: 200, y: 200 } });
      world.addAgent(agent);

      // Water the sapling
      const action = makeValidatedAction('agent_test001', {
        type: 'water',
        x: 200,
        y: 200,
      });
      executor.executeBatch([action], world, 15);

      const newCompleteTick = sapling.growthCompleteTick!;
      expect(newCompleteTick).toBe(startTick + SAPLING_GROWTH_TICKS - WATER_SPEED_BONUS);

      // Tick to the new complete tick
      processor.tick(world, newCompleteTick);

      expect(sapling.type).toBe('tree');
      expect(sapling.state).toBe('available');
      expect(sapling.remaining).toBe(7);
    });
  });

  describe('Seed Drop', () => {
    it('should handle tree depletion with potential seed drop', () => {
      // We just verify the system doesn't crash and handles depletion
      // The seed drop is deterministic based on resource ID + tick
      const agent = createAgent();
      const tree = createResource({ remaining: 1, maxCapacity: 1 });
      world.addAgent(agent);
      world.addResource(tree);

      const action = makeValidatedAction('agent_test001', {
        type: 'gather',
        targetId: 'res_test001',
      });
      executor.executeBatch([action], world, 1);

      for (let t = 1; t <= TREE_GATHER_TICKS; t++) {
        processor.tick(world, t);
      }

      expect(tree.state).toBe('depleted');
      // Seed drop is probabilistic but deterministic. Just check no crash.
    });
  });

  describe('Gathering cancellation', () => {
    it('should stop gathering if agent status changes', () => {
      const agent = createAgent();
      const tree = createResource({ remaining: 5 });
      world.addAgent(agent);
      world.addResource(tree);

      const action = makeValidatedAction('agent_test001', {
        type: 'gather',
        targetId: 'res_test001',
      });
      executor.executeBatch([action], world, 1);

      // Tick once
      processor.tick(world, 1);

      // Agent status changes externally (e.g., got attacked)
      agent.status = 'fighting';

      // Next tick should clean up gathering
      processor.tick(world, 2);

      // No logs should have been gained (didn't complete a full cycle)
      expect(agent.inventory.find((i) => i.id === 'log')).toBeUndefined();
    });

    it('should stop gathering if resource is depleted externally', () => {
      const agent = createAgent();
      const tree = createResource({ remaining: 5 });
      world.addAgent(agent);
      world.addResource(tree);

      const action = makeValidatedAction('agent_test001', {
        type: 'gather',
        targetId: 'res_test001',
      });
      executor.executeBatch([action], world, 1);

      // Externally deplete the resource
      tree.state = 'depleted';

      processor.tick(world, 1);

      expect(agent.status).toBe('idle');
    });
  });

  describe('Integration: full planting lifecycle', () => {
    it('should support full cycle: gather tree → get seed → plant → water → grow', () => {
      const agent = createAgent();
      // Tree with 1 remaining so it depletes quickly
      const tree = createResource({ remaining: 1, maxCapacity: 1 });
      world.addAgent(agent);
      world.addResource(tree);

      // Step 1: Gather the tree
      const gatherAction = makeValidatedAction('agent_test001', {
        type: 'gather',
        targetId: 'res_test001',
      });
      executor.executeBatch([gatherAction], world, 1);

      for (let t = 1; t <= TREE_GATHER_TICKS; t++) {
        processor.tick(world, t);
      }

      expect(tree.state).toBe('depleted');
      expect(agent.status).toBe('idle');
      const logItem = agent.inventory.find((i) => i.id === 'log');
      expect(logItem).toBeDefined();

      // Manually give agent a seed (seed drop is probabilistic)
      agent.inventory.push({ id: 'tree_seed', quantity: 1 });

      // Step 2: Plant seed
      world.tickEvents = [];
      const plantAction = makeValidatedAction('agent_test001', {
        type: 'plant',
        seedId: 'tree_seed',
        x: 300,
        y: 300,
      });
      executor.executeBatch([plantAction], world, TREE_GATHER_TICKS + 1);

      expect(agent.inventory.find((i) => i.id === 'tree_seed')).toBeUndefined();

      // Find the sapling
      let saplingId: string | null = null;
      for (const [id, resource] of world.resources) {
        if (resource.type === 'sapling' && resource.position.x === 300) {
          saplingId = id;
          break;
        }
      }
      expect(saplingId).not.toBeNull();
      const sapling = world.resources.get(saplingId!)!;
      expect(sapling.state).toBe('growing');

      // Step 3: Water the sapling
      const waterTick = TREE_GATHER_TICKS + 5;
      const waterAction = makeValidatedAction('agent_test001', {
        type: 'water',
        x: 300,
        y: 300,
      });
      executor.executeBatch([waterAction], world, waterTick);

      const expectedComplete = sapling.growthCompleteTick!;

      // Step 4: Wait for growth
      processor.tick(world, expectedComplete);

      expect(sapling.type).toBe('tree');
      expect(sapling.state).toBe('available');
      expect(sapling.remaining).toBe(sapling.maxCapacity);
    });
  });
});
