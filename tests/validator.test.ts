// tests/validator.test.ts — ActionValidator tests

import { describe, it, expect, beforeEach } from 'vitest';
import { ActionValidator } from '../src/pipeline/validator.js';
import { WorldState } from '../src/server/world.js';
import type {
  Agent,
  AgentAction,
  ActionParams,
  Resource,
  NpcMonster,
  Behemoth,
  ValidatedAction,
  RejectedAction,
} from '../src/types/index.js';

function makeAgent(overrides: Partial<Agent> & { id: string; role: Agent['role'] }): Agent {
  return {
    name: overrides.name ?? overrides.id,
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

function makeAction(agentId: string, params: ActionParams): AgentAction {
  return {
    agentId,
    action: params.type === 'form_alliance' || params.type === 'join_alliance'
      ? params.type
      : params.type,
    params,
    receivedTick: 0,
    serverTick: 1,
  };
}

function makeResource(overrides: Partial<Resource> & { id: string }): Resource {
  return {
    type: 'tree',
    position: { x: 102, y: 100 },
    remaining: 5,
    maxCapacity: 10,
    state: 'available',
    growthStartTick: null,
    growthCompleteTick: null,
    createdAt: 0,
    ...overrides,
  };
}

function makeNpcMonster(overrides: Partial<NpcMonster> & { id: string }): NpcMonster {
  return {
    template: 'weak_goblin',
    position: { x: 102, y: 100 },
    health: 30,
    maxHealth: 30,
    attack: 5,
    defense: 3,
    speed: 3,
    status: 'roaming',
    behavior: 'patrol',
    patrolOrigin: { x: 102, y: 100 },
    patrolRadius: 50,
    targetId: null,
    goldDrop: 10,
    createdAt: 0,
    ...overrides,
  };
}

function makeBehemoth(overrides: Partial<Behemoth> & { id: string }): Behemoth {
  return {
    type: 'iron',
    position: { x: 102, y: 100 },
    health: 500,
    maxHealth: 500,
    attack: 30,
    defense: 20,
    status: 'roaming',
    oreAmount: 0,
    oreMax: 15,
    fedAmount: 0,
    unconsciousUntilTick: null,
    route: [],
    currentWaypoint: 0,
    ...overrides,
  };
}

describe('ActionValidator', () => {
  let validator: ActionValidator;
  let world: WorldState;

  beforeEach(() => {
    validator = new ActionValidator();
    world = new WorldState(42);
    world.tick = 1;
  });

  // --- Basic validation ---

  it('rejects action for non-existent agent', () => {
    const action = makeAction('agent_ghost', { type: 'idle' });
    const { validated, rejected } = validator.validateBatch([action], world);
    expect(validated).toHaveLength(0);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toBe('Agent not found');
  });

  it('rejects action for dead agent', () => {
    const agent = makeAgent({ id: 'agent_dead', role: 'fighter', status: 'dead', isAlive: false });
    world.addAgent(agent);

    const action = makeAction('agent_dead', { type: 'idle' });
    const { rejected } = validator.validateBatch([action], world);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toBe('Agent is dead');
  });

  it('rejects action for agent on cooldown', () => {
    const agent = makeAgent({ id: 'agent_cd', role: 'fighter', actionCooldown: 10 });
    world.addAgent(agent);

    const action = makeAction('agent_cd', { type: 'idle' });
    const { rejected } = validator.validateBatch([action], world);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toBe('On cooldown');
  });

  it('approves idle action', () => {
    const agent = makeAgent({ id: 'agent_idle', role: 'fighter' });
    world.addAgent(agent);

    const action = makeAction('agent_idle', { type: 'idle' });
    const { validated } = validator.validateBatch([action], world);
    expect(validated).toHaveLength(1);
    expect(validated[0]!.valid).toBe(true);
  });

  // --- Move validation ---

  it('approves valid move within bounds', () => {
    const agent = makeAgent({ id: 'agent_mv', role: 'fighter' });
    world.addAgent(agent);

    const action = makeAction('agent_mv', { type: 'move', x: 500, y: 500 });
    const { validated } = validator.validateBatch([action], world);
    expect(validated).toHaveLength(1);
  });

  it('rejects move out of bounds', () => {
    const agent = makeAgent({ id: 'agent_mv', role: 'fighter' });
    world.addAgent(agent);

    const action = makeAction('agent_mv', { type: 'move', x: -1, y: 500 });
    const { rejected } = validator.validateBatch([action], world);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toBe('Destination out of bounds');
  });

  it('rejects move to x=1000 (out of bounds)', () => {
    const agent = makeAgent({ id: 'agent_mv', role: 'fighter' });
    world.addAgent(agent);

    const action = makeAction('agent_mv', { type: 'move', x: 1000, y: 500 });
    const { rejected } = validator.validateBatch([action], world);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toBe('Destination out of bounds');
  });

  // --- Gather validation ---

  it('merchant gather tree → approved', () => {
    const agent = makeAgent({ id: 'agent_m', role: 'merchant', position: { x: 100, y: 100 } });
    world.addAgent(agent);
    const tree = makeResource({ id: 'res_tree', type: 'tree', position: { x: 102, y: 100 } });
    world.addResource(tree);

    const action = makeAction('agent_m', { type: 'gather', targetId: 'res_tree' });
    const { validated } = validator.validateBatch([action], world);
    expect(validated).toHaveLength(1);
  });

  it('merchant gather gold → rejected "Merchants cannot mine gold"', () => {
    const agent = makeAgent({ id: 'agent_m', role: 'merchant', position: { x: 100, y: 100 } });
    world.addAgent(agent);
    const gold = makeResource({ id: 'res_gold', type: 'gold_vein', position: { x: 102, y: 100 } });
    world.addResource(gold);

    const action = makeAction('agent_m', { type: 'gather', targetId: 'res_gold' });
    const { rejected } = validator.validateBatch([action], world);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toBe('Merchants cannot mine gold');
  });

  it('fighter gather gold → approved', () => {
    const agent = makeAgent({ id: 'agent_f', role: 'fighter', position: { x: 100, y: 100 } });
    world.addAgent(agent);
    const gold = makeResource({ id: 'res_gold', type: 'gold_vein', position: { x: 102, y: 100 } });
    world.addResource(gold);

    const action = makeAction('agent_f', { type: 'gather', targetId: 'res_gold' });
    const { validated } = validator.validateBatch([action], world);
    expect(validated).toHaveLength(1);
  });

  it('fighter gather tree → rejected "Fighters can only mine gold"', () => {
    const agent = makeAgent({ id: 'agent_f', role: 'fighter', position: { x: 100, y: 100 } });
    world.addAgent(agent);
    const tree = makeResource({ id: 'res_tree', type: 'tree', position: { x: 102, y: 100 } });
    world.addResource(tree);

    const action = makeAction('agent_f', { type: 'gather', targetId: 'res_tree' });
    const { rejected } = validator.validateBatch([action], world);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toBe('Fighters can only mine gold');
  });

  it('monster gather → rejected "Monsters cannot gather"', () => {
    const agent = makeAgent({ id: 'agent_mon', role: 'monster', position: { x: 100, y: 100 } });
    world.addAgent(agent);
    const tree = makeResource({ id: 'res_tree', type: 'tree', position: { x: 102, y: 100 } });
    world.addResource(tree);

    const action = makeAction('agent_mon', { type: 'gather', targetId: 'res_tree' });
    const { rejected } = validator.validateBatch([action], world);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toBe('Monsters cannot gather');
  });

  it('gather target out of range → rejected "Too far"', () => {
    const agent = makeAgent({ id: 'agent_m', role: 'merchant', position: { x: 100, y: 100 } });
    world.addAgent(agent);
    const tree = makeResource({ id: 'res_tree', type: 'tree', position: { x: 200, y: 200 } });
    world.addResource(tree);

    const action = makeAction('agent_m', { type: 'gather', targetId: 'res_tree' });
    const { rejected } = validator.validateBatch([action], world);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toBe('Too far');
  });

  it('gather depleted resource → rejected "Resource unavailable"', () => {
    const agent = makeAgent({ id: 'agent_m', role: 'merchant', position: { x: 100, y: 100 } });
    world.addAgent(agent);
    const tree = makeResource({
      id: 'res_tree',
      type: 'tree',
      position: { x: 102, y: 100 },
      state: 'depleted',
    });
    world.addResource(tree);

    const action = makeAction('agent_m', { type: 'gather', targetId: 'res_tree' });
    const { rejected } = validator.validateBatch([action], world);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toBe('Resource unavailable');
  });

  it('gather non-existent resource → rejected "Resource not found"', () => {
    const agent = makeAgent({ id: 'agent_m', role: 'merchant', position: { x: 100, y: 100 } });
    world.addAgent(agent);

    const action = makeAction('agent_m', { type: 'gather', targetId: 'res_nonexistent' });
    const { rejected } = validator.validateBatch([action], world);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toBe('Resource not found');
  });

  // --- Attack validation ---

  it('fighter attack NPC → approved', () => {
    const agent = makeAgent({ id: 'agent_f', role: 'fighter', position: { x: 100, y: 100 } });
    world.addAgent(agent);
    const npc = makeNpcMonster({ id: 'npc_001', position: { x: 103, y: 100 } });
    world.addNpcMonster(npc);

    const action = makeAction('agent_f', { type: 'attack', targetId: 'npc_001' });
    const { validated } = validator.validateBatch([action], world);
    expect(validated).toHaveLength(1);
  });

  it('fighter attack fighter → rejected "Fighters cannot attack other fighters"', () => {
    const agent1 = makeAgent({ id: 'agent_f1', role: 'fighter', position: { x: 100, y: 100 } });
    const agent2 = makeAgent({ id: 'agent_f2', role: 'fighter', position: { x: 103, y: 100 } });
    world.addAgent(agent1);
    world.addAgent(agent2);

    const action = makeAction('agent_f1', { type: 'attack', targetId: 'agent_f2' });
    const { rejected } = validator.validateBatch([action], world);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toBe('Fighters cannot attack other fighters');
  });

  it('fighter attack merchant → rejected "Fighters cannot attack merchants"', () => {
    const fighter = makeAgent({ id: 'agent_f', role: 'fighter', position: { x: 100, y: 100 } });
    const merchant = makeAgent({ id: 'agent_m', role: 'merchant', position: { x: 103, y: 100 } });
    world.addAgent(fighter);
    world.addAgent(merchant);

    const action = makeAction('agent_f', { type: 'attack', targetId: 'agent_m' });
    const { rejected } = validator.validateBatch([action], world);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toBe('Fighters cannot attack merchants');
  });

  it('monster attack merchant → approved', () => {
    const monster = makeAgent({ id: 'agent_mon', role: 'monster', position: { x: 100, y: 100 } });
    const merchant = makeAgent({ id: 'agent_m', role: 'merchant', position: { x: 103, y: 100 } });
    world.addAgent(monster);
    world.addAgent(merchant);

    const action = makeAction('agent_mon', { type: 'attack', targetId: 'agent_m' });
    const { validated } = validator.validateBatch([action], world);
    expect(validated).toHaveLength(1);
  });

  it('monster attack fighter → approved', () => {
    const monster = makeAgent({ id: 'agent_mon', role: 'monster', position: { x: 100, y: 100 } });
    const fighter = makeAgent({ id: 'agent_f', role: 'fighter', position: { x: 103, y: 100 } });
    world.addAgent(monster);
    world.addAgent(fighter);

    const action = makeAction('agent_mon', { type: 'attack', targetId: 'agent_f' });
    const { validated } = validator.validateBatch([action], world);
    expect(validated).toHaveLength(1);
  });

  it('merchant attack anything → rejected "Merchants cannot attack"', () => {
    const merchant = makeAgent({ id: 'agent_m', role: 'merchant', position: { x: 100, y: 100 } });
    world.addAgent(merchant);
    const npc = makeNpcMonster({ id: 'npc_001', position: { x: 103, y: 100 } });
    world.addNpcMonster(npc);

    const action = makeAction('agent_m', { type: 'attack', targetId: 'npc_001' });
    const { rejected } = validator.validateBatch([action], world);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toBe('Merchants cannot attack');
  });

  it('attack target out of range → rejected "Too far"', () => {
    const fighter = makeAgent({ id: 'agent_f', role: 'fighter', position: { x: 100, y: 100 } });
    world.addAgent(fighter);
    const npc = makeNpcMonster({ id: 'npc_001', position: { x: 200, y: 200 } });
    world.addNpcMonster(npc);

    const action = makeAction('agent_f', { type: 'attack', targetId: 'npc_001' });
    const { rejected } = validator.validateBatch([action], world);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toBe('Too far');
  });

  it('attack non-existent target → rejected "Target not found"', () => {
    const fighter = makeAgent({ id: 'agent_f', role: 'fighter', position: { x: 100, y: 100 } });
    world.addAgent(fighter);

    const action = makeAction('agent_f', { type: 'attack', targetId: 'npc_ghost' });
    const { rejected } = validator.validateBatch([action], world);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toBe('Target not found');
  });

  it('fighter attack behemoth → approved', () => {
    const fighter = makeAgent({ id: 'agent_f', role: 'fighter', position: { x: 100, y: 100 } });
    world.addAgent(fighter);
    const beh = makeBehemoth({ id: 'beh_001', position: { x: 103, y: 100 } });
    world.addBehemoth(beh);

    const action = makeAction('agent_f', { type: 'attack', targetId: 'beh_001' });
    const { validated } = validator.validateBatch([action], world);
    expect(validated).toHaveLength(1);
  });

  // --- Craft validation ---

  it('fighter craft → rejected "Only merchants can craft"', () => {
    const fighter = makeAgent({ id: 'agent_f', role: 'fighter' });
    world.addAgent(fighter);

    const action = makeAction('agent_f', { type: 'craft', recipeId: 'iron_sword' });
    const { rejected } = validator.validateBatch([action], world);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toBe('Only merchants can craft');
  });

  it('merchant craft → approved', () => {
    const merchant = makeAgent({ id: 'agent_m', role: 'merchant' });
    world.addAgent(merchant);

    const action = makeAction('agent_m', { type: 'craft', recipeId: 'iron_sword' });
    const { validated } = validator.validateBatch([action], world);
    expect(validated).toHaveLength(1);
  });

  // --- Talk validation ---

  it('talk with empty message → rejected', () => {
    const agent = makeAgent({ id: 'agent_t', role: 'fighter' });
    world.addAgent(agent);

    const action = makeAction('agent_t', { type: 'talk', mode: 'local', message: '' });
    const { rejected } = validator.validateBatch([action], world);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toBe('Message cannot be empty');
  });

  it('whisper to non-existent target → rejected', () => {
    const agent = makeAgent({ id: 'agent_t', role: 'fighter' });
    world.addAgent(agent);

    const action = makeAction('agent_t', {
      type: 'talk',
      mode: 'whisper',
      message: 'hello',
      targetId: 'agent_ghost',
    });
    const { rejected } = validator.validateBatch([action], world);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toBe('Whisper target not found');
  });

  it('broadcast talk → approved', () => {
    const agent = makeAgent({ id: 'agent_t', role: 'fighter' });
    world.addAgent(agent);

    const action = makeAction('agent_t', { type: 'talk', mode: 'broadcast', message: 'hello all' });
    const { validated } = validator.validateBatch([action], world);
    expect(validated).toHaveLength(1);
  });

  // --- Trade validation ---

  it('trade with target in range and items → approved', () => {
    const agent1 = makeAgent({
      id: 'agent_t1',
      role: 'merchant',
      position: { x: 100, y: 100 },
      inventory: [{ id: 'iron_sword', quantity: 1 }],
    });
    const agent2 = makeAgent({ id: 'agent_t2', role: 'fighter', position: { x: 105, y: 100 } });
    world.addAgent(agent1);
    world.addAgent(agent2);

    const action = makeAction('agent_t1', {
      type: 'trade',
      targetAgentId: 'agent_t2',
      offer: [{ itemId: 'iron_sword', quantity: 1 }],
      request: [{ itemId: 'gold', quantity: 50 }],
    });
    const { validated } = validator.validateBatch([action], world);
    expect(validated).toHaveLength(1);
  });

  it('trade with target too far → rejected "Too far"', () => {
    const agent1 = makeAgent({
      id: 'agent_t1',
      role: 'merchant',
      position: { x: 100, y: 100 },
      inventory: [{ id: 'iron_sword', quantity: 1 }],
    });
    const agent2 = makeAgent({ id: 'agent_t2', role: 'fighter', position: { x: 200, y: 200 } });
    world.addAgent(agent1);
    world.addAgent(agent2);

    const action = makeAction('agent_t1', {
      type: 'trade',
      targetAgentId: 'agent_t2',
      offer: [{ itemId: 'iron_sword', quantity: 1 }],
      request: [{ itemId: 'gold', quantity: 50 }],
    });
    const { rejected } = validator.validateBatch([action], world);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toBe('Too far');
  });

  it('trade with insufficient items → rejected', () => {
    const agent1 = makeAgent({
      id: 'agent_t1',
      role: 'merchant',
      position: { x: 100, y: 100 },
      inventory: [],
    });
    const agent2 = makeAgent({ id: 'agent_t2', role: 'fighter', position: { x: 105, y: 100 } });
    world.addAgent(agent1);
    world.addAgent(agent2);

    const action = makeAction('agent_t1', {
      type: 'trade',
      targetAgentId: 'agent_t2',
      offer: [{ itemId: 'iron_sword', quantity: 1 }],
      request: [{ itemId: 'gold', quantity: 50 }],
    });
    const { rejected } = validator.validateBatch([action], world);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toBe('Insufficient items for trade offer');
  });

  // --- Plant validation ---

  it('merchant plant with seed → approved', () => {
    const merchant = makeAgent({
      id: 'agent_m',
      role: 'merchant',
      inventory: [{ id: 'tree_seed', quantity: 1 }],
    });
    world.addAgent(merchant);

    const action = makeAction('agent_m', { type: 'plant', seedId: 'tree_seed', x: 100, y: 100 });
    const { validated } = validator.validateBatch([action], world);
    expect(validated).toHaveLength(1);
  });

  it('fighter plant → rejected "Only merchants can plant"', () => {
    const fighter = makeAgent({
      id: 'agent_f',
      role: 'fighter',
      inventory: [{ id: 'tree_seed', quantity: 1 }],
    });
    world.addAgent(fighter);

    const action = makeAction('agent_f', { type: 'plant', seedId: 'tree_seed', x: 100, y: 100 });
    const { rejected } = validator.validateBatch([action], world);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toBe('Only merchants can plant');
  });

  it('plant without seed in inventory → rejected', () => {
    const merchant = makeAgent({ id: 'agent_m', role: 'merchant', inventory: [] });
    world.addAgent(merchant);

    const action = makeAction('agent_m', { type: 'plant', seedId: 'tree_seed', x: 100, y: 100 });
    const { rejected } = validator.validateBatch([action], world);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toBe('No seed in inventory');
  });

  // --- Water validation ---

  it('merchant water sapling → approved', () => {
    const merchant = makeAgent({ id: 'agent_m', role: 'merchant' });
    world.addAgent(merchant);
    const sapling = makeResource({
      id: 'res_sap',
      type: 'sapling',
      position: { x: 150, y: 150 },
      state: 'growing',
    });
    world.addResource(sapling);

    const action = makeAction('agent_m', { type: 'water', x: 150, y: 150 });
    const { validated } = validator.validateBatch([action], world);
    expect(validated).toHaveLength(1);
  });

  it('water with no sapling at position → rejected', () => {
    const merchant = makeAgent({ id: 'agent_m', role: 'merchant' });
    world.addAgent(merchant);

    const action = makeAction('agent_m', { type: 'water', x: 150, y: 150 });
    const { rejected } = validator.validateBatch([action], world);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toBe('No sapling at position');
  });

  it('fighter water → rejected "Only merchants can water"', () => {
    const fighter = makeAgent({ id: 'agent_f', role: 'fighter' });
    world.addAgent(fighter);

    const action = makeAction('agent_f', { type: 'water', x: 150, y: 150 });
    const { rejected } = validator.validateBatch([action], world);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toBe('Only merchants can water');
  });

  // --- Feed validation ---

  it('feed behemoth with food in inventory → approved', () => {
    const agent = makeAgent({
      id: 'agent_f',
      role: 'fighter',
      position: { x: 100, y: 100 },
      inventory: [{ id: 'food', quantity: 5 }],
    });
    world.addAgent(agent);
    const beh = makeBehemoth({ id: 'beh_001', position: { x: 105, y: 100 } });
    world.addBehemoth(beh);

    const action = makeAction('agent_f', { type: 'feed', behemothId: 'beh_001', itemId: 'food' });
    const { validated } = validator.validateBatch([action], world);
    expect(validated).toHaveLength(1);
  });

  it('feed without food → rejected', () => {
    const agent = makeAgent({ id: 'agent_f', role: 'fighter', position: { x: 100, y: 100 } });
    world.addAgent(agent);
    const beh = makeBehemoth({ id: 'beh_001', position: { x: 105, y: 100 } });
    world.addBehemoth(beh);

    const action = makeAction('agent_f', { type: 'feed', behemothId: 'beh_001', itemId: 'food' });
    const { rejected } = validator.validateBatch([action], world);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toBe('No food item in inventory');
  });

  it('feed behemoth out of range → rejected "Too far"', () => {
    const agent = makeAgent({
      id: 'agent_f',
      role: 'fighter',
      position: { x: 100, y: 100 },
      inventory: [{ id: 'food', quantity: 5 }],
    });
    world.addAgent(agent);
    const beh = makeBehemoth({ id: 'beh_001', position: { x: 200, y: 200 } });
    world.addBehemoth(beh);

    const action = makeAction('agent_f', { type: 'feed', behemothId: 'beh_001', itemId: 'food' });
    const { rejected } = validator.validateBatch([action], world);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toBe('Too far');
  });

  // --- Climb validation ---

  it('merchant climb unconscious behemoth → approved', () => {
    const merchant = makeAgent({ id: 'agent_m', role: 'merchant', position: { x: 100, y: 100 } });
    world.addAgent(merchant);
    const beh = makeBehemoth({
      id: 'beh_001',
      position: { x: 105, y: 100 },
      status: 'unconscious',
    });
    world.addBehemoth(beh);

    const action = makeAction('agent_m', { type: 'climb', behemothId: 'beh_001' });
    const { validated } = validator.validateBatch([action], world);
    expect(validated).toHaveLength(1);
  });

  it('merchant climb roaming behemoth → rejected "Behemoth is not unconscious"', () => {
    const merchant = makeAgent({ id: 'agent_m', role: 'merchant', position: { x: 100, y: 100 } });
    world.addAgent(merchant);
    const beh = makeBehemoth({ id: 'beh_001', position: { x: 105, y: 100 }, status: 'roaming' });
    world.addBehemoth(beh);

    const action = makeAction('agent_m', { type: 'climb', behemothId: 'beh_001' });
    const { rejected } = validator.validateBatch([action], world);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toBe('Behemoth is not unconscious');
  });

  it('fighter climb → rejected "Only merchants can climb behemoths"', () => {
    const fighter = makeAgent({ id: 'agent_f', role: 'fighter', position: { x: 100, y: 100 } });
    world.addAgent(fighter);
    const beh = makeBehemoth({
      id: 'beh_001',
      position: { x: 105, y: 100 },
      status: 'unconscious',
    });
    world.addBehemoth(beh);

    const action = makeAction('agent_f', { type: 'climb', behemothId: 'beh_001' });
    const { rejected } = validator.validateBatch([action], world);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toBe('Only merchants can climb behemoths');
  });

  it('climb behemoth out of range → rejected "Too far"', () => {
    const merchant = makeAgent({ id: 'agent_m', role: 'merchant', position: { x: 100, y: 100 } });
    world.addAgent(merchant);
    const beh = makeBehemoth({
      id: 'beh_001',
      position: { x: 200, y: 200 },
      status: 'unconscious',
    });
    world.addBehemoth(beh);

    const action = makeAction('agent_m', { type: 'climb', behemothId: 'beh_001' });
    const { rejected } = validator.validateBatch([action], world);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toBe('Too far');
  });

  // --- Alliance validation ---

  it('form alliance → approved', () => {
    const agent = makeAgent({ id: 'agent_a', role: 'fighter' });
    world.addAgent(agent);

    const action = makeAction('agent_a', { type: 'form_alliance', name: 'Wolves' });
    const { validated } = validator.validateBatch([action], world);
    expect(validated).toHaveLength(1);
  });

  it('form alliance with taken name → rejected', () => {
    const agent = makeAgent({ id: 'agent_a', role: 'fighter' });
    world.addAgent(agent);
    world.alliances.set('Wolves', {
      name: 'Wolves',
      founder: 'agent_other',
      members: new Set(['agent_other']),
      createdAt: 0,
    });

    const action = makeAction('agent_a', { type: 'form_alliance', name: 'Wolves' });
    const { rejected } = validator.validateBatch([action], world);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toBe('Alliance name already taken');
  });

  it('form alliance when already in one → rejected', () => {
    const agent = makeAgent({ id: 'agent_a', role: 'fighter', alliance: 'Bears' });
    world.addAgent(agent);

    const action = makeAction('agent_a', { type: 'form_alliance', name: 'Wolves' });
    const { rejected } = validator.validateBatch([action], world);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toBe('Already in an alliance');
  });

  it('join existing alliance → approved', () => {
    const agent = makeAgent({ id: 'agent_a', role: 'fighter' });
    world.addAgent(agent);
    world.alliances.set('Wolves', {
      name: 'Wolves',
      founder: 'agent_other',
      members: new Set(['agent_other']),
      createdAt: 0,
    });

    const action = makeAction('agent_a', { type: 'join_alliance', name: 'Wolves' });
    const { validated } = validator.validateBatch([action], world);
    expect(validated).toHaveLength(1);
  });

  it('join non-existent alliance → rejected', () => {
    const agent = makeAgent({ id: 'agent_a', role: 'fighter' });
    world.addAgent(agent);

    const action = makeAction('agent_a', { type: 'join_alliance', name: 'NoSuchAlliance' });
    const { rejected } = validator.validateBatch([action], world);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toBe('Alliance not found');
  });

  it('join alliance when already in one → rejected', () => {
    const agent = makeAgent({ id: 'agent_a', role: 'fighter', alliance: 'Bears' });
    world.addAgent(agent);
    world.alliances.set('Wolves', {
      name: 'Wolves',
      founder: 'agent_other',
      members: new Set(['agent_other']),
      createdAt: 0,
    });

    const action = makeAction('agent_a', { type: 'join_alliance', name: 'Wolves' });
    const { rejected } = validator.validateBatch([action], world);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toBe('Already in an alliance');
  });

  // --- Self-targeting prevention ---

  it('fighter cannot attack itself', () => {
    const fighter = makeAgent({ id: 'agent_f', role: 'fighter', position: { x: 100, y: 100 } });
    world.addAgent(fighter);

    const action = makeAction('agent_f', { type: 'attack', targetId: 'agent_f' });
    const { rejected } = validator.validateBatch([action], world);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toBe('Cannot attack yourself');
  });

  it('monster cannot attack itself', () => {
    const monster = makeAgent({ id: 'agent_mon', role: 'monster', position: { x: 100, y: 100 } });
    world.addAgent(monster);

    const action = makeAction('agent_mon', { type: 'attack', targetId: 'agent_mon' });
    const { rejected } = validator.validateBatch([action], world);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toBe('Cannot attack yourself');
  });

  it('cannot trade with yourself', () => {
    const agent = makeAgent({
      id: 'agent_m',
      role: 'merchant',
      position: { x: 100, y: 100 },
      inventory: [{ id: 'log', quantity: 5 }],
    });
    world.addAgent(agent);

    const action = makeAction('agent_m', {
      type: 'trade',
      targetAgentId: 'agent_m',
      offer: [{ itemId: 'log', quantity: 1 }],
      request: [{ itemId: 'gold', quantity: 10 }],
    });
    const { rejected } = validator.validateBatch([action], world);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toBe('Cannot trade with yourself');
  });

  // --- Batch validation ---

  it('validates batch of mixed actions correctly', () => {
    const merchant = makeAgent({
      id: 'agent_m',
      role: 'merchant',
      position: { x: 100, y: 100 },
    });
    const fighter = makeAgent({
      id: 'agent_f',
      role: 'fighter',
      position: { x: 100, y: 100 },
    });
    const monster = makeAgent({
      id: 'agent_mon',
      role: 'monster',
      position: { x: 100, y: 100 },
    });
    world.addAgent(merchant);
    world.addAgent(fighter);
    world.addAgent(monster);

    const tree = makeResource({ id: 'res_tree', type: 'tree', position: { x: 102, y: 100 } });
    world.addResource(tree);

    const actions: AgentAction[] = [
      makeAction('agent_m', { type: 'gather', targetId: 'res_tree' }),  // approved
      makeAction('agent_f', { type: 'gather', targetId: 'res_tree' }),  // rejected: fighters can only mine gold
      makeAction('agent_mon', { type: 'gather', targetId: 'res_tree' }), // rejected: monsters cannot gather
    ];

    const { validated, rejected } = validator.validateBatch(actions, world);
    expect(validated).toHaveLength(1);
    expect(validated[0]!.agentId).toBe('agent_m');
    expect(rejected).toHaveLength(2);
  });
});
