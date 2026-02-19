import { describe, it, expect } from 'vitest';
import {
  route,
  STUCK_THRESHOLD_TICKS,
  MIN_TICKS_BETWEEN_PLANS,
  type Plan,
  type RouterInput,
} from '../router.js';
import type { SalienceResult } from '../salience.js';
import type { Drives } from '../drives.js';

// --- Helpers ---

function makePlan(stepCount = 3, createdAtTick = 0): Plan {
  return {
    steps: Array.from({ length: stepCount }, (_, i) => ({
      action: 'move',
      params: { x: 100 + i * 50, y: 200 },
      description: `Move to checkpoint ${i + 1}`,
      expectedTicks: 10,
    })),
    reasoning: 'test plan',
    createdAtTick,
  };
}

function makeSalience(shouldInterrupt = false, maxSalience = 0): SalienceResult {
  return {
    shouldInterrupt,
    maxSalience,
    significantEvents: shouldInterrupt
      ? [{
          perception: { type: 'got_attacked', details: { attackerId: 'goblin_1' }, tick: 1 },
          score: maxSalience,
        }]
      : [],
  };
}

function makeDrives(): Drives {
  return { survival: 0.5, greed: 0.5, ambition: 0.5, social: 0.3, caution: 0.3 };
}

function makeInput(overrides: Partial<RouterInput> = {}): RouterInput {
  return {
    currentPlan: makePlan(),
    currentStepIndex: 0,
    salience: makeSalience(false),
    drives: makeDrives(),
    ticksSinceLastPlan: 20,
    ticksOnCurrentStep: 0,
    ...overrides,
  };
}

// --- Tests ---

describe('route', () => {
  describe('PLAN_EMPTY', () => {
    it('returns PLAN_EMPTY when no plan exists', () => {
      const result = route(makeInput({ currentPlan: null }));
      expect(result.type).toBe('PLAN_EMPTY');
    });
  });

  describe('PLAN_COMPLETE', () => {
    it('returns PLAN_COMPLETE when step index >= step count', () => {
      const plan = makePlan(3);
      const result = route(makeInput({ currentPlan: plan, currentStepIndex: 3 }));
      expect(result.type).toBe('PLAN_COMPLETE');
    });

    it('returns PLAN_COMPLETE when step index exceeds step count', () => {
      const plan = makePlan(2);
      const result = route(makeInput({ currentPlan: plan, currentStepIndex: 5 }));
      expect(result.type).toBe('PLAN_COMPLETE');
    });
  });

  describe('INTERRUPT — salience', () => {
    it('returns INTERRUPT when salience says to interrupt and cooldown elapsed', () => {
      const result = route(makeInput({
        salience: makeSalience(true, 1.0),
        ticksSinceLastPlan: 15,
      }));
      expect(result.type).toBe('INTERRUPT');
      if (result.type === 'INTERRUPT') {
        expect(result.reason).toContain('got_attacked');
      }
    });

    it('does NOT interrupt if cooldown has not elapsed', () => {
      const result = route(makeInput({
        salience: makeSalience(true, 1.0),
        ticksSinceLastPlan: 5, // < MIN_TICKS_BETWEEN_PLANS
      }));
      // Should continue executing instead of thrashing
      expect(result.type).toBe('EXECUTE_PLAN');
    });

    it('interrupts exactly at cooldown boundary', () => {
      const result = route(makeInput({
        salience: makeSalience(true, 0.8),
        ticksSinceLastPlan: MIN_TICKS_BETWEEN_PLANS,
      }));
      expect(result.type).toBe('INTERRUPT');
    });

    it('includes salience score in interrupt reason', () => {
      const result = route(makeInput({
        salience: makeSalience(true, 0.85),
        ticksSinceLastPlan: 20,
      }));
      if (result.type === 'INTERRUPT') {
        expect(result.reason).toContain('0.85');
      }
    });
  });

  describe('INTERRUPT — stuck detection', () => {
    it('returns INTERRUPT when stuck on step for >= STUCK_THRESHOLD_TICKS', () => {
      const result = route(makeInput({
        ticksOnCurrentStep: STUCK_THRESHOLD_TICKS,
        salience: makeSalience(false),
      }));
      expect(result.type).toBe('INTERRUPT');
      if (result.type === 'INTERRUPT') {
        expect(result.reason).toContain('stuck');
      }
    });

    it('includes step description in stuck reason', () => {
      const plan = makePlan(3);
      const result = route(makeInput({
        currentPlan: plan,
        currentStepIndex: 1,
        ticksOnCurrentStep: 70,
      }));
      if (result.type === 'INTERRUPT') {
        expect(result.reason).toContain('Move to checkpoint 2');
      }
    });

    it('does NOT trigger stuck when under threshold', () => {
      const result = route(makeInput({
        ticksOnCurrentStep: STUCK_THRESHOLD_TICKS - 1,
        salience: makeSalience(false),
      }));
      expect(result.type).toBe('EXECUTE_PLAN');
    });
  });

  describe('EXECUTE_PLAN', () => {
    it('returns EXECUTE_PLAN when mid-plan with no interrupt', () => {
      const result = route(makeInput({
        currentStepIndex: 1,
        salience: makeSalience(false),
        ticksOnCurrentStep: 5,
      }));
      expect(result.type).toBe('EXECUTE_PLAN');
    });

    it('returns EXECUTE_PLAN on first step', () => {
      const result = route(makeInput({
        currentStepIndex: 0,
        salience: makeSalience(false),
      }));
      expect(result.type).toBe('EXECUTE_PLAN');
    });

    it('returns EXECUTE_PLAN when salience is below threshold', () => {
      const result = route(makeInput({
        salience: makeSalience(false, 0.3),
      }));
      expect(result.type).toBe('EXECUTE_PLAN');
    });
  });

  describe('priority ordering', () => {
    it('PLAN_EMPTY takes priority over salience interrupt', () => {
      const result = route(makeInput({
        currentPlan: null,
        salience: makeSalience(true, 1.0),
      }));
      expect(result.type).toBe('PLAN_EMPTY');
    });

    it('PLAN_COMPLETE takes priority over salience interrupt', () => {
      const plan = makePlan(2);
      const result = route(makeInput({
        currentPlan: plan,
        currentStepIndex: 2,
        salience: makeSalience(true, 1.0),
      }));
      expect(result.type).toBe('PLAN_COMPLETE');
    });

    it('salience interrupt takes priority over stuck detection', () => {
      const result = route(makeInput({
        salience: makeSalience(true, 1.0),
        ticksSinceLastPlan: 20,
        ticksOnCurrentStep: 100,
      }));
      expect(result.type).toBe('INTERRUPT');
      if (result.type === 'INTERRUPT') {
        expect(result.reason).toContain('got_attacked');
        expect(result.reason).not.toContain('stuck');
      }
    });

    it('stuck fires when salience is blocked by cooldown', () => {
      const result = route(makeInput({
        salience: makeSalience(true, 1.0),
        ticksSinceLastPlan: 5, // cooldown blocks salience
        ticksOnCurrentStep: 70, // but stuck fires
      }));
      expect(result.type).toBe('INTERRUPT');
      if (result.type === 'INTERRUPT') {
        expect(result.reason).toContain('stuck');
      }
    });
  });

  describe('constants', () => {
    it('STUCK_THRESHOLD_TICKS is 60', () => {
      expect(STUCK_THRESHOLD_TICKS).toBe(60);
    });

    it('MIN_TICKS_BETWEEN_PLANS is 10', () => {
      expect(MIN_TICKS_BETWEEN_PLANS).toBe(10);
    });
  });
});
