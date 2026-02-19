// tests/agent-brain.test.ts — Tests for state-buffer, action-parser, prompt-assembler

import { describe, it, expect } from 'vitest';
import { StateBuffer } from '../agent/state-buffer.js';
import { parseDecision } from '../agent/action-parser.js';
import { assemblePrompt } from '../agent/prompt-assembler.js';
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

// --- StateBuffer Tests ---

describe('StateBuffer', () => {
  describe('shouldTriggerDecision', () => {
    it('returns true on first tick', () => {
      const buf = new StateBuffer();
      buf.push(makeTickUpdate({ tick: 1 }));
      expect(buf.shouldTriggerDecision()).toBe(true);
    });

    it('returns true on health change', () => {
      const buf = new StateBuffer();
      buf.push(makeTickUpdate({ tick: 1 }));
      buf.recordDecision(1);
      buf.recordAction(1);
      buf.push(makeTickUpdate({ tick: 2, self: { health: 80 } as any }));
      expect(buf.shouldTriggerDecision()).toBe(true);
    });

    it('returns true on status change', () => {
      const buf = new StateBuffer();
      buf.push(makeTickUpdate({ tick: 1 }));
      buf.recordDecision(1);
      buf.recordAction(1);
      buf.push(makeTickUpdate({ tick: 2, self: { status: 'moving' } as any }));
      expect(buf.shouldTriggerDecision()).toBe(true);
    });

    it('returns true when new entity appears nearby', () => {
      const buf = new StateBuffer();
      buf.push(makeTickUpdate({ tick: 1 }));
      buf.recordDecision(1);
      buf.recordAction(1);
      buf.push(makeTickUpdate({
        tick: 2,
        nearby: {
          agents: [{
            id: 'agent_other1',
            name: 'Other',
            role: 'merchant',
            position: { x: 110, y: 200 },
            status: 'idle',
            health: 50,
            maxHealth: 50,
            alliance: null,
            evolutionStage: 1,
          }],
          resources: [],
          monsters: [],
          behemoths: [],
          structures: [],
        },
      }));
      expect(buf.shouldTriggerDecision()).toBe(true);
    });

    it('returns true when messages received', () => {
      const buf = new StateBuffer();
      buf.push(makeTickUpdate({ tick: 1 }));
      buf.recordDecision(1);
      buf.recordAction(1);
      buf.push(makeTickUpdate({
        tick: 2,
        messages: [{
          id: 'msg_1',
          mode: 'local',
          senderId: 'agent_other',
          senderName: 'Other',
          content: 'hello',
          tick: 2,
        }],
      }));
      expect(buf.shouldTriggerDecision()).toBe(true);
    });

    it('returns true when events received', () => {
      const buf = new StateBuffer();
      buf.push(makeTickUpdate({ tick: 1 }));
      buf.recordDecision(1);
      buf.recordAction(1);
      buf.push(makeTickUpdate({
        tick: 2,
        events: [{ type: 'death', entityId: 'agent_x', killedBy: null, droppedGold: 0, droppedItems: [] }],
      }));
      expect(buf.shouldTriggerDecision()).toBe(true);
    });

    it('returns true on idle timeout', () => {
      const buf = new StateBuffer();
      buf.push(makeTickUpdate({ tick: 1 }));
      buf.recordDecision(1);
      // Don't record action — simulate being idle
      // Push ticks 2-6 with no changes
      for (let t = 2; t <= 6; t++) {
        buf.push(makeTickUpdate({ tick: t }));
      }
      // At tick 6, ticksSinceAction = 6 - 0 = 6 >= 5
      expect(buf.shouldTriggerDecision()).toBe(true);
    });

    it('returns false when nothing meaningful changed', () => {
      const buf = new StateBuffer();
      buf.push(makeTickUpdate({ tick: 1 }));
      buf.recordDecision(1);
      buf.recordAction(1);
      // Same state, no events, no messages, within idle timeout
      buf.push(makeTickUpdate({ tick: 2 }));
      expect(buf.shouldTriggerDecision()).toBe(false);
    });

    it('returns false when same nearby entities present', () => {
      const buf = new StateBuffer();
      const nearby = {
        agents: [{
          id: 'agent_other1',
          name: 'Other',
          role: 'merchant' as const,
          position: { x: 110, y: 200 },
          status: 'idle' as const,
          health: 50,
          maxHealth: 50,
          alliance: null,
          evolutionStage: 1,
        }],
        resources: [],
        monsters: [],
        behemoths: [],
        structures: [],
      };
      buf.push(makeTickUpdate({ tick: 1, nearby }));
      buf.recordDecision(1);
      buf.recordAction(1);
      buf.push(makeTickUpdate({ tick: 2, nearby }));
      expect(buf.shouldTriggerDecision()).toBe(false);
    });
  });

  describe('getBuffered', () => {
    it('returns null when buffer is empty', () => {
      const buf = new StateBuffer();
      expect(buf.getBuffered()).toBeNull();
    });

    it('returns current and null previous on first tick', () => {
      const buf = new StateBuffer();
      buf.push(makeTickUpdate({ tick: 1 }));
      const state = buf.getBuffered()!;
      expect(state.current.tick).toBe(1);
      expect(state.previous).toBeNull();
    });

    it('returns current and previous on second tick', () => {
      const buf = new StateBuffer();
      buf.push(makeTickUpdate({ tick: 1 }));
      buf.push(makeTickUpdate({ tick: 2 }));
      const state = buf.getBuffered()!;
      expect(state.current.tick).toBe(2);
      expect(state.previous!.tick).toBe(1);
    });

    it('tracks ticksSinceLastAction', () => {
      const buf = new StateBuffer();
      buf.push(makeTickUpdate({ tick: 1 }));
      buf.recordAction(1);
      buf.push(makeTickUpdate({ tick: 5 }));
      const state = buf.getBuffered()!;
      expect(state.ticksSinceLastAction).toBe(4);
    });

    it('accumulates recent events across ticks', () => {
      const buf = new StateBuffer();
      buf.push(makeTickUpdate({
        tick: 1,
        events: [{ type: 'death', entityId: 'a', killedBy: null, droppedGold: 0, droppedItems: [] }],
      }));
      buf.push(makeTickUpdate({
        tick: 2,
        events: [{ type: 'death', entityId: 'b', killedBy: null, droppedGold: 0, droppedItems: [] }],
      }));
      const state = buf.getBuffered()!;
      expect(state.recentEvents).toHaveLength(2);
    });
  });
});

// --- ActionParser Tests ---

describe('parseDecision', () => {
  it('parses clean JSON', () => {
    const input = '{"action":"move","params":{"x":100,"y":200},"plan":"exploring"}';
    const result = parseDecision(input);
    expect(result).toEqual({
      action: 'move',
      params: { x: 100, y: 200 },
      plan: 'exploring',
    });
  });

  it('parses markdown-wrapped JSON', () => {
    const input = 'Here is my decision:\n```json\n{"action":"gather","params":{"targetId":"res_abc"},"plan":"gathering wood"}\n```';
    const result = parseDecision(input);
    expect(result).toEqual({
      action: 'gather',
      params: { targetId: 'res_abc' },
      plan: 'gathering wood',
    });
  });

  it('parses markdown code block without json language tag', () => {
    const input = '```\n{"action":"attack","params":{"targetId":"npc_xyz"},"plan":"hunting"}\n```';
    const result = parseDecision(input);
    expect(result).toEqual({
      action: 'attack',
      params: { targetId: 'npc_xyz' },
      plan: 'hunting',
    });
  });

  it('extracts JSON from mixed text', () => {
    const input = 'I will move north to find resources.\n{"action":"move","params":{"x":100,"y":300},"plan":"exploring north"}\nThis should work.';
    const result = parseDecision(input);
    expect(result).toEqual({
      action: 'move',
      params: { x: 100, y: 300 },
      plan: 'exploring north',
    });
  });

  it('returns null for unparseable garbage', () => {
    const result = parseDecision('this is not json at all');
    expect(result).toBeNull();
  });

  it('returns null for unknown action type', () => {
    const result = parseDecision('{"action":"fly","params":{},"plan":"flying"}');
    expect(result).toBeNull();
  });

  it('handles missing params gracefully', () => {
    const result = parseDecision('{"action":"idle","plan":"waiting"}');
    expect(result).not.toBeNull();
    expect(result!.action).toBe('idle');
    expect(result!.params).toEqual({});
  });

  it('handles missing plan gracefully', () => {
    const result = parseDecision('{"action":"idle","params":{}}');
    expect(result).not.toBeNull();
    expect(result!.plan).toBe('');
  });

  it('handles extra fields without crashing', () => {
    const result = parseDecision('{"action":"move","params":{"x":1,"y":2},"plan":"go","extra":"data","nested":{"a":1}}');
    expect(result).not.toBeNull();
    expect(result!.action).toBe('move');
  });

  it('handles empty string', () => {
    const result = parseDecision('');
    expect(result).toBeNull();
  });

  it('handles JSON with whitespace', () => {
    const input = '  \n  {"action":"idle","params":{},"plan":"resting"}  \n  ';
    const result = parseDecision(input);
    expect(result).not.toBeNull();
    expect(result!.action).toBe('idle');
  });

  it('parses ```JSON (uppercase) code block', () => {
    const input = '```JSON\n{"action":"move","params":{"x":50,"y":100},"plan":"flee"}\n```';
    const result = parseDecision(input);
    expect(result).not.toBeNull();
    expect(result!.action).toBe('move');
    expect(result!.params).toEqual({ x: 50, y: 100 });
  });

  it('parses truncated code block (no closing fence)', () => {
    const input = '```json\n{"action":"move","params":{"x":200,"y":500},"plan":"CRITICAL SURVIVAL FLEE"}';
    const result = parseDecision(input);
    expect(result).not.toBeNull();
    expect(result!.action).toBe('move');
    expect(result!.params).toEqual({ x: 200, y: 500 });
  });

  it('parses code block with trailing newlines inside', () => {
    const input = '```json\n\n{"action":"attack","params":{"targetId":"npc_abc123"},"plan":"hunting"}\n\n```';
    const result = parseDecision(input);
    expect(result).not.toBeNull();
    expect(result!.action).toBe('attack');
    expect(result!.params).toEqual({ targetId: 'npc_abc123' });
  });

  it('returns null for truncated JSON with malformed params', () => {
    // Real failure: LLM output {"x":200,"500"} — missing key, not recoverable
    const input = '```json\n{"action":"move","params":{"x":200,"500"},"plan":"CRITICAL SURVIVAL FLEE — HP 3/80 is critical, one hit means pe';
    const result = parseDecision(input);
    expect(result).toBeNull();
  });

  it('parses code block with no space after json tag', () => {
    const input = '```json{"action":"idle","params":{},"plan":"waiting"}```';
    const result = parseDecision(input);
    expect(result).not.toBeNull();
    expect(result!.action).toBe('idle');
  });

  it('repairs truncated JSON with missing closing brace and quote', () => {
    const input = '{"action":"move","params":{"x":100,"y":200},"plan":"heading north to find gold';
    const result = parseDecision(input);
    expect(result).not.toBeNull();
    expect(result!.action).toBe('move');
    expect(result!.params).toEqual({ x: 100, y: 200 });
    expect(result!.plan).toBe('heading north to find gold');
  });
});

// --- PromptAssembler Tests ---

describe('assemblePrompt', () => {
  it('returns system and user strings', () => {
    const buf = new StateBuffer();
    buf.push(makeTickUpdate({ tick: 1 }));
    const state = buf.getBuffered()!;
    const config = makeConfig();

    const { system, user } = assemblePrompt(state, config);

    expect(typeof system).toBe('string');
    expect(typeof user).toBe('string');
    expect(system.length).toBeGreaterThan(0);
    expect(user.length).toBeGreaterThan(0);
  });

  it('system prompt contains base rules and role-specific content', () => {
    const buf = new StateBuffer();
    buf.push(makeTickUpdate({ tick: 1 }));
    const state = buf.getBuffered()!;

    const fighterResult = assemblePrompt(state, makeConfig({ role: 'fighter' }));
    expect(fighterResult.system).toContain('Fighter');
    expect(fighterResult.system).toContain('RESPONSE FORMAT');

    const merchantResult = assemblePrompt(state, makeConfig({ role: 'merchant' }));
    expect(merchantResult.system).toContain('Merchant');

    const monsterResult = assemblePrompt(state, makeConfig({ role: 'monster' }));
    expect(monsterResult.system).toContain('Monster');
  });

  it('user prompt contains status line with tick, health, position', () => {
    const buf = new StateBuffer();
    buf.push(makeTickUpdate({ tick: 42 }));
    const state = buf.getBuffered()!;
    const config = makeConfig();

    const { user } = assemblePrompt(state, config);

    expect(user).toContain('T42');
    expect(user).toContain('HP:100/100');
    expect(user).toContain('Pos:(100,200)');
  });

  it('user prompt includes inventory when present', () => {
    const buf = new StateBuffer();
    buf.push(makeTickUpdate({
      tick: 1,
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
        inventory: [{ id: 'iron_sword', quantity: 1 }],
        equipment: { weapon: null, armor: null, tool: null },
        alliance: null,
        kills: 0,
        evolutionStage: 1,
        actionCooldown: 0,
      },
    }));
    const state = buf.getBuffered()!;
    const config = makeConfig();

    const { user } = assemblePrompt(state, config);
    expect(user).toContain('INV:');
    expect(user).toContain('iron_sword:1');
  });

  it('user prompt includes nearby entities', () => {
    const buf = new StateBuffer();
    buf.push(makeTickUpdate({
      tick: 1,
      nearby: {
        agents: [{
          id: 'agent_ally',
          name: 'AllyBot',
          role: 'merchant',
          position: { x: 110, y: 210 },
          status: 'gathering',
          health: 45,
          maxHealth: 50,
          alliance: null,
          evolutionStage: 1,
        }],
        resources: [{
          id: 'res_tree1',
          type: 'tree',
          position: { x: 105, y: 195 },
          remaining: 5,
          state: 'available',
        }],
        monsters: [{
          id: 'npc_gob1',
          position: { x: 130, y: 230 },
          type: 'weak_goblin',
          health: 30,
          maxHealth: 30,
          evolutionStage: 1,
          isNpc: true,
          status: 'roaming',
        }],
        behemoths: [],
        structures: [],
      },
    }));
    const state = buf.getBuffered()!;
    const config = makeConfig();

    const { user } = assemblePrompt(state, config);
    expect(user).toContain('AGENTS:');
    expect(user).toContain('AllyBot');
    expect(user).toContain('RESOURCES:');
    expect(user).toContain('res_tree1');
    expect(user).toContain('MONSTERS:');
    expect(user).toContain('npc_gob1');
  });

  it('user prompt includes recent events', () => {
    const buf = new StateBuffer();
    buf.push(makeTickUpdate({
      tick: 1,
      events: [
        { type: 'combat_hit', attackerId: 'agent_test01', targetId: 'npc_gob1', damage: 7, targetHealthAfter: 23 },
      ],
    }));
    const state = buf.getBuffered()!;
    const config = makeConfig();

    const { user } = assemblePrompt(state, config);
    expect(user).toContain('EVENTS:');
    expect(user).toContain('7dmg');
  });

  it('user prompt includes current plan', () => {
    const buf = new StateBuffer();
    buf.push(makeTickUpdate({ tick: 1 }));
    buf.currentPlan = 'heading north to find gold';
    const state = buf.getBuffered()!;
    const config = makeConfig();

    const { user } = assemblePrompt(state, config);
    expect(user).toContain('PLAN:');
    expect(user).toContain('heading north to find gold');
  });

  it('total prompt stays compact (under ~2000 tokens rough estimate)', () => {
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

    const { system, user } = assemblePrompt(state, config);
    // Rough token estimate: ~4 chars per token
    const totalChars = system.length + user.length;
    const estimatedTokens = totalChars / 4;
    // Should be under ~2000 tokens
    expect(estimatedTokens).toBeLessThan(2000);
  });
});
