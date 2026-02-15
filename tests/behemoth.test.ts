// tests/behemoth.test.ts — Tests for BehemothProcessor

import { describe, it, expect, beforeEach } from 'vitest';
import { BehemothProcessor } from '../src/pipeline/behemoth-processor.js';
import { ActionExecutor } from '../src/pipeline/executor.js';
import { WorldState } from '../src/server/world.js';
import type {
  Agent,
  Behemoth,
  ValidatedAction,
  ActionParams,
} from '../src/types/index.js';
import {
  BEHEMOTH_FEED_THRESHOLD,
  BEHEMOTH_ORE_GROWTH_TICKS,
  BEHEMOTH_UNCONSCIOUS_TICKS,
  BEHEMOTH_THROW_DAMAGE_PERCENT,
  RESPAWN_TICKS,
} from '../src/shared/constants.js';

function createAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: 'agent_test001',
    name: 'TestAgent',
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

function createBehemoth(overrides: Partial<Behemoth> = {}): Behemoth {
  return {
    id: 'beh_test0001',
    type: 'iron',
    position: { x: 100, y: 100 },
    health: 500,
    maxHealth: 500,
    attack: 30,
    defense: 20,
    status: 'roaming',
    oreAmount: 0,
    oreMax: 15,
    fedAmount: 0,
    unconsciousUntilTick: null,
    route: [],
    currentWaypoint: 0,
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

/** Helper: run processor tick and have executor handle throw-offs */
function tickWithThrowOffs(
  processor: BehemothProcessor,
  executor: ActionExecutor,
  world: WorldState,
  tick: number,
): void {
  const throwOffs = processor.tick(world, tick);
  if (throwOffs.length > 0) {
    executor.processThrowOffs(throwOffs, world, tick);
  }
}

describe('BehemothProcessor', () => {
  let processor: BehemothProcessor;
  let executor: ActionExecutor;
  let world: WorldState;

  beforeEach(() => {
    processor = new BehemothProcessor();
    executor = new ActionExecutor();
    executor.behemothProcessor = processor;
    world = new WorldState(42);
  });

  describe('feeding', () => {
    it('should increment fed_amount when behemoth is fed', () => {
      const behemoth = createBehemoth();
      world.addBehemoth(behemoth);

      const agent = createAgent({
        inventory: [{ id: 'food', quantity: 5 }],
      });
      world.addAgent(agent);

      const action = makeValidatedAction('agent_test001', {
        type: 'feed',
        behemothId: 'beh_test0001',
        itemId: 'food',
      });

      executor.executeBatch([action], world, 1);

      const updated = world.behemoths.get('beh_test0001')!;
      expect(updated.fedAmount).toBe(1);
    });

    it('should remove food item from agent inventory', () => {
      const behemoth = createBehemoth();
      world.addBehemoth(behemoth);

      const agent = createAgent({
        inventory: [{ id: 'food', quantity: 3 }],
      });
      world.addAgent(agent);

      const action = makeValidatedAction('agent_test001', {
        type: 'feed',
        behemothId: 'beh_test0001',
        itemId: 'food',
      });

      executor.executeBatch([action], world, 1);

      const updated = world.agents.get('agent_test001')!;
      expect(updated.inventory[0]!.quantity).toBe(2);
    });

    it('should remove item entirely when quantity reaches 0', () => {
      const behemoth = createBehemoth();
      world.addBehemoth(behemoth);

      const agent = createAgent({
        inventory: [{ id: 'food', quantity: 1 }],
      });
      world.addAgent(agent);

      const action = makeValidatedAction('agent_test001', {
        type: 'feed',
        behemothId: 'beh_test0001',
        itemId: 'food',
      });

      executor.executeBatch([action], world, 1);

      const updated = world.agents.get('agent_test001')!;
      expect(updated.inventory).toHaveLength(0);
    });

    it('should start ore growth after feeding threshold reached', () => {
      const behemoth = createBehemoth();
      world.addBehemoth(behemoth);

      // Feed the behemoth BEHEMOTH_FEED_THRESHOLD times
      for (let i = 0; i < BEHEMOTH_FEED_THRESHOLD; i++) {
        const agent = createAgent({
          id: `agent_feed_${i}`,
          name: `Feeder${i}`,
          inventory: [{ id: 'food', quantity: 1 }],
        });
        world.addAgent(agent);

        const action = makeValidatedAction(`agent_feed_${i}`, {
          type: 'feed',
          behemothId: 'beh_test0001',
          itemId: 'food',
        });

        executor.executeBatch([action], world, i + 1);
      }

      expect(behemoth.fedAmount).toBe(BEHEMOTH_FEED_THRESHOLD);

      // Ore should not be available yet — growth timer must elapse
      expect(behemoth.oreAmount).toBe(0);

      // Tick until ore growth completes
      const growthCompleteTick = BEHEMOTH_FEED_THRESHOLD + BEHEMOTH_ORE_GROWTH_TICKS;
      for (let t = BEHEMOTH_FEED_THRESHOLD + 1; t <= growthCompleteTick; t++) {
        processor.tick(world, t);
      }

      // Ore should now be available
      expect(behemoth.oreAmount).toBeGreaterThan(0);
      expect(behemoth.oreAmount).toBeLessThanOrEqual(behemoth.oreMax);
    });
  });

  describe('knockout', () => {
    it('should transition to unconscious when health reaches 0', () => {
      const behemoth = createBehemoth({ health: 0 });
      world.addBehemoth(behemoth);

      processor.tick(world, 10);

      const updated = world.behemoths.get('beh_test0001')!;
      expect(updated.status).toBe('unconscious');
      expect(updated.unconsciousUntilTick).toBe(10 + BEHEMOTH_UNCONSCIOUS_TICKS);
    });

    it('should emit behemoth_knockout event', () => {
      const behemoth = createBehemoth({ health: 0 });
      world.addBehemoth(behemoth);

      processor.tick(world, 10);

      const knockoutEvent = world.tickEvents.find(
        (e) => e.type === 'behemoth_knockout',
      );
      expect(knockoutEvent).toBeDefined();
      if (knockoutEvent && knockoutEvent.type === 'behemoth_knockout') {
        expect(knockoutEvent.behemothId).toBe('beh_test0001');
      }
    });
  });

  describe('climbing', () => {
    it('should allow merchant to climb unconscious behemoth', () => {
      const behemoth = createBehemoth({
        status: 'unconscious',
        health: 0,
        unconsciousUntilTick: 100,
        oreAmount: 10,
      });
      world.addBehemoth(behemoth);

      const agent = createAgent();
      world.addAgent(agent);

      const action = makeValidatedAction('agent_test001', {
        type: 'climb',
        behemothId: 'beh_test0001',
      });

      executor.executeBatch([action], world, 50);

      const updated = world.agents.get('agent_test001')!;
      expect(updated.status).toBe('climbing');

      // Check climber is registered
      const climbers = processor.getClimbers('beh_test0001');
      expect(climbers.has('agent_test001')).toBe(true);
    });
  });

  describe('waking', () => {
    it('should wake up after unconscious timer expires', () => {
      const behemoth = createBehemoth({
        status: 'unconscious',
        health: 0,
        unconsciousUntilTick: 70,
        oreAmount: 10,
      });
      world.addBehemoth(behemoth);

      tickWithThrowOffs(processor, executor, world, 70);

      const updated = world.behemoths.get('beh_test0001')!;
      expect(updated.status).toBe('roaming');
      expect(updated.health).toBe(updated.maxHealth);
      expect(updated.oreAmount).toBe(0);
      expect(updated.fedAmount).toBe(0);
      expect(updated.unconsciousUntilTick).toBeNull();
    });

    it('should throw off climbing merchants on wake via executor', () => {
      const behemoth = createBehemoth({
        status: 'unconscious',
        health: 0,
        unconsciousUntilTick: 70,
        oreAmount: 10,
      });
      world.addBehemoth(behemoth);

      const merchant = createAgent({
        id: 'agent_climb01',
        name: 'Climber',
        status: 'climbing',
        stats: {
          health: 50,
          maxHealth: 50,
          attack: 0,
          defense: 5,
          speed: 3,
          visionRadius: 80,
        },
      });
      world.addAgent(merchant);
      processor.registerClimber('beh_test0001', 'agent_climb01');

      // Processor returns throw-offs, executor applies damage
      tickWithThrowOffs(processor, executor, world, 70);

      const updatedMerchant = world.agents.get('agent_climb01')!;
      // 50% of maxHealth (50) = 25 damage. 50 - 25 = 25
      expect(updatedMerchant.stats.health).toBe(25);
      expect(updatedMerchant.status).toBe('idle');

      // Climbers should be cleared
      expect(processor.getClimbers('beh_test0001').size).toBe(0);
    });

    it('should deal 50% max HP damage to thrown merchants', () => {
      const behemoth = createBehemoth({
        status: 'unconscious',
        health: 0,
        unconsciousUntilTick: 70,
      });
      world.addBehemoth(behemoth);

      const merchant = createAgent({
        id: 'agent_climb01',
        name: 'Climber',
        status: 'climbing',
        stats: {
          health: 50,
          maxHealth: 50,
          attack: 0,
          defense: 5,
          speed: 3,
          visionRadius: 80,
        },
      });
      world.addAgent(merchant);
      processor.registerClimber('beh_test0001', 'agent_climb01');

      tickWithThrowOffs(processor, executor, world, 70);

      const updated = world.agents.get('agent_climb01')!;
      const expectedDamage = Math.floor(50 * BEHEMOTH_THROW_DAMAGE_PERCENT);
      expect(updated.stats.health).toBe(50 - expectedDamage);
    });

    it('should kill merchant if throw damage exceeds remaining health', () => {
      const behemoth = createBehemoth({
        status: 'unconscious',
        health: 0,
        unconsciousUntilTick: 70,
      });
      world.addBehemoth(behemoth);

      // Merchant with very low health
      const merchant = createAgent({
        id: 'agent_climb01',
        name: 'WeakClimber',
        status: 'climbing',
        stats: {
          health: 10,
          maxHealth: 50,
          attack: 0,
          defense: 5,
          speed: 3,
          visionRadius: 80,
        },
      });
      world.addAgent(merchant);
      processor.registerClimber('beh_test0001', 'agent_climb01');

      tickWithThrowOffs(processor, executor, world, 70);

      const updated = world.agents.get('agent_climb01')!;
      // 50% of 50 maxHealth = 25 damage, 10 - 25 = -15 → clamped to 0
      expect(updated.stats.health).toBe(0);
      expect(updated.status).toBe('dead');
      expect(updated.respawnTick).toBe(70 + RESPAWN_TICKS);
    });

    it('should emit behemoth_wake event with thrown off agents', () => {
      const behemoth = createBehemoth({
        status: 'unconscious',
        health: 0,
        unconsciousUntilTick: 70,
      });
      world.addBehemoth(behemoth);

      const merchant1 = createAgent({
        id: 'agent_climb01',
        name: 'Climber1',
        status: 'climbing',
      });
      const merchant2 = createAgent({
        id: 'agent_climb02',
        name: 'Climber2',
        status: 'climbing',
        position: { x: 101, y: 100 },
      });
      world.addAgent(merchant1);
      world.addAgent(merchant2);
      processor.registerClimber('beh_test0001', 'agent_climb01');
      processor.registerClimber('beh_test0001', 'agent_climb02');

      tickWithThrowOffs(processor, executor, world, 70);

      const wakeEvent = world.tickEvents.find((e) => e.type === 'behemoth_wake');
      expect(wakeEvent).toBeDefined();
      if (wakeEvent && wakeEvent.type === 'behemoth_wake') {
        expect(wakeEvent.behemothId).toBe('beh_test0001');
        expect(wakeEvent.thrownOff).toHaveLength(2);
        expect(wakeEvent.thrownOff).toContain('agent_climb01');
        expect(wakeEvent.thrownOff).toContain('agent_climb02');
      }
    });

    it('should reset behemoth health after waking', () => {
      const behemoth = createBehemoth({
        status: 'unconscious',
        health: 0,
        maxHealth: 500,
        unconsciousUntilTick: 70,
        oreAmount: 10,
        fedAmount: 15,
      });
      world.addBehemoth(behemoth);

      tickWithThrowOffs(processor, executor, world, 70);

      const updated = world.behemoths.get('beh_test0001')!;
      expect(updated.health).toBe(500);
      expect(updated.oreAmount).toBe(0);
      expect(updated.fedAmount).toBe(0);
      expect(updated.status).toBe('roaming');
    });
  });

  describe('roaming movement', () => {
    it('should follow route waypoints', () => {
      const behemoth = createBehemoth({
        position: { x: 100, y: 100 },
        route: [
          { x: 200, y: 100 },
          { x: 200, y: 200 },
          { x: 100, y: 200 },
          { x: 100, y: 100 },
        ],
        currentWaypoint: 0,
      });
      world.addBehemoth(behemoth);

      // Behemoth speed is 2 units/tick, distance to first waypoint is 100
      // After 1 tick should move 2 units toward (200, 100)
      processor.tick(world, 1);

      const updated = world.behemoths.get('beh_test0001')!;
      expect(updated.position.x).toBeCloseTo(102, 0);
      expect(updated.position.y).toBeCloseTo(100, 0);
    });

    it('should advance to next waypoint when reached', () => {
      const behemoth = createBehemoth({
        position: { x: 199, y: 100 },
        route: [
          { x: 200, y: 100 },
          { x: 200, y: 200 },
        ],
        currentWaypoint: 0,
      });
      world.addBehemoth(behemoth);

      // Distance is 1, speed is 2, should arrive
      processor.tick(world, 1);

      const updated = world.behemoths.get('beh_test0001')!;
      expect(updated.position.x).toBe(200);
      expect(updated.position.y).toBe(100);
      expect(updated.currentWaypoint).toBe(1);
    });

    it('should wrap waypoint index back to 0', () => {
      const behemoth = createBehemoth({
        position: { x: 199, y: 100 },
        route: [
          { x: 100, y: 100 },
          { x: 200, y: 100 },
        ],
        currentWaypoint: 1, // Last waypoint
      });
      world.addBehemoth(behemoth);

      // Distance is 1, speed is 2, should arrive at waypoint 1 and wrap to 0
      processor.tick(world, 1);

      const updated = world.behemoths.get('beh_test0001')!;
      expect(updated.currentWaypoint).toBe(0);
    });

    it('should not move if no route', () => {
      const behemoth = createBehemoth({
        position: { x: 100, y: 100 },
        route: [],
      });
      world.addBehemoth(behemoth);

      processor.tick(world, 1);

      const updated = world.behemoths.get('beh_test0001')!;
      expect(updated.position.x).toBe(100);
      expect(updated.position.y).toBe(100);
    });
  });

  describe('processThrowOffs (executor)', () => {
    it('should apply damage via executor.processThrowOffs', () => {
      const agent = createAgent({
        id: 'agent_climb01',
        name: 'Climber',
        status: 'climbing',
        stats: {
          health: 40,
          maxHealth: 40,
          attack: 0,
          defense: 5,
          speed: 3,
          visionRadius: 80,
        },
      });
      world.addAgent(agent);

      executor.processThrowOffs(
        [{ behemothId: 'beh_test0001', agentIds: ['agent_climb01'] }],
        world,
        100,
      );

      const updated = world.agents.get('agent_climb01')!;
      const expectedDamage = Math.floor(40 * BEHEMOTH_THROW_DAMAGE_PERCENT);
      expect(updated.stats.health).toBe(40 - expectedDamage);
      expect(updated.status).toBe('idle');
    });
  });

  describe('full lifecycle', () => {
    it('should complete feed → ore growth → knockout → climb → wake cycle', () => {
      const behemoth = createBehemoth({
        route: [], // Stationary for test simplicity
      });
      world.addBehemoth(behemoth);

      // Step 1: Feed the behemoth BEHEMOTH_FEED_THRESHOLD times
      let currentTick = 1;
      for (let i = 0; i < BEHEMOTH_FEED_THRESHOLD; i++) {
        const feeder = createAgent({
          id: `agent_feeder${i}`,
          name: `Feeder${i}`,
          inventory: [{ id: 'food', quantity: 1 }],
        });
        world.addAgent(feeder);

        const action = makeValidatedAction(`agent_feeder${i}`, {
          type: 'feed',
          behemothId: 'beh_test0001',
          itemId: 'food',
        });

        executor.executeBatch([action], world, currentTick);
        processor.tick(world, currentTick);
        world.tickEvents = [];
        currentTick++;
      }

      expect(behemoth.fedAmount).toBe(BEHEMOTH_FEED_THRESHOLD);

      // Step 2: Wait for ore growth
      const oreReadyTick = currentTick + BEHEMOTH_ORE_GROWTH_TICKS;
      for (; currentTick <= oreReadyTick; currentTick++) {
        processor.tick(world, currentTick);
        world.tickEvents = [];
      }

      expect(behemoth.oreAmount).toBeGreaterThan(0);

      // Step 3: Fighter attacks behemoth to 0 HP
      behemoth.health = 0;
      processor.tick(world, currentTick);

      expect(behemoth.status).toBe('unconscious');
      expect(behemoth.unconsciousUntilTick).toBe(currentTick + BEHEMOTH_UNCONSCIOUS_TICKS);
      world.tickEvents = [];
      currentTick++;

      // Step 4: Merchant climbs and mines ores
      const miner = createAgent({
        id: 'agent_miner01',
        name: 'Miner',
      });
      world.addAgent(miner);

      const climbAction = makeValidatedAction('agent_miner01', {
        type: 'climb',
        behemothId: 'beh_test0001',
      });

      executor.executeBatch([climbAction], world, currentTick);
      expect(world.agents.get('agent_miner01')!.status).toBe('climbing');
      expect(processor.getClimbers('beh_test0001').has('agent_miner01')).toBe(true);

      // Step 5: Advance to wake-up tick
      const wakeTick = behemoth.unconsciousUntilTick!;
      for (; currentTick < wakeTick; currentTick++) {
        tickWithThrowOffs(processor, executor, world, currentTick);
        world.tickEvents = [];
      }

      // Step 6: Wake up — merchant gets thrown off (executor handles damage)
      tickWithThrowOffs(processor, executor, world, wakeTick);

      expect(behemoth.status).toBe('roaming');
      expect(behemoth.health).toBe(behemoth.maxHealth);
      expect(behemoth.oreAmount).toBe(0);

      const minerAfter = world.agents.get('agent_miner01')!;
      expect(minerAfter.status === 'idle' || minerAfter.status === 'dead').toBe(true);

      const wakeEvent = world.tickEvents.find((e) => e.type === 'behemoth_wake');
      expect(wakeEvent).toBeDefined();
      if (wakeEvent && wakeEvent.type === 'behemoth_wake') {
        expect(wakeEvent.thrownOff).toContain('agent_miner01');
      }
    });
  });
});
