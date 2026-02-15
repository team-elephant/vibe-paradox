import { describe, it, expect } from 'vitest';
import { WorldState } from '../src/server/world.js';
import { seedWorld } from '../src/server/seed.js';
import { distance } from '../src/types/core.js';
import { SPAWN_POINT, SAFE_ZONE_RADIUS, WORLD_SIZE } from '../src/shared/constants.js';

function createSeededWorld(seed: number): WorldState {
  const world = new WorldState(seed);
  seedWorld(world, seed);
  return world;
}

describe('seedWorld', () => {
  it('generates approximately 2000 trees', () => {
    const world = createSeededWorld(42);

    const trees = [...world.resources.values()].filter(r => r.type === 'tree');
    // Allow some variance from safe-zone filtering, but should be close to 2000
    expect(trees.length).toBeGreaterThan(1700);
    expect(trees.length).toBeLessThan(2100);
  });

  it('generates approximately 50 gold veins', () => {
    const world = createSeededWorld(42);

    const goldVeins = [...world.resources.values()].filter(r => r.type === 'gold_vein');
    // Allow some variance from safe-zone filtering
    expect(goldVeins.length).toBeGreaterThan(35);
    expect(goldVeins.length).toBeLessThanOrEqual(55);
  });

  it('generates exactly 5 behemoths', () => {
    const world = createSeededWorld(42);

    expect(world.behemoths.size).toBe(5);

    const types = [...world.behemoths.values()].map(b => b.type).sort();
    expect(types).toEqual([
      'copper_behemoth',
      'iron_behemoth',
      'mithril_behemoth',
      'obsidian_behemoth',
      'silver_behemoth',
    ]);
  });

  it('generates approximately 100 NPC monsters', () => {
    const world = createSeededWorld(42);

    // Target is ~90 from dangerous zones + 10 scattered = ~100
    expect(world.npcMonsters.size).toBeGreaterThan(70);
    expect(world.npcMonsters.size).toBeLessThan(130);
  });

  it('no entities within safe zone radius of spawn', () => {
    const world = createSeededWorld(42);

    // Check resources
    for (const [, resource] of world.resources) {
      const dist = distance(resource.position, SPAWN_POINT);
      expect(dist).toBeGreaterThanOrEqual(SAFE_ZONE_RADIUS);
    }

    // Check NPC monsters
    for (const [, monster] of world.npcMonsters) {
      const dist = distance(monster.position, SPAWN_POINT);
      expect(dist).toBeGreaterThanOrEqual(SAFE_ZONE_RADIUS);
    }
  });

  it('same seed produces identical world', () => {
    const world1 = createSeededWorld(12345);
    const world2 = createSeededWorld(12345);

    // Same number of each entity type
    expect(world1.resources.size).toBe(world2.resources.size);
    expect(world1.npcMonsters.size).toBe(world2.npcMonsters.size);
    expect(world1.behemoths.size).toBe(world2.behemoths.size);

    // Resources should have same positions and values (order may differ due to Map, so sort by position)
    const res1 = [...world1.resources.values()].sort(
      (a, b) => a.position.x - b.position.x || a.position.y - b.position.y,
    );
    const res2 = [...world2.resources.values()].sort(
      (a, b) => a.position.x - b.position.x || a.position.y - b.position.y,
    );

    for (let i = 0; i < res1.length; i++) {
      expect(res1[i]!.type).toBe(res2[i]!.type);
      expect(res1[i]!.position.x).toBeCloseTo(res2[i]!.position.x);
      expect(res1[i]!.position.y).toBeCloseTo(res2[i]!.position.y);
      expect(res1[i]!.remaining).toBe(res2[i]!.remaining);
    }

    // Monsters should have same positions and templates
    const mon1 = [...world1.npcMonsters.values()].sort(
      (a, b) => a.position.x - b.position.x || a.position.y - b.position.y,
    );
    const mon2 = [...world2.npcMonsters.values()].sort(
      (a, b) => a.position.x - b.position.x || a.position.y - b.position.y,
    );

    for (let i = 0; i < mon1.length; i++) {
      expect(mon1[i]!.template).toBe(mon2[i]!.template);
      expect(mon1[i]!.position.x).toBeCloseTo(mon2[i]!.position.x);
      expect(mon1[i]!.position.y).toBeCloseTo(mon2[i]!.position.y);
    }

    // Behemoths should have same types and positions
    const beh1 = [...world1.behemoths.values()].sort(
      (a, b) => a.type.localeCompare(b.type),
    );
    const beh2 = [...world2.behemoths.values()].sort(
      (a, b) => a.type.localeCompare(b.type),
    );

    for (let i = 0; i < beh1.length; i++) {
      expect(beh1[i]!.type).toBe(beh2[i]!.type);
      expect(beh1[i]!.position.x).toBeCloseTo(beh2[i]!.position.x);
      expect(beh1[i]!.position.y).toBeCloseTo(beh2[i]!.position.y);
    }
  });

  it('different seeds produce different worlds', () => {
    const world1 = createSeededWorld(111);
    const world2 = createSeededWorld(222);

    // Entity counts might be similar, but positions should differ
    const res1 = [...world1.resources.values()].map(r => r.position);
    const res2 = [...world2.resources.values()].map(r => r.position);

    // At least some positions should differ
    let diffCount = 0;
    const checkCount = Math.min(res1.length, res2.length, 50);
    for (let i = 0; i < checkCount; i++) {
      if (res1[i]!.x !== res2[i]!.x || res1[i]!.y !== res2[i]!.y) {
        diffCount++;
      }
    }
    expect(diffCount).toBeGreaterThan(0);
  });

  it('all entities are within world bounds', () => {
    const world = createSeededWorld(42);

    for (const [, resource] of world.resources) {
      expect(resource.position.x).toBeGreaterThanOrEqual(0);
      expect(resource.position.x).toBeLessThan(WORLD_SIZE);
      expect(resource.position.y).toBeGreaterThanOrEqual(0);
      expect(resource.position.y).toBeLessThan(WORLD_SIZE);
    }

    for (const [, monster] of world.npcMonsters) {
      expect(monster.position.x).toBeGreaterThanOrEqual(0);
      expect(monster.position.x).toBeLessThan(WORLD_SIZE);
      expect(monster.position.y).toBeGreaterThanOrEqual(0);
      expect(monster.position.y).toBeLessThan(WORLD_SIZE);
    }

    for (const [, behemoth] of world.behemoths) {
      expect(behemoth.position.x).toBeGreaterThanOrEqual(0);
      expect(behemoth.position.x).toBeLessThan(WORLD_SIZE);
      expect(behemoth.position.y).toBeGreaterThanOrEqual(0);
      expect(behemoth.position.y).toBeLessThan(WORLD_SIZE);
    }
  });

  it('trees have valid remaining/capacity values', () => {
    const world = createSeededWorld(42);

    const trees = [...world.resources.values()].filter(r => r.type === 'tree');
    for (const tree of trees) {
      expect(tree.remaining).toBeGreaterThanOrEqual(5);
      expect(tree.remaining).toBeLessThanOrEqual(10);
      expect(tree.remaining).toBe(tree.maxCapacity);
      expect(tree.state).toBe('available');
    }
  });

  it('gold veins have valid remaining/capacity values', () => {
    const world = createSeededWorld(42);

    const goldVeins = [...world.resources.values()].filter(r => r.type === 'gold_vein');
    for (const vein of goldVeins) {
      expect(vein.remaining).toBeGreaterThanOrEqual(100);
      expect(vein.remaining).toBeLessThanOrEqual(500);
      expect(vein.remaining).toBe(vein.maxCapacity);
      expect(vein.state).toBe('available');
    }
  });

  it('NPC monsters use valid templates', () => {
    const world = createSeededWorld(42);

    const validTemplates = new Set(['weak_goblin', 'medium_wolf', 'strong_troll']);
    for (const [, monster] of world.npcMonsters) {
      expect(validTemplates.has(monster.template)).toBe(true);
      expect(monster.behavior).toBe('patrol');
      expect(monster.status).toBe('roaming');
    }
  });

  it('behemoths have valid routes and initial state', () => {
    const world = createSeededWorld(42);

    for (const [, behemoth] of world.behemoths) {
      expect(behemoth.status).toBe('roaming');
      expect(behemoth.health).toBe(behemoth.maxHealth);
      expect(behemoth.oreAmount).toBe(0);
      expect(behemoth.fedAmount).toBe(0);
      expect(behemoth.route.length).toBeGreaterThan(0);
      expect(behemoth.currentWaypoint).toBe(0);
    }
  });
});
