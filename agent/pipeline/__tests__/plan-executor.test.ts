import { describe, it, expect } from 'vitest';
import { PlanExecutor, type GameAction } from '../../plan-executor.js';
import type { Plan, PlanStep } from '../router.js';
import type { TickUpdateData } from '../../../src/types/protocol.js';
import type { AgentSelfView } from '../../../src/types/agent.js';

// --- Test helpers ---

function makeSelf(overrides: Partial<AgentSelfView> = {}): AgentSelfView {
  return {
    id: 'agent_1',
    name: 'TestAgent',
    role: 'fighter',
    position: { x: 100, y: 100 },
    status: 'idle',
    health: 100,
    maxHealth: 100,
    attack: 10,
    defense: 5,
    speed: 3,
    gold: 50,
    inventory: [],
    equipment: { weapon: null, armor: null, tool: null },
    alliance: null,
    kills: 0,
    evolutionStage: 0,
    actionCooldown: 0,
    ...overrides,
  };
}

function makeTick(overrides: Partial<TickUpdateData> = {}): TickUpdateData {
  return {
    tick: 1,
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

function makeStep(overrides: Partial<PlanStep> = {}): PlanStep {
  return {
    action: 'move',
    params: { x: 200, y: 300 },
    description: 'Move to target',
    expectedTicks: 10,
    ...overrides,
  };
}

function makePlan(steps: PlanStep[] = [makeStep()]): Plan {
  return {
    steps,
    reasoning: 'test plan',
    createdAtTick: 0,
  };
}

// --- Tests ---

describe('PlanExecutor', () => {
  describe('plan management', () => {
    it('starts with no plan', () => {
      const executor = new PlanExecutor();
      expect(executor.hasPlan()).toBe(false);
      expect(executor.isPlanComplete()).toBe(true);
      expect(executor.currentStep).toBeNull();
    });

    it('sets a plan', () => {
      const executor = new PlanExecutor();
      const plan = makePlan();
      executor.setPlan(plan);

      expect(executor.hasPlan()).toBe(true);
      expect(executor.isPlanComplete()).toBe(false);
      expect(executor.stepIndex).toBe(0);
      expect(executor.currentStep).toEqual(plan.steps[0]);
    });

    it('clears a plan', () => {
      const executor = new PlanExecutor();
      executor.setPlan(makePlan());
      executor.clearPlan();

      expect(executor.hasPlan()).toBe(false);
      expect(executor.isPlanComplete()).toBe(true);
      expect(executor.currentStep).toBeNull();
    });

    it('setting a new plan resets step index and tick count', () => {
      const executor = new PlanExecutor();
      executor.setPlan(makePlan([makeStep(), makeStep()]));
      executor.advanceStep();
      executor.tick();
      executor.tick();

      // Now set new plan
      executor.setPlan(makePlan());
      expect(executor.stepIndex).toBe(0);
      expect(executor.ticksOnCurrentStep).toBe(0);
    });
  });

  describe('step advancement', () => {
    it('advances to next step', () => {
      const steps = [
        makeStep({ description: 'Step 1' }),
        makeStep({ description: 'Step 2' }),
        makeStep({ description: 'Step 3' }),
      ];
      const executor = new PlanExecutor();
      executor.setPlan(makePlan(steps));

      expect(executor.stepIndex).toBe(0);
      expect(executor.currentStep!.description).toBe('Step 1');

      executor.advanceStep();
      expect(executor.stepIndex).toBe(1);
      expect(executor.currentStep!.description).toBe('Step 2');

      executor.advanceStep();
      expect(executor.stepIndex).toBe(2);
      expect(executor.currentStep!.description).toBe('Step 3');

      executor.advanceStep();
      expect(executor.stepIndex).toBe(3);
      expect(executor.isPlanComplete()).toBe(true);
      expect(executor.currentStep).toBeNull();
    });

    it('resets ticksOnCurrentStep when advancing', () => {
      const executor = new PlanExecutor();
      executor.setPlan(makePlan([makeStep(), makeStep()]));
      executor.tick();
      executor.tick();
      executor.tick();

      expect(executor.ticksOnCurrentStep).toBe(3);

      executor.advanceStep();
      expect(executor.ticksOnCurrentStep).toBe(0);
    });
  });

  describe('tick tracking', () => {
    it('increments ticksOnCurrentStep', () => {
      const executor = new PlanExecutor();
      executor.setPlan(makePlan());
      expect(executor.ticksOnCurrentStep).toBe(0);

      executor.tick();
      expect(executor.ticksOnCurrentStep).toBe(1);

      executor.tick();
      expect(executor.ticksOnCurrentStep).toBe(2);
    });
  });

  describe('getNextAction — move', () => {
    it('translates move step to move action', () => {
      const executor = new PlanExecutor();
      executor.setPlan(makePlan([
        makeStep({ action: 'move', params: { x: 400, y: 300 } }),
      ]));

      const action = executor.getNextAction(makeTick());
      expect(action).toEqual({ action: 'move', params: { x: 400, y: 300 } });
    });
  });

  describe('getNextAction — gather', () => {
    it('translates gather with specific target', () => {
      const executor = new PlanExecutor();
      executor.setPlan(makePlan([
        makeStep({ action: 'gather', params: { targetId: 'tree_1' } }),
      ]));

      const action = executor.getNextAction(makeTick());
      expect(action).toEqual({ action: 'gather', params: { targetId: 'tree_1' } });
    });

    it('finds nearest available resource when no target specified', () => {
      const executor = new PlanExecutor();
      executor.setPlan(makePlan([
        makeStep({ action: 'gather', params: {} }),
      ]));

      const state = makeTick({
        self: makeSelf({ position: { x: 100, y: 100 } }),
        nearby: {
          agents: [],
          resources: [
            { id: 'tree_far', type: 'tree', position: { x: 200, y: 200 }, remaining: 3, state: 'available' },
            { id: 'tree_close', type: 'tree', position: { x: 105, y: 100 }, remaining: 2, state: 'available' },
          ],
          monsters: [],
          behemoths: [],
          structures: [],
        },
      });

      const action = executor.getNextAction(state);
      expect(action).toEqual({ action: 'gather', params: { targetId: 'tree_close' } });
    });

    it('returns null when no resources available for gather', () => {
      const executor = new PlanExecutor();
      executor.setPlan(makePlan([
        makeStep({ action: 'gather', params: {} }),
      ]));

      const state = makeTick({
        nearby: {
          agents: [],
          resources: [
            { id: 'tree_1', type: 'tree', position: { x: 110, y: 100 }, remaining: 0, state: 'depleted' },
          ],
          monsters: [],
          behemoths: [],
          structures: [],
        },
      });

      const action = executor.getNextAction(state);
      expect(action).toBeNull();
    });
  });

  describe('getNextAction — attack', () => {
    it('translates attack step', () => {
      const executor = new PlanExecutor();
      executor.setPlan(makePlan([
        makeStep({ action: 'attack', params: { targetId: 'goblin_1' } }),
      ]));

      const action = executor.getNextAction(makeTick());
      expect(action).toEqual({ action: 'attack', params: { targetId: 'goblin_1' } });
    });

    it('returns null when attack has no target', () => {
      const executor = new PlanExecutor();
      executor.setPlan(makePlan([
        makeStep({ action: 'attack', params: {} }),
      ]));

      const action = executor.getNextAction(makeTick());
      expect(action).toBeNull();
    });
  });

  describe('getNextAction — craft', () => {
    it('translates craft step with recipeId', () => {
      const executor = new PlanExecutor();
      executor.setPlan(makePlan([
        makeStep({ action: 'craft', params: { recipeId: 'iron_sword' } }),
      ]));

      const action = executor.getNextAction(makeTick());
      expect(action).toEqual({ action: 'craft', params: { recipeId: 'iron_sword' } });
    });

    it('handles recipe param alias', () => {
      const executor = new PlanExecutor();
      executor.setPlan(makePlan([
        makeStep({ action: 'craft', params: { recipe: 'wooden_shield' } }),
      ]));

      const action = executor.getNextAction(makeTick());
      expect(action).toEqual({ action: 'craft', params: { recipeId: 'wooden_shield' } });
    });
  });

  describe('getNextAction — trade', () => {
    it('translates trade step', () => {
      const executor = new PlanExecutor();
      executor.setPlan(makePlan([
        makeStep({
          action: 'trade',
          params: {
            targetAgentId: 'agent_2',
            offer: [{ itemId: 'wood', quantity: 3 }],
            request: [{ itemId: 'gold_ore', quantity: 1 }],
          },
        }),
      ]));

      const action = executor.getNextAction(makeTick());
      expect(action).toEqual({
        action: 'trade',
        params: {
          targetAgentId: 'agent_2',
          offer: [{ itemId: 'wood', quantity: 3 }],
          request: [{ itemId: 'gold_ore', quantity: 1 }],
        },
      });
    });

    it('handles targetId alias for trade', () => {
      const executor = new PlanExecutor();
      executor.setPlan(makePlan([
        makeStep({
          action: 'trade',
          params: { targetId: 'agent_2', offer: [], request: [] },
        }),
      ]));

      const action = executor.getNextAction(makeTick());
      expect(action!.params.targetAgentId).toBe('agent_2');
    });

    it('returns null when trade has no target', () => {
      const executor = new PlanExecutor();
      executor.setPlan(makePlan([
        makeStep({ action: 'trade', params: {} }),
      ]));

      const action = executor.getNextAction(makeTick());
      expect(action).toBeNull();
    });
  });

  describe('getNextAction — rest/idle', () => {
    it('translates rest to idle action', () => {
      const executor = new PlanExecutor();
      executor.setPlan(makePlan([
        makeStep({ action: 'rest', params: {} }),
      ]));

      const action = executor.getNextAction(makeTick());
      expect(action).toEqual({ action: 'idle', params: {} });
    });

    it('translates idle to idle action', () => {
      const executor = new PlanExecutor();
      executor.setPlan(makePlan([
        makeStep({ action: 'idle', params: {} }),
      ]));

      const action = executor.getNextAction(makeTick());
      expect(action).toEqual({ action: 'idle', params: {} });
    });
  });

  describe('getNextAction — chat', () => {
    it('translates chat step to talk action', () => {
      const executor = new PlanExecutor();
      executor.setPlan(makePlan([
        makeStep({
          action: 'chat',
          params: { targetId: 'agent_2', message: 'Want to trade?' },
        }),
      ]));

      const action = executor.getNextAction(makeTick());
      expect(action).toEqual({
        action: 'talk',
        params: { mode: 'local', message: 'Want to trade?', targetId: 'agent_2' },
      });
    });

    it('defaults message to Hello! when not provided', () => {
      const executor = new PlanExecutor();
      executor.setPlan(makePlan([
        makeStep({ action: 'chat', params: {} }),
      ]));

      const action = executor.getNextAction(makeTick());
      expect(action!.params.message).toBe('Hello!');
    });
  });

  describe('getNextAction — unknown action', () => {
    it('falls back to idle for unknown action types', () => {
      const executor = new PlanExecutor();
      executor.setPlan(makePlan([
        makeStep({ action: 'dance', params: {} }),
      ]));

      const action = executor.getNextAction(makeTick());
      expect(action).toEqual({ action: 'idle', params: {} });
    });
  });

  describe('getNextAction — no plan', () => {
    it('returns null when no plan is set', () => {
      const executor = new PlanExecutor();
      const action = executor.getNextAction(makeTick());
      expect(action).toBeNull();
    });

    it('returns null when plan is complete', () => {
      const executor = new PlanExecutor();
      executor.setPlan(makePlan([makeStep()]));
      executor.advanceStep(); // past last step

      const action = executor.getNextAction(makeTick());
      expect(action).toBeNull();
    });
  });

  describe('multi-step plan execution', () => {
    it('executes steps in sequence', () => {
      const steps = [
        makeStep({ action: 'move', params: { x: 200, y: 300 }, description: 'Go to forest' }),
        makeStep({ action: 'gather', params: { targetId: 'tree_1' }, description: 'Gather wood' }),
        makeStep({ action: 'move', params: { x: 100, y: 100 }, description: 'Return home' }),
      ];

      const executor = new PlanExecutor();
      executor.setPlan(makePlan(steps));
      const state = makeTick();

      // Step 0: move
      let action = executor.getNextAction(state);
      expect(action!.action).toBe('move');
      expect(action!.params).toEqual({ x: 200, y: 300 });

      executor.advanceStep();

      // Step 1: gather
      action = executor.getNextAction(state);
      expect(action!.action).toBe('gather');

      executor.advanceStep();

      // Step 2: move back
      action = executor.getNextAction(state);
      expect(action!.action).toBe('move');
      expect(action!.params).toEqual({ x: 100, y: 100 });

      executor.advanceStep();

      // Done
      expect(executor.isPlanComplete()).toBe(true);
      action = executor.getNextAction(state);
      expect(action).toBeNull();
    });
  });
});
