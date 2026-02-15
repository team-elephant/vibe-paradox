// tests/executor.test.ts — Tests for ActionExecutor

import { describe, it, expect, beforeEach } from 'vitest';
import { ActionExecutor } from '../src/pipeline/executor.js';
import { WorldState } from '../src/server/world.js';
import type {
  Agent,
  ValidatedAction,
  ActionParams,
  Resource,
} from '../src/types/index.js';
import { SPAWN_POINT, RESPAWN_TICKS } from '../src/shared/constants.js';

function createAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: 'agent_test001',
    name: 'TestAgent',
    role: 'fighter',
    position: { x: 100, y: 100 },
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

describe('ActionExecutor', () => {
  let executor: ActionExecutor;
  let world: WorldState;

  beforeEach(() => {
    executor = new ActionExecutor();
    world = new WorldState(42);
  });

  describe('executeMove', () => {
    it('should set destination and status to moving', () => {
      const agent = createAgent();
      world.addAgent(agent);

      const action = makeValidatedAction('agent_test001', {
        type: 'move',
        x: 200,
        y: 300,
      });

      executor.executeBatch([action], world, 1);

      const updated = world.agents.get('agent_test001')!;
      expect(updated.status).toBe('moving');
      expect(updated.destination).toEqual({ x: 200, y: 300 });
    });

    it('should clamp destination to world bounds', () => {
      const agent = createAgent();
      world.addAgent(agent);

      const action = makeValidatedAction('agent_test001', {
        type: 'move',
        x: 1500,
        y: -100,
      });

      executor.executeBatch([action], world, 1);

      const updated = world.agents.get('agent_test001')!;
      expect(updated.destination!.x).toBe(999);
      expect(updated.destination!.y).toBe(0);
    });

    it('should return state changes', () => {
      const agent = createAgent();
      world.addAgent(agent);

      const action = makeValidatedAction('agent_test001', {
        type: 'move',
        x: 200,
        y: 300,
      });

      const result = executor.executeBatch([action], world, 1);

      expect(result.stateChanges.length).toBeGreaterThanOrEqual(2);
      const statusChange = result.stateChanges.find(
        (c) => c.field === 'status',
      );
      expect(statusChange).toBeDefined();
      expect(statusChange!.oldValue).toBe('idle');
      expect(statusChange!.newValue).toBe('moving');
    });
  });

  describe('processContinuous — movement', () => {
    it('should advance a moving agent toward destination each tick', () => {
      const agent = createAgent({
        position: { x: 100, y: 100 },
        destination: { x: 200, y: 100 },
        status: 'moving',
        stats: {
          health: 100,
          maxHealth: 100,
          attack: 15,
          defense: 10,
          speed: 4,
          visionRadius: 100,
        },
      });
      world.addAgent(agent);

      executor.processContinuous(world, 1);

      const updated = world.agents.get('agent_test001')!;
      // Speed is 4 units per tick, moving along x-axis
      expect(updated.position.x).toBeCloseTo(104, 5);
      expect(updated.position.y).toBeCloseTo(100, 5);
      expect(updated.status).toBe('moving');
      expect(updated.destination).not.toBeNull();
    });

    it('should advance diagonally toward destination', () => {
      const agent = createAgent({
        position: { x: 0, y: 0 },
        destination: { x: 100, y: 100 },
        status: 'moving',
        stats: {
          health: 100,
          maxHealth: 100,
          attack: 15,
          defense: 10,
          speed: 4,
          visionRadius: 100,
        },
      });
      world.addAgent(agent);

      executor.processContinuous(world, 1);

      const updated = world.agents.get('agent_test001')!;
      // Speed is 4, diagonal distance per component = 4 / sqrt(2) ≈ 2.828
      const expectedMove = 4 / Math.sqrt(2);
      expect(updated.position.x).toBeCloseTo(expectedMove, 5);
      expect(updated.position.y).toBeCloseTo(expectedMove, 5);
    });

    it('should arrive at destination when close enough', () => {
      const agent = createAgent({
        position: { x: 100, y: 100 },
        destination: { x: 103, y: 100 },
        status: 'moving',
        stats: {
          health: 100,
          maxHealth: 100,
          attack: 15,
          defense: 10,
          speed: 4,
          visionRadius: 100,
        },
      });
      world.addAgent(agent);

      executor.processContinuous(world, 1);

      const updated = world.agents.get('agent_test001')!;
      // Distance is 3, speed is 4, so should arrive
      expect(updated.position.x).toBe(103);
      expect(updated.position.y).toBe(100);
      expect(updated.destination).toBeNull();
      expect(updated.status).toBe('idle');
    });

    it('should arrive at exact destination after multiple ticks', () => {
      const agent = createAgent({
        position: { x: 100, y: 100 },
        destination: { x: 120, y: 100 },
        status: 'moving',
        stats: {
          health: 100,
          maxHealth: 100,
          attack: 15,
          defense: 10,
          speed: 4,
          visionRadius: 100,
        },
      });
      world.addAgent(agent);

      // Distance is 20, speed is 4, needs 5 ticks
      for (let t = 1; t <= 5; t++) {
        executor.processContinuous(world, t);
      }

      const updated = world.agents.get('agent_test001')!;
      expect(updated.position.x).toBe(120);
      expect(updated.position.y).toBe(100);
      expect(updated.destination).toBeNull();
      expect(updated.status).toBe('idle');
    });

    it('should not move an idle agent', () => {
      const agent = createAgent({
        position: { x: 100, y: 100 },
        status: 'idle',
      });
      world.addAgent(agent);

      executor.processContinuous(world, 1);

      const updated = world.agents.get('agent_test001')!;
      expect(updated.position.x).toBe(100);
      expect(updated.position.y).toBe(100);
    });
  });

  describe('executeGather', () => {
    it('should set agent status to gathering and resource to being_gathered', () => {
      const agent = createAgent({ role: 'merchant' });
      const resource = createResource();
      world.addAgent(agent);
      world.addResource(resource);

      const action = makeValidatedAction('agent_test001', {
        type: 'gather',
        targetId: 'res_test001',
      });

      executor.executeBatch([action], world, 1);

      const updatedAgent = world.agents.get('agent_test001')!;
      expect(updatedAgent.status).toBe('gathering');

      const updatedResource = world.resources.get('res_test001')!;
      expect(updatedResource.state).toBe('being_gathered');
    });
  });

  describe('executeAttack', () => {
    it('should set agent status to fighting and create combat pair', () => {
      const attacker = createAgent({ id: 'agent_atk001', role: 'fighter' });
      const target = createAgent({
        id: 'agent_def001',
        name: 'Target',
        role: 'monster',
        position: { x: 103, y: 100 },
      });
      world.addAgent(attacker);
      world.addAgent(target);

      const action = makeValidatedAction('agent_atk001', {
        type: 'attack',
        targetId: 'agent_def001',
      });

      executor.executeBatch([action], world, 5);

      const updatedAttacker = world.agents.get('agent_atk001')!;
      expect(updatedAttacker.status).toBe('fighting');
      expect(executor.combatPairs).toHaveLength(1);
      expect(executor.combatPairs[0].attackerId).toBe('agent_atk001');
      expect(executor.combatPairs[0].targetId).toBe('agent_def001');
      expect(executor.combatPairs[0].startTick).toBe(5);
      expect(executor.combatPairs[0].active).toBe(true);
    });
  });

  describe('executeTalk', () => {
    it('should create a broadcast chat message', () => {
      const agent = createAgent();
      world.addAgent(agent);

      const action = makeValidatedAction('agent_test001', {
        type: 'talk',
        mode: 'broadcast',
        message: 'Hello world!',
      });

      executor.executeBatch([action], world, 3);

      expect(world.tickMessages).toHaveLength(1);
      const msg = world.tickMessages[0];
      expect(msg.senderId).toBe('agent_test001');
      expect(msg.senderName).toBe('TestAgent');
      expect(msg.mode).toBe('broadcast');
      expect(msg.content).toBe('Hello world!');
      expect(msg.tick).toBe(3);
      expect(msg.recipients).toBe('all');
    });

    it('should create a whisper chat message with correct recipients', () => {
      const agent = createAgent();
      const target = createAgent({
        id: 'agent_target01',
        name: 'TargetAgent',
        position: { x: 200, y: 200 },
      });
      world.addAgent(agent);
      world.addAgent(target);

      const action = makeValidatedAction('agent_test001', {
        type: 'talk',
        mode: 'whisper',
        message: 'Secret message',
        targetId: 'agent_target01',
      });

      executor.executeBatch([action], world, 3);

      expect(world.tickMessages).toHaveLength(1);
      const msg = world.tickMessages[0];
      expect(msg.mode).toBe('whisper');
      expect(msg.recipients).toEqual(['agent_test001', 'agent_target01']);
    });
  });

  describe('executeIdle', () => {
    it('should not change agent state', () => {
      const agent = createAgent();
      world.addAgent(agent);

      const action = makeValidatedAction('agent_test001', {
        type: 'idle',
      });

      executor.executeBatch([action], world, 1);

      const updated = world.agents.get('agent_test001')!;
      expect(updated.status).toBe('idle');
      expect(updated.position).toEqual({ x: 100, y: 100 });
    });
  });

  describe('processRespawns', () => {
    it('should respawn a dead fighter at spawn point after respawnTick', () => {
      const agent = createAgent({
        status: 'dead',
        respawnTick: 30,
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

      executor.processRespawns(world, 30);

      const updated = world.agents.get('agent_test001')!;
      expect(updated.status).toBe('idle');
      expect(updated.stats.health).toBe(100);
      expect(updated.position.x).toBe(SPAWN_POINT.x);
      expect(updated.position.y).toBe(SPAWN_POINT.y);
      expect(updated.destination).toBeNull();
      expect(updated.respawnTick).toBeNull();
    });

    it('should emit a respawn event', () => {
      const agent = createAgent({
        status: 'dead',
        respawnTick: 30,
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

      executor.processRespawns(world, 30);

      expect(world.tickEvents).toHaveLength(1);
      expect(world.tickEvents[0].type).toBe('respawn');
      if (world.tickEvents[0].type === 'respawn') {
        expect(world.tickEvents[0].agentId).toBe('agent_test001');
        expect(world.tickEvents[0].position).toEqual(SPAWN_POINT);
      }
    });

    it('should NOT respawn a dead agent before respawnTick', () => {
      const agent = createAgent({
        status: 'dead',
        respawnTick: 30,
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

      executor.processRespawns(world, 29);

      const updated = world.agents.get('agent_test001')!;
      expect(updated.status).toBe('dead');
      expect(updated.stats.health).toBe(0);
    });

    it('should NOT respawn a dead monster (permadeath)', () => {
      const monster = createAgent({
        role: 'monster',
        status: 'dead',
        respawnTick: 30,
        isAlive: false,
        stats: {
          health: 0,
          maxHealth: 80,
          attack: 12,
          defense: 8,
          speed: 5,
          visionRadius: 150,
        },
      });
      world.addAgent(monster);

      executor.processRespawns(world, 30);

      const updated = world.agents.get('agent_test001')!;
      expect(updated.status).toBe('dead');
      expect(updated.stats.health).toBe(0);
    });
  });

  describe('executeBatch — multiple actions', () => {
    it('should handle multiple agents executing different actions', () => {
      const agent1 = createAgent({
        id: 'agent_move001',
        name: 'Mover',
      });
      const agent2 = createAgent({
        id: 'agent_talk001',
        name: 'Talker',
        position: { x: 200, y: 200 },
      });
      world.addAgent(agent1);
      world.addAgent(agent2);

      const actions: ValidatedAction[] = [
        makeValidatedAction('agent_move001', {
          type: 'move',
          x: 300,
          y: 300,
        }),
        makeValidatedAction('agent_talk001', {
          type: 'talk',
          mode: 'broadcast',
          message: 'Moving out!',
        }),
      ];

      executor.executeBatch(actions, world, 1);

      const mover = world.agents.get('agent_move001')!;
      expect(mover.status).toBe('moving');
      expect(mover.destination).toEqual({ x: 300, y: 300 });

      expect(world.tickMessages).toHaveLength(1);
      expect(world.tickMessages[0].content).toBe('Moving out!');
    });
  });

  describe('full movement lifecycle', () => {
    it('should move agent from start to destination over multiple ticks', () => {
      const agent = createAgent({
        position: { x: 500, y: 500 },
      });
      world.addAgent(agent);

      // Execute move action
      const action = makeValidatedAction('agent_test001', {
        type: 'move',
        x: 512,
        y: 500,
      });
      executor.executeBatch([action], world, 1);

      expect(world.agents.get('agent_test001')!.status).toBe('moving');

      // Tick 1: move 4 units → x=504
      executor.processContinuous(world, 1);
      const tick1 = world.agents.get('agent_test001')!;
      expect(tick1.position.x).toBeCloseTo(504, 5);
      expect(tick1.status).toBe('moving');

      // Tick 2: move 4 units → x=508
      executor.processContinuous(world, 2);
      const tick2 = world.agents.get('agent_test001')!;
      expect(tick2.position.x).toBeCloseTo(508, 5);
      expect(tick2.status).toBe('moving');

      // Tick 3: remaining is 4, speed is 4 → arrive at x=512
      executor.processContinuous(world, 3);
      const tick3 = world.agents.get('agent_test001')!;
      expect(tick3.position.x).toBe(512);
      expect(tick3.position.y).toBe(500);
      expect(tick3.status).toBe('idle');
      expect(tick3.destination).toBeNull();
    });
  });

  describe('edge cases', () => {
    it('should handle action for nonexistent agent gracefully', () => {
      const action = makeValidatedAction('agent_nonexist', {
        type: 'move',
        x: 100,
        y: 100,
      });

      const result = executor.executeBatch([action], world, 1);
      expect(result.stateChanges).toHaveLength(0);
    });

    it('should handle move to current position (zero distance)', () => {
      const agent = createAgent({
        position: { x: 100, y: 100 },
      });
      world.addAgent(agent);

      const action = makeValidatedAction('agent_test001', {
        type: 'move',
        x: 100,
        y: 100,
      });
      executor.executeBatch([action], world, 1);

      // Even though destination == position, status is set to moving
      expect(world.agents.get('agent_test001')!.status).toBe('moving');

      // processContinuous should arrive immediately (distance is 0, which is <= speed)
      executor.processContinuous(world, 1);
      const updated = world.agents.get('agent_test001')!;
      expect(updated.status).toBe('idle');
      expect(updated.destination).toBeNull();
    });

    it('should cancel movement when a new move action is issued', () => {
      const agent = createAgent({
        position: { x: 100, y: 100 },
        destination: { x: 200, y: 100 },
        status: 'moving',
      });
      world.addAgent(agent);

      // New move action overrides destination
      const action = makeValidatedAction('agent_test001', {
        type: 'move',
        x: 50,
        y: 50,
      });
      executor.executeBatch([action], world, 1);

      const updated = world.agents.get('agent_test001')!;
      expect(updated.destination).toEqual({ x: 50, y: 50 });
      expect(updated.status).toBe('moving');
    });
  });
});
