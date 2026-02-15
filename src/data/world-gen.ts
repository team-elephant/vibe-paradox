// data/world-gen.ts — World generation parameters
// Forest zones, dangerous zones, behemoth territories, spawn rules

import type { Position } from '../types/core.js';

// --- Forest zones: clusters of trees ---

export interface ForestZone {
  center: Position;
  radius: number;
  treeDensity: number; // trees per unit area (approximate)
  treeCount: number;   // target trees for this zone
}

export const FOREST_ZONES: ForestZone[] = [
  // Northwest forest
  { center: { x: 150, y: 150 }, radius: 120, treeCount: 350, treeDensity: 0.008 },
  // Northeast forest
  { center: { x: 800, y: 200 }, radius: 100, treeCount: 280, treeDensity: 0.009 },
  // Southwest forest
  { center: { x: 200, y: 800 }, radius: 110, treeCount: 300, treeDensity: 0.008 },
  // Southeast forest
  { center: { x: 850, y: 850 }, radius: 90, treeCount: 250, treeDensity: 0.01 },
  // Central-north forest
  { center: { x: 500, y: 200 }, radius: 80, treeCount: 200, treeDensity: 0.01 },
  // Central-south forest
  { center: { x: 500, y: 800 }, radius: 80, treeCount: 200, treeDensity: 0.01 },
  // West forest
  { center: { x: 100, y: 500 }, radius: 70, treeCount: 180, treeDensity: 0.012 },
  // East forest
  { center: { x: 900, y: 500 }, radius: 70, treeCount: 180, treeDensity: 0.012 },
];

// Total target: ~1940 trees, variance from RNG will bring it near ~2000

// --- Dangerous zones: gold veins + high monster density ---

export interface DangerousZone {
  center: Position;
  radius: number;
  goldVeinCount: number;
  monsterDensity: number; // monsters per zone
}

export const DANGEROUS_ZONES: DangerousZone[] = [
  // North edge
  { center: { x: 500, y: 50 }, radius: 80, goldVeinCount: 8, monsterDensity: 15 },
  // South edge
  { center: { x: 500, y: 950 }, radius: 80, goldVeinCount: 8, monsterDensity: 15 },
  // West edge
  { center: { x: 50, y: 500 }, radius: 80, goldVeinCount: 8, monsterDensity: 15 },
  // East edge
  { center: { x: 950, y: 500 }, radius: 80, goldVeinCount: 8, monsterDensity: 15 },
  // Center corridor (most dangerous)
  { center: { x: 500, y: 500 }, radius: 60, goldVeinCount: 10, monsterDensity: 20 },
  // Northwest corner
  { center: { x: 50, y: 50 }, radius: 50, goldVeinCount: 4, monsterDensity: 5 },
  // Southeast corner
  { center: { x: 950, y: 950 }, radius: 50, goldVeinCount: 4, monsterDensity: 5 },
];

// Total target: ~50 gold veins, ~90 monsters from dangerous zones + ~10 scattered

// --- Behemoth territories ---

export interface BehemothTerritory {
  type: string;
  oreType: string;
  center: Position;
  radius: number;
  route: Position[];  // waypoints for roaming
  health: number;
  maxHealth: number;
  attack: number;
  defense: number;
  oreMax: number;
}

export const BEHEMOTH_TERRITORIES: BehemothTerritory[] = [
  {
    type: 'iron_behemoth',
    oreType: 'iron_ore',
    center: { x: 200, y: 200 },
    radius: 80,
    route: [
      { x: 160, y: 160 }, { x: 240, y: 160 },
      { x: 240, y: 240 }, { x: 160, y: 240 },
    ],
    health: 500, maxHealth: 500, attack: 30, defense: 20, oreMax: 15,
  },
  {
    type: 'copper_behemoth',
    oreType: 'copper_ore',
    center: { x: 800, y: 200 },
    radius: 80,
    route: [
      { x: 760, y: 160 }, { x: 840, y: 160 },
      { x: 840, y: 240 }, { x: 760, y: 240 },
    ],
    health: 500, maxHealth: 500, attack: 30, defense: 20, oreMax: 15,
  },
  {
    type: 'silver_behemoth',
    oreType: 'silver_ore',
    center: { x: 800, y: 800 },
    radius: 80,
    route: [
      { x: 760, y: 760 }, { x: 840, y: 760 },
      { x: 840, y: 840 }, { x: 760, y: 840 },
    ],
    health: 500, maxHealth: 500, attack: 30, defense: 20, oreMax: 15,
  },
  {
    type: 'mithril_behemoth',
    oreType: 'mithril_ore',
    center: { x: 200, y: 800 },
    radius: 80,
    route: [
      { x: 160, y: 760 }, { x: 240, y: 760 },
      { x: 240, y: 840 }, { x: 160, y: 840 },
    ],
    health: 500, maxHealth: 500, attack: 30, defense: 20, oreMax: 15,
  },
  {
    type: 'obsidian_behemoth',
    oreType: 'obsidian_ore',
    center: { x: 500, y: 500 },
    radius: 60,
    route: [
      { x: 470, y: 470 }, { x: 530, y: 470 },
      { x: 530, y: 530 }, { x: 470, y: 530 },
    ],
    health: 500, maxHealth: 500, attack: 30, defense: 20, oreMax: 15,
  },
];

// --- NPC Monster templates ---

export interface NpcTemplate {
  templateId: string;
  health: number;
  maxHealth: number;
  attack: number;
  defense: number;
  speed: number;
  patrolRadius: number;
  goldDropMin: number;
  goldDropMax: number;
  weight: number; // relative spawn weight
}

export const NPC_TEMPLATES: NpcTemplate[] = [
  {
    templateId: 'weak_goblin',
    health: 30, maxHealth: 30,
    attack: 5, defense: 3, speed: 3,
    patrolRadius: 30,
    goldDropMin: 5, goldDropMax: 15,
    weight: 5,
  },
  {
    templateId: 'medium_wolf',
    health: 60, maxHealth: 60,
    attack: 10, defense: 5, speed: 4,
    patrolRadius: 40,
    goldDropMin: 15, goldDropMax: 40,
    weight: 3,
  },
  {
    templateId: 'strong_troll',
    health: 120, maxHealth: 120,
    attack: 18, defense: 12, speed: 2,
    patrolRadius: 25,
    goldDropMin: 40, goldDropMax: 100,
    weight: 1,
  },
];

// --- Tree generation parameters ---

export const TREE_LOGS_MIN = 5;
export const TREE_LOGS_MAX = 10;

// --- Gold vein parameters ---

export const GOLD_VEIN_MIN = 100;
export const GOLD_VEIN_MAX = 500;
