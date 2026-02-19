// plan-executor.ts — Executes plan steps locally without LLM
//
// Translates plan steps into game protocol actions. Tracks step progress
// and completion via world state checks. Called every tick when the router
// says EXECUTE_PLAN.

import type { ActionType } from '../src/types/action.js';
import type { EntityId } from '../src/types/core.js';
import type { TickUpdateData } from '../src/types/protocol.js';
import type { Plan, PlanStep } from './pipeline/router.js';

// --- Types ---

export interface GameAction {
  action: ActionType;
  params: Record<string, unknown>;
}

// --- Class ---

export class PlanExecutor {
  private plan: Plan | null = null;
  private _stepIndex: number = 0;
  private _ticksOnCurrentStep: number = 0;

  get stepIndex(): number {
    return this._stepIndex;
  }

  get ticksOnCurrentStep(): number {
    return this._ticksOnCurrentStep;
  }

  get currentPlan(): Plan | null {
    return this.plan;
  }

  get currentStep(): PlanStep | null {
    if (!this.plan || this._stepIndex >= this.plan.steps.length) return null;
    return this.plan.steps[this._stepIndex];
  }

  setPlan(plan: Plan): void {
    this.plan = plan;
    this._stepIndex = 0;
    this._ticksOnCurrentStep = 0;
  }

  clearPlan(): void {
    this.plan = null;
    this._stepIndex = 0;
    this._ticksOnCurrentStep = 0;
  }

  isPlanComplete(): boolean {
    if (!this.plan) return true;
    return this._stepIndex >= this.plan.steps.length;
  }

  hasPlan(): boolean {
    return this.plan !== null;
  }

  tick(): void {
    this._ticksOnCurrentStep++;
  }

  advanceStep(): void {
    this._stepIndex++;
    this._ticksOnCurrentStep = 0;
  }

  getNextAction(state: TickUpdateData): GameAction | null {
    if (!this.plan || this._stepIndex >= this.plan.steps.length) {
      return null;
    }

    const step = this.plan.steps[this._stepIndex];
    return translateStep(step, state);
  }
}

// --- Step translation ---

function translateStep(step: PlanStep, state: TickUpdateData): GameAction | null {
  switch (step.action) {
    case 'move':
      return translateMove(step);

    case 'gather':
      return translateGather(step, state);

    case 'attack':
      return translateAttack(step);

    case 'craft':
      return translateCraft(step);

    case 'trade':
      return translateTrade(step);

    case 'rest':
    case 'idle':
      return { action: 'idle', params: {} };

    case 'chat':
    case 'talk':
      return translateChat(step);

    default:
      return { action: 'idle', params: {} };
  }
}

function translateMove(step: PlanStep): GameAction {
  const x = (step.params.x as number) ?? 0;
  const y = (step.params.y as number) ?? 0;
  return { action: 'move', params: { x, y } };
}

function translateGather(step: PlanStep, state: TickUpdateData): GameAction | null {
  // If a specific target is given, use it
  const targetId = step.params.targetId as string | undefined;
  if (targetId) {
    return { action: 'gather', params: { targetId } };
  }

  // Otherwise find the nearest available resource
  const available = state.nearby.resources.filter((r) => r.state === 'available');
  if (available.length === 0) {
    return null; // No resource available — executor can't do anything
  }

  // Sort by distance and pick closest
  const sorted = available.sort((a, b) => {
    const da = dist(state.self.position, a.position);
    const db = dist(state.self.position, b.position);
    return da - db;
  });

  return { action: 'gather', params: { targetId: sorted[0].id } };
}

function translateAttack(step: PlanStep): GameAction | null {
  const targetId = step.params.targetId as string | undefined;
  if (!targetId) return null;
  return { action: 'attack', params: { targetId } };
}

function translateCraft(step: PlanStep): GameAction {
  const recipeId = (step.params.recipeId as string) ?? (step.params.recipe as string) ?? '';
  return { action: 'craft', params: { recipeId } };
}

function translateTrade(step: PlanStep): GameAction | null {
  const targetAgentId = (step.params.targetAgentId as string) ?? (step.params.targetId as string);
  if (!targetAgentId) return null;

  const offer = step.params.offer ?? [];
  const request = step.params.request ?? [];

  return {
    action: 'trade',
    params: { targetAgentId, offer, request },
  };
}

function translateChat(step: PlanStep): GameAction {
  const targetId = step.params.targetId as string | undefined;
  const message = (step.params.message as string) ?? 'Hello!';
  const mode = (step.params.mode as string) ?? 'local';

  return {
    action: 'talk',
    params: { mode, message, ...(targetId ? { targetId } : {}) },
  };
}

// --- Helpers ---

function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}
