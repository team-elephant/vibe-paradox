// tests/combat.test.ts — Tests for CombatResolver

import { describe, it, expect, beforeEach } from 'vitest';
import { CombatResolver } from '../src/pipeline/combat-resolver.js';
import { ActionExecutor } from '../src/pipeline/executor.js';
import { WorldState } from '../src/server/world.js';
import type {
  Agent,
  NpcMonster,
  CombatPair,
  ValidatedAction,
  ActionParams,
} from '../src/types/index.js';
import { SPAWN_POINT, RESPAWN_TICKS, DEATH_LOSS_PERCENT } from '../src/shared/constants.js';

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

function createNpc(overrides: Partial<NpcMonster> = {}): NpcMonster {
  return {
    id: 'npc_test001',
    template: 'weak_goblin',
    position: { x: 103, y: 100 },
    health: 30,
    maxHealth: 30,
    attack: 10,
    defense: 8,
    speed: 3,
    status: 'idle',
    behavior: 'idle',
    patrolOrigin: { x: 103, y: 100 },
    patrolRadius: 50,
    targetId: null,
    goldDrop: 10,
    createdAt: 0,
    ...overrides,
  };
}

function makeCombatPair(attackerId: string, targetId: string, startTick: number = 1): CombatPair {
  return {
    attackerId,
    targetId,
    startTick,
    active: true,
  };
}

function makeValidatedAction(
  agentId: string,
  params: ActionParams,
): ValidatedAction {
  return {
    agentId,
    action: params.type,
    params,
    valid: true,
  };
}

describe('CombatResolver', () => {
  let resolver: CombatResolver;
  let world: WorldState;

  beforeEach(() => {
    resolver = new CombatResolver();
    world = new WorldState(42);
  });

  describe('damage calculation', () => {
    it('Fighter (ATK 15) attacks NPC (DEF 8) → 7 damage per tick', () => {
      const fighter = createAgent({
        id: 'agent_fighter1',
        role: 'fighter',
        position: { x: 100, y: 100 },
        status: 'fighting',
        stats: {
          health: 100,
          maxHealth: 100,
          attack: 15,
          defense: 10,
          speed: 4,
          visionRadius: 100,
        },
      });
      const npc = createNpc({
        id: 'npc_goblin1',
        position: { x: 103, y: 100 },
        health: 30,
        maxHealth: 30,
        attack: 10,
        defense: 8,
      });

      world.addAgent(fighter);
      world.addNpcMonster(npc);

      const pairs: CombatPair[] = [makeCombatPair('agent_fighter1', 'npc_goblin1')];
      resolver.resolveCombat(pairs, world, 1);

      // Expected damage: max(1, 15 - 8) = 7
      const updatedNpc = world.npcMonsters.get('npc_goblin1')!;
      expect(updatedNpc.health).toBe(23); // 30 - 7

      // Check combat_hit event was emitted
      const hitEvents = world.tickEvents.filter(e => e.type === 'combat_hit');
      expect(hitEvents.length).toBeGreaterThanOrEqual(1);
      const attackHit = hitEvents.find(
        e => e.type === 'combat_hit' && e.attackerId === 'agent_fighter1',
      );
      expect(attackHit).toBeDefined();
      if (attackHit && attackHit.type === 'combat_hit') {
        expect(attackHit.damage).toBe(7);
        expect(attackHit.targetHealthAfter).toBe(23);
      }
    });

    it('NPC (ATK 10) counter-attacks fighter (DEF 10) → 1 damage per tick (minimum)', () => {
      const fighter = createAgent({
        id: 'agent_fighter1',
        role: 'fighter',
        position: { x: 100, y: 100 },
        status: 'fighting',
        stats: {
          health: 100,
          maxHealth: 100,
          attack: 15,
          defense: 10,
          speed: 4,
          visionRadius: 100,
        },
      });
      const npc = createNpc({
        id: 'npc_goblin1',
        position: { x: 103, y: 100 },
        health: 30,
        maxHealth: 30,
        attack: 10,
        defense: 8,
      });

      world.addAgent(fighter);
      world.addNpcMonster(npc);

      const pairs: CombatPair[] = [makeCombatPair('agent_fighter1', 'npc_goblin1')];
      resolver.resolveCombat(pairs, world, 1);

      // NPC counter-attack: max(1, 10 - 10) = 1 (minimum damage)
      const updatedFighter = world.agents.get('agent_fighter1')!;
      expect(updatedFighter.stats.health).toBe(99); // 100 - 1

      // Check counter-attack event
      const counterHit = world.tickEvents.find(
        e => e.type === 'combat_hit' && e.attackerId === 'npc_goblin1',
      );
      expect(counterHit).toBeDefined();
      if (counterHit && counterHit.type === 'combat_hit') {
        expect(counterHit.damage).toBe(1);
        expect(counterHit.targetHealthAfter).toBe(99);
      }
    });
  });

  describe('NPC death', () => {
    it('NPC dies → gold drops to fighter, NPC removed from world', () => {
      const fighter = createAgent({
        id: 'agent_fighter1',
        role: 'fighter',
        position: { x: 100, y: 100 },
        status: 'fighting',
        gold: 50,
        stats: {
          health: 100,
          maxHealth: 100,
          attack: 15,
          defense: 10,
          speed: 4,
          visionRadius: 100,
        },
      });
      const npc = createNpc({
        id: 'npc_goblin1',
        position: { x: 103, y: 100 },
        health: 5, // low HP, will die from 7 damage
        maxHealth: 30,
        attack: 10,
        defense: 8,
        goldDrop: 15,
      });

      world.addAgent(fighter);
      world.addNpcMonster(npc);

      const pairs: CombatPair[] = [makeCombatPair('agent_fighter1', 'npc_goblin1')];
      resolver.resolveCombat(pairs, world, 1);

      // NPC should be removed
      expect(world.npcMonsters.has('npc_goblin1')).toBe(false);

      // Fighter gets gold
      const updatedFighter = world.agents.get('agent_fighter1')!;
      expect(updatedFighter.gold).toBe(65); // 50 + 15

      // Death event emitted
      const deathEvent = world.tickEvents.find(e => e.type === 'death');
      expect(deathEvent).toBeDefined();
      if (deathEvent && deathEvent.type === 'death') {
        expect(deathEvent.entityId).toBe('npc_goblin1');
        expect(deathEvent.killedBy).toBe('agent_fighter1');
        expect(deathEvent.droppedGold).toBe(15);
      }

      // Combat pair is deactivated
      expect(pairs[0].active).toBe(false);

      // Fighter returns to idle
      expect(updatedFighter.status).toBe('idle');
    });
  });

  describe('fighter death', () => {
    it('Fighter dies → respawns at spawn after RESPAWN_TICKS, loses 20% gold', () => {
      const fighter = createAgent({
        id: 'agent_fighter1',
        role: 'fighter',
        position: { x: 100, y: 100 },
        status: 'fighting',
        gold: 100,
        stats: {
          health: 5, // low HP, will die
          maxHealth: 100,
          attack: 5,
          defense: 3,
          speed: 4,
          visionRadius: 100,
        },
      });
      const monster = createAgent({
        id: 'agent_monster1',
        name: 'MonsterPlayer',
        role: 'monster',
        position: { x: 103, y: 100 },
        status: 'fighting',
        stats: {
          health: 80,
          maxHealth: 80,
          attack: 12,
          defense: 8,
          speed: 5,
          visionRadius: 150,
        },
      });

      world.addAgent(fighter);
      world.addAgent(monster);

      const pairs: CombatPair[] = [makeCombatPair('agent_monster1', 'agent_fighter1')];
      resolver.resolveCombat(pairs, world, 10);

      const updatedFighter = world.agents.get('agent_fighter1')!;
      expect(updatedFighter.status).toBe('dead');
      expect(updatedFighter.stats.health).toBe(0);
      expect(updatedFighter.respawnTick).toBe(10 + RESPAWN_TICKS);
      expect(updatedFighter.position.x).toBe(SPAWN_POINT.x);
      expect(updatedFighter.position.y).toBe(SPAWN_POINT.y);

      // Lost 20% gold: 100 * 0.20 = 20 lost, keeps 80
      expect(updatedFighter.gold).toBe(80);

      // Monster gets the dropped gold
      const updatedMonster = world.agents.get('agent_monster1')!;
      expect(updatedMonster.gold).toBe(20);
    });
  });

  describe('monster kills tracking', () => {
    it('Monster kills fighter → monster.kills increments', () => {
      const fighter = createAgent({
        id: 'agent_fighter1',
        role: 'fighter',
        position: { x: 100, y: 100 },
        status: 'fighting',
        gold: 0,
        stats: {
          health: 1, // will die
          maxHealth: 100,
          attack: 5,
          defense: 3,
          speed: 4,
          visionRadius: 100,
        },
      });
      const monster = createAgent({
        id: 'agent_monster1',
        name: 'MonsterPlayer',
        role: 'monster',
        position: { x: 103, y: 100 },
        status: 'fighting',
        kills: 0,
        stats: {
          health: 80,
          maxHealth: 80,
          attack: 12,
          defense: 8,
          speed: 5,
          visionRadius: 150,
        },
      });

      world.addAgent(fighter);
      world.addAgent(monster);

      const pairs: CombatPair[] = [makeCombatPair('agent_monster1', 'agent_fighter1')];
      resolver.resolveCombat(pairs, world, 1);

      const updatedMonster = world.agents.get('agent_monster1')!;
      expect(updatedMonster.kills).toBe(1);
    });
  });

  describe('monster permadeath', () => {
    it('Monster dies → status=dead, no respawn', () => {
      const fighter = createAgent({
        id: 'agent_fighter1',
        role: 'fighter',
        position: { x: 100, y: 100 },
        status: 'fighting',
        stats: {
          health: 100,
          maxHealth: 100,
          attack: 20,
          defense: 10,
          speed: 4,
          visionRadius: 100,
        },
      });
      const monster = createAgent({
        id: 'agent_monster1',
        name: 'MonsterPlayer',
        role: 'monster',
        position: { x: 103, y: 100 },
        status: 'fighting',
        gold: 50,
        stats: {
          health: 1, // will die
          maxHealth: 80,
          attack: 12,
          defense: 8,
          speed: 5,
          visionRadius: 150,
        },
      });

      world.addAgent(fighter);
      world.addAgent(monster);

      const pairs: CombatPair[] = [makeCombatPair('agent_fighter1', 'agent_monster1')];
      resolver.resolveCombat(pairs, world, 1);

      const updatedMonster = world.agents.get('agent_monster1')!;
      expect(updatedMonster.status).toBe('dead');
      expect(updatedMonster.isAlive).toBe(false);
      expect(updatedMonster.respawnTick).toBeNull(); // no respawn set
      expect(updatedMonster.gold).toBe(0); // all gold dropped

      // Fighter gets the gold
      const updatedFighter = world.agents.get('agent_fighter1')!;
      expect(updatedFighter.gold).toBe(50);
    });
  });

  describe('out of range', () => {
    it('Combat pair ends when combatants are out of range', () => {
      const fighter = createAgent({
        id: 'agent_fighter1',
        role: 'fighter',
        position: { x: 100, y: 100 },
        status: 'fighting',
        stats: {
          health: 100,
          maxHealth: 100,
          attack: 15,
          defense: 10,
          speed: 4,
          visionRadius: 100,
        },
      });
      const npc = createNpc({
        id: 'npc_goblin1',
        position: { x: 200, y: 200 }, // far away
        health: 30,
        maxHealth: 30,
        attack: 10,
        defense: 8,
      });

      world.addAgent(fighter);
      world.addNpcMonster(npc);

      const pairs: CombatPair[] = [makeCombatPair('agent_fighter1', 'npc_goblin1')];
      resolver.resolveCombat(pairs, world, 1);

      // Combat pair should be deactivated
      expect(pairs[0].active).toBe(false);

      // No damage dealt
      expect(world.npcMonsters.get('npc_goblin1')!.health).toBe(30);
      expect(world.agents.get('agent_fighter1')!.stats.health).toBe(100);

      // Fighter returns to idle
      expect(world.agents.get('agent_fighter1')!.status).toBe('idle');
    });
  });

  describe('merchant cannot counter-attack', () => {
    it('Merchant being attacked does NOT fight back', () => {
      const monster = createAgent({
        id: 'agent_monster1',
        name: 'MonsterPlayer',
        role: 'monster',
        position: { x: 100, y: 100 },
        status: 'fighting',
        stats: {
          health: 80,
          maxHealth: 80,
          attack: 12,
          defense: 8,
          speed: 5,
          visionRadius: 150,
        },
      });
      const merchant = createAgent({
        id: 'agent_merchant1',
        name: 'Merchant',
        role: 'merchant',
        position: { x: 103, y: 100 },
        status: 'idle',
        stats: {
          health: 50,
          maxHealth: 50,
          attack: 0,
          defense: 5,
          speed: 3,
          visionRadius: 80,
        },
      });

      world.addAgent(monster);
      world.addAgent(merchant);

      const pairs: CombatPair[] = [makeCombatPair('agent_monster1', 'agent_merchant1')];
      resolver.resolveCombat(pairs, world, 1);

      // Monster takes no counter-damage
      const updatedMonster = world.agents.get('agent_monster1')!;
      expect(updatedMonster.stats.health).toBe(80); // no damage taken

      // Merchant takes damage: max(1, 12 - 5) = 7
      const updatedMerchant = world.agents.get('agent_merchant1')!;
      expect(updatedMerchant.stats.health).toBe(43); // 50 - 7

      // Only one combat_hit event (attacker → merchant), no counter
      const hitEvents = world.tickEvents.filter(e => e.type === 'combat_hit');
      expect(hitEvents).toHaveLength(1);
      if (hitEvents[0].type === 'combat_hit') {
        expect(hitEvents[0].attackerId).toBe('agent_monster1');
      }
    });
  });

  describe('monster eating', () => {
    it('Monster kills NPC → gains 10% of NPC stats', () => {
      const monster = createAgent({
        id: 'agent_monster1',
        name: 'MonsterPlayer',
        role: 'monster',
        position: { x: 100, y: 100 },
        status: 'fighting',
        kills: 0,
        monsterEats: 0,
        stats: {
          health: 80,
          maxHealth: 80,
          attack: 12,
          defense: 8,
          speed: 5,
          visionRadius: 150,
        },
      });
      const npc = createNpc({
        id: 'npc_goblin1',
        position: { x: 103, y: 100 },
        health: 1, // will die
        maxHealth: 60,
        attack: 10,
        defense: 5,
        goldDrop: 10,
      });

      world.addAgent(monster);
      world.addNpcMonster(npc);

      const pairs: CombatPair[] = [makeCombatPair('agent_monster1', 'npc_goblin1')];
      resolver.resolveCombat(pairs, world, 1);

      const updatedMonster = world.agents.get('agent_monster1')!;

      // 10% of NPC stats: maxHealth +6 (60*0.1), attack +1 (10*0.1), defense +0 (5*0.1 floored)
      expect(updatedMonster.stats.maxHealth).toBe(86); // 80 + 6
      expect(updatedMonster.stats.attack).toBe(13); // 12 + 1
      expect(updatedMonster.stats.defense).toBe(8); // 8 + 0 (floor of 0.5)
      // Health healed by maxHealth gain
      expect(updatedMonster.stats.health).toBe(80 + 6); // healed by maxHealth gain amount
      expect(updatedMonster.monsterEats).toBe(1);
      expect(updatedMonster.kills).toBe(1);

      // monster_eat event emitted
      const eatEvent = world.tickEvents.find(e => e.type === 'monster_eat');
      expect(eatEvent).toBeDefined();
    });
  });

  describe('evolution', () => {
    it('Monster at 5 kills evolves to stage 2', () => {
      const monster = createAgent({
        id: 'agent_monster1',
        name: 'MonsterPlayer',
        role: 'monster',
        position: { x: 100, y: 100 },
        status: 'fighting',
        kills: 4, // will become 5 after this kill
        monsterEats: 0,
        evolutionStage: 1,
        stats: {
          health: 80,
          maxHealth: 80,
          attack: 12,
          defense: 8,
          speed: 5,
          visionRadius: 150,
        },
      });
      const npc = createNpc({
        id: 'npc_goblin1',
        position: { x: 103, y: 100 },
        health: 1,
        maxHealth: 30,
        attack: 5,
        defense: 3,
        goldDrop: 10,
      });

      world.addAgent(monster);
      world.addNpcMonster(npc);

      const pairs: CombatPair[] = [makeCombatPair('agent_monster1', 'npc_goblin1')];
      resolver.resolveCombat(pairs, world, 1);

      const updatedMonster = world.agents.get('agent_monster1')!;
      expect(updatedMonster.kills).toBe(5);
      expect(updatedMonster.evolutionStage).toBe(2);

      // Evolution event emitted
      const evoEvent = world.tickEvents.find(e => e.type === 'evolution');
      expect(evoEvent).toBeDefined();
      if (evoEvent && evoEvent.type === 'evolution') {
        expect(evoEvent.fromStage).toBe(1);
        expect(evoEvent.toStage).toBe(2);
      }

      // Stats scaled from current: after eating NPC (maxHP 30, ATK 5), gained +3 HP, +0 ATK
      // So pre-evolution: ATK=12, maxHP=83. Scale: ATK × 1.5 = 18, maxHP × 1.25 = 103
      expect(updatedMonster.stats.attack).toBe(18); // 12 * 1.5
      expect(updatedMonster.stats.maxHealth).toBe(103); // 83 * 1.25
    });

    it('Monster with 3 eats evolves to stage 2 (eat threshold)', () => {
      const monster = createAgent({
        id: 'agent_monster1',
        name: 'MonsterPlayer',
        role: 'monster',
        position: { x: 100, y: 100 },
        status: 'fighting',
        kills: 0,
        monsterEats: 2, // will become 3 after eating NPC
        evolutionStage: 1,
        stats: {
          health: 80,
          maxHealth: 80,
          attack: 12,
          defense: 8,
          speed: 5,
          visionRadius: 150,
        },
      });
      const npc = createNpc({
        id: 'npc_goblin1',
        position: { x: 103, y: 100 },
        health: 1,
        maxHealth: 30,
        attack: 5,
        defense: 3,
        goldDrop: 10,
      });

      world.addAgent(monster);
      world.addNpcMonster(npc);

      const pairs: CombatPair[] = [makeCombatPair('agent_monster1', 'npc_goblin1')];
      resolver.resolveCombat(pairs, world, 1);

      const updatedMonster = world.agents.get('agent_monster1')!;
      expect(updatedMonster.monsterEats).toBe(3);
      expect(updatedMonster.evolutionStage).toBe(2);
    });
  });

  describe('integration with executor', () => {
    it('executeAttack creates a combat pair that resolver processes', () => {
      const executor = new ActionExecutor();
      const fighter = createAgent({
        id: 'agent_fighter1',
        role: 'fighter',
        position: { x: 100, y: 100 },
      });
      const npc = createNpc({
        id: 'npc_goblin1',
        position: { x: 103, y: 100 },
        health: 30,
      });

      world.addAgent(fighter);
      world.addNpcMonster(npc);

      // Execute attack via executor
      const action = makeValidatedAction('agent_fighter1', {
        type: 'attack',
        targetId: 'npc_goblin1',
      });
      executor.executeBatch([action], world, 1);

      // Verify combat pair was created
      expect(executor.combatPairs).toHaveLength(1);

      // Now resolve combat
      resolver.resolveCombat(executor.combatPairs, world, 1);

      // NPC should have taken damage
      expect(world.npcMonsters.get('npc_goblin1')!.health).toBeLessThan(30);

      // combat_hit event should exist
      expect(world.tickEvents.some(e => e.type === 'combat_hit')).toBe(true);
    });
  });

  describe('multi-tick combat', () => {
    it('combat persists across ticks until target dies', () => {
      const fighter = createAgent({
        id: 'agent_fighter1',
        role: 'fighter',
        position: { x: 100, y: 100 },
        status: 'fighting',
        stats: {
          health: 100,
          maxHealth: 100,
          attack: 15,
          defense: 10,
          speed: 4,
          visionRadius: 100,
        },
      });
      // NPC with 30 HP, takes 7 damage per tick → dies after 5 ticks (5*7=35 > 30)
      const npc = createNpc({
        id: 'npc_goblin1',
        position: { x: 103, y: 100 },
        health: 30,
        maxHealth: 30,
        attack: 10,
        defense: 8,
        goldDrop: 10,
      });

      world.addAgent(fighter);
      world.addNpcMonster(npc);

      const pairs: CombatPair[] = [makeCombatPair('agent_fighter1', 'npc_goblin1')];

      // Tick 1: NPC hp 30 → 23
      resolver.resolveCombat(pairs, world, 1);
      expect(world.npcMonsters.get('npc_goblin1')!.health).toBe(23);
      expect(pairs[0].active).toBe(true);
      world.tickEvents = [];

      // Tick 2: NPC hp 23 → 16
      resolver.resolveCombat(pairs, world, 2);
      expect(world.npcMonsters.get('npc_goblin1')!.health).toBe(16);
      expect(pairs[0].active).toBe(true);
      world.tickEvents = [];

      // Tick 3: NPC hp 16 → 9
      resolver.resolveCombat(pairs, world, 3);
      expect(world.npcMonsters.get('npc_goblin1')!.health).toBe(9);
      expect(pairs[0].active).toBe(true);
      world.tickEvents = [];

      // Tick 4: NPC hp 9 → 2
      resolver.resolveCombat(pairs, world, 4);
      expect(world.npcMonsters.get('npc_goblin1')!.health).toBe(2);
      expect(pairs[0].active).toBe(true);
      world.tickEvents = [];

      // Tick 5: NPC hp 2 → -5 → dies
      resolver.resolveCombat(pairs, world, 5);
      expect(world.npcMonsters.has('npc_goblin1')).toBe(false);
      expect(pairs[0].active).toBe(false);

      // Fighter took 1 damage per tick for 4 ticks (NPC alive ticks 1-4, died on 5 before counter)
      expect(world.agents.get('agent_fighter1')!.stats.health).toBe(96); // 100 - 4*1
    });
  });

  describe('inventory loss on death', () => {
    it('Fighter loses 20% of inventory items on death', () => {
      const fighter = createAgent({
        id: 'agent_fighter1',
        role: 'fighter',
        position: { x: 100, y: 100 },
        status: 'fighting',
        gold: 100,
        inventory: [
          { id: 'log', quantity: 10 },
          { id: 'iron_ore', quantity: 5 },
        ],
        stats: {
          health: 1, // will die
          maxHealth: 100,
          attack: 5,
          defense: 3,
          speed: 4,
          visionRadius: 100,
        },
      });
      const monster = createAgent({
        id: 'agent_monster1',
        name: 'MonsterPlayer',
        role: 'monster',
        position: { x: 103, y: 100 },
        status: 'fighting',
        stats: {
          health: 80,
          maxHealth: 80,
          attack: 12,
          defense: 8,
          speed: 5,
          visionRadius: 150,
        },
      });

      world.addAgent(fighter);
      world.addAgent(monster);

      const pairs: CombatPair[] = [makeCombatPair('agent_monster1', 'agent_fighter1')];
      resolver.resolveCombat(pairs, world, 1);

      const updatedFighter = world.agents.get('agent_fighter1')!;
      // 20% of 10 logs = 2 lost → 8 remaining
      // 20% of 5 iron_ore = 1 lost → 4 remaining
      const logs = updatedFighter.inventory.find(i => i.id === 'log');
      const ore = updatedFighter.inventory.find(i => i.id === 'iron_ore');
      expect(logs!.quantity).toBe(8);
      expect(ore!.quantity).toBe(4);

      // Death event should list dropped items
      const deathEvent = world.tickEvents.find(e => e.type === 'death');
      expect(deathEvent).toBeDefined();
      if (deathEvent && deathEvent.type === 'death') {
        expect(deathEvent.droppedItems.length).toBe(3); // 2 logs + 1 iron_ore
      }
    });
  });
});
