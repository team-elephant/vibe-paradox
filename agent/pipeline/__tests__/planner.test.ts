import { describe, it, expect, vi } from 'vitest';
import {
  assemblePrompt,
  parsePlanResponse,
  generatePlan,
  PlannerCooldown,
  MAX_PLAN_STEPS,
  MIN_PLAN_STEPS,
  MAX_NEARBY_ENTITIES,
  type PlannerInput,
  type LlmCreateFn,
} from '../planner.js';
import { PipelineMemory } from '../memory.js';
import type { TickUpdateData } from '../../../src/types/protocol.js';
import type { AgentSelfView } from '../../../src/types/agent.js';
import type { Drives } from '../drives.js';

// --- Helpers ---

function makeSelf(overrides: Partial<AgentSelfView> = {}): AgentSelfView {
  return {
    id: 'agent_1',
    name: 'Aria',
    role: 'fighter',
    position: { x: 100, y: 200 },
    status: 'idle',
    health: 80,
    maxHealth: 100,
    attack: 12,
    defense: 6,
    speed: 3,
    gold: 150,
    inventory: [],
    equipment: { weapon: null, armor: null, tool: null },
    alliance: null,
    kills: 0,
    evolutionStage: 0,
    actionCooldown: 0,
    ...overrides,
  };
}

function makeState(overrides: Partial<TickUpdateData> = {}): TickUpdateData {
  return {
    tick: 42,
    self: makeSelf(),
    nearby: {
      agents: [],
      resources: [],
      monsters: [],
      behemoths: [],
      structures: [],
    },
    messages: [],
    events: [],
    ...overrides,
  };
}

function makeDrives(overrides: Partial<Drives> = {}): Drives {
  return {
    survival: 0.6,
    greed: 0.4,
    ambition: 0.5,
    social: 0.3,
    caution: 0.2,
    ...overrides,
  };
}

function makeInput(overrides: Partial<PlannerInput> = {}): PlannerInput {
  return {
    state: makeState(),
    drives: makeDrives(),
    memory: new PipelineMemory(),
    lastPlanOutcome: null,
    interruptReason: null,
    ...overrides,
  };
}

function validLlmResponse(steps = 6): string {
  const stepsArr = Array.from({ length: steps }, (_, i) => ({
    action: 'move',
    params: { x: 100 + i * 50, y: 200 },
    description: `Move to point ${i + 1}`,
    expectedTicks: 10,
  }));
  return JSON.stringify({ reasoning: 'explore the area', steps: stepsArr });
}

// --- Tests ---

describe('Planner', () => {
  describe('assemblePrompt', () => {
    it('includes agent name and role in system prompt', () => {
      const input = makeInput();
      const { system } = assemblePrompt(input);

      expect(system).toContain('fighter');
      expect(system).toContain('Vibe Paradox');
      expect(system).toContain('JSON');
    });

    it('includes agent stats in user prompt', () => {
      const input = makeInput({
        state: makeState({ self: makeSelf({ health: 80, maxHealth: 100, attack: 12, defense: 6, gold: 150 }) }),
      });
      const { user } = assemblePrompt(input);

      expect(user).toContain('HP 80/100');
      expect(user).toContain('ATK 12');
      expect(user).toContain('DEF 6');
      expect(user).toContain('Gold 150');
    });

    it('includes position and status', () => {
      const input = makeInput({
        state: makeState({ self: makeSelf({ position: { x: 100, y: 200 }, status: 'idle' }) }),
      });
      const { user } = assemblePrompt(input);

      expect(user).toContain('(100, 200)');
      expect(user).toContain('idle');
    });

    it('includes inventory items', () => {
      const input = makeInput({
        state: makeState({
          self: makeSelf({
            inventory: [
              { id: 'wood', quantity: 5 },
              { id: 'stone', quantity: 3 },
            ],
          }),
        }),
      });
      const { user } = assemblePrompt(input);

      expect(user).toContain('5x wood');
      expect(user).toContain('3x stone');
    });

    it('shows empty inventory', () => {
      const input = makeInput();
      const { user } = assemblePrompt(input);

      expect(user).toContain('Inventory: empty');
    });

    it('includes equipment', () => {
      const input = makeInput({
        state: makeState({
          self: makeSelf({
            equipment: { weapon: 'iron_sword', armor: 'leather_vest', tool: null },
          }),
        }),
      });
      const { user } = assemblePrompt(input);

      expect(user).toContain('iron_sword');
      expect(user).toContain('leather_vest');
    });

    it('includes drives description', () => {
      const input = makeInput({ drives: makeDrives({ survival: 0.9, caution: 0.1 }) });
      const { user } = assemblePrompt(input);

      expect(user).toContain('drives');
    });

    it('shows "Nothing visible nearby" when no entities', () => {
      const input = makeInput();
      const { user } = assemblePrompt(input);

      expect(user).toContain('Nothing visible nearby');
    });

    it('includes nearby agents sorted by distance', () => {
      const input = makeInput({
        state: makeState({
          self: makeSelf({ position: { x: 100, y: 100 } }),
          nearby: {
            agents: [
              { id: 'a2', name: 'Bob', role: 'merchant', position: { x: 200, y: 200 }, status: 'idle', health: 100, maxHealth: 100, alliance: null, evolutionStage: 0 },
              { id: 'a3', name: 'Clara', role: 'fighter', position: { x: 110, y: 100 }, status: 'idle', health: 80, maxHealth: 100, alliance: null, evolutionStage: 0 },
            ],
            resources: [],
            monsters: [],
            behemoths: [],
            structures: [],
          },
        }),
      });
      const { user } = assemblePrompt(input);

      // Clara is closer so should appear first
      const claraIdx = user.indexOf('Clara');
      const bobIdx = user.indexOf('Bob');
      expect(claraIdx).toBeLessThan(bobIdx);
    });

    it('includes nearby monsters (only alive)', () => {
      const input = makeInput({
        state: makeState({
          nearby: {
            agents: [],
            resources: [],
            monsters: [
              { id: 'm1', type: 'goblin', position: { x: 120, y: 200 }, health: 30, maxHealth: 50, evolutionStage: 0, isNpc: false, status: 'idle' },
              { id: 'm2', type: 'skeleton', position: { x: 130, y: 200 }, health: 0, maxHealth: 40, evolutionStage: 0, isNpc: false, status: 'dead' },
            ],
            behemoths: [],
            structures: [],
          },
        }),
      });
      const { user } = assemblePrompt(input);

      expect(user).toContain('goblin');
      expect(user).not.toContain('skeleton'); // dead, filtered out
    });

    it('includes nearby resources (only available)', () => {
      const input = makeInput({
        state: makeState({
          nearby: {
            agents: [],
            resources: [
              { id: 'r1', type: 'tree', position: { x: 110, y: 200 }, remaining: 5, state: 'available' },
              { id: 'r2', type: 'gold_vein', position: { x: 115, y: 200 }, remaining: 0, state: 'depleted' },
            ],
            monsters: [],
            behemoths: [],
            structures: [],
          },
        }),
      });
      const { user } = assemblePrompt(input);

      expect(user).toContain('tree');
      expect(user).not.toContain('gold_vein'); // depleted, filtered out
    });

    it('caps nearby entities at MAX_NEARBY_ENTITIES', () => {
      const agents = Array.from({ length: 15 }, (_, i) => ({
        id: `a${i}`,
        name: `Agent${i}`,
        role: 'fighter' as const,
        position: { x: 100 + i * 5, y: 200 },
        status: 'idle' as const,
        health: 100,
        maxHealth: 100,
        alliance: null,
        evolutionStage: 0,
      }));

      const input = makeInput({
        state: makeState({
          nearby: {
            agents,
            resources: [],
            monsters: [],
            behemoths: [],
            structures: [],
          },
        }),
      });
      const { user } = assemblePrompt(input);

      // Count "Agent:" occurrences
      const agentMatches = user.match(/Agent:/g) || [];
      expect(agentMatches.length).toBeLessThanOrEqual(MAX_NEARBY_ENTITIES);
    });

    it('includes interrupt reason when present', () => {
      const input = makeInput({ interruptReason: 'Got attacked by goblin' });
      const { user } = assemblePrompt(input);

      expect(user).toContain('INTERRUPTED');
      expect(user).toContain('Got attacked by goblin');
    });

    it('includes last plan outcome when present', () => {
      const input = makeInput({ lastPlanOutcome: 'completed: all steps done' });
      const { user } = assemblePrompt(input);

      expect(user).toContain('Last plan: completed: all steps done');
    });

    it('shows "No previous plan" when no outcome or interrupt', () => {
      const input = makeInput();
      const { user } = assemblePrompt(input);

      expect(user).toContain('No previous plan');
    });

    it('interrupt reason takes priority over lastPlanOutcome', () => {
      const input = makeInput({
        interruptReason: 'under attack',
        lastPlanOutcome: 'completed normally',
      });
      const { user } = assemblePrompt(input);

      expect(user).toContain('INTERRUPTED');
      expect(user).not.toContain('completed normally');
    });

    it('includes memory summary', () => {
      const mem = new PipelineMemory();
      mem.log({ tick: 1, type: 'observation', content: 'Found gold mine', importance: 8 });

      const input = makeInput({ memory: mem });
      const { user } = assemblePrompt(input);

      expect(user).toContain('Found gold mine');
    });

    it('includes action instructions', () => {
      const { user } = assemblePrompt(makeInput());

      expect(user).toContain('move <x> <y>');
      expect(user).toContain('gather');
      expect(user).toContain('attack');
      expect(user).toContain('craft');
      expect(user).toContain('trade');
      expect(user).toContain('rest');
      expect(user).toContain('chat');
      expect(user).toContain('idle');
    });
  });

  describe('parsePlanResponse', () => {
    it('parses valid JSON response', () => {
      const response = JSON.stringify({
        reasoning: 'explore',
        steps: [
          { action: 'move', params: { x: 300, y: 400 }, description: 'Go north', expectedTicks: 20 },
          { action: 'gather', params: {}, description: 'Gather resources', expectedTicks: 15 },
          { action: 'move', params: { x: 100, y: 100 }, description: 'Return', expectedTicks: 20 },
          { action: 'rest', params: {}, description: 'Rest up', expectedTicks: 10 },
          { action: 'idle', params: {}, description: 'Wait', expectedTicks: 5 },
        ],
      });

      const plan = parsePlanResponse(response, 42);

      expect(plan.reasoning).toBe('explore');
      expect(plan.steps).toHaveLength(5);
      expect(plan.steps[0].action).toBe('move');
      expect(plan.steps[0].params).toEqual({ x: 300, y: 400 });
      expect(plan.createdAtTick).toBe(42);
    });

    it('parses JSON from markdown code block', () => {
      const response = '```json\n' +
        JSON.stringify({
          reasoning: 'strategy',
          steps: [
            { action: 'move', params: { x: 50, y: 50 }, description: 'Go', expectedTicks: 10 },
            { action: 'gather', params: {}, description: 'Get', expectedTicks: 10 },
            { action: 'idle', params: {}, description: 'Wait', expectedTicks: 5 },
            { action: 'idle', params: {}, description: 'Wait more', expectedTicks: 5 },
            { action: 'idle', params: {}, description: 'Done', expectedTicks: 5 },
          ],
        }) + '\n```';

      const plan = parsePlanResponse(response, 10);

      expect(plan.reasoning).toBe('strategy');
      expect(plan.steps).toHaveLength(5);
    });

    it('extracts JSON from surrounding text', () => {
      const json = JSON.stringify({
        reasoning: 'found it',
        steps: [
          { action: 'attack', params: { targetId: 'g1' }, description: 'Attack', expectedTicks: 10 },
          { action: 'attack', params: { targetId: 'g1' }, description: 'Keep attacking', expectedTicks: 10 },
          { action: 'rest', params: {}, description: 'Recover', expectedTicks: 15 },
          { action: 'idle', params: {}, description: 'Observe', expectedTicks: 5 },
          { action: 'idle', params: {}, description: 'Wait', expectedTicks: 5 },
        ],
      });
      const response = `Here is my plan:\n${json}\nI hope that works!`;

      const plan = parsePlanResponse(response, 5);

      expect(plan.reasoning).toBe('found it');
      expect(plan.steps).toHaveLength(5);
    });

    it('returns fallback plan for unparseable text', () => {
      const plan = parsePlanResponse('I cannot do that because reasons', 99);

      expect(plan.steps).toHaveLength(5);
      expect(plan.steps.every((s) => s.action === 'idle')).toBe(true);
      expect(plan.reasoning).toContain('Failed to parse');
      expect(plan.createdAtTick).toBe(99);
    });

    it('returns fallback plan when steps is not an array', () => {
      const response = JSON.stringify({ reasoning: 'ok', steps: 'not an array' });
      const plan = parsePlanResponse(response, 1);

      expect(plan.steps).toHaveLength(5);
      expect(plan.steps.every((s) => s.action === 'idle')).toBe(true);
    });

    it('pads with idle steps when under MIN_PLAN_STEPS', () => {
      const response = JSON.stringify({
        reasoning: 'short plan',
        steps: [
          { action: 'move', params: { x: 100, y: 100 }, description: 'Go', expectedTicks: 10 },
          { action: 'gather', params: {}, description: 'Get stuff', expectedTicks: 15 },
        ],
      });

      const plan = parsePlanResponse(response, 1);

      expect(plan.steps.length).toBe(MIN_PLAN_STEPS);
      expect(plan.steps[0].action).toBe('move');
      expect(plan.steps[1].action).toBe('gather');
      // Padding should be idle
      expect(plan.steps[2].action).toBe('idle');
      expect(plan.steps[3].action).toBe('idle');
      expect(plan.steps[4].action).toBe('idle');
    });

    it('truncates steps over MAX_PLAN_STEPS', () => {
      const steps = Array.from({ length: 30 }, (_, i) => ({
        action: 'move',
        params: { x: i * 10, y: i * 10 },
        description: `Step ${i}`,
        expectedTicks: 5,
      }));

      const response = JSON.stringify({ reasoning: 'too many', steps });
      const plan = parsePlanResponse(response, 1);

      expect(plan.steps).toHaveLength(MAX_PLAN_STEPS);
    });

    it('filters out steps with non-string action', () => {
      const response = JSON.stringify({
        reasoning: 'mixed',
        steps: [
          { action: 'move', params: { x: 1, y: 2 }, description: 'Valid' },
          { action: 123, params: {}, description: 'Invalid' },
          { action: null, params: {} },
          { action: 'gather', params: {}, description: 'Also valid' },
        ],
      });

      const plan = parsePlanResponse(response, 1);

      // 2 valid steps + 3 idle padding = 5
      expect(plan.steps).toHaveLength(MIN_PLAN_STEPS);
      expect(plan.steps[0].action).toBe('move');
      expect(plan.steps[1].action).toBe('gather');
    });

    it('defaults expectedTicks to 10 when missing', () => {
      const response = JSON.stringify({
        reasoning: 'ok',
        steps: [
          { action: 'move', params: { x: 1, y: 2 }, description: 'Go' },
          { action: 'idle', params: {} },
          { action: 'idle', params: {} },
          { action: 'idle', params: {} },
          { action: 'idle', params: {} },
        ],
      });

      const plan = parsePlanResponse(response, 1);

      expect(plan.steps[0].expectedTicks).toBe(10);
    });

    it('defaults description to action name when missing', () => {
      const response = JSON.stringify({
        reasoning: 'ok',
        steps: [
          { action: 'gather', params: {} },
          { action: 'idle', params: {} },
          { action: 'idle', params: {} },
          { action: 'idle', params: {} },
          { action: 'idle', params: {} },
        ],
      });

      const plan = parsePlanResponse(response, 1);

      expect(plan.steps[0].description).toBe('gather');
    });

    it('defaults reasoning to empty string when missing', () => {
      const response = JSON.stringify({
        steps: [
          { action: 'idle', params: {} },
          { action: 'idle', params: {} },
          { action: 'idle', params: {} },
          { action: 'idle', params: {} },
          { action: 'idle', params: {} },
        ],
      });

      const plan = parsePlanResponse(response, 1);

      expect(plan.reasoning).toBe('');
    });
  });

  describe('generatePlan', () => {
    it('calls LLM and returns plan with cost', async () => {
      const mockLlm: LlmCreateFn = vi.fn().mockResolvedValue({
        text: validLlmResponse(6),
        inputTokens: 500,
        outputTokens: 200,
        cacheReadTokens: 100,
        cacheWriteTokens: 50,
      });

      const result = await generatePlan(makeInput(), mockLlm, 'test-model');

      expect(mockLlm).toHaveBeenCalledOnce();
      expect(result.plan.steps).toHaveLength(6);
      expect(result.plan.reasoning).toBe('explore the area');
      expect(result.inputTokens).toBe(500);
      expect(result.outputTokens).toBe(200);
      expect(result.cacheReadTokens).toBe(100);
      expect(result.cacheWriteTokens).toBe(50);
    });

    it('passes model, maxTokens, and temperature to LLM', async () => {
      const mockLlm: LlmCreateFn = vi.fn().mockResolvedValue({
        text: validLlmResponse(),
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      });

      await generatePlan(makeInput(), mockLlm, 'claude-haiku', 256, 0.5);

      expect(mockLlm).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'claude-haiku',
          maxTokens: 256,
          temperature: 0.5,
        }),
      );
    });

    it('returns fallback plan when LLM returns garbage', async () => {
      const mockLlm: LlmCreateFn = vi.fn().mockResolvedValue({
        text: 'Sorry I cannot help with that',
        inputTokens: 100,
        outputTokens: 10,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      });

      const result = await generatePlan(makeInput(), mockLlm, 'test-model');

      expect(result.plan.steps).toHaveLength(5);
      expect(result.plan.steps.every((s) => s.action === 'idle')).toBe(true);
      expect(result.inputTokens).toBe(100);
    });

    it('uses state tick for createdAtTick', async () => {
      const mockLlm: LlmCreateFn = vi.fn().mockResolvedValue({
        text: validLlmResponse(),
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      });

      const input = makeInput({ state: makeState({ tick: 777 }) });
      const result = await generatePlan(input, mockLlm, 'test-model');

      expect(result.plan.createdAtTick).toBe(777);
    });
  });

  describe('PlannerCooldown', () => {
    it('allows planning when under limit', () => {
      const cooldown = new PlannerCooldown(3);
      expect(cooldown.canPlan(1000)).toBe(true);
    });

    it('blocks after reaching max per minute', () => {
      const cooldown = new PlannerCooldown(3);
      const now = 10_000;

      cooldown.recordPlan(now);
      cooldown.recordPlan(now + 1000);
      cooldown.recordPlan(now + 2000);

      expect(cooldown.canPlan(now + 3000)).toBe(false);
    });

    it('allows again after timestamps expire', () => {
      const cooldown = new PlannerCooldown(2);
      const start = 10_000;

      cooldown.recordPlan(start);
      cooldown.recordPlan(start + 1000);

      // At start + 2s, still blocked
      expect(cooldown.canPlan(start + 2000)).toBe(false);

      // At start + 61s, the first timestamp expired
      expect(cooldown.canPlan(start + 61_000)).toBe(true);
    });

    it('uses custom maxPerMinute', () => {
      const cooldown = new PlannerCooldown(1);
      const now = 5000;

      cooldown.recordPlan(now);
      expect(cooldown.canPlan(now + 100)).toBe(false);

      // After 60s
      expect(cooldown.canPlan(now + 60_001)).toBe(true);
    });

    it('defaults to 3 plans per minute', () => {
      const cooldown = new PlannerCooldown();
      const now = 0;

      cooldown.recordPlan(now);
      cooldown.recordPlan(now + 100);
      cooldown.recordPlan(now + 200);

      expect(cooldown.canPlan(now + 300)).toBe(false);
    });
  });

  describe('constants', () => {
    it('MAX_PLAN_STEPS is 20', () => {
      expect(MAX_PLAN_STEPS).toBe(20);
    });

    it('MIN_PLAN_STEPS is 5', () => {
      expect(MIN_PLAN_STEPS).toBe(5);
    });

    it('MAX_NEARBY_ENTITIES is 10', () => {
      expect(MAX_NEARBY_ENTITIES).toBe(10);
    });
  });
});
