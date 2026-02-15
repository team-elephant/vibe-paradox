// data/evolution.ts — Monster evolution thresholds and stat multipliers

import { EVOLUTION_THRESHOLDS } from '../shared/constants.js';

export interface EvolutionStage {
  stage: number;
  kills: number;
  eats: number;
  attackMult: number;
  healthMult: number;
}

/**
 * Get the evolution stage a monster should be at given its kills and eats.
 * Returns the highest stage the monster qualifies for.
 * Evolution is triggered by kills OR eats (not both required).
 */
export function getEvolutionStage(kills: number, eats: number): number {
  let stage = 1;
  for (const threshold of EVOLUTION_THRESHOLDS) {
    if (kills >= threshold.kills || eats >= threshold.eats) {
      stage = threshold.stage;
    }
  }
  return stage;
}

/**
 * Get the stat multipliers for a given evolution stage transition.
 * Returns null if no evolution should happen.
 */
export function getEvolutionMultipliers(
  targetStage: number,
): { attackMult: number; healthMult: number } | null {
  const threshold = EVOLUTION_THRESHOLDS.find(t => t.stage === targetStage);
  if (!threshold) return null;
  return { attackMult: threshold.attackMult, healthMult: threshold.healthMult };
}
