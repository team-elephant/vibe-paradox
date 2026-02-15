// server/seed.ts — World generation from seed
// Deterministic: same seed = same world

import type { Resource, NpcMonster, Behemoth } from '../types/index.js';
import type { Position } from '../types/core.js';
import { distance } from '../types/core.js';
import { generateResourceId, generateNpcId, generateBehemothId } from '../shared/utils.js';
import {
  WORLD_SIZE,
  SPAWN_POINT,
  SAFE_ZONE_RADIUS,
} from '../shared/constants.js';
import {
  FOREST_ZONES,
  DANGEROUS_ZONES,
  BEHEMOTH_TERRITORIES,
  NPC_TEMPLATES,
  TREE_LOGS_MIN,
  TREE_LOGS_MAX,
  GOLD_VEIN_MIN,
  GOLD_VEIN_MAX,
} from '../data/world-gen.js';
import type { NpcTemplate } from '../data/world-gen.js';
import { SeededRng } from './rng.js';
import type { WorldState } from './world.js';

/**
 * Generate the initial world state from a seed.
 * Same seed always produces the same world.
 */
export function seedWorld(world: WorldState, seed: number): void {
  const rng = new SeededRng(seed);

  generateTrees(world, rng);
  generateGoldVeins(world, rng);
  generateBehemoths(world, rng);
  generateNpcMonsters(world, rng);
}

function isInSafeZone(pos: Position): boolean {
  return distance(pos, SPAWN_POINT) < SAFE_ZONE_RADIUS;
}

function clampToWorld(value: number): number {
  return Math.max(0, Math.min(WORLD_SIZE - 1, value));
}

function randomPointInCircle(rng: SeededRng, center: Position, radius: number): Position {
  // Use rejection sampling for uniform distribution within circle
  for (let i = 0; i < 100; i++) {
    const x = rng.nextFloat(center.x - radius, center.x + radius);
    const y = rng.nextFloat(center.y - radius, center.y + radius);
    const pos = { x: clampToWorld(x), y: clampToWorld(y) };
    if (distance(pos, center) <= radius) {
      return pos;
    }
  }
  // Fallback: return center offset slightly
  return {
    x: clampToWorld(center.x + rng.nextFloat(-5, 5)),
    y: clampToWorld(center.y + rng.nextFloat(-5, 5)),
  };
}

function generateTrees(world: WorldState, rng: SeededRng): void {
  for (const zone of FOREST_ZONES) {
    for (let i = 0; i < zone.treeCount; i++) {
      const pos = randomPointInCircle(rng, zone.center, zone.radius);

      // Skip if in safe zone
      if (isInSafeZone(pos)) continue;

      const logs = rng.nextInt(TREE_LOGS_MIN, TREE_LOGS_MAX);
      const tree: Resource = {
        id: generateResourceId(),
        type: 'tree',
        position: pos,
        remaining: logs,
        maxCapacity: logs,
        state: 'available',
        growthStartTick: null,
        growthCompleteTick: null,
        createdAt: 0,
      };
      world.addResource(tree);
    }
  }
}

function generateGoldVeins(world: WorldState, rng: SeededRng): void {
  for (const zone of DANGEROUS_ZONES) {
    for (let i = 0; i < zone.goldVeinCount; i++) {
      const pos = randomPointInCircle(rng, zone.center, zone.radius);

      // Skip if in safe zone
      if (isInSafeZone(pos)) continue;

      const gold = rng.nextInt(GOLD_VEIN_MIN, GOLD_VEIN_MAX);
      const vein: Resource = {
        id: generateResourceId(),
        type: 'gold_vein',
        position: pos,
        remaining: gold,
        maxCapacity: gold,
        state: 'available',
        growthStartTick: null,
        growthCompleteTick: null,
        createdAt: 0,
      };
      world.addResource(vein);
    }
  }
}

function generateBehemoths(world: WorldState, rng: SeededRng): void {
  for (const territory of BEHEMOTH_TERRITORIES) {
    // Place behemoth at first waypoint of its route
    const startPos = territory.route[0]!;
    const behemoth: Behemoth = {
      id: generateBehemothId(),
      type: territory.type,
      position: { x: startPos.x, y: startPos.y },
      health: territory.health,
      maxHealth: territory.maxHealth,
      attack: territory.attack,
      defense: territory.defense,
      status: 'roaming',
      oreAmount: 0,
      oreMax: territory.oreMax,
      fedAmount: 0,
      unconsciousUntilTick: null,
      route: territory.route.map(p => ({ x: p.x, y: p.y })),
      currentWaypoint: 0,
    };
    world.addBehemoth(behemoth);
  }
}

function pickTemplate(rng: SeededRng): NpcTemplate {
  const totalWeight = NPC_TEMPLATES.reduce((sum, t) => sum + t.weight, 0);
  let roll = rng.nextFloat(0, totalWeight);
  for (const template of NPC_TEMPLATES) {
    roll -= template.weight;
    if (roll <= 0) return template;
  }
  return NPC_TEMPLATES[0]!;
}

function generateNpcMonsters(world: WorldState, rng: SeededRng): void {
  // Spawn monsters in dangerous zones (dense near gold)
  for (const zone of DANGEROUS_ZONES) {
    const count = Math.round(zone.monsterDensity);
    for (let i = 0; i < count; i++) {
      const pos = randomPointInCircle(rng, zone.center, zone.radius);

      // Skip if in safe zone
      if (isInSafeZone(pos)) continue;

      const template = pickTemplate(rng);
      const goldDrop = rng.nextInt(template.goldDropMin, template.goldDropMax);

      const monster: NpcMonster = {
        id: generateNpcId(),
        template: template.templateId,
        position: pos,
        health: template.health,
        maxHealth: template.maxHealth,
        attack: template.attack,
        defense: template.defense,
        speed: template.speed,
        status: 'roaming',
        behavior: 'patrol',
        patrolOrigin: { x: pos.x, y: pos.y },
        patrolRadius: template.patrolRadius,
        targetId: null,
        goldDrop,
        createdAt: 0,
      };
      world.addNpcMonster(monster);
    }
  }

  // Scatter a few extra monsters in non-safe areas for variety
  const scatteredCount = 10;
  for (let i = 0; i < scatteredCount; i++) {
    let pos: Position;
    // Keep trying until we find a non-safe-zone position
    do {
      pos = {
        x: rng.nextFloat(0, WORLD_SIZE - 1),
        y: rng.nextFloat(0, WORLD_SIZE - 1),
      };
    } while (isInSafeZone(pos));

    const template = pickTemplate(rng);
    const goldDrop = rng.nextInt(template.goldDropMin, template.goldDropMax);

    const monster: NpcMonster = {
      id: generateNpcId(),
      template: template.templateId,
      position: pos,
      health: template.health,
      maxHealth: template.maxHealth,
      attack: template.attack,
      defense: template.defense,
      speed: template.speed,
      status: 'roaming',
      behavior: 'patrol',
      patrolOrigin: { x: pos.x, y: pos.y },
      patrolRadius: template.patrolRadius,
      targetId: null,
      goldDrop,
      createdAt: 0,
    };
    world.addNpcMonster(monster);
  }
}
