import { describe, it, expect } from 'vitest';
import {
  scoreSalience,
  SALIENCE_SCORES,
  INTERRUPT_THRESHOLD,
  ROLE_MODIFIERS,
  type SalienceResult,
} from '../salience.js';
import type { Perception } from '../perception.js';

// --- Helpers ---

function makePerception(type: Perception['type'], tick = 1): Perception {
  return { type, details: {}, tick };
}

// --- Tests ---

describe('scoreSalience', () => {
  describe('basic scoring', () => {
    it('returns no interrupt for empty perceptions', () => {
      const result = scoreSalience([], 'fighter');
      expect(result.shouldInterrupt).toBe(false);
      expect(result.maxSalience).toBe(0);
      expect(result.significantEvents).toEqual([]);
    });

    it('scores got_attacked at 1.0 (always interrupts)', () => {
      const result = scoreSalience([makePerception('got_attacked')], 'fighter');
      expect(result.shouldInterrupt).toBe(true);
      expect(result.maxSalience).toBe(1.0);
      expect(result.significantEvents).toHaveLength(1);
    });

    it('scores hp_changed at 0.8 (interrupts)', () => {
      const result = scoreSalience([makePerception('hp_changed')], 'fighter');
      expect(result.shouldInterrupt).toBe(true);
      expect(result.maxSalience).toBe(0.8);
    });

    it('scores threat_appeared at 0.7 (interrupts)', () => {
      const result = scoreSalience([makePerception('threat_appeared')], 'fighter');
      expect(result.shouldInterrupt).toBe(true);
    });

    it('scores trade_offered at 0.6 (interrupts)', () => {
      const result = scoreSalience([makePerception('trade_offered')], 'fighter');
      expect(result.shouldInterrupt).toBe(true);
      expect(result.maxSalience).toBe(0.6);
    });

    it('scores plan_step_failed at 0.6 (interrupts)', () => {
      const result = scoreSalience([makePerception('plan_step_failed')], 'fighter');
      expect(result.shouldInterrupt).toBe(true);
    });

    it('scores plan_step_completed at 0.3 (does not interrupt)', () => {
      const result = scoreSalience([makePerception('plan_step_completed')], 'fighter');
      expect(result.shouldInterrupt).toBe(false);
      expect(result.maxSalience).toBe(0.3);
    });

    it('scores resource_nearby at 0.2 (does not interrupt)', () => {
      const result = scoreSalience([makePerception('resource_nearby')], 'fighter');
      expect(result.shouldInterrupt).toBe(false);
    });

    it('scores agent_nearby at 0.2 (does not interrupt)', () => {
      const result = scoreSalience([makePerception('agent_nearby')], 'fighter');
      expect(result.shouldInterrupt).toBe(false);
    });

    it('scores nothing at 0.0', () => {
      const result = scoreSalience([makePerception('nothing')], 'fighter');
      expect(result.shouldInterrupt).toBe(false);
      expect(result.maxSalience).toBe(0.0);
    });
  });

  describe('interrupt threshold', () => {
    it('interrupts when max salience >= threshold', () => {
      // plan_step_failed = 0.6 >= 0.5
      const result = scoreSalience([makePerception('plan_step_failed')], 'fighter');
      expect(result.shouldInterrupt).toBe(true);
    });

    it('does not interrupt when max salience < threshold', () => {
      // resource_nearby = 0.2 < 0.5
      const result = scoreSalience([makePerception('resource_nearby')], 'fighter');
      expect(result.shouldInterrupt).toBe(false);
    });

    it('threshold is at 0.5', () => {
      expect(INTERRUPT_THRESHOLD).toBe(0.5);
    });
  });

  describe('significant events filtering', () => {
    it('includes only events at or above threshold in significantEvents', () => {
      const perceptions = [
        makePerception('got_attacked'),     // 1.0 — significant
        makePerception('resource_nearby'),   // 0.2 — not significant
        makePerception('hp_changed'),        // 0.8 — significant
        makePerception('agent_nearby'),      // 0.2 — not significant
      ];
      const result = scoreSalience(perceptions, 'fighter');
      expect(result.significantEvents).toHaveLength(2);
      expect(result.significantEvents[0].perception.type).toBe('got_attacked');
      expect(result.significantEvents[1].perception.type).toBe('hp_changed');
    });

    it('sorts significant events by score descending', () => {
      const perceptions = [
        makePerception('plan_step_failed'),  // 0.6
        makePerception('got_attacked'),      // 1.0
        makePerception('hp_changed'),        // 0.8
      ];
      const result = scoreSalience(perceptions, 'fighter');
      expect(result.significantEvents[0].score).toBeGreaterThanOrEqual(result.significantEvents[1].score);
      expect(result.significantEvents[1].score).toBeGreaterThanOrEqual(result.significantEvents[2].score);
    });
  });

  describe('role-specific modifiers — fighter', () => {
    it('fighter boosts threat_appeared by +0.2', () => {
      const result = scoreSalience([makePerception('threat_appeared')], 'fighter');
      // Base 0.7 + 0.2 = 0.9
      expect(result.maxSalience).toBeCloseTo(0.9);
    });

    it('fighter reduces resource_nearby by -0.1', () => {
      const result = scoreSalience([makePerception('resource_nearby')], 'fighter');
      // Base 0.2 - 0.1 = 0.1
      expect(result.maxSalience).toBe(0.1);
    });

    it('fighter does not modify other perception types', () => {
      const result = scoreSalience([makePerception('trade_offered')], 'fighter');
      // No modifier, stays at base 0.6
      expect(result.maxSalience).toBe(0.6);
    });
  });

  describe('role-specific modifiers — merchant', () => {
    it('merchant boosts trade_offered by +0.2', () => {
      const result = scoreSalience([makePerception('trade_offered')], 'merchant');
      // Base 0.6 + 0.2 = 0.8
      expect(result.maxSalience).toBe(0.8);
    });

    it('merchant boosts resource_nearby by +0.2', () => {
      const result = scoreSalience([makePerception('resource_nearby')], 'merchant');
      // Base 0.2 + 0.2 = 0.4
      expect(result.maxSalience).toBe(0.4);
    });

    it('merchant does not boost threat_appeared', () => {
      const result = scoreSalience([makePerception('threat_appeared')], 'merchant');
      // Base 0.7, no modifier
      expect(result.maxSalience).toBe(0.7);
    });
  });

  describe('role-specific modifiers — monster', () => {
    it('monster boosts agent_nearby by +0.3 (prey detected)', () => {
      const result = scoreSalience([makePerception('agent_nearby')], 'monster');
      // Base 0.2 + 0.3 = 0.5
      expect(result.maxSalience).toBe(0.5);
      // 0.5 >= 0.5 threshold — should interrupt
      expect(result.shouldInterrupt).toBe(true);
    });

    it('monster does not modify resource_nearby', () => {
      const result = scoreSalience([makePerception('resource_nearby')], 'monster');
      // Base 0.2, no modifier
      expect(result.maxSalience).toBe(0.2);
    });
  });

  describe('score clamping', () => {
    it('scores are clamped to [0, 1]', () => {
      // fighter: threat_appeared = 0.7 + 0.2 = 0.9 (within range)
      const result = scoreSalience([makePerception('threat_appeared')], 'fighter');
      expect(result.maxSalience).toBeLessThanOrEqual(1);
      expect(result.maxSalience).toBeGreaterThanOrEqual(0);
    });

    it('scores never go below 0 with negative modifiers', () => {
      // fighter: resource_nearby = 0.2 - 0.1 = 0.1 (still positive)
      const result = scoreSalience([makePerception('resource_nearby')], 'fighter');
      expect(result.maxSalience).toBeGreaterThanOrEqual(0);
    });
  });

  describe('multiple perceptions', () => {
    it('maxSalience is the highest scored perception', () => {
      const perceptions = [
        makePerception('resource_nearby'),   // 0.2
        makePerception('got_attacked'),      // 1.0
        makePerception('agent_nearby'),      // 0.2
      ];
      const result = scoreSalience(perceptions, 'fighter');
      expect(result.maxSalience).toBe(1.0);
    });

    it('interrupts if any single perception exceeds threshold', () => {
      const perceptions = [
        makePerception('resource_nearby'),  // 0.1 (fighter modifier)
        makePerception('agent_nearby'),     // 0.2
        makePerception('got_attacked'),     // 1.0
      ];
      const result = scoreSalience(perceptions, 'fighter');
      expect(result.shouldInterrupt).toBe(true);
    });
  });
});
