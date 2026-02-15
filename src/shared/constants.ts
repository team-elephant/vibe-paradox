// shared/constants.ts — All game constants

import type { Position } from '../types/core.js';

export const TICK_RATE_MS = 1000;
export const WORLD_SIZE = 1000;
export const CHUNK_SIZE = 32;

export const SPAWN_POINT: Position = { x: 500, y: 500 };
export const SAFE_ZONE_RADIUS = 100;

export const GATHER_RANGE = 5;
export const ATTACK_RANGE = 5;
export const TRADE_RANGE = 10;
export const CLIMB_RANGE = 10;
export const LOCAL_CHAT_RADIUS = 100;

export const RESPAWN_TICKS = 30;
export const DEATH_LOSS_PERCENT = 0.20;

export const TREE_GATHER_TICKS = 3;
export const GOLD_GATHER_TICKS = 2;
export const SEED_DROP_CHANCE = 0.30;
export const SAPLING_GROWTH_TICKS = 300;
export const WATER_SPEED_BONUS = 50;

export const BEHEMOTH_UNCONSCIOUS_TICKS = 60;
export const BEHEMOTH_FEED_THRESHOLD = 10;
export const BEHEMOTH_ORE_GROWTH_TICKS = 120;
export const BEHEMOTH_THROW_DAMAGE_PERCENT = 0.50;
export const BEHEMOTH_SPEED = 2;

export const NPC_AGGRO_RANGE = 30;
export const NPC_CHASE_RANGE = 60;
export const NPC_SPAWN_RATIO = 1.5;
export const NPC_SPAWN_CHECK_INTERVAL = 60;
export const NPC_MAX_SPAWN_PER_CHECK = 3;

export const TRADE_EXPIRE_TICKS = 30;

export const SNAPSHOT_INTERVAL_TICKS = 60;

export const VISION_RADIUS = {
  merchant: 80,
  fighter: 100,
  monster_s1: 150,
  monster_s2: 150,
  monster_s3: 200,
  monster_s4: 250,
} as const;

export const BASE_STATS = {
  merchant: { health: 50, attack: 0, defense: 5, speed: 3 },
  fighter: { health: 100, attack: 15, defense: 10, speed: 4 },
  monster: { health: 80, attack: 12, defense: 8, speed: 5 },
} as const;

export const EVOLUTION_THRESHOLDS = [
  { stage: 2, kills: 5, eats: 3, attackMult: 1.5, healthMult: 1.25 },
  { stage: 3, kills: 15, eats: 10, attackMult: 2.0, healthMult: 1.5 },
  { stage: 4, kills: 30, eats: 20, attackMult: 3.0, healthMult: 2.0 },
] as const;
