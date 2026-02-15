// tests/tick-loop.test.ts — Tests for TickLoop

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { unlinkSync, existsSync } from 'node:fs';
import { TickLoop } from '../src/server/tick-loop.js';
import { WorldState } from '../src/server/world.js';
import { ActionQueue } from '../src/pipeline/action-queue.js';
import { ActionValidator } from '../src/pipeline/validator.js';
import { ActionExecutor } from '../src/pipeline/executor.js';
import { Database } from '../src/server/db.js';
import type { Agent, RawAction } from '../src/types/index.js';
import { SNAPSHOT_INTERVAL_TICKS, SPAWN_POINT } from '../src/shared/constants.js';

const TEST_DB_PATH = join(import.meta.dirname, 'test-tick-loop.db');
const MIGRATIONS_DIR = join(import.meta.dirname, '..', 'db', 'migrations');

function cleanupDb(): void {
  for (const suffix of ['', '-wal', '-shm']) {
    const path = TEST_DB_PATH + suffix;
    if (existsSync(path)) unlinkSync(path);
  }
}

function createAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: 'agent_test001',
    name: 'TestAgent',
    role: 'fighter',
    position: { x: 500, y: 500 },
    destination: null,
    status: 'idle',
    stats: {
      health: 100,
      maxHealth: 100,
      attack: 15,
      defense: 10,
      speed: 4,
      visionRadius: 100,
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

describe('TickLoop', () => {
  let world: WorldState;
  let actionQueue: ActionQueue;
  let validator: ActionValidator;
  let executor: ActionExecutor;
  let db: Database;
  let tickLoop: TickLoop;

  beforeEach(() => {
    cleanupDb();
    world = new WorldState(42);
    actionQueue = new ActionQueue();
    validator = new ActionValidator();
    executor = new ActionExecutor();
    db = new Database(TEST_DB_PATH);
    db.runMigrations(MIGRATIONS_DIR);
    tickLoop = new TickLoop(world, actionQueue, validator, executor, db);
  });

  afterEach(() => {
    tickLoop.stop();
    db.close();
    cleanupDb();
  });

  describe('tick counter', () => {
    it('should increment tick on each processTick call', () => {
      expect(world.tick).toBe(0);

      tickLoop.processTick();
      expect(world.tick).toBe(1);

      tickLoop.processTick();
      expect(world.tick).toBe(2);

      tickLoop.processTick();
      expect(world.tick).toBe(3);
    });
  });

  describe('action processing', () => {
    it('should process move actions and move agents over 10 ticks', () => {
      const agent1 = createAgent({
        id: 'agent_mover01',
        name: 'Mover1',
        position: { x: 500, y: 500 },
      });
      const agent2 = createAgent({
        id: 'agent_mover02',
        name: 'Mover2',
        position: { x: 100, y: 100 },
      });
      world.addAgent(agent1);
      world.addAgent(agent2);

      // Enqueue move actions
      const rawMove1: RawAction = {
        action: 'move',
        params: { x: 540, y: 500 },
        tick: 0,
      };
      const rawMove2: RawAction = {
        action: 'move',
        params: { x: 100, y: 140 },
        tick: 0,
      };
      actionQueue.enqueue('agent_mover01', rawMove1, 0);
      actionQueue.enqueue('agent_mover02', rawMove2, 0);

      // Run 10 ticks manually
      for (let i = 0; i < 10; i++) {
        tickLoop.processTick();
      }

      const updated1 = world.agents.get('agent_mover01')!;
      const updated2 = world.agents.get('agent_mover02')!;

      // Agent 1: speed=4, distance=40, needs 10 ticks → arrives at tick 10
      expect(updated1.position.x).toBe(540);
      expect(updated1.position.y).toBe(500);
      expect(updated1.status).toBe('idle');
      expect(updated1.destination).toBeNull();

      // Agent 2: speed=4, distance=40, needs 10 ticks → arrives at tick 10
      expect(updated2.position.x).toBe(100);
      expect(updated2.position.y).toBe(140);
      expect(updated2.status).toBe('idle');
      expect(updated2.destination).toBeNull();
    });

    it('should partially move agents within limited ticks', () => {
      const agent = createAgent({
        id: 'agent_mover03',
        name: 'Mover3',
        position: { x: 500, y: 500 },
      });
      world.addAgent(agent);

      actionQueue.enqueue(
        'agent_mover03',
        { action: 'move', params: { x: 600, y: 500 }, tick: 0 },
        0,
      );

      // Run only 5 ticks (speed=4 * 5 = 20 units moved, out of 100)
      for (let i = 0; i < 5; i++) {
        tickLoop.processTick();
      }

      const updated = world.agents.get('agent_mover03')!;
      // After 5 ticks: move action consumed on tick 1 (sets destination+status),
      // processContinuous on tick 1 moves 4 units → x=504
      // ticks 2-5 each move 4 more → x=520
      expect(updated.position.x).toBeCloseTo(520, 0);
      expect(updated.status).toBe('moving');
    });
  });

  describe('rejected actions', () => {
    it('should reject invalid actions (merchant attack) in tick result', () => {
      const merchant = createAgent({
        id: 'agent_merch01',
        name: 'Merchant1',
        role: 'merchant',
        position: { x: 100, y: 100 },
        stats: {
          health: 50,
          maxHealth: 50,
          attack: 0,
          defense: 5,
          speed: 3,
          visionRadius: 80,
        },
      });
      const target = createAgent({
        id: 'agent_target1',
        name: 'Target',
        role: 'monster',
        position: { x: 103, y: 100 },
      });
      world.addAgent(merchant);
      world.addAgent(target);

      actionQueue.enqueue(
        'agent_merch01',
        { action: 'attack', params: { targetId: 'agent_target1' }, tick: 0 },
        0,
      );

      const result = tickLoop.processTick();

      expect(result.rejected).toHaveLength(1);
      expect(result.rejected[0].agentId).toBe('agent_merch01');
      expect(result.rejected[0].reason).toBe('Merchants cannot attack');
      expect(result.executed).toHaveLength(0);
    });
  });

  describe('snapshot persistence', () => {
    it('should call snapshotWorld every SNAPSHOT_INTERVAL_TICKS', () => {
      const agent = createAgent();
      world.addAgent(agent);

      // Run exactly SNAPSHOT_INTERVAL_TICKS ticks
      for (let i = 0; i < SNAPSHOT_INTERVAL_TICKS; i++) {
        tickLoop.processTick();
      }

      // After SNAPSHOT_INTERVAL_TICKS ticks, a snapshot should have been saved
      const tickStr = db.getMetaValue('current_tick');
      expect(tickStr).toBe(String(SNAPSHOT_INTERVAL_TICKS));

      const seedStr = db.getMetaValue('world_seed');
      expect(seedStr).toBe('42');
    });

    it('should NOT snapshot before SNAPSHOT_INTERVAL_TICKS', () => {
      const agent = createAgent();
      world.addAgent(agent);

      // Run fewer ticks than the interval
      for (let i = 0; i < SNAPSHOT_INTERVAL_TICKS - 1; i++) {
        tickLoop.processTick();
      }

      // No snapshot should have been taken yet
      const tickStr = db.getMetaValue('last_snapshot_tick');
      expect(tickStr).toBeNull();
    });
  });

  describe('tick-scoped data clearing', () => {
    it('should clear tickMessages and tickEvents after each tick', () => {
      const agent = createAgent();
      world.addAgent(agent);

      actionQueue.enqueue(
        'agent_test001',
        {
          action: 'talk',
          params: { mode: 'broadcast', message: 'Hello!' },
          tick: 0,
        },
        0,
      );

      tickLoop.processTick();

      // After tick processing, tick-scoped data should be cleared
      expect(world.tickMessages).toHaveLength(0);
      expect(world.tickEvents).toHaveLength(0);
    });

    it('should include events in tick result before clearing', () => {
      const agent = createAgent({
        status: 'dead',
        respawnTick: 1,
        position: { x: 200, y: 200 },
        stats: {
          health: 0,
          maxHealth: 100,
          attack: 15,
          defense: 10,
          speed: 4,
          visionRadius: 100,
        },
      });
      world.addAgent(agent);

      const result = tickLoop.processTick();

      // The tick result should contain the respawn event
      expect(result.events).toHaveLength(1);
      expect(result.events[0].type).toBe('respawn');

      // But the world's tickEvents should be cleared
      expect(world.tickEvents).toHaveLength(0);
    });
  });

  describe('respawn integration', () => {
    it('should respawn dead agents at the right tick', () => {
      const agent = createAgent({
        status: 'dead',
        respawnTick: 5,
        position: { x: 200, y: 200 },
        stats: {
          health: 0,
          maxHealth: 100,
          attack: 15,
          defense: 10,
          speed: 4,
          visionRadius: 100,
        },
      });
      world.addAgent(agent);

      // Run 4 ticks — should NOT respawn
      for (let i = 0; i < 4; i++) {
        tickLoop.processTick();
      }
      expect(world.agents.get('agent_test001')!.status).toBe('dead');

      // Tick 5 — should respawn
      tickLoop.processTick();
      const updated = world.agents.get('agent_test001')!;
      expect(updated.status).toBe('idle');
      expect(updated.stats.health).toBe(100);
      expect(updated.position.x).toBe(SPAWN_POINT.x);
      expect(updated.position.y).toBe(SPAWN_POINT.y);
    });
  });

  describe('tick result', () => {
    it('should return a complete TickResult', () => {
      const agent = createAgent();
      world.addAgent(agent);

      actionQueue.enqueue(
        'agent_test001',
        { action: 'move', params: { x: 510, y: 510 }, tick: 0 },
        0,
      );

      const result = tickLoop.processTick();

      expect(result.tick).toBe(1);
      expect(result.executed).toHaveLength(1);
      expect(result.executed[0].action).toBe('move');
      expect(result.rejected).toHaveLength(0);
      expect(Array.isArray(result.events)).toBe(true);
      expect(Array.isArray(result.stateChanges)).toBe(true);
      expect(Array.isArray(result.spawns)).toBe(true);
    });
  });

  describe('start/stop', () => {
    it('should start and stop the interval without errors', () => {
      tickLoop.start();
      expect(world.tick).toBe(0); // hasn't ticked yet (async)
      tickLoop.stop();
    });

    it('should handle stop being called when not started', () => {
      // Should not throw
      tickLoop.stop();
    });

    it('should handle stop being called multiple times', () => {
      tickLoop.start();
      tickLoop.stop();
      tickLoop.stop(); // second call should be safe
    });
  });
});
