// tests/agent-memory.test.ts — Tests for AgentMemory + memory-aware prompt assembly

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, unlinkSync, mkdirSync, rmSync } from 'node:fs';
import { AgentMemory } from '../agent/memory.js';
import { assemblePrompt } from '../agent/prompt-assembler.js';
import { StateBuffer } from '../agent/state-buffer.js';
import type { TickUpdateData } from '../src/types/index.js';
import type { AgentConfig } from '../agent/config.js';

// --- Helpers ---

function makeTickUpdate(overrides: Partial<TickUpdateData> & { tick: number }): TickUpdateData {
  return {
    tick: overrides.tick,
    self: {
      id: 'agent_test01',
      name: 'TestBot',
      role: 'fighter',
      position: { x: 100, y: 200 },
      status: 'idle',
      health: 100,
      maxHealth: 100,
      attack: 15,
      defense: 10,
      speed: 4,
      gold: 50,
      inventory: [],
      equipment: { weapon: null, armor: null, tool: null },
      alliance: null,
      kills: 0,
      evolutionStage: 1,
      actionCooldown: 0,
      ...overrides.self,
    },
    nearby: {
      agents: [],
      resources: [],
      monsters: [],
      behemoths: [],
      structures: [],
      ...overrides.nearby,
    },
    messages: overrides.messages ?? [],
    events: overrides.events ?? [],
  };
}

function makeConfig(overrides?: Partial<AgentConfig>): AgentConfig {
  return {
    serverUrl: 'ws://localhost:8080',
    name: 'TestBot',
    role: 'fighter',
    apiKey: 'test-key',
    model: 'claude-sonnet-4-5-20250929',
    maxTokens: 200,
    temperature: 0.7,
    idleTimeout: 5,
    maxEventsInPrompt: 5,
    maxMessagesInPrompt: 3,
    decisionCooldown: 2,
    ...overrides,
  };
}

const TEST_DIR = 'test-data-memory';
const TEST_FILE = `${TEST_DIR}/test-agent.memory.json`;

// --- AgentMemory Tests ---

describe('AgentMemory', () => {
  beforeEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true });
    }
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true });
    }
  });

  describe('serialization roundtrip', () => {
    it('serializes and deserializes all data intact', () => {
      const memory = new AgentMemory();

      // Add decisions
      memory.recordDecisionWithTick(10, 'move', { x: 100, y: 200 }, 'exploring', 'success');
      memory.recordDecisionWithTick(12, 'attack', { targetId: 'npc_1' }, 'hunting', 'rejected', 'Too far');

      // Add known agents
      memory.recordAgentMet('Fighter_001', 'fighter', 'Wolves', 50, { x: 300, y: 400 });
      memory.recordAgentMet('Merchant_001', 'merchant', null, 55, { x: 100, y: 100 });

      // Add resources
      memory.recordResourceFound({ x: 200, y: 300 }, 'tree', 10);
      memory.recordResourceFound({ x: 800, y: 100 }, 'gold_vein', 15);

      // Add threats
      memory.recordThreat('Monster_X', 'monster', { x: 600, y: 400 }, 20, 'survived');

      // Add trades
      memory.recordTrade('Merchant_001', '50 gold', '1x iron_sword', 30);

      // Add deaths
      memory.recordDeath({ x: 600, y: 400 }, 'Monster_X', 25);

      // Serialize + deserialize
      const json = memory.serialize();
      const restored = AgentMemory.fromSerialized(json);

      expect(restored.decisions).toHaveLength(2);
      expect(restored.decisions[0].action).toBe('move');
      expect(restored.decisions[0].outcome).toBe('success');
      expect(restored.decisions[1].action).toBe('attack');
      expect(restored.decisions[1].outcome).toBe('rejected');
      expect(restored.decisions[1].rejectionReason).toBe('Too far');

      expect(restored.knownAgents.size).toBe(2);
      expect(restored.knownAgents.get('Fighter_001')!.role).toBe('fighter');
      expect(restored.knownAgents.get('Fighter_001')!.alliance).toBe('Wolves');
      expect(restored.knownAgents.get('Merchant_001')!.role).toBe('merchant');

      expect(restored.knownResources).toHaveLength(2);
      expect(restored.knownResources[0].type).toBe('tree');
      expect(restored.knownResources[1].type).toBe('gold_vein');

      expect(restored.threats).toHaveLength(1);
      expect(restored.threats[0].attackerName).toBe('Monster_X');
      expect(restored.threats[0].outcome).toBe('survived');

      expect(restored.trades).toHaveLength(1);
      expect(restored.trades[0].partnerName).toBe('Merchant_001');

      expect(restored.deaths).toHaveLength(1);
      expect(restored.deaths[0].killerName).toBe('Monster_X');
      expect(restored.deaths[0].position).toEqual({ x: 600, y: 400 });
    });
  });

  describe('file persistence', () => {
    it('save and load roundtrip via file', () => {
      const memory = new AgentMemory();
      memory.recordDecisionWithTick(1, 'move', { x: 100, y: 200 }, 'go', 'success');
      memory.recordAgentMet('Ally', 'merchant', null, 5, { x: 50, y: 50 });
      memory.save(TEST_FILE);

      expect(existsSync(TEST_FILE)).toBe(true);

      const loaded = AgentMemory.load(TEST_FILE);
      expect(loaded.decisions).toHaveLength(1);
      expect(loaded.knownAgents.size).toBe(1);
    });

    it('load returns empty memory when file does not exist', () => {
      const loaded = AgentMemory.load('nonexistent/path/memory.json');
      expect(loaded.decisions).toHaveLength(0);
      expect(loaded.knownAgents.size).toBe(0);
    });
  });

  describe('decision truncation', () => {
    it('keeps only last 20 decisions when adding 25', () => {
      const memory = new AgentMemory();
      for (let i = 0; i < 25; i++) {
        memory.recordDecisionWithTick(i, 'move', { x: i }, `plan_${i}`, 'success');
      }
      expect(memory.decisions).toHaveLength(20);
      // Should keep decisions 5-24
      expect(memory.decisions[0].tick).toBe(5);
      expect(memory.decisions[19].tick).toBe(24);
    });
  });

  describe('death tracking', () => {
    it('records deaths at same position', () => {
      const memory = new AgentMemory();
      memory.recordDeath({ x: 600, y: 400 }, 'MonsterA', 100);
      memory.recordDeath({ x: 600, y: 400 }, 'MonsterB', 200);
      expect(memory.deaths).toHaveLength(2);
      expect(memory.deaths[0].killerName).toBe('MonsterA');
      expect(memory.deaths[0].tick).toBe(100);
      expect(memory.deaths[1].killerName).toBe('MonsterB');
      expect(memory.deaths[1].tick).toBe(200);
    });

    it('records death with null killer', () => {
      const memory = new AgentMemory();
      memory.recordDeath({ x: 500, y: 500 }, null, 50);
      expect(memory.deaths).toHaveLength(1);
      expect(memory.deaths[0].killerName).toBeNull();
    });
  });

  describe('resource deduplication', () => {
    it('updates existing resource when position is close', () => {
      const memory = new AgentMemory();
      memory.recordResourceFound({ x: 100, y: 200 }, 'tree', 10);
      memory.recordResourceFound({ x: 102, y: 201 }, 'tree', 20);
      expect(memory.knownResources).toHaveLength(1);
      expect(memory.knownResources[0].lastSeenTick).toBe(20);
    });

    it('adds new resource when position is far', () => {
      const memory = new AgentMemory();
      memory.recordResourceFound({ x: 100, y: 200 }, 'tree', 10);
      memory.recordResourceFound({ x: 200, y: 300 }, 'tree', 20);
      expect(memory.knownResources).toHaveLength(2);
    });
  });

  describe('agent tracking', () => {
    it('updates known agent on re-encounter', () => {
      const memory = new AgentMemory();
      memory.recordAgentMet('Bob', 'fighter', null, 10, { x: 100, y: 100 });
      memory.recordAgentMet('Bob', 'fighter', 'Wolves', 50, { x: 200, y: 300 });
      expect(memory.knownAgents.size).toBe(1);
      const bob = memory.knownAgents.get('Bob')!;
      expect(bob.alliance).toBe('Wolves');
      expect(bob.lastSeenTick).toBe(50);
      expect(bob.lastSeenPosition).toEqual({ x: 200, y: 300 });
    });
  });
});

// --- Prompt Assembly with Memory Tests ---

describe('assemblePrompt with memory', () => {
  it('includes MEMORY section when memory has data', () => {
    const buf = new StateBuffer();
    buf.push(makeTickUpdate({ tick: 1 }));
    const state = buf.getBuffered()!;
    const config = makeConfig();

    const memory = new AgentMemory();
    memory.recordAgentMet('Fighter_001', 'fighter', 'Wolves', 10, { x: 300, y: 400 });
    memory.recordResourceFound({ x: 200, y: 300 }, 'gold_vein', 5);
    memory.recordDeath({ x: 600, y: 400 }, 'Monster_X', 25);
    memory.recordTrade('Merchant_001', '50 gold', '1x iron_sword', 30);
    memory.recordThreat('Monster_Y', 'monster', { x: 700, y: 500 }, 40, 'survived');
    memory.recordDecisionWithTick(1, 'move', { x: 100, y: 200 }, 'explore', 'success');

    const { user } = assemblePrompt(state, config, memory);

    expect(user).toContain('MEMORY:');
    expect(user).toContain('Known agents:');
    expect(user).toContain('Fighter_001');
    expect(user).toContain('Known resources:');
    expect(user).toContain('gold_vein');
    expect(user).toContain('Deaths:');
    expect(user).toContain('AVOID');
    expect(user).toContain('Trades:');
    expect(user).toContain('Merchant_001');
    expect(user).toContain('Threats:');
    expect(user).toContain('Monster_Y');
    expect(user).toContain('Recent outcomes:');
  });

  it('omits MEMORY section when memory is empty', () => {
    const buf = new StateBuffer();
    buf.push(makeTickUpdate({ tick: 1 }));
    const state = buf.getBuffered()!;
    const config = makeConfig();
    const memory = new AgentMemory();

    const { user } = assemblePrompt(state, config, memory);
    expect(user).not.toContain('MEMORY:');
  });

  it('works without memory parameter (backwards compatible)', () => {
    const buf = new StateBuffer();
    buf.push(makeTickUpdate({ tick: 1 }));
    const state = buf.getBuffered()!;
    const config = makeConfig();

    const { user } = assemblePrompt(state, config);
    expect(user).not.toContain('MEMORY:');
    expect(user).toContain('T1');
  });

  it('total prompt stays under ~2500 tokens with full memory', () => {
    const buf = new StateBuffer();
    buf.push(makeTickUpdate({
      tick: 100,
      nearby: {
        agents: Array.from({ length: 10 }, (_, i) => ({
          id: `agent_${i}`,
          name: `Agent${i}`,
          role: 'fighter' as const,
          position: { x: 100 + i * 10, y: 200 },
          status: 'idle' as const,
          health: 100,
          maxHealth: 100,
          alliance: null,
          evolutionStage: 1,
        })),
        resources: Array.from({ length: 10 }, (_, i) => ({
          id: `res_${i}`,
          type: 'tree' as const,
          position: { x: 100 + i * 5, y: 200 },
          remaining: 5,
          state: 'available',
        })),
        monsters: Array.from({ length: 10 }, (_, i) => ({
          id: `npc_${i}`,
          position: { x: 100 + i * 10, y: 250 },
          type: 'weak_goblin',
          health: 30,
          maxHealth: 30,
          evolutionStage: 1,
          isNpc: true,
          status: 'roaming',
        })),
        behemoths: [],
        structures: [],
      },
      events: Array.from({ length: 10 }, (_, i) => ({
        type: 'combat_hit' as const,
        attackerId: `agent_${i}`,
        targetId: `npc_${i}`,
        damage: 7,
        targetHealthAfter: 23,
      })),
      messages: Array.from({ length: 5 }, (_, i) => ({
        id: `msg_${i}`,
        mode: 'local' as const,
        senderId: `agent_${i}`,
        senderName: `Agent${i}`,
        content: `Hello from agent ${i}`,
        tick: 100,
      })),
    }));
    buf.currentPlan = 'hunting goblins in the east forest';
    const state = buf.getBuffered()!;
    const config = makeConfig();

    // Build full memory
    const memory = new AgentMemory();
    for (let i = 0; i < 20; i++) {
      memory.recordDecisionWithTick(i, 'move', { x: i * 10 }, `plan_${i}`, i % 3 === 0 ? 'rejected' : 'success', i % 3 === 0 ? 'Too far' : undefined);
    }
    for (let i = 0; i < 10; i++) {
      memory.recordAgentMet(`Agent_${i}`, i % 2 === 0 ? 'fighter' : 'merchant', i % 3 === 0 ? 'Wolves' : null, i * 10, { x: i * 50, y: i * 30 });
    }
    for (let i = 0; i < 10; i++) {
      memory.recordResourceFound({ x: i * 80, y: i * 60 }, i % 2 === 0 ? 'tree' : 'gold_vein', i * 5);
    }
    for (let i = 0; i < 5; i++) {
      memory.recordThreat(`Monster_${i}`, 'monster', { x: i * 100, y: i * 100 }, i * 20, 'survived');
    }
    for (let i = 0; i < 5; i++) {
      memory.recordTrade(`Merchant_${i}`, `${i * 10} gold`, `${i}x iron_sword`, i * 30);
    }
    for (let i = 0; i < 3; i++) {
      memory.recordDeath({ x: 600 + i * 50, y: 400 + i * 50 }, `Killer_${i}`, i * 100);
    }

    const { system, user } = assemblePrompt(state, config, memory);
    // Rough token estimate: ~4 chars per token
    const totalChars = system.length + user.length;
    const estimatedTokens = totalChars / 4;
    // Should be under ~2500 tokens (was 2000 without memory, +500 budget)
    expect(estimatedTokens).toBeLessThan(2500);
  });
});
