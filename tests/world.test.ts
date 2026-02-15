import { describe, it, expect } from 'vitest';
import { WorldState } from '../src/server/world.js';
import type { Agent, Resource, NpcMonster, Behemoth, Structure } from '../src/types/index.js';

function makeAgent(id: string, x: number, y: number, overrides?: Partial<Agent>): Agent {
  return {
    id,
    name: `Agent_${id}`,
    role: 'fighter',
    position: { x, y },
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

function makeResource(id: string, x: number, y: number, type: 'tree' | 'gold_vein' | 'sapling' = 'tree'): Resource {
  return {
    id,
    type,
    position: { x, y },
    remaining: 5,
    maxCapacity: 10,
    state: 'available',
    growthStartTick: null,
    growthCompleteTick: null,
    createdAt: 0,
  };
}

function makeNpcMonster(id: string, x: number, y: number): NpcMonster {
  return {
    id,
    template: 'weak_goblin',
    position: { x, y },
    health: 30,
    maxHealth: 30,
    attack: 5,
    defense: 3,
    speed: 3,
    status: 'roaming',
    behavior: 'patrol',
    patrolOrigin: { x, y },
    patrolRadius: 50,
    targetId: null,
    goldDrop: 10,
    createdAt: 0,
  };
}

function makeBehemoth(id: string, x: number, y: number): Behemoth {
  return {
    id,
    type: 'iron',
    position: { x, y },
    health: 500,
    maxHealth: 500,
    attack: 30,
    defense: 20,
    status: 'roaming',
    oreAmount: 0,
    oreMax: 15,
    fedAmount: 0,
    unconsciousUntilTick: null,
    route: [{ x, y }, { x: x + 100, y: y + 100 }],
    currentWaypoint: 0,
  };
}

function makeStructure(id: string, x: number, y: number): Structure {
  return {
    id,
    type: 'wooden_wall',
    position: { x, y },
    owner: 'agent_owner',
    alliance: null,
    createdAt: 0,
  };
}

describe('WorldState', () => {
  describe('Agent management', () => {
    it('should add and retrieve agents', () => {
      const world = new WorldState(42);
      const agent = makeAgent('a1', 100, 100);
      world.addAgent(agent);

      expect(world.agents.get('a1')).toBe(agent);
      expect(world.agents.size).toBe(1);
    });

    it('should remove agents', () => {
      const world = new WorldState(42);
      world.addAgent(makeAgent('a1', 100, 100));
      world.removeAgent('a1');

      expect(world.agents.has('a1')).toBe(false);
      expect(world.agents.size).toBe(0);
    });

    it('should move agents and update chunk manager', () => {
      const world = new WorldState(42);
      const agent = makeAgent('a1', 100, 100);
      world.addAgent(agent);

      world.moveAgent('a1', { x: 800, y: 800 });

      expect(agent.position).toEqual({ x: 800, y: 800 });

      // Should be found near new position
      const nearby = world.getEntitiesNear({ x: 800, y: 800 }, 50);
      expect(nearby.agents.map(a => a.id)).toContain('a1');

      // Should NOT be found near old position
      const oldNearby = world.getEntitiesNear({ x: 100, y: 100 }, 50);
      expect(oldNearby.agents.map(a => a.id)).not.toContain('a1');
    });

    it('should handle remove of nonexistent agent gracefully', () => {
      const world = new WorldState(42);
      expect(() => world.removeAgent('nonexistent')).not.toThrow();
    });

    it('should handle move of nonexistent agent gracefully', () => {
      const world = new WorldState(42);
      expect(() => world.moveAgent('nonexistent', { x: 0, y: 0 })).not.toThrow();
    });
  });

  describe('Resource management', () => {
    it('should add and retrieve resources', () => {
      const world = new WorldState(42);
      const tree = makeResource('r1', 200, 200);
      world.addResource(tree);

      expect(world.resources.get('r1')).toBe(tree);
    });

    it('should remove resources', () => {
      const world = new WorldState(42);
      world.addResource(makeResource('r1', 200, 200));
      world.removeResource('r1');
      expect(world.resources.has('r1')).toBe(false);
    });
  });

  describe('NPC Monster management', () => {
    it('should add and retrieve monsters', () => {
      const world = new WorldState(42);
      const npc = makeNpcMonster('n1', 300, 300);
      world.addNpcMonster(npc);

      expect(world.npcMonsters.get('n1')).toBe(npc);
    });

    it('should remove monsters', () => {
      const world = new WorldState(42);
      world.addNpcMonster(makeNpcMonster('n1', 300, 300));
      world.removeNpcMonster('n1');
      expect(world.npcMonsters.has('n1')).toBe(false);
    });

    it('should move monsters', () => {
      const world = new WorldState(42);
      const npc = makeNpcMonster('n1', 300, 300);
      world.addNpcMonster(npc);
      world.moveNpcMonster('n1', { x: 400, y: 400 });
      expect(npc.position).toEqual({ x: 400, y: 400 });
    });
  });

  describe('Behemoth management', () => {
    it('should add and retrieve behemoths', () => {
      const world = new WorldState(42);
      const beh = makeBehemoth('b1', 200, 800);
      world.addBehemoth(beh);

      expect(world.behemoths.get('b1')).toBe(beh);
    });

    it('should remove behemoths', () => {
      const world = new WorldState(42);
      world.addBehemoth(makeBehemoth('b1', 200, 800));
      world.removeBehemoth('b1');
      expect(world.behemoths.has('b1')).toBe(false);
    });
  });

  describe('Structure management', () => {
    it('should add and retrieve structures', () => {
      const world = new WorldState(42);
      const s = makeStructure('s1', 500, 500);
      world.addStructure(s);

      expect(world.structures.get('s1')).toBe(s);
    });

    it('should remove structures', () => {
      const world = new WorldState(42);
      world.addStructure(makeStructure('s1', 500, 500));
      world.removeStructure('s1');
      expect(world.structures.has('s1')).toBe(false);
    });
  });

  describe('getEntitiesNear', () => {
    it('should return agents and resources within radius', () => {
      const world = new WorldState(42);

      world.addAgent(makeAgent('a1', 100, 100));
      world.addAgent(makeAgent('a2', 120, 120));
      world.addAgent(makeAgent('a3', 900, 900));

      world.addResource(makeResource('r1', 110, 110));
      world.addResource(makeResource('r2', 800, 800));

      const nearby = world.getEntitiesNear({ x: 100, y: 100 }, 50);

      expect(nearby.agents.map(a => a.id)).toContain('a1');
      expect(nearby.agents.map(a => a.id)).toContain('a2');
      expect(nearby.agents.map(a => a.id)).not.toContain('a3');

      expect(nearby.resources.map(r => r.id)).toContain('r1');
      expect(nearby.resources.map(r => r.id)).not.toContain('r2');
    });

    it('should return monsters within radius', () => {
      const world = new WorldState(42);

      world.addNpcMonster(makeNpcMonster('n1', 100, 100));
      world.addNpcMonster(makeNpcMonster('n2', 900, 900));

      const nearby = world.getEntitiesNear({ x: 100, y: 100 }, 50);
      expect(nearby.monsters.map(m => m.id)).toContain('n1');
      expect(nearby.monsters.map(m => m.id)).not.toContain('n2');
    });

    it('should return behemoths within radius', () => {
      const world = new WorldState(42);

      world.addBehemoth(makeBehemoth('b1', 100, 100));
      world.addBehemoth(makeBehemoth('b2', 900, 900));

      const nearby = world.getEntitiesNear({ x: 100, y: 100 }, 50);
      expect(nearby.behemoths.map(b => b.id)).toContain('b1');
      expect(nearby.behemoths.map(b => b.id)).not.toContain('b2');
    });

    it('should return structures within radius', () => {
      const world = new WorldState(42);

      world.addStructure(makeStructure('s1', 100, 100));
      world.addStructure(makeStructure('s2', 900, 900));

      const nearby = world.getEntitiesNear({ x: 100, y: 100 }, 50);
      expect(nearby.structures.map(s => s.id)).toContain('s1');
      expect(nearby.structures.map(s => s.id)).not.toContain('s2');
    });

    it('should return all entity types in mixed query', () => {
      const world = new WorldState(42);

      world.addAgent(makeAgent('a1', 500, 500));
      world.addResource(makeResource('r1', 505, 505));
      world.addNpcMonster(makeNpcMonster('n1', 510, 510));
      world.addBehemoth(makeBehemoth('b1', 515, 515));
      world.addStructure(makeStructure('s1', 520, 520));

      const nearby = world.getEntitiesNear({ x: 500, y: 500 }, 50);

      expect(nearby.agents).toHaveLength(1);
      expect(nearby.resources).toHaveLength(1);
      expect(nearby.monsters).toHaveLength(1);
      expect(nearby.behemoths).toHaveLength(1);
      expect(nearby.structures).toHaveLength(1);
    });

    it('should correctly filter entities at radius boundary', () => {
      const world = new WorldState(42);

      // Agent exactly at radius distance
      world.addAgent(makeAgent('exact', 150, 100));  // distance from (100,100) = 50
      // Agent just outside
      world.addAgent(makeAgent('outside', 151, 100));  // distance ~51

      const nearby = world.getEntitiesNear({ x: 100, y: 100 }, 50);
      expect(nearby.agents.map(a => a.id)).toContain('exact');
      expect(nearby.agents.map(a => a.id)).not.toContain('outside');
    });

    it('should return empty arrays when no entities nearby', () => {
      const world = new WorldState(42);

      world.addAgent(makeAgent('a1', 900, 900));

      const nearby = world.getEntitiesNear({ x: 100, y: 100 }, 50);

      expect(nearby.agents).toHaveLength(0);
      expect(nearby.resources).toHaveLength(0);
      expect(nearby.monsters).toHaveLength(0);
      expect(nearby.behemoths).toHaveLength(0);
      expect(nearby.structures).toHaveLength(0);
    });
  });

  describe('Tick state', () => {
    it('should initialize with tick 0 and empty collections', () => {
      const world = new WorldState(12345);

      expect(world.tick).toBe(0);
      expect(world.seed).toBe(12345);
      expect(world.agents.size).toBe(0);
      expect(world.resources.size).toBe(0);
      expect(world.npcMonsters.size).toBe(0);
      expect(world.behemoths.size).toBe(0);
      expect(world.structures.size).toBe(0);
      expect(world.alliances.size).toBe(0);
      expect(world.pendingTrades.size).toBe(0);
      expect(world.craftingQueue.size).toBe(0);
      expect(world.tickMessages).toHaveLength(0);
      expect(world.tickEvents).toHaveLength(0);
    });
  });
});
