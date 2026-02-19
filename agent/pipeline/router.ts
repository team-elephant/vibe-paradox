// pipeline/router.ts — Stage 4: Decision routing
//
// The critical decision point. Determines whether the agent should:
//   - EXECUTE_PLAN: continue the current plan step (no LLM, the common case)
//   - INTERRUPT: re-plan due to a high-salience event
//   - PLAN_COMPLETE: plan finished, need a new one
//   - PLAN_EMPTY: no plan exists (first tick or after reset)
//
// Pure function — no side effects, no LLM calls.

import type { SalienceResult } from './salience.js';
import type { Drives } from './drives.js';

// --- Types ---

export interface Plan {
  steps: PlanStep[];
  reasoning: string;
  createdAtTick: number;
}

export interface PlanStep {
  action: string;
  params: Record<string, unknown>;
  description: string;
  expectedTicks: number;
}

export type RouteDecision =
  | { type: 'EXECUTE_PLAN' }
  | { type: 'INTERRUPT'; reason: string }
  | { type: 'PLAN_COMPLETE' }
  | { type: 'PLAN_EMPTY' };

export interface RouterInput {
  currentPlan: Plan | null;
  currentStepIndex: number;
  salience: SalienceResult;
  drives: Drives;
  ticksSinceLastPlan: number;
  ticksOnCurrentStep: number;
}

// --- Constants ---

export const STUCK_THRESHOLD_TICKS = 60;
export const MIN_TICKS_BETWEEN_PLANS = 10;

// --- Main function ---

export function route(input: RouterInput): RouteDecision {
  const {
    currentPlan,
    currentStepIndex,
    salience,
    ticksSinceLastPlan,
    ticksOnCurrentStep,
  } = input;

  // No plan exists → need one
  if (currentPlan === null) {
    return { type: 'PLAN_EMPTY' };
  }

  // Plan exists but all steps are done → need a new plan
  if (currentStepIndex >= currentPlan.steps.length) {
    return { type: 'PLAN_COMPLETE' };
  }

  // High salience event → interrupt (but respect cooldown to prevent thrashing)
  if (salience.shouldInterrupt && ticksSinceLastPlan >= MIN_TICKS_BETWEEN_PLANS) {
    const topEvent = salience.significantEvents[0];
    const reason = topEvent
      ? `${topEvent.perception.type} (salience: ${topEvent.score.toFixed(2)})`
      : 'high salience event';
    return { type: 'INTERRUPT', reason };
  }

  // Stuck on same step too long → interrupt to re-plan
  if (ticksOnCurrentStep >= STUCK_THRESHOLD_TICKS) {
    const step = currentPlan.steps[currentStepIndex];
    return {
      type: 'INTERRUPT',
      reason: `stuck on step ${currentStepIndex}: "${step.description}" for ${ticksOnCurrentStep} ticks`,
    };
  }

  // Default: continue executing the current plan step
  return { type: 'EXECUTE_PLAN' };
}
