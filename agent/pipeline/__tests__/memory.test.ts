import { describe, it, expect, vi } from 'vitest';
import {
  PipelineMemory,
  MEMORY_CAP,
  REFLECTION_INTERVAL_PLANS,
  type MemoryEntry,
} from '../memory.js';
import type { Perception } from '../perception.js';

// --- Helpers ---

function makePerception(type: Perception['type'], details: Record<string, unknown> = {}, tick = 1): Perception {
  return { type, details, tick };
}

function makeEntry(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
  return {
    tick: 1,
    type: 'observation',
    content: 'Something happened',
    importance: 5,
    ...overrides,
  };
}

// --- Tests ---

describe('PipelineMemory', () => {
  describe('logging', () => {
    it('logs entries', () => {
      const mem = new PipelineMemory();
      mem.log(makeEntry({ content: 'event 1' }));
      mem.log(makeEntry({ content: 'event 2' }));

      expect(mem.getEntries()).toHaveLength(2);
      expect(mem.getEntries()[0].content).toBe('event 1');
    });

    it('caps at MEMORY_CAP entries', () => {
      const mem = new PipelineMemory();
      for (let i = 0; i < MEMORY_CAP + 20; i++) {
        mem.log(makeEntry({ tick: i, content: `event ${i}`, importance: i % 10 }));
      }
      expect(mem.getEntries().length).toBeLessThanOrEqual(MEMORY_CAP);
    });

    it('pruning keeps high-importance entries', () => {
      const mem = new PipelineMemory();
      // Add some high-importance entries
      mem.log(makeEntry({ tick: 0, content: 'critical event', importance: 10 }));

      // Fill to cap with low-importance
      for (let i = 1; i <= MEMORY_CAP + 5; i++) {
        mem.log(makeEntry({ tick: i, content: `filler ${i}`, importance: 1 }));
      }

      const entries = mem.getEntries();
      const hasCritical = entries.some((e) => e.content === 'critical event');
      expect(hasCritical).toBe(true);
    });

    it('pruning keeps reflections', () => {
      const mem = new PipelineMemory();
      mem.log(makeEntry({ tick: 0, type: 'reflection', content: 'I learned something', importance: 8 }));

      for (let i = 1; i <= MEMORY_CAP + 5; i++) {
        mem.log(makeEntry({ tick: i, content: `filler ${i}`, importance: 1 }));
      }

      const entries = mem.getEntries();
      const hasReflection = entries.some((e) => e.type === 'reflection');
      expect(hasReflection).toBe(true);
    });
  });

  describe('logPerceptions', () => {
    it('logs high-importance perceptions', () => {
      const mem = new PipelineMemory();
      const perceptions: Perception[] = [
        makePerception('got_attacked', { attackerId: 'goblin_1', damage: 20 }, 10),
      ];
      mem.logPerceptions(perceptions, 10);

      const entries = mem.getEntries();
      expect(entries).toHaveLength(1);
      expect(entries[0].content).toContain('Attacked by goblin_1');
    });

    it('filters out low-importance perceptions (importance < 3)', () => {
      const mem = new PipelineMemory();
      const perceptions: Perception[] = [
        makePerception('agent_nearby', { agentId: 'a2', name: 'Bob', role: 'merchant' }, 5),
        makePerception('resource_nearby', { resourceId: 'r1', type: 'tree' }, 5),
      ];
      mem.logPerceptions(perceptions, 5);

      expect(mem.getEntries()).toHaveLength(0);
    });

    it('logs multiple perceptions from same tick', () => {
      const mem = new PipelineMemory();
      const perceptions: Perception[] = [
        makePerception('got_attacked', { attackerId: 'g1', damage: 10 }, 20),
        makePerception('hp_changed', { from: 100, to: 90, delta: -10 }, 20),
        makePerception('threat_appeared', { monsterId: 'g1', monsterType: 'goblin' }, 20),
      ];
      mem.logPerceptions(perceptions, 20);

      expect(mem.getEntries().length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('logPlanCreated', () => {
    it('increments plan count', () => {
      const mem = new PipelineMemory();
      expect(mem.getPlanCount()).toBe(0);

      mem.logPlanCreated('explore forest', 5, 10);
      expect(mem.getPlanCount()).toBe(1);

      mem.logPlanCreated('gather resources', 8, 50);
      expect(mem.getPlanCount()).toBe(2);
    });

    it('logs the plan as an action entry', () => {
      const mem = new PipelineMemory();
      mem.logPlanCreated('attack goblin camp', 7, 30);

      const entries = mem.getEntries();
      expect(entries).toHaveLength(1);
      expect(entries[0].type).toBe('action');
      expect(entries[0].content).toContain('attack goblin camp');
      expect(entries[0].content).toContain('7 steps');
    });
  });

  describe('logPlanOutcome', () => {
    it('logs completed plans', () => {
      const mem = new PipelineMemory();
      mem.logPlanOutcome('completed', 'all steps done', 50);

      const entries = mem.getEntries();
      expect(entries[0].content).toContain('completed');
      expect(entries[0].importance).toBe(4);
    });

    it('logs interrupted plans with higher importance', () => {
      const mem = new PipelineMemory();
      mem.logPlanOutcome('interrupted', 'got attacked', 50);

      const entries = mem.getEntries();
      expect(entries[0].importance).toBe(6);
    });

    it('logs failed plans with highest importance', () => {
      const mem = new PipelineMemory();
      mem.logPlanOutcome('failed', 'agent died', 50);

      const entries = mem.getEntries();
      expect(entries[0].importance).toBe(7);
    });
  });

  describe('reflection', () => {
    it('shouldReflect returns false when under plan threshold', () => {
      const mem = new PipelineMemory();
      for (let i = 0; i < REFLECTION_INTERVAL_PLANS - 1; i++) {
        mem.logPlanCreated('plan', 5, i * 10);
      }
      expect(mem.shouldReflect()).toBe(false);
    });

    it('shouldReflect returns true at reflection interval', () => {
      const mem = new PipelineMemory();
      for (let i = 0; i < REFLECTION_INTERVAL_PLANS; i++) {
        mem.logPlanCreated('plan', 5, i * 10);
      }
      expect(mem.shouldReflect()).toBe(true);
    });

    it('reflect calls LLM and stores result', async () => {
      const mem = new PipelineMemory();
      mem.log(makeEntry({ tick: 1, content: 'gathered wood' }));
      mem.log(makeEntry({ tick: 2, content: 'attacked by goblin' }));

      const mockLlm = vi.fn().mockResolvedValue('I learned to watch out for goblins near forests.');

      const result = await mem.reflect(mockLlm);

      expect(mockLlm).toHaveBeenCalledOnce();
      expect(result).toBe('I learned to watch out for goblins near forests.');
      expect(mem.getReflections()).toHaveLength(1);
      expect(mem.getReflections()[0]).toBe('I learned to watch out for goblins near forests.');
    });

    it('reflect adds a reflection entry to memory', async () => {
      const mem = new PipelineMemory();
      mem.log(makeEntry({ tick: 5, content: 'test event' }));

      const mockLlm = vi.fn().mockResolvedValue('Learned something.');
      await mem.reflect(mockLlm);

      const reflectionEntries = mem.getEntries().filter((e) => e.type === 'reflection');
      expect(reflectionEntries).toHaveLength(1);
      expect(reflectionEntries[0].importance).toBe(8);
    });

    it('shouldReflect resets after reflecting', async () => {
      const mem = new PipelineMemory();
      for (let i = 0; i < REFLECTION_INTERVAL_PLANS; i++) {
        mem.logPlanCreated('plan', 5, i * 10);
      }

      expect(mem.shouldReflect()).toBe(true);

      const mockLlm = vi.fn().mockResolvedValue('reflection');
      await mem.reflect(mockLlm);

      expect(mem.shouldReflect()).toBe(false);
    });

    it('triggers again after another interval', async () => {
      const mem = new PipelineMemory();

      // First interval
      for (let i = 0; i < REFLECTION_INTERVAL_PLANS; i++) {
        mem.logPlanCreated('plan', 5, i * 10);
      }
      const mockLlm = vi.fn().mockResolvedValue('first reflection');
      await mem.reflect(mockLlm);

      // Second interval
      for (let i = 0; i < REFLECTION_INTERVAL_PLANS; i++) {
        mem.logPlanCreated('plan', 5, (REFLECTION_INTERVAL_PLANS + i) * 10);
      }
      expect(mem.shouldReflect()).toBe(true);
    });
  });

  describe('getSummary', () => {
    it('returns "No memories yet." when empty', () => {
      const mem = new PipelineMemory();
      expect(mem.getSummary()).toBe('No memories yet.');
    });

    it('returns last 5 significant events by importance', () => {
      const mem = new PipelineMemory();
      mem.log(makeEntry({ tick: 1, content: 'low importance', importance: 1 }));
      mem.log(makeEntry({ tick: 2, content: 'high importance', importance: 9 }));
      mem.log(makeEntry({ tick: 3, content: 'medium importance', importance: 5 }));
      mem.log(makeEntry({ tick: 4, content: 'very high', importance: 10 }));
      mem.log(makeEntry({ tick: 5, content: 'medium-high', importance: 7 }));
      mem.log(makeEntry({ tick: 6, content: 'medium', importance: 6 }));

      const summary = mem.getSummary();
      expect(summary).toContain('very high');
      expect(summary).toContain('high importance');
      expect(summary).not.toContain('low importance');
    });

    it('includes latest reflection', async () => {
      const mem = new PipelineMemory();
      mem.log(makeEntry({ tick: 1, content: 'event' }));

      const mockLlm = vi.fn().mockResolvedValue('forests are dangerous');
      await mem.reflect(mockLlm);

      const summary = mem.getSummary();
      expect(summary).toContain('Reflection: forests are dangerous');
    });
  });

  describe('serialization', () => {
    it('round-trips through toJSON/fromJSON', async () => {
      const mem = new PipelineMemory();
      mem.log(makeEntry({ tick: 1, content: 'event 1' }));
      mem.logPlanCreated('test plan', 5, 10);

      const mockLlm = vi.fn().mockResolvedValue('test reflection');

      // Force reflection
      for (let i = 0; i < REFLECTION_INTERVAL_PLANS - 1; i++) {
        mem.logPlanCreated('plan', 5, i * 10);
      }
      await mem.reflect(mockLlm);

      const json = mem.toJSON();
      const restored = PipelineMemory.fromJSON(json);

      expect(restored.getEntries().length).toBe(mem.getEntries().length);
      expect(restored.getReflections()).toEqual(mem.getReflections());
      expect(restored.getPlanCount()).toBe(mem.getPlanCount());
    });
  });

  describe('constants', () => {
    it('MEMORY_CAP is 100', () => {
      expect(MEMORY_CAP).toBe(100);
    });

    it('REFLECTION_INTERVAL_PLANS is 10', () => {
      expect(REFLECTION_INTERVAL_PLANS).toBe(10);
    });
  });
});
