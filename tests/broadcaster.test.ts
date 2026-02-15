// tests/broadcaster.test.ts — Tests for StateBroadcaster

import { describe, it, expect, beforeEach } from 'vitest';
import { StateBroadcaster } from '../src/server/broadcaster.js';
import { WorldState } from '../src/server/world.js';
import type {
  Agent,
  Resource,
  NpcMonster,
  Behemoth,
  Structure,
  ChatMessage,
  TickResult,
  ServerMessage,
  EntityId,
} from '../src/types/index.js';

// --- Helpers ---

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
    gold: 50,
    inventory: [{ id: 'log', quantity: 3 }],
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
    position: { x: 120, y: 120 },
    remaining: 5,
    maxCapacity: 10,
    state: 'available',
    growthStartTick: null,
    growthCompleteTick: null,
    createdAt: 0,
    ...overrides,
  };
}

function createNpcMonster(overrides: Partial<NpcMonster> = {}): NpcMonster {
  return {
    id: 'npc_test001',
    template: 'weak_goblin',
    position: { x: 110, y: 110 },
    health: 30,
    maxHealth: 30,
    attack: 5,
    defense: 3,
    speed: 3,
    status: 'roaming',
    behavior: 'patrol',
    patrolOrigin: { x: 110, y: 110 },
    patrolRadius: 50,
    targetId: null,
    goldDrop: 10,
    createdAt: 0,
    ...overrides,
  };
}

function createBehemoth(overrides: Partial<Behemoth> = {}): Behemoth {
  return {
    id: 'beh_test001',
    type: 'iron',
    position: { x: 130, y: 130 },
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

function createStructure(overrides: Partial<Structure> = {}): Structure {
  return {
    id: 'str_test001',
    type: 'wooden_wall',
    position: { x: 105, y: 105 },
    owner: 'agent_test001',
    alliance: null,
    createdAt: 0,
    ...overrides,
  };
}

function emptyTickResult(tick: number): TickResult {
  return {
    tick,
    executed: [],
    rejected: [],
    events: [],
    stateChanges: [],
    spawns: [],
  };
}

// Mock WS server that captures sent messages
class MockWsServer {
  sentMessages: Map<EntityId, ServerMessage[]> = new Map();

  sendToAgent(agentId: EntityId, message: ServerMessage): void {
    let msgs = this.sentMessages.get(agentId);
    if (!msgs) {
      msgs = [];
      this.sentMessages.set(agentId, msgs);
    }
    msgs.push(message);
  }

  getMessages(agentId: EntityId): ServerMessage[] {
    return this.sentMessages.get(agentId) || [];
  }

  getTickUpdate(agentId: EntityId): Extract<ServerMessage, { type: 'tick_update' }> | undefined {
    const msgs = this.getMessages(agentId);
    return msgs.find(m => m.type === 'tick_update') as Extract<ServerMessage, { type: 'tick_update' }> | undefined;
  }
}

// --- Tests ---

describe('StateBroadcaster', () => {
  let broadcaster: StateBroadcaster;
  let world: WorldState;
  let mockWs: MockWsServer;

  beforeEach(() => {
    broadcaster = new StateBroadcaster();
    world = new WorldState(42);
    world.tick = 10;
    mockWs = new MockWsServer();
  });

  describe('fog of war — vision radius filtering', () => {
    it('two agents far apart should NOT see each other', () => {
      const agentA = createAgent({
        id: 'agent_A',
        name: 'AgentA',
        position: { x: 100, y: 100 },
        stats: { health: 100, maxHealth: 100, attack: 15, defense: 10, speed: 4, visionRadius: 100 },
      });
      const agentB = createAgent({
        id: 'agent_B',
        name: 'AgentB',
        position: { x: 900, y: 900 },
        stats: { health: 100, maxHealth: 100, attack: 15, defense: 10, speed: 4, visionRadius: 100 },
      });

      world.addAgent(agentA);
      world.addAgent(agentB);

      const tickResult = emptyTickResult(world.tick);
      broadcaster.broadcastTick(world, tickResult, mockWs as any);

      const updateA = mockWs.getTickUpdate('agent_A');
      const updateB = mockWs.getTickUpdate('agent_B');

      expect(updateA).toBeDefined();
      expect(updateB).toBeDefined();

      // A should NOT see B in nearby agents
      expect(updateA!.data.nearby.agents).toHaveLength(0);
      // B should NOT see A in nearby agents
      expect(updateB!.data.nearby.agents).toHaveLength(0);
    });

    it('two agents close together should see each other', () => {
      const agentA = createAgent({
        id: 'agent_A',
        name: 'AgentA',
        position: { x: 100, y: 100 },
        stats: { health: 100, maxHealth: 100, attack: 15, defense: 10, speed: 4, visionRadius: 100 },
      });
      const agentB = createAgent({
        id: 'agent_B',
        name: 'AgentB',
        position: { x: 150, y: 100 },
        stats: { health: 100, maxHealth: 100, attack: 15, defense: 10, speed: 4, visionRadius: 100 },
      });

      world.addAgent(agentA);
      world.addAgent(agentB);

      const tickResult = emptyTickResult(world.tick);
      broadcaster.broadcastTick(world, tickResult, mockWs as any);

      const updateA = mockWs.getTickUpdate('agent_A');
      const updateB = mockWs.getTickUpdate('agent_B');

      // A should see B
      expect(updateA!.data.nearby.agents).toHaveLength(1);
      expect(updateA!.data.nearby.agents[0].id).toBe('agent_B');
      // B should see A
      expect(updateB!.data.nearby.agents).toHaveLength(1);
      expect(updateB!.data.nearby.agents[0].id).toBe('agent_A');
    });

    it('resource within vision appears in nearby.resources', () => {
      const agent = createAgent({
        id: 'agent_A',
        name: 'AgentA',
        position: { x: 100, y: 100 },
        stats: { health: 100, maxHealth: 100, attack: 15, defense: 10, speed: 4, visionRadius: 100 },
      });
      const resource = createResource({
        id: 'res_nearby',
        position: { x: 120, y: 120 },
      });

      world.addAgent(agent);
      world.addResource(resource);

      const tickResult = emptyTickResult(world.tick);
      broadcaster.broadcastTick(world, tickResult, mockWs as any);

      const update = mockWs.getTickUpdate('agent_A');
      expect(update!.data.nearby.resources).toHaveLength(1);
      expect(update!.data.nearby.resources[0].id).toBe('res_nearby');
      expect(update!.data.nearby.resources[0].type).toBe('tree');
      expect(update!.data.nearby.resources[0].remaining).toBe(5);
    });

    it('resource outside vision does NOT appear', () => {
      const agent = createAgent({
        id: 'agent_A',
        name: 'AgentA',
        position: { x: 100, y: 100 },
        stats: { health: 100, maxHealth: 100, attack: 15, defense: 10, speed: 4, visionRadius: 100 },
      });
      const resource = createResource({
        id: 'res_far',
        position: { x: 500, y: 500 },
      });

      world.addAgent(agent);
      world.addResource(resource);

      const tickResult = emptyTickResult(world.tick);
      broadcaster.broadcastTick(world, tickResult, mockWs as any);

      const update = mockWs.getTickUpdate('agent_A');
      expect(update!.data.nearby.resources).toHaveLength(0);
    });

    it('NPC monster within vision appears in nearby.monsters', () => {
      const agent = createAgent({
        id: 'agent_A',
        name: 'AgentA',
        position: { x: 100, y: 100 },
        stats: { health: 100, maxHealth: 100, attack: 15, defense: 10, speed: 4, visionRadius: 100 },
      });
      const npc = createNpcMonster({
        id: 'npc_near',
        position: { x: 130, y: 130 },
      });

      world.addAgent(agent);
      world.addNpcMonster(npc);

      const tickResult = emptyTickResult(world.tick);
      broadcaster.broadcastTick(world, tickResult, mockWs as any);

      const update = mockWs.getTickUpdate('agent_A');
      expect(update!.data.nearby.monsters.some(m => m.id === 'npc_near' && m.isNpc)).toBe(true);
    });

    it('behemoth within vision appears in nearby.behemoths', () => {
      const agent = createAgent({
        id: 'agent_A',
        name: 'AgentA',
        position: { x: 100, y: 100 },
        stats: { health: 100, maxHealth: 100, attack: 15, defense: 10, speed: 4, visionRadius: 100 },
      });
      const behemoth = createBehemoth({
        id: 'beh_near',
        position: { x: 130, y: 130 },
      });

      world.addAgent(agent);
      world.addBehemoth(behemoth);

      const tickResult = emptyTickResult(world.tick);
      broadcaster.broadcastTick(world, tickResult, mockWs as any);

      const update = mockWs.getTickUpdate('agent_A');
      expect(update!.data.nearby.behemoths).toHaveLength(1);
      expect(update!.data.nearby.behemoths[0].id).toBe('beh_near');
      expect(update!.data.nearby.behemoths[0].type).toBe('iron');
    });
  });

  describe('self view', () => {
    it('buildSelfView contains complete agent state', () => {
      const agent = createAgent({
        id: 'agent_A',
        name: 'SelfViewAgent',
        role: 'merchant',
        position: { x: 200, y: 300 },
        gold: 150,
        alliance: 'Wolves',
        kills: 5,
        evolutionStage: 2,
        actionCooldown: 15,
        stats: { health: 40, maxHealth: 50, attack: 0, defense: 5, speed: 3, visionRadius: 80 },
      });

      world.addAgent(agent);

      const tickResult = emptyTickResult(world.tick);
      broadcaster.broadcastTick(world, tickResult, mockWs as any);

      const update = mockWs.getTickUpdate('agent_A');
      expect(update).toBeDefined();

      const self = update!.data.self;
      expect(self.id).toBe('agent_A');
      expect(self.name).toBe('SelfViewAgent');
      expect(self.role).toBe('merchant');
      expect(self.position).toEqual({ x: 200, y: 300 });
      expect(self.health).toBe(40);
      expect(self.maxHealth).toBe(50);
      expect(self.gold).toBe(150);
      expect(self.alliance).toBe('Wolves');
      expect(self.kills).toBe(5);
      expect(self.evolutionStage).toBe(2);
      // actionCooldown should be relative: 15 - 10 (world tick) = 5
      expect(self.actionCooldown).toBe(5);
    });

    it('actionCooldown shows 0 when already expired', () => {
      const agent = createAgent({
        id: 'agent_A',
        actionCooldown: 5, // already past (world tick is 10)
      });

      world.addAgent(agent);

      const tickResult = emptyTickResult(world.tick);
      broadcaster.broadcastTick(world, tickResult, mockWs as any);

      const update = mockWs.getTickUpdate('agent_A');
      expect(update!.data.self.actionCooldown).toBe(0);
    });
  });

  describe('message filtering', () => {
    it('local chat from nearby agent is received, far agent does not get it', () => {
      const agentA = createAgent({
        id: 'agent_A',
        name: 'AgentA',
        position: { x: 100, y: 100 },
        stats: { health: 100, maxHealth: 100, attack: 15, defense: 10, speed: 4, visionRadius: 100 },
      });
      const agentB = createAgent({
        id: 'agent_B',
        name: 'AgentB',
        position: { x: 150, y: 150 },
        stats: { health: 100, maxHealth: 100, attack: 15, defense: 10, speed: 4, visionRadius: 100 },
      });
      const agentC = createAgent({
        id: 'agent_C',
        name: 'AgentC',
        position: { x: 300, y: 300 },
        stats: { health: 100, maxHealth: 100, attack: 15, defense: 10, speed: 4, visionRadius: 100 },
      });

      world.addAgent(agentA);
      world.addAgent(agentB);
      world.addAgent(agentC);

      // Local message from A — B is within 100 range, C is NOT
      const localMsg: ChatMessage = {
        id: 'msg_001',
        tick: 10,
        senderId: 'agent_A',
        senderName: 'AgentA',
        mode: 'local',
        content: 'Hello nearby!',
        targetId: null,
        position: { x: 100, y: 100 },
        recipients: ['agent_A', 'agent_B'], // pre-computed by chat processor
      };
      world.tickMessages.push(localMsg);

      const tickResult = emptyTickResult(world.tick);
      broadcaster.broadcastTick(world, tickResult, mockWs as any);

      const updateA = mockWs.getTickUpdate('agent_A');
      const updateB = mockWs.getTickUpdate('agent_B');
      const updateC = mockWs.getTickUpdate('agent_C');

      // A (sender) should receive it
      expect(updateA!.data.messages).toHaveLength(1);
      expect(updateA!.data.messages[0].content).toBe('Hello nearby!');

      // B (within range) should receive it
      expect(updateB!.data.messages).toHaveLength(1);
      expect(updateB!.data.messages[0].content).toBe('Hello nearby!');

      // C (out of range) should NOT receive it
      expect(updateC!.data.messages).toHaveLength(0);
    });

    it('whisper to agent B — only B receives it', () => {
      const agentA = createAgent({
        id: 'agent_A',
        name: 'AgentA',
        position: { x: 100, y: 100 },
      });
      const agentB = createAgent({
        id: 'agent_B',
        name: 'AgentB',
        position: { x: 900, y: 900 },
      });
      const agentC = createAgent({
        id: 'agent_C',
        name: 'AgentC',
        position: { x: 100, y: 100 },
      });

      world.addAgent(agentA);
      world.addAgent(agentB);
      world.addAgent(agentC);

      const whisperMsg: ChatMessage = {
        id: 'msg_002',
        tick: 10,
        senderId: 'agent_A',
        senderName: 'AgentA',
        mode: 'whisper',
        content: 'Secret message',
        targetId: 'agent_B',
        position: { x: 100, y: 100 },
        recipients: ['agent_A', 'agent_B'],
      };
      world.tickMessages.push(whisperMsg);

      const tickResult = emptyTickResult(world.tick);
      broadcaster.broadcastTick(world, tickResult, mockWs as any);

      const updateA = mockWs.getTickUpdate('agent_A');
      const updateB = mockWs.getTickUpdate('agent_B');
      const updateC = mockWs.getTickUpdate('agent_C');

      // Sender and recipient get the whisper
      expect(updateA!.data.messages).toHaveLength(1);
      expect(updateB!.data.messages).toHaveLength(1);
      // Third party does NOT
      expect(updateC!.data.messages).toHaveLength(0);
    });

    it('broadcast message received by everyone', () => {
      const agentA = createAgent({
        id: 'agent_A',
        name: 'AgentA',
        position: { x: 100, y: 100 },
      });
      const agentB = createAgent({
        id: 'agent_B',
        name: 'AgentB',
        position: { x: 900, y: 900 },
      });

      world.addAgent(agentA);
      world.addAgent(agentB);

      const broadcastMsg: ChatMessage = {
        id: 'msg_003',
        tick: 10,
        senderId: 'agent_A',
        senderName: 'AgentA',
        mode: 'broadcast',
        content: 'Hello world!',
        targetId: null,
        position: { x: 100, y: 100 },
        recipients: 'all',
      };
      world.tickMessages.push(broadcastMsg);

      const tickResult = emptyTickResult(world.tick);
      broadcaster.broadcastTick(world, tickResult, mockWs as any);

      const updateA = mockWs.getTickUpdate('agent_A');
      const updateB = mockWs.getTickUpdate('agent_B');

      expect(updateA!.data.messages).toHaveLength(1);
      expect(updateB!.data.messages).toHaveLength(1);
      expect(updateA!.data.messages[0].mode).toBe('broadcast');
    });
  });

  describe('event filtering', () => {
    it('events about self are always visible regardless of distance', () => {
      const agent = createAgent({
        id: 'agent_A',
        name: 'AgentA',
        position: { x: 100, y: 100 },
        stats: { health: 100, maxHealth: 100, attack: 15, defense: 10, speed: 4, visionRadius: 100 },
      });

      world.addAgent(agent);

      const tickResult = emptyTickResult(world.tick);
      tickResult.events = [
        { type: 'respawn', agentId: 'agent_A', position: { x: 500, y: 500 } },
      ];

      broadcaster.broadcastTick(world, tickResult, mockWs as any);

      const update = mockWs.getTickUpdate('agent_A');
      expect(update!.data.events).toHaveLength(1);
      expect(update!.data.events[0].type).toBe('respawn');
    });

    it('events about distant entities are NOT visible', () => {
      const agent = createAgent({
        id: 'agent_A',
        name: 'AgentA',
        position: { x: 100, y: 100 },
        stats: { health: 100, maxHealth: 100, attack: 15, defense: 10, speed: 4, visionRadius: 100 },
      });
      const farAgent = createAgent({
        id: 'agent_B',
        name: 'AgentB',
        position: { x: 900, y: 900 },
      });

      world.addAgent(agent);
      world.addAgent(farAgent);

      const tickResult = emptyTickResult(world.tick);
      tickResult.events = [
        { type: 'combat_hit', attackerId: 'agent_B', targetId: 'agent_B', damage: 10, targetHealthAfter: 90 },
      ];

      broadcaster.broadcastTick(world, tickResult, mockWs as any);

      const update = mockWs.getTickUpdate('agent_A');
      expect(update!.data.events).toHaveLength(0);
    });
  });

  describe('rejection broadcasting', () => {
    it('rejected actions are sent to the specific agent', () => {
      const agentA = createAgent({
        id: 'agent_A',
        name: 'AgentA',
        position: { x: 100, y: 100 },
      });
      const agentB = createAgent({
        id: 'agent_B',
        name: 'AgentB',
        position: { x: 200, y: 200 },
      });

      world.addAgent(agentA);
      world.addAgent(agentB);

      const tickResult = emptyTickResult(world.tick);
      tickResult.rejected = [
        { agentId: 'agent_A', action: 'attack', reason: 'Merchants cannot attack' },
      ];

      broadcaster.broadcastTick(world, tickResult, mockWs as any);

      const msgsA = mockWs.getMessages('agent_A');
      const msgsB = mockWs.getMessages('agent_B');

      // A should get the rejection
      const rejections = msgsA.filter(m => m.type === 'action_rejected');
      expect(rejections).toHaveLength(1);
      expect((rejections[0] as any).reason).toBe('Merchants cannot attack');

      // B should NOT get A's rejection
      const bRejections = msgsB.filter(m => m.type === 'action_rejected');
      expect(bRejections).toHaveLength(0);
    });
  });

  describe('disconnected agents', () => {
    it('disconnected agents do not receive broadcasts', () => {
      const connected = createAgent({
        id: 'agent_A',
        name: 'ConnectedAgent',
        isConnected: true,
      });
      const disconnected = createAgent({
        id: 'agent_B',
        name: 'DisconnectedAgent',
        isConnected: false,
      });

      world.addAgent(connected);
      world.addAgent(disconnected);

      const tickResult = emptyTickResult(world.tick);
      broadcaster.broadcastTick(world, tickResult, mockWs as any);

      expect(mockWs.getMessages('agent_A').length).toBeGreaterThan(0);
      expect(mockWs.getMessages('agent_B').length).toBe(0);
    });
  });

  describe('public view filtering', () => {
    it('agent does NOT see themselves in nearby.agents', () => {
      const agent = createAgent({
        id: 'agent_A',
        name: 'AgentA',
        position: { x: 100, y: 100 },
      });

      world.addAgent(agent);

      const tickResult = emptyTickResult(world.tick);
      broadcaster.broadcastTick(world, tickResult, mockWs as any);

      const update = mockWs.getTickUpdate('agent_A');
      expect(update!.data.nearby.agents).toHaveLength(0);
    });

    it('nearby agent public view does NOT expose private data (gold, inventory)', () => {
      const agentA = createAgent({
        id: 'agent_A',
        name: 'AgentA',
        position: { x: 100, y: 100 },
        stats: { health: 100, maxHealth: 100, attack: 15, defense: 10, speed: 4, visionRadius: 100 },
      });
      const agentB = createAgent({
        id: 'agent_B',
        name: 'AgentB',
        position: { x: 120, y: 120 },
        gold: 999,
        inventory: [{ id: 'secret_item', quantity: 5 }],
        alliance: 'Wolves',
      });

      world.addAgent(agentA);
      world.addAgent(agentB);

      const tickResult = emptyTickResult(world.tick);
      broadcaster.broadcastTick(world, tickResult, mockWs as any);

      const update = mockWs.getTickUpdate('agent_A');
      const bView = update!.data.nearby.agents[0];

      // Public view should contain these
      expect(bView.id).toBe('agent_B');
      expect(bView.name).toBe('AgentB');
      expect(bView.role).toBe('fighter');
      expect(bView.alliance).toBe('Wolves');
      expect(bView.health).toBeDefined();
      expect(bView.maxHealth).toBeDefined();

      // Public view should NOT have gold or inventory
      expect((bView as any).gold).toBeUndefined();
      expect((bView as any).inventory).toBeUndefined();
    });
  });

  describe('behemoth view', () => {
    it('unconscious behemoth shows remaining ticks', () => {
      const agent = createAgent({
        id: 'agent_A',
        name: 'AgentA',
        position: { x: 100, y: 100 },
        stats: { health: 100, maxHealth: 100, attack: 15, defense: 10, speed: 4, visionRadius: 100 },
      });
      const behemoth = createBehemoth({
        id: 'beh_ko',
        position: { x: 120, y: 120 },
        status: 'unconscious',
        unconsciousUntilTick: 30,
        oreAmount: 5,
      });

      world.addAgent(agent);
      world.addBehemoth(behemoth);

      const tickResult = emptyTickResult(world.tick);
      broadcaster.broadcastTick(world, tickResult, mockWs as any);

      const update = mockWs.getTickUpdate('agent_A');
      const bView = update!.data.nearby.behemoths[0];

      expect(bView.status).toBe('unconscious');
      expect(bView.unconsciousTicksRemaining).toBe(20); // 30 - 10
      expect(bView.oreAvailable).toBe(true);
    });
  });
});
