// tests/monster.test.ts — Tests for MonsterProcessor (NPC AI, spawn balancing, evolution)

import { describe, it, expect, beforeEach } from 'vitest';
import { MonsterProcessor } from '../src/pipeline/monster-processor.js';
import { WorldState } from '../src/server/world.js';
import type { Agent, NpcMonster } from '../src/types/index.js';
import {
  NPC_AGGRO_RANGE,
  NPC_CHASE_RANGE,
  NPC_SPAWN_CHECK_INTERVAL,
  ATTACK_RANGE,
  BASE_STATS,
  SPAWN_POINT,
  SAFE_ZONE_RADIUS,
} from '../src/shared/constants.js';
import { distance } from '../src/types/index.js';
import { getEvolutionStage } from '../src/data/evolution.js';

function createAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: 'agent_test001',
    name: 'TestAgent',
    role: 'fighter',
    position: { x: 100, y: 100 },
    destination: null,
    status: 'idle',
    stats: {
      health: 100,
      maxHealth: 100,
      attack: 15,
      defense: 10,
      speed: 4,
      visionRadius: 100,
    },
    gold: 0,
    inventory: [],
    equipment: { weapon: null, armor: null, tool: null },
    alliance: null,
    kills: 0,
    monsterEats: 0,
    evolutionStage: 1,
    actionCooldown: 0,
    respawnTick: null,
    connectedAt: 0,
    lastActionTick: 0,
    isAlive: true,
    isConnected: true,
    ...overrides,
  };
}

function createNpcMonster(overrides: Partial<NpcMonster> = {}): NpcMonster {
  return {
    id: 'npc_test001',
    template: 'weak_goblin',
    position: { x: 300, y: 300 },
    health: 30,
    maxHealth: 30,
    attack: 5,
    defense: 3,
    speed: 3,
    status: 'roaming',
    behavior: 'patrol',
    patrolOrigin: { x: 300, y: 300 },
    patrolRadius: 30,
    targetId: null,
    goldDrop: 10,
    createdAt: 0,
    ...overrides,
  };
}

function createPlayerMonster(overrides: Partial<Agent> = {}): Agent {
  return createAgent({
    id: 'agent_mon001',
    name: 'MonsterPlayer',
    role: 'monster',
    position: { x: 200, y: 200 },
    stats: {
      health: 80,
      maxHealth: 80,
      attack: 12,
      defense: 8,
      speed: 5,
      visionRadius: 150,
    },
    kills: 0,
    monsterEats: 0,
    evolutionStage: 1,
    ...overrides,
  });
}

describe('MonsterProcessor', () => {
  let processor: MonsterProcessor;
  let world: WorldState;

  beforeEach(() => {
    processor = new MonsterProcessor();
    world = new WorldState(42);
  });

  describe('NPC Patrol', () => {
    it('should keep NPC within patrol radius when patrolling', () => {
      const npc = createNpcMonster({
        patrolOrigin: { x: 300, y: 300 },
        patrolRadius: 30,
      });
      world.addNpcMonster(npc);

      // Run multiple ticks
      for (let t = 1; t <= 50; t++) {
        processor.tick(world, t);

        const updated = world.npcMonsters.get('npc_test001')!;
        const distFromOrigin = distance(updated.position, { x: 300, y: 300 });
        // NPC should stay within patrol radius + speed (one step overshoot is OK)
        expect(distFromOrigin).toBeLessThanOrEqual(npc.patrolRadius + npc.speed + 1);
      }
    });

    it('should not leave patrol radius over many ticks', () => {
      const npc = createNpcMonster({
        position: { x: 500, y: 500 },
        patrolOrigin: { x: 500, y: 500 },
        patrolRadius: 50,
        speed: 3,
      });
      world.addNpcMonster(npc);

      for (let t = 1; t <= 100; t++) {
        processor.tick(world, t);
      }

      const updated = world.npcMonsters.get('npc_test001')!;
      // After many ticks, should still be near patrol origin
      const distFromOrigin = distance(updated.position, { x: 500, y: 500 });
      expect(distFromOrigin).toBeLessThanOrEqual(50 + 3 + 1);
    });
  });

  describe('NPC Chase', () => {
    it('should chase when a human enters aggro range', () => {
      const npc = createNpcMonster({
        position: { x: 300, y: 300 },
      });
      world.addNpcMonster(npc);

      // Place a human just within aggro range
      const human = createAgent({
        position: { x: 300 + NPC_AGGRO_RANGE - 1, y: 300 },
      });
      world.addAgent(human);

      processor.tick(world, 1);

      const updated = world.npcMonsters.get('npc_test001')!;
      expect(updated.behavior).toBe('chase');
      expect(updated.targetId).toBe('agent_test001');
    });

    it('should NOT chase when human is outside aggro range', () => {
      const npc = createNpcMonster({
        position: { x: 300, y: 300 },
      });
      world.addNpcMonster(npc);

      // Place a human just outside aggro range
      const human = createAgent({
        position: { x: 300 + NPC_AGGRO_RANGE + 5, y: 300 },
      });
      world.addAgent(human);

      processor.tick(world, 1);

      const updated = world.npcMonsters.get('npc_test001')!;
      expect(updated.behavior).toBe('patrol');
      expect(updated.targetId).toBeNull();
    });

    it('should return to patrol when human leaves chase range', () => {
      const npc = createNpcMonster({
        position: { x: 300, y: 300 },
        behavior: 'chase',
        targetId: 'agent_test001',
      });
      world.addNpcMonster(npc);

      // Place human outside chase range
      const human = createAgent({
        position: { x: 300 + NPC_CHASE_RANGE + 5, y: 300 },
      });
      world.addAgent(human);

      processor.tick(world, 1);

      const updated = world.npcMonsters.get('npc_test001')!;
      expect(updated.behavior).toBe('patrol');
      expect(updated.targetId).toBeNull();
    });

    it('should return to patrol when target dies', () => {
      const npc = createNpcMonster({
        position: { x: 300, y: 300 },
        behavior: 'chase',
        targetId: 'agent_test001',
      });
      world.addNpcMonster(npc);

      // Human is dead
      const human = createAgent({
        position: { x: 310, y: 300 },
        status: 'dead',
        isAlive: true,
      });
      world.addAgent(human);

      processor.tick(world, 1);

      const updated = world.npcMonsters.get('npc_test001')!;
      expect(updated.behavior).toBe('patrol');
      expect(updated.targetId).toBeNull();
    });

    it('should move toward target while chasing', () => {
      const npc = createNpcMonster({
        position: { x: 300, y: 300 },
        behavior: 'chase',
        targetId: 'agent_test001',
        speed: 3,
      });
      world.addNpcMonster(npc);

      // Place human within chase range but outside attack range
      const human = createAgent({
        position: { x: 320, y: 300 },
      });
      world.addAgent(human);

      processor.tick(world, 1);

      const updated = world.npcMonsters.get('npc_test001')!;
      // NPC should have moved toward human (x increased by speed)
      expect(updated.position.x).toBeCloseTo(303, 0);
    });

    it('should switch to attack when in attack range', () => {
      const npc = createNpcMonster({
        position: { x: 300, y: 300 },
        behavior: 'chase',
        targetId: 'agent_test001',
      });
      world.addNpcMonster(npc);

      // Place human within attack range
      const human = createAgent({
        position: { x: 300 + ATTACK_RANGE - 1, y: 300 },
      });
      world.addAgent(human);

      processor.tick(world, 1);

      const updated = world.npcMonsters.get('npc_test001')!;
      expect(updated.behavior).toBe('attack');
    });
  });

  describe('NPC Attack', () => {
    it('should stay in attack behavior when target is in range', () => {
      const npc = createNpcMonster({
        position: { x: 300, y: 300 },
        behavior: 'attack',
        targetId: 'agent_test001',
      });
      world.addNpcMonster(npc);

      const human = createAgent({
        position: { x: 300 + ATTACK_RANGE - 1, y: 300 },
      });
      world.addAgent(human);

      processor.tick(world, 1);

      const updated = world.npcMonsters.get('npc_test001')!;
      expect(updated.behavior).toBe('attack');
    });

    it('should switch to chase when target moves out of attack range', () => {
      const npc = createNpcMonster({
        position: { x: 300, y: 300 },
        behavior: 'attack',
        targetId: 'agent_test001',
      });
      world.addNpcMonster(npc);

      // Human just outside attack range
      const human = createAgent({
        position: { x: 300 + ATTACK_RANGE + 2, y: 300 },
      });
      world.addAgent(human);

      processor.tick(world, 1);

      const updated = world.npcMonsters.get('npc_test001')!;
      expect(updated.behavior).toBe('chase');
    });

    it('should return to patrol when target is gone', () => {
      const npc = createNpcMonster({
        position: { x: 300, y: 300 },
        behavior: 'attack',
        targetId: 'agent_nonexist',
      });
      world.addNpcMonster(npc);

      processor.tick(world, 1);

      const updated = world.npcMonsters.get('npc_test001')!;
      expect(updated.behavior).toBe('patrol');
      expect(updated.targetId).toBeNull();
    });
  });

  describe('Monster Evolution', () => {
    it('should evolve to stage 2 at 5 kills', () => {
      const monster = createPlayerMonster({ kills: 4, monsterEats: 0 });
      world.addAgent(monster);

      monster.kills = 5;
      processor.checkEvolution(monster, world, 100);

      expect(monster.evolutionStage).toBe(2);
      expect(monster.stats.attack).toBe(Math.floor(BASE_STATS.monster.attack * 1.5));
      expect(monster.stats.maxHealth).toBe(Math.floor(BASE_STATS.monster.health * 1.25));
      expect(monster.stats.health).toBe(monster.stats.maxHealth); // Full heal

      // Should emit evolution event
      const evolEvent = world.tickEvents.find(e => e.type === 'evolution');
      expect(evolEvent).toBeDefined();
      if (evolEvent && evolEvent.type === 'evolution') {
        expect(evolEvent.fromStage).toBe(1);
        expect(evolEvent.toStage).toBe(2);
        expect(evolEvent.monsterId).toBe('agent_mon001');
      }
    });

    it('should evolve to stage 2 at 3 eats (OR condition)', () => {
      const monster = createPlayerMonster({ kills: 0, monsterEats: 2 });
      world.addAgent(monster);

      monster.monsterEats = 3;
      processor.checkEvolution(monster, world, 100);

      expect(monster.evolutionStage).toBe(2);
    });

    it('should NOT evolve when below thresholds', () => {
      const monster = createPlayerMonster({ kills: 2, monsterEats: 1 });
      world.addAgent(monster);

      processor.checkEvolution(monster, world, 100);

      expect(monster.evolutionStage).toBe(1);
      expect(world.tickEvents.filter(e => e.type === 'evolution')).toHaveLength(0);
    });

    it('should evolve to stage 3 at 15 kills', () => {
      const monster = createPlayerMonster({
        kills: 15,
        monsterEats: 0,
        evolutionStage: 2,
        stats: {
          health: 100,
          maxHealth: 100,
          attack: 18,
          defense: 12,
          speed: 5,
          visionRadius: 150,
        },
      });
      world.addAgent(monster);

      processor.checkEvolution(monster, world, 200);

      expect(monster.evolutionStage).toBe(3);
      expect(monster.stats.attack).toBe(Math.floor(BASE_STATS.monster.attack * 2.0));
      expect(monster.stats.maxHealth).toBe(Math.floor(BASE_STATS.monster.health * 1.5));
    });

    it('should skip stages if thresholds are exceeded', () => {
      // Monster goes from stage 1 directly to stage 3 if thresholds exceeded
      const monster = createPlayerMonster({ kills: 15, monsterEats: 0, evolutionStage: 1 });
      world.addAgent(monster);

      processor.checkEvolution(monster, world, 200);

      expect(monster.evolutionStage).toBe(3);
    });
  });

  describe('Monster Eating', () => {
    it('should absorb 10% of NPC stats on eat', () => {
      const monster = createPlayerMonster();
      world.addAgent(monster);

      const npc = createNpcMonster({
        maxHealth: 60,
        attack: 10,
        defense: 5,
      });

      const originalMaxHP = monster.stats.maxHealth;
      const originalAtk = monster.stats.attack;
      const originalDef = monster.stats.defense;
      const originalHP = monster.stats.health;

      processor.monsterEat(monster, npc, world, 100);

      expect(monster.stats.maxHealth).toBe(originalMaxHP + Math.floor(60 * 0.1));
      expect(monster.stats.attack).toBe(originalAtk + Math.floor(10 * 0.1));
      expect(monster.stats.defense).toBe(originalDef + Math.floor(5 * 0.1));
      // Health should increase by the same amount as maxHealth (heal on eat)
      expect(monster.stats.health).toBe(originalHP + Math.floor(60 * 0.1));
      expect(monster.monsterEats).toBe(1);
    });

    it('should emit monster_eat event', () => {
      const monster = createPlayerMonster();
      world.addAgent(monster);

      const npc = createNpcMonster();

      processor.monsterEat(monster, npc, world, 100);

      const eatEvent = world.tickEvents.find(e => e.type === 'monster_eat');
      expect(eatEvent).toBeDefined();
      if (eatEvent && eatEvent.type === 'monster_eat') {
        expect(eatEvent.eaterId).toBe('agent_mon001');
        expect(eatEvent.eatenId).toBe('npc_test001');
        expect(eatEvent.statsGained).toBeDefined();
      }
    });

    it('should trigger evolution check after eating', () => {
      // Set up monster just below eat threshold for stage 2
      const monster = createPlayerMonster({ monsterEats: 2 });
      world.addAgent(monster);

      const npc = createNpcMonster();

      processor.monsterEat(monster, npc, world, 100);

      // monsterEats should now be 3, which triggers stage 2
      expect(monster.monsterEats).toBe(3);
      expect(monster.evolutionStage).toBe(2);
    });
  });

  describe('Spawn Check', () => {
    it('should spawn NPCs when below target ratio', () => {
      // Add 10 human agents
      for (let i = 0; i < 10; i++) {
        const human = createAgent({
          id: `agent_human${i}`,
          name: `Human${i}`,
          position: { x: 500 + i * 10, y: 500 },
          isConnected: true,
          isAlive: true,
        });
        world.addAgent(human);
      }

      // Add only 5 NPCs (target should be 15 based on 1.5 ratio)
      for (let i = 0; i < 5; i++) {
        const npc = createNpcMonster({
          id: `npc_existing${i}`,
          position: { x: 700 + i * 10, y: 700 },
        });
        world.addNpcMonster(npc);
      }

      const initialCount = world.npcMonsters.size;
      processor.spawnCheck(world, NPC_SPAWN_CHECK_INTERVAL);

      // Should spawn up to 3 (NPC_MAX_SPAWN_PER_CHECK)
      expect(world.npcMonsters.size).toBeGreaterThan(initialCount);
      expect(world.npcMonsters.size).toBeLessThanOrEqual(initialCount + 3);
    });

    it('should NOT spawn when at or above target ratio', () => {
      // Add 2 humans
      for (let i = 0; i < 2; i++) {
        const human = createAgent({
          id: `agent_human${i}`,
          name: `Human${i}`,
          position: { x: 500 + i * 10, y: 500 },
          isConnected: true,
          isAlive: true,
        });
        world.addAgent(human);
      }

      // Add 3 NPCs (target is floor(2 * 1.5) = 3, already met)
      for (let i = 0; i < 3; i++) {
        const npc = createNpcMonster({
          id: `npc_existing${i}`,
          position: { x: 700 + i * 10, y: 700 },
        });
        world.addNpcMonster(npc);
      }

      processor.spawnCheck(world, NPC_SPAWN_CHECK_INTERVAL);

      expect(world.npcMonsters.size).toBe(3);
    });

    it('should only check on spawn check interval ticks', () => {
      // Add humans but no NPCs
      const human = createAgent({
        isConnected: true,
        isAlive: true,
      });
      world.addAgent(human);

      // Call on non-interval tick
      processor.spawnCheck(world, NPC_SPAWN_CHECK_INTERVAL + 1);

      // No spawns should happen
      expect(world.npcMonsters.size).toBe(0);
    });

    it('should emit npc_spawn events', () => {
      // Add enough humans to trigger spawning
      for (let i = 0; i < 10; i++) {
        const human = createAgent({
          id: `agent_h${i}`,
          name: `H${i}`,
          position: { x: 500 + i * 10, y: 500 },
          isConnected: true,
          isAlive: true,
        });
        world.addAgent(human);
      }

      processor.spawnCheck(world, NPC_SPAWN_CHECK_INTERVAL);

      const spawnEvents = world.tickEvents.filter(e => e.type === 'npc_spawn');
      expect(spawnEvents.length).toBeGreaterThan(0);
    });

    it('should NOT count monsters as humans for spawn ratio', () => {
      // Add 2 monster-role agents and 1 human
      const monsterAgent = createPlayerMonster({
        id: 'agent_mon1',
        isConnected: true,
        isAlive: true,
      });
      const monsterAgent2 = createPlayerMonster({
        id: 'agent_mon2',
        name: 'Mon2',
        isConnected: true,
        isAlive: true,
      });
      const human = createAgent({
        id: 'agent_h1',
        name: 'H1',
        isConnected: true,
        isAlive: true,
      });
      world.addAgent(monsterAgent);
      world.addAgent(monsterAgent2);
      world.addAgent(human);

      // Target = floor(1 * 1.5) = 1 NPC (only 1 human counted)
      // Add 1 NPC → at target
      const npc = createNpcMonster();
      world.addNpcMonster(npc);

      processor.spawnCheck(world, NPC_SPAWN_CHECK_INTERVAL);

      // Should NOT spawn more since we're at target
      expect(world.npcMonsters.size).toBe(1);
    });
  });

  describe('Evolution thresholds (data)', () => {
    it('stage 1 for 0 kills and 0 eats', () => {
      expect(getEvolutionStage(0, 0)).toBe(1);
    });

    it('stage 2 for 5 kills', () => {
      expect(getEvolutionStage(5, 0)).toBe(2);
    });

    it('stage 2 for 3 eats', () => {
      expect(getEvolutionStage(0, 3)).toBe(2);
    });

    it('stage 3 for 15 kills', () => {
      expect(getEvolutionStage(15, 0)).toBe(3);
    });

    it('stage 3 for 10 eats', () => {
      expect(getEvolutionStage(0, 10)).toBe(3);
    });

    it('stage 4 for 30 kills', () => {
      expect(getEvolutionStage(30, 0)).toBe(4);
    });

    it('stage 4 for 20 eats', () => {
      expect(getEvolutionStage(0, 20)).toBe(4);
    });

    it('highest qualifying stage wins', () => {
      // 30 kills qualifies for all stages, should return highest
      expect(getEvolutionStage(30, 20)).toBe(4);
    });

    it('below all thresholds stays at stage 1', () => {
      expect(getEvolutionStage(4, 2)).toBe(1);
    });
  });

  describe('NPC does not target monsters', () => {
    it('should not aggro on player monsters', () => {
      const npc = createNpcMonster({
        position: { x: 300, y: 300 },
      });
      world.addNpcMonster(npc);

      // Place a player monster within aggro range
      const monster = createPlayerMonster({
        position: { x: 300 + NPC_AGGRO_RANGE - 1, y: 300 },
      });
      world.addAgent(monster);

      processor.tick(world, 1);

      const updated = world.npcMonsters.get('npc_test001')!;
      // Should NOT chase — player monsters have role='monster', NPCs only target humans
      expect(updated.behavior).toBe('patrol');
    });
  });

  describe('Multiple NPCs', () => {
    it('should process all NPCs independently', () => {
      const npc1 = createNpcMonster({
        id: 'npc_one',
        position: { x: 100, y: 100 },
        patrolOrigin: { x: 100, y: 100 },
      });
      const npc2 = createNpcMonster({
        id: 'npc_two',
        position: { x: 800, y: 800 },
        patrolOrigin: { x: 800, y: 800 },
      });
      world.addNpcMonster(npc1);
      world.addNpcMonster(npc2);

      // Place a human near npc1 only
      const human = createAgent({
        position: { x: 100 + NPC_AGGRO_RANGE - 1, y: 100 },
      });
      world.addAgent(human);

      processor.tick(world, 1);

      const updated1 = world.npcMonsters.get('npc_one')!;
      const updated2 = world.npcMonsters.get('npc_two')!;

      expect(updated1.behavior).toBe('chase');
      expect(updated2.behavior).toBe('patrol'); // Too far from human
    });
  });
});
