// pipeline/salience.ts — Stage 2: Score perceptions by importance
//
// Assigns a salience score to each perception. If any perception exceeds the
// interrupt threshold, the router should consider re-planning.
// Role-specific modifiers adjust scores based on agent archetype.
// Pure function — no side effects, no LLM calls.

import type { AgentRole } from '../../src/types/agent.js';
import type { Perception, PerceptionType } from './perception.js';

// --- Types ---

export interface ScoredPerception {
  perception: Perception;
  score: number;
}

export interface SalienceResult {
  shouldInterrupt: boolean;
  maxSalience: number;
  significantEvents: ScoredPerception[];
}

// --- Constants ---

export const SALIENCE_SCORES: Record<PerceptionType, number> = {
  'got_attacked': 1.0,
  'hp_changed': 0.8,
  'threat_appeared': 0.7,
  'entity_died': 0.7,
  'trade_offered': 0.6,
  'plan_step_failed': 0.6,
  'level_up': 0.5,
  'message_received': 0.4,
  'plan_step_completed': 0.3,
  'resource_nearby': 0.2,
  'agent_nearby': 0.2,
  'threat_gone': 0.1,
  'inventory_changed': 0.1,
  'nothing': 0.0,
};

export const INTERRUPT_THRESHOLD = 0.5;

export const ROLE_MODIFIERS: Record<AgentRole, Partial<Record<PerceptionType, number>>> = {
  fighter: {
    'threat_appeared': +0.2,
    'resource_nearby': -0.1,
  },
  merchant: {
    'trade_offered': +0.2,
    'resource_nearby': +0.2,
  },
  monster: {
    'agent_nearby': +0.3,
  },
};

// --- Main function ---

export function scoreSalience(
  perceptions: Perception[],
  role: AgentRole,
): SalienceResult {
  if (perceptions.length === 0) {
    return {
      shouldInterrupt: false,
      maxSalience: 0,
      significantEvents: [],
    };
  }

  const modifiers = ROLE_MODIFIERS[role] ?? {};
  const scored: ScoredPerception[] = [];

  for (const perception of perceptions) {
    const base = SALIENCE_SCORES[perception.type] ?? 0;
    const modifier = modifiers[perception.type] ?? 0;
    const score = Math.max(0, Math.min(1, base + modifier));

    scored.push({ perception, score });
  }

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  const maxSalience = scored.length > 0 ? scored[0].score : 0;
  const significantEvents = scored.filter((s) => s.score >= INTERRUPT_THRESHOLD);

  return {
    shouldInterrupt: maxSalience >= INTERRUPT_THRESHOLD,
    maxSalience,
    significantEvents,
  };
}
