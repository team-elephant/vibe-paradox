// tests/alliance.test.ts — Tests for Alliance System (TASK-019)

import { describe, it, expect, beforeEach } from 'vitest';
import { ActionExecutor } from '../src/pipeline/executor.js';
import { ActionValidator } from '../src/pipeline/validator.js';
import { WorldState } from '../src/server/world.js';
import type {
  Agent,
  ValidatedAction,
  ActionParams,
  AgentAction,
} from '../src/types/index.js';

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

function makeAgentAction(
  agentId: string,
  params: ActionParams,
): AgentAction {
  return {
    agentId,
    action: params.type,
    params,
    receivedTick: 0,
    serverTick: 1,
  };
}

describe('Alliance System', () => {
  let executor: ActionExecutor;
  let validator: ActionValidator;
  let world: WorldState;

  beforeEach(() => {
    executor = new ActionExecutor();
    validator = new ActionValidator();
    world = new WorldState(42);
  });

  describe('Form Alliance', () => {
    it('should create an alliance and add founder as member', () => {
      const agent = createAgent();
      world.addAgent(agent);

      const action = makeValidatedAction('agent_test001', {
        type: 'form_alliance',
        name: 'Wolves',
      });

      executor.executeBatch([action], world, 1);

      // Alliance exists
      const alliance = world.alliances.get('Wolves');
      expect(alliance).toBeDefined();
      expect(alliance!.name).toBe('Wolves');
      expect(alliance!.founder).toBe('agent_test001');
      expect(alliance!.members.has('agent_test001')).toBe(true);
      expect(alliance!.members.size).toBe(1);
      expect(alliance!.createdAt).toBe(1);

      // Agent's alliance field is set
      const updated = world.agents.get('agent_test001')!;
      expect(updated.alliance).toBe('Wolves');
    });

    it('should emit alliance_formed event', () => {
      const agent = createAgent();
      world.addAgent(agent);

      const action = makeValidatedAction('agent_test001', {
        type: 'form_alliance',
        name: 'Wolves',
      });

      executor.executeBatch([action], world, 1);

      expect(world.tickEvents).toHaveLength(1);
      expect(world.tickEvents[0].type).toBe('alliance_formed');
      if (world.tickEvents[0].type === 'alliance_formed') {
        expect(world.tickEvents[0].name).toBe('Wolves');
        expect(world.tickEvents[0].founder).toBe('agent_test001');
      }
    });

    it('should return state changes for alliance field', () => {
      const agent = createAgent();
      world.addAgent(agent);

      const action = makeValidatedAction('agent_test001', {
        type: 'form_alliance',
        name: 'Wolves',
      });

      const result = executor.executeBatch([action], world, 1);

      const allianceChange = result.stateChanges.find(
        (c) => c.field === 'alliance',
      );
      expect(allianceChange).toBeDefined();
      expect(allianceChange!.oldValue).toBeNull();
      expect(allianceChange!.newValue).toBe('Wolves');
    });
  });

  describe('Join Alliance', () => {
    it('should add agent to existing alliance', () => {
      const founder = createAgent({ id: 'agent_founder1', name: 'Founder' });
      const joiner = createAgent({ id: 'agent_joiner1', name: 'Joiner' });
      world.addAgent(founder);
      world.addAgent(joiner);

      // First, form the alliance
      executor.executeBatch(
        [makeValidatedAction('agent_founder1', { type: 'form_alliance', name: 'Wolves' })],
        world,
        1,
      );

      // Then join
      executor.executeBatch(
        [makeValidatedAction('agent_joiner1', { type: 'join_alliance', name: 'Wolves' })],
        world,
        2,
      );

      const alliance = world.alliances.get('Wolves')!;
      expect(alliance.members.has('agent_founder1')).toBe(true);
      expect(alliance.members.has('agent_joiner1')).toBe(true);
      expect(alliance.members.size).toBe(2);

      // Both agents show alliance
      expect(world.agents.get('agent_founder1')!.alliance).toBe('Wolves');
      expect(world.agents.get('agent_joiner1')!.alliance).toBe('Wolves');
    });

    it('should emit alliance_joined event', () => {
      const founder = createAgent({ id: 'agent_founder1', name: 'Founder' });
      const joiner = createAgent({ id: 'agent_joiner1', name: 'Joiner' });
      world.addAgent(founder);
      world.addAgent(joiner);

      executor.executeBatch(
        [makeValidatedAction('agent_founder1', { type: 'form_alliance', name: 'Wolves' })],
        world,
        1,
      );
      world.tickEvents = []; // clear

      executor.executeBatch(
        [makeValidatedAction('agent_joiner1', { type: 'join_alliance', name: 'Wolves' })],
        world,
        2,
      );

      expect(world.tickEvents).toHaveLength(1);
      expect(world.tickEvents[0].type).toBe('alliance_joined');
      if (world.tickEvents[0].type === 'alliance_joined') {
        expect(world.tickEvents[0].name).toBe('Wolves');
        expect(world.tickEvents[0].agentId).toBe('agent_joiner1');
      }
    });
  });

  describe('Leave Alliance', () => {
    it('should remove agent from alliance and clear alliance field', () => {
      const agent = createAgent();
      world.addAgent(agent);

      // Form alliance
      executor.executeBatch(
        [makeValidatedAction('agent_test001', { type: 'form_alliance', name: 'Wolves' })],
        world,
        1,
      );

      expect(world.agents.get('agent_test001')!.alliance).toBe('Wolves');

      // Leave alliance
      executor.executeBatch(
        [makeValidatedAction('agent_test001', { type: 'leave_alliance' })],
        world,
        2,
      );

      expect(world.agents.get('agent_test001')!.alliance).toBeNull();
    });

    it('should remove alliance when last member leaves', () => {
      const agent = createAgent();
      world.addAgent(agent);

      // Form alliance
      executor.executeBatch(
        [makeValidatedAction('agent_test001', { type: 'form_alliance', name: 'Wolves' })],
        world,
        1,
      );
      expect(world.alliances.has('Wolves')).toBe(true);

      // Leave — only member
      executor.executeBatch(
        [makeValidatedAction('agent_test001', { type: 'leave_alliance' })],
        world,
        2,
      );

      expect(world.alliances.has('Wolves')).toBe(false);
    });

    it('should not remove alliance when other members remain', () => {
      const founder = createAgent({ id: 'agent_founder1', name: 'Founder' });
      const member = createAgent({ id: 'agent_member1', name: 'Member' });
      world.addAgent(founder);
      world.addAgent(member);

      executor.executeBatch(
        [makeValidatedAction('agent_founder1', { type: 'form_alliance', name: 'Wolves' })],
        world,
        1,
      );
      executor.executeBatch(
        [makeValidatedAction('agent_member1', { type: 'join_alliance', name: 'Wolves' })],
        world,
        2,
      );

      // Founder leaves
      executor.executeBatch(
        [makeValidatedAction('agent_founder1', { type: 'leave_alliance' })],
        world,
        3,
      );

      // Alliance still exists with remaining member
      expect(world.alliances.has('Wolves')).toBe(true);
      const alliance = world.alliances.get('Wolves')!;
      expect(alliance.members.size).toBe(1);
      expect(alliance.members.has('agent_member1')).toBe(true);

      expect(world.agents.get('agent_founder1')!.alliance).toBeNull();
      expect(world.agents.get('agent_member1')!.alliance).toBe('Wolves');
    });

    it('should return state changes for leave', () => {
      const agent = createAgent();
      world.addAgent(agent);

      executor.executeBatch(
        [makeValidatedAction('agent_test001', { type: 'form_alliance', name: 'Wolves' })],
        world,
        1,
      );

      const result = executor.executeBatch(
        [makeValidatedAction('agent_test001', { type: 'leave_alliance' })],
        world,
        2,
      );

      const allianceChange = result.stateChanges.find(
        (c) => c.field === 'alliance',
      );
      expect(allianceChange).toBeDefined();
      expect(allianceChange!.oldValue).toBe('Wolves');
      expect(allianceChange!.newValue).toBeNull();
    });
  });

  describe('Validator — form_alliance', () => {
    it('should reject if alliance name is already taken', () => {
      const agent1 = createAgent({ id: 'agent_a1', name: 'Agent1' });
      const agent2 = createAgent({ id: 'agent_a2', name: 'Agent2' });
      world.addAgent(agent1);
      world.addAgent(agent2);

      // Form alliance first
      executor.executeBatch(
        [makeValidatedAction('agent_a1', { type: 'form_alliance', name: 'Wolves' })],
        world,
        1,
      );

      // Try to form with same name
      const action = makeAgentAction('agent_a2', { type: 'form_alliance', name: 'Wolves' });
      const { validated, rejected } = validator.validateBatch([action], world);

      expect(validated).toHaveLength(0);
      expect(rejected).toHaveLength(1);
      expect(rejected[0].reason).toBe('Alliance name already taken');
    });

    it('should reject if agent is already in an alliance', () => {
      const agent = createAgent();
      world.addAgent(agent);

      executor.executeBatch(
        [makeValidatedAction('agent_test001', { type: 'form_alliance', name: 'Wolves' })],
        world,
        1,
      );

      const action = makeAgentAction('agent_test001', { type: 'form_alliance', name: 'Bears' });
      const { validated, rejected } = validator.validateBatch([action], world);

      expect(validated).toHaveLength(0);
      expect(rejected).toHaveLength(1);
      expect(rejected[0].reason).toBe('Already in an alliance');
    });

    it('should approve forming a new alliance', () => {
      const agent = createAgent();
      world.addAgent(agent);

      const action = makeAgentAction('agent_test001', { type: 'form_alliance', name: 'Wolves' });
      const { validated, rejected } = validator.validateBatch([action], world);

      expect(validated).toHaveLength(1);
      expect(rejected).toHaveLength(0);
    });
  });

  describe('Validator — join_alliance', () => {
    it('should reject if alliance does not exist', () => {
      const agent = createAgent();
      world.addAgent(agent);

      const action = makeAgentAction('agent_test001', { type: 'join_alliance', name: 'Ghosts' });
      const { validated, rejected } = validator.validateBatch([action], world);

      expect(validated).toHaveLength(0);
      expect(rejected).toHaveLength(1);
      expect(rejected[0].reason).toBe('Alliance not found');
    });

    it('should reject if agent is already in an alliance', () => {
      const founder = createAgent({ id: 'agent_founder1', name: 'Founder' });
      const agent = createAgent({ id: 'agent_test001', name: 'TestAgent', alliance: 'Bears' });
      world.addAgent(founder);
      world.addAgent(agent);

      executor.executeBatch(
        [makeValidatedAction('agent_founder1', { type: 'form_alliance', name: 'Wolves' })],
        world,
        1,
      );

      const action = makeAgentAction('agent_test001', { type: 'join_alliance', name: 'Wolves' });
      const { validated, rejected } = validator.validateBatch([action], world);

      expect(validated).toHaveLength(0);
      expect(rejected).toHaveLength(1);
      expect(rejected[0].reason).toBe('Already in an alliance');
    });

    it('should approve joining an existing alliance', () => {
      const founder = createAgent({ id: 'agent_founder1', name: 'Founder' });
      const agent = createAgent();
      world.addAgent(founder);
      world.addAgent(agent);

      executor.executeBatch(
        [makeValidatedAction('agent_founder1', { type: 'form_alliance', name: 'Wolves' })],
        world,
        1,
      );

      const action = makeAgentAction('agent_test001', { type: 'join_alliance', name: 'Wolves' });
      const { validated, rejected } = validator.validateBatch([action], world);

      expect(validated).toHaveLength(1);
      expect(rejected).toHaveLength(0);
    });
  });

  describe('Validator — leave_alliance', () => {
    it('should reject if agent is not in an alliance', () => {
      const agent = createAgent();
      world.addAgent(agent);

      const action = makeAgentAction('agent_test001', { type: 'leave_alliance' });
      const { validated, rejected } = validator.validateBatch([action], world);

      expect(validated).toHaveLength(0);
      expect(rejected).toHaveLength(1);
      expect(rejected[0].reason).toBe('Not in an alliance');
    });

    it('should approve leaving when agent is in an alliance', () => {
      const agent = createAgent();
      world.addAgent(agent);

      executor.executeBatch(
        [makeValidatedAction('agent_test001', { type: 'form_alliance', name: 'Wolves' })],
        world,
        1,
      );

      const action = makeAgentAction('agent_test001', { type: 'leave_alliance' });
      const { validated, rejected } = validator.validateBatch([action], world);

      expect(validated).toHaveLength(1);
      expect(rejected).toHaveLength(0);
    });
  });

  describe('Alliance visible in AgentPublicView', () => {
    it('should show alliance field on agents', () => {
      const agent = createAgent();
      world.addAgent(agent);

      executor.executeBatch(
        [makeValidatedAction('agent_test001', { type: 'form_alliance', name: 'Wolves' })],
        world,
        1,
      );

      const updated = world.agents.get('agent_test001')!;
      // The alliance field is on the Agent type which feeds into AgentPublicView
      expect(updated.alliance).toBe('Wolves');
    });
  });

  describe('Full lifecycle', () => {
    it('should handle form → join → leave cycle', () => {
      const founder = createAgent({ id: 'agent_founder1', name: 'Founder' });
      const member1 = createAgent({ id: 'agent_member1', name: 'Member1' });
      const member2 = createAgent({ id: 'agent_member2', name: 'Member2' });
      world.addAgent(founder);
      world.addAgent(member1);
      world.addAgent(member2);

      // Founder creates alliance
      executor.executeBatch(
        [makeValidatedAction('agent_founder1', { type: 'form_alliance', name: 'Wolves' })],
        world,
        1,
      );

      // Two members join
      executor.executeBatch(
        [makeValidatedAction('agent_member1', { type: 'join_alliance', name: 'Wolves' })],
        world,
        2,
      );
      executor.executeBatch(
        [makeValidatedAction('agent_member2', { type: 'join_alliance', name: 'Wolves' })],
        world,
        3,
      );

      const alliance = world.alliances.get('Wolves')!;
      expect(alliance.members.size).toBe(3);

      // Member1 leaves
      executor.executeBatch(
        [makeValidatedAction('agent_member1', { type: 'leave_alliance' })],
        world,
        4,
      );

      expect(world.alliances.get('Wolves')!.members.size).toBe(2);
      expect(world.agents.get('agent_member1')!.alliance).toBeNull();

      // Member1 can now join another alliance
      executor.executeBatch(
        [makeValidatedAction('agent_member1', { type: 'form_alliance', name: 'Bears' })],
        world,
        5,
      );

      expect(world.agents.get('agent_member1')!.alliance).toBe('Bears');
      expect(world.alliances.has('Bears')).toBe(true);
    });
  });
});
