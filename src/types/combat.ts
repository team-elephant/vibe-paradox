// types/combat.ts — Combat pairs and damage results

import type { EntityId } from './core.js';

export interface CombatPair {
  attackerId: EntityId;
  targetId: EntityId;
  startTick: number;
  active: boolean;
}

export interface DamageResult {
  attackerId: EntityId;
  targetId: EntityId;
  damage: number;
  targetHealthAfter: number;
  targetDied: boolean;
}
