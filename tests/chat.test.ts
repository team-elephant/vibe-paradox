// tests/chat.test.ts — Tests for ChatProcessor

import { describe, it, expect, beforeEach } from 'vitest';
import { ChatProcessor } from '../src/pipeline/chat-processor.js';
import { WorldState } from '../src/server/world.js';
import type { Agent, ChatMessage } from '../src/types/index.js';
import { LOCAL_CHAT_RADIUS } from '../src/shared/constants.js';

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

function createMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'msg_test0001',
    tick: 1,
    senderId: 'agent_test001',
    senderName: 'TestAgent',
    mode: 'local',
    content: 'Hello!',
    targetId: null,
    position: { x: 100, y: 100 },
    recipients: [],
    ...overrides,
  };
}

describe('ChatProcessor', () => {
  let processor: ChatProcessor;
  let world: WorldState;

  beforeEach(() => {
    processor = new ChatProcessor();
    world = new WorldState(42);
  });

  describe('whisper', () => {
    it('should set recipients to only sender and target', () => {
      const sender = createAgent({ id: 'agent_sender1', name: 'Sender' });
      const target = createAgent({
        id: 'agent_target1',
        name: 'Target',
        position: { x: 900, y: 900 },
      });
      world.addAgent(sender);
      world.addAgent(target);

      const msg = createMessage({
        senderId: 'agent_sender1',
        senderName: 'Sender',
        mode: 'whisper',
        targetId: 'agent_target1',
        position: { x: 100, y: 100 },
      });

      processor.processMessage(msg, world);

      expect(msg.recipients).toEqual(['agent_sender1', 'agent_target1']);
    });

    it('should work at any distance (whisper is not range-limited)', () => {
      const sender = createAgent({
        id: 'agent_sender1',
        name: 'Sender',
        position: { x: 0, y: 0 },
      });
      const target = createAgent({
        id: 'agent_target1',
        name: 'Target',
        position: { x: 999, y: 999 },
      });
      world.addAgent(sender);
      world.addAgent(target);

      const msg = createMessage({
        senderId: 'agent_sender1',
        senderName: 'Sender',
        mode: 'whisper',
        targetId: 'agent_target1',
        position: { x: 0, y: 0 },
      });

      processor.processMessage(msg, world);

      expect(msg.recipients).toEqual(['agent_sender1', 'agent_target1']);
    });

    it('should only include sender when no target is specified', () => {
      const sender = createAgent({ id: 'agent_sender1', name: 'Sender' });
      world.addAgent(sender);

      const msg = createMessage({
        senderId: 'agent_sender1',
        senderName: 'Sender',
        mode: 'whisper',
        targetId: null,
        position: { x: 100, y: 100 },
      });

      processor.processMessage(msg, world);

      expect(msg.recipients).toEqual(['agent_sender1']);
    });
  });

  describe('local', () => {
    it('should include agents within LOCAL_CHAT_RADIUS of sender', () => {
      const sender = createAgent({
        id: 'agent_sender1',
        name: 'Sender',
        position: { x: 100, y: 100 },
      });
      const nearbyAgent = createAgent({
        id: 'agent_nearby1',
        name: 'Nearby',
        position: { x: 150, y: 150 },
      });
      world.addAgent(sender);
      world.addAgent(nearbyAgent);

      const msg = createMessage({
        senderId: 'agent_sender1',
        senderName: 'Sender',
        mode: 'local',
        position: { x: 100, y: 100 },
      });

      processor.processMessage(msg, world);

      expect(msg.recipients).toContain('agent_sender1');
      expect(msg.recipients).toContain('agent_nearby1');
    });

    it('should NOT include agents beyond LOCAL_CHAT_RADIUS', () => {
      const sender = createAgent({
        id: 'agent_sender1',
        name: 'Sender',
        position: { x: 100, y: 100 },
      });
      const farAgent = createAgent({
        id: 'agent_far001',
        name: 'FarAway',
        position: { x: 300, y: 300 },
      });
      world.addAgent(sender);
      world.addAgent(farAgent);

      const msg = createMessage({
        senderId: 'agent_sender1',
        senderName: 'Sender',
        mode: 'local',
        position: { x: 100, y: 100 },
      });

      processor.processMessage(msg, world);

      expect(msg.recipients).toContain('agent_sender1');
      expect(msg.recipients).not.toContain('agent_far001');
    });

    it('should include monster agents within range (monsters can hear local chat)', () => {
      const sender = createAgent({
        id: 'agent_sender1',
        name: 'Sender',
        role: 'merchant',
        position: { x: 100, y: 100 },
      });
      const monster = createAgent({
        id: 'agent_monst01',
        name: 'SneakyMonster',
        role: 'monster',
        position: { x: 90, y: 100 },
        stats: {
          health: 80,
          maxHealth: 80,
          attack: 12,
          defense: 8,
          speed: 5,
          visionRadius: 150,
        },
      });
      world.addAgent(sender);
      world.addAgent(monster);

      const msg = createMessage({
        senderId: 'agent_sender1',
        senderName: 'Sender',
        mode: 'local',
        position: { x: 100, y: 100 },
      });

      processor.processMessage(msg, world);

      expect(msg.recipients).toContain('agent_sender1');
      expect(msg.recipients).toContain('agent_monst01');
    });

    it('should not include non-agent entities (resources, NPCs) in recipients', () => {
      const sender = createAgent({
        id: 'agent_sender1',
        name: 'Sender',
        position: { x: 100, y: 100 },
      });
      world.addAgent(sender);

      // Add a resource nearby — it's tracked by chunk manager but shouldn't be a recipient
      world.addResource({
        id: 'res_test0001',
        type: 'tree',
        position: { x: 102, y: 100 },
        remaining: 5,
        maxCapacity: 5,
        state: 'available',
        growthStartTick: null,
        growthCompleteTick: null,
        createdAt: 0,
      });

      const msg = createMessage({
        senderId: 'agent_sender1',
        senderName: 'Sender',
        mode: 'local',
        position: { x: 100, y: 100 },
      });

      processor.processMessage(msg, world);

      expect(msg.recipients).toContain('agent_sender1');
      expect(msg.recipients).not.toContain('res_test0001');
      expect(Array.isArray(msg.recipients) ? msg.recipients.length : 0).toBe(1);
    });

    it('should include the sender even if they are the only agent', () => {
      const sender = createAgent({
        id: 'agent_sender1',
        name: 'Sender',
        position: { x: 100, y: 100 },
      });
      world.addAgent(sender);

      const msg = createMessage({
        senderId: 'agent_sender1',
        senderName: 'Sender',
        mode: 'local',
        position: { x: 100, y: 100 },
      });

      processor.processMessage(msg, world);

      expect(msg.recipients).toEqual(['agent_sender1']);
    });
  });

  describe('broadcast', () => {
    it('should set recipients to "all"', () => {
      const sender = createAgent({ id: 'agent_sender1', name: 'Sender' });
      world.addAgent(sender);

      const msg = createMessage({
        senderId: 'agent_sender1',
        senderName: 'Sender',
        mode: 'broadcast',
        position: { x: 100, y: 100 },
      });

      processor.processMessage(msg, world);

      expect(msg.recipients).toBe('all');
    });
  });

  describe('integration with multiple agents', () => {
    it('should correctly partition recipients by distance for local chat', () => {
      // Sender at (100, 100)
      const sender = createAgent({
        id: 'agent_sender1',
        name: 'Sender',
        position: { x: 100, y: 100 },
      });
      // Agent at (150, 150) — distance ~70.7, within LOCAL_CHAT_RADIUS (100)
      const nearby1 = createAgent({
        id: 'agent_near001',
        name: 'Near1',
        position: { x: 150, y: 150 },
      });
      // Agent at (190, 100) — distance 90, within LOCAL_CHAT_RADIUS (100)
      const nearby2 = createAgent({
        id: 'agent_near002',
        name: 'Near2',
        position: { x: 190, y: 100 },
      });
      // Agent at (300, 300) — distance ~283, beyond LOCAL_CHAT_RADIUS (100)
      const far = createAgent({
        id: 'agent_far001',
        name: 'Far1',
        position: { x: 300, y: 300 },
      });

      world.addAgent(sender);
      world.addAgent(nearby1);
      world.addAgent(nearby2);
      world.addAgent(far);

      const msg = createMessage({
        senderId: 'agent_sender1',
        senderName: 'Sender',
        mode: 'local',
        position: { x: 100, y: 100 },
      });

      processor.processMessage(msg, world);

      const recipients = msg.recipients as string[];
      expect(recipients).toContain('agent_sender1');
      expect(recipients).toContain('agent_near001');
      expect(recipients).toContain('agent_near002');
      expect(recipients).not.toContain('agent_far001');
      expect(recipients).toHaveLength(3);
    });
  });
});
