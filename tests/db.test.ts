import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { unlinkSync, existsSync } from 'node:fs';
import { Database } from '../src/server/db.js';
import type {
  Agent,
  Resource,
  NpcMonster,
  Behemoth,
  Alliance,
  Trade,
  ChatMessage,
  TickResult,
} from '../src/types/index.js';

const TEST_DB_PATH = join(import.meta.dirname, 'test-vibe-paradox.db');
const MIGRATIONS_DIR = join(import.meta.dirname, '..', 'db', 'migrations');

function cleanup(): void {
  for (const suffix of ['', '-wal', '-shm']) {
    const path = TEST_DB_PATH + suffix;
    if (existsSync(path)) unlinkSync(path);
  }
}

describe('Database', () => {
  let db: Database;

  beforeEach(() => {
    cleanup();
    db = new Database(TEST_DB_PATH);
    db.runMigrations(MIGRATIONS_DIR);
  });

  afterEach(() => {
    db.close();
    cleanup();
  });

  // --- Migration Tests ---

  it('should create all tables after running migrations', () => {
    const tables = [
      'world_meta', 'chunks', 'agents', 'resources',
      'npc_monsters', 'behemoths', 'trades', 'crafting_queue',
      'messages', 'alliances', 'alliance_members',
    ];

    for (const table of tables) {
      const row = (db as any).db.prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name=?`
      ).get(table);
      expect(row, `Table '${table}' should exist`).toBeTruthy();
    }
  });

  // --- Agent Tests ---

  it('should save and load an agent with all fields', () => {
    const agent = makeAgent('agent_abc12345', 'TestBot', 'fighter');
    db.saveAgent(agent);

    const loaded = db.loadAgent('agent_abc12345');
    expect(loaded).not.toBeNull();
    expect(loaded!.id).toBe(agent.id);
    expect(loaded!.name).toBe(agent.name);
    expect(loaded!.role).toBe(agent.role);
    expect(loaded!.position).toEqual(agent.position);
    expect(loaded!.destination).toEqual(agent.destination);
    expect(loaded!.status).toBe(agent.status);
    expect(loaded!.stats).toEqual(agent.stats);
    expect(loaded!.gold).toBe(agent.gold);
    expect(loaded!.inventory).toEqual(agent.inventory);
    expect(loaded!.equipment).toEqual(agent.equipment);
    expect(loaded!.alliance).toBe(agent.alliance);
    expect(loaded!.kills).toBe(agent.kills);
    expect(loaded!.monsterEats).toBe(agent.monsterEats);
    expect(loaded!.evolutionStage).toBe(agent.evolutionStage);
    expect(loaded!.actionCooldown).toBe(agent.actionCooldown);
    expect(loaded!.respawnTick).toBe(agent.respawnTick);
    expect(loaded!.connectedAt).toBe(agent.connectedAt);
    expect(loaded!.lastActionTick).toBe(agent.lastActionTick);
    expect(loaded!.isAlive).toBe(agent.isAlive);
    expect(loaded!.isConnected).toBe(agent.isConnected);
  });

  it('should return null for nonexistent agent', () => {
    const loaded = db.loadAgent('agent_nope0000');
    expect(loaded).toBeNull();
  });

  it('should load all agents', () => {
    db.saveAgent(makeAgent('agent_aaa00001', 'Bot1', 'fighter'));
    db.saveAgent(makeAgent('agent_bbb00002', 'Bot2', 'merchant'));
    db.saveAgent(makeAgent('agent_ccc00003', 'Bot3', 'monster'));

    const all = db.loadAllAgents();
    expect(all).toHaveLength(3);
    const names = all.map(a => a.name).sort();
    expect(names).toEqual(['Bot1', 'Bot2', 'Bot3']);
  });

  it('should save agent with destination', () => {
    const agent = makeAgent('agent_dest0001', 'Mover', 'fighter');
    agent.destination = { x: 200, y: 300 };
    agent.status = 'moving';
    db.saveAgent(agent);

    const loaded = db.loadAgent('agent_dest0001')!;
    expect(loaded.destination).toEqual({ x: 200, y: 300 });
    expect(loaded.status).toBe('moving');
  });

  it('should save agent with inventory and equipment', () => {
    const agent = makeAgent('agent_inv00001', 'Crafter', 'merchant');
    agent.inventory = [
      { id: 'iron_ore', quantity: 5 },
      { id: 'log', quantity: 10 },
    ];
    agent.equipment = { weapon: 'iron_sword', armor: null, tool: 'iron_axe' };
    db.saveAgent(agent);

    const loaded = db.loadAgent('agent_inv00001')!;
    expect(loaded.inventory).toEqual(agent.inventory);
    expect(loaded.equipment).toEqual(agent.equipment);
  });

  it('should update agent on re-save', () => {
    const agent = makeAgent('agent_upd00001', 'Updater', 'fighter');
    db.saveAgent(agent);

    agent.gold = 999;
    agent.stats.health = 50;
    db.saveAgent(agent);

    const loaded = db.loadAgent('agent_upd00001')!;
    expect(loaded.gold).toBe(999);
    expect(loaded.stats.health).toBe(50);
  });

  // --- Resource Tests ---

  it('should save and load resources', () => {
    const resource: Resource = {
      id: 'res_tree0001',
      type: 'tree',
      position: { x: 100, y: 200 },
      remaining: 7,
      maxCapacity: 10,
      state: 'available',
      growthStartTick: null,
      growthCompleteTick: null,
      createdAt: 0,
    };
    db.saveResource(resource);

    const all = db.loadAllResources();
    expect(all).toHaveLength(1);
    expect(all[0]!.id).toBe('res_tree0001');
    expect(all[0]!.type).toBe('tree');
    expect(all[0]!.position).toEqual({ x: 100, y: 200 });
    expect(all[0]!.remaining).toBe(7);
    expect(all[0]!.maxCapacity).toBe(10);
    expect(all[0]!.state).toBe('available');
  });

  it('should save and load sapling with growth ticks', () => {
    const sapling: Resource = {
      id: 'res_sap00001',
      type: 'sapling',
      position: { x: 50, y: 60 },
      remaining: 0,
      maxCapacity: 8,
      state: 'growing',
      growthStartTick: 100,
      growthCompleteTick: 400,
      createdAt: 100,
    };
    db.saveResource(sapling);

    const all = db.loadAllResources();
    expect(all).toHaveLength(1);
    expect(all[0]!.growthStartTick).toBe(100);
    expect(all[0]!.growthCompleteTick).toBe(400);
  });

  // --- NPC Monster Tests ---

  it('should save and load NPC monsters', () => {
    const monster: NpcMonster = {
      id: 'npc_gob00001',
      template: 'weak_goblin',
      position: { x: 300, y: 400 },
      health: 30,
      maxHealth: 30,
      attack: 5,
      defense: 3,
      speed: 3,
      status: 'roaming',
      behavior: 'patrol',
      patrolOrigin: { x: 300, y: 400 },
      patrolRadius: 50,
      targetId: null,
      goldDrop: 10,
      createdAt: 0,
    };
    db.saveNpcMonster(monster);

    const all = db.loadAllNpcMonsters();
    expect(all).toHaveLength(1);
    expect(all[0]!.id).toBe('npc_gob00001');
    expect(all[0]!.template).toBe('weak_goblin');
    expect(all[0]!.position).toEqual({ x: 300, y: 400 });
    expect(all[0]!.health).toBe(30);
    expect(all[0]!.maxHealth).toBe(30);
    expect(all[0]!.attack).toBe(5);
    expect(all[0]!.defense).toBe(3);
    expect(all[0]!.goldDrop).toBe(10);
    expect(all[0]!.patrolOrigin).toEqual({ x: 300, y: 400 });
  });

  // --- Behemoth Tests ---

  it('should save and load behemoths', () => {
    const behemoth: Behemoth = {
      id: 'beh_iron0001',
      type: 'iron',
      position: { x: 200, y: 200 },
      health: 500,
      maxHealth: 500,
      attack: 30,
      defense: 20,
      status: 'roaming',
      oreAmount: 0,
      oreMax: 15,
      fedAmount: 0,
      unconsciousUntilTick: null,
      route: [{ x: 200, y: 200 }, { x: 250, y: 250 }, { x: 200, y: 300 }],
      currentWaypoint: 0,
    };
    db.saveBehemoth(behemoth);

    const all = db.loadAllBehemoths();
    expect(all).toHaveLength(1);
    expect(all[0]!.id).toBe('beh_iron0001');
    expect(all[0]!.type).toBe('iron');
    expect(all[0]!.health).toBe(500);
    expect(all[0]!.maxHealth).toBe(500);
    expect(all[0]!.status).toBe('roaming');
    expect(all[0]!.route).toEqual([
      { x: 200, y: 200 },
      { x: 250, y: 250 },
      { x: 200, y: 300 },
    ]);
  });

  // --- Alliance Tests ---

  it('should save and load alliances with members', () => {
    const alliance: Alliance = {
      name: 'Wolves',
      founder: 'agent_found001',
      members: new Set(['agent_found001', 'agent_memb0002']),
      createdAt: 10,
    };
    db.saveAlliance(alliance);

    const all = db.loadAllAlliances();
    expect(all).toHaveLength(1);
    expect(all[0]!.name).toBe('Wolves');
    expect(all[0]!.founder).toBe('agent_found001');
    expect(all[0]!.members.size).toBe(2);
    expect(all[0]!.members.has('agent_found001')).toBe(true);
    expect(all[0]!.members.has('agent_memb0002')).toBe(true);
  });

  // --- Trade Tests ---

  it('should save a trade', () => {
    const trade: Trade = {
      id: 'trade_t000001',
      tick: 5,
      buyerId: 'agent_buy00001',
      sellerId: 'agent_sell0001',
      offered: [{ itemId: 'iron_sword', quantity: 1 }],
      requested: [{ itemId: 'gold', quantity: 50 }],
      status: 'pending',
      createdAt: 5,
      resolvedAt: null,
    };
    db.saveTrade(trade);

    // Verify via raw query
    const row = (db as any).db.prepare('SELECT * FROM trades WHERE id = ?').get('trade_t000001') as any;
    expect(row).toBeTruthy();
    expect(row.buyer_id).toBe('agent_buy00001');
    expect(row.status).toBe('pending');
    expect(JSON.parse(row.offered)).toEqual([{ itemId: 'iron_sword', quantity: 1 }]);
  });

  // --- Message Tests ---

  it('should save a message', () => {
    const msg: ChatMessage = {
      id: 'msg_test0001',
      tick: 3,
      senderId: 'agent_send0001',
      senderName: 'Sender',
      mode: 'local',
      content: 'Hello world',
      targetId: null,
      position: { x: 100, y: 100 },
      recipients: ['agent_send0001', 'agent_recv0001'],
    };
    db.saveMessage(msg);

    const row = (db as any).db.prepare('SELECT * FROM messages WHERE id = ?').get('msg_test0001') as any;
    expect(row).toBeTruthy();
    expect(row.sender_id).toBe('agent_send0001');
    expect(row.mode).toBe('local');
    expect(row.content).toBe('Hello world');
  });

  // --- Meta Tests ---

  it('should get and set meta values', () => {
    db.setMetaValue('current_tick', '42', 42);
    expect(db.getMetaValue('current_tick')).toBe('42');
    expect(db.getMetaValue('nonexistent')).toBeNull();
  });

  // --- Snapshot Tests ---

  it('should snapshot and restore world state', () => {
    const agents = new Map<string, Agent>();
    const agent = makeAgent('agent_snap0001', 'Snappy', 'fighter');
    agent.gold = 100;
    agent.stats.health = 75;
    agents.set(agent.id, agent);

    const resources = new Map<string, Resource>();
    const tree: Resource = {
      id: 'res_snap0001',
      type: 'tree',
      position: { x: 150, y: 250 },
      remaining: 5,
      maxCapacity: 10,
      state: 'available',
      growthStartTick: null,
      growthCompleteTick: null,
      createdAt: 0,
    };
    resources.set(tree.id, tree);

    const npcMonsters = new Map<string, NpcMonster>();
    const npc: NpcMonster = {
      id: 'npc_snap0001',
      template: 'medium_wolf',
      position: { x: 400, y: 500 },
      health: 60,
      maxHealth: 60,
      attack: 10,
      defense: 5,
      speed: 4,
      status: 'roaming',
      behavior: 'patrol',
      patrolOrigin: { x: 400, y: 500 },
      patrolRadius: 50,
      targetId: null,
      goldDrop: 25,
      createdAt: 0,
    };
    npcMonsters.set(npc.id, npc);

    const behemoths = new Map<string, Behemoth>();
    const beh: Behemoth = {
      id: 'beh_snap0001',
      type: 'copper',
      position: { x: 800, y: 200 },
      health: 500,
      maxHealth: 500,
      attack: 30,
      defense: 20,
      status: 'roaming',
      oreAmount: 3,
      oreMax: 15,
      fedAmount: 5,
      unconsciousUntilTick: null,
      route: [{ x: 800, y: 200 }, { x: 850, y: 250 }],
      currentWaypoint: 0,
    };
    behemoths.set(beh.id, beh);

    const alliances = new Map<string, Alliance>();
    const ally: Alliance = {
      name: 'SnapTeam',
      founder: 'agent_snap0001',
      members: new Set(['agent_snap0001']),
      createdAt: 5,
    };
    alliances.set(ally.name, ally);

    db.snapshotWorld({
      tick: 42,
      seed: 12345,
      agents,
      resources,
      npcMonsters,
      behemoths,
      alliances,
    });

    // Restore
    const snapshot = db.loadWorldSnapshot();
    expect(snapshot).not.toBeNull();
    expect(snapshot!.tick).toBe(42);
    expect(snapshot!.seed).toBe(12345);

    // Agents
    expect(snapshot!.agents).toHaveLength(1);
    expect(snapshot!.agents[0]!.id).toBe('agent_snap0001');
    expect(snapshot!.agents[0]!.gold).toBe(100);
    expect(snapshot!.agents[0]!.stats.health).toBe(75);

    // Resources
    expect(snapshot!.resources).toHaveLength(1);
    expect(snapshot!.resources[0]!.id).toBe('res_snap0001');
    expect(snapshot!.resources[0]!.remaining).toBe(5);

    // NPC Monsters
    expect(snapshot!.npcMonsters).toHaveLength(1);
    expect(snapshot!.npcMonsters[0]!.id).toBe('npc_snap0001');
    expect(snapshot!.npcMonsters[0]!.template).toBe('medium_wolf');

    // Behemoths
    expect(snapshot!.behemoths).toHaveLength(1);
    expect(snapshot!.behemoths[0]!.id).toBe('beh_snap0001');
    expect(snapshot!.behemoths[0]!.oreAmount).toBe(3);

    // Alliances
    expect(snapshot!.alliances).toHaveLength(1);
    expect(snapshot!.alliances[0]!.name).toBe('SnapTeam');
    expect(snapshot!.alliances[0]!.members.has('agent_snap0001')).toBe(true);
  });

  it('should return null snapshot when no data exists', () => {
    const snapshot = db.loadWorldSnapshot();
    expect(snapshot).toBeNull();
  });
});

// --- Helper ---

function makeAgent(id: string, name: string, role: 'merchant' | 'fighter' | 'monster'): Agent {
  const stats: Record<string, { health: number; attack: number; defense: number; speed: number }> = {
    merchant: { health: 50, attack: 0, defense: 5, speed: 3 },
    fighter: { health: 100, attack: 15, defense: 10, speed: 4 },
    monster: { health: 80, attack: 12, defense: 8, speed: 5 },
  };
  const visionRadius: Record<string, number> = {
    merchant: 80,
    fighter: 100,
    monster: 150,
  };
  const base = stats[role]!;

  return {
    id,
    name,
    role,
    position: { x: 500, y: 500 },
    destination: null,
    status: 'idle',
    stats: {
      health: base.health,
      maxHealth: base.health,
      attack: base.attack,
      defense: base.defense,
      speed: base.speed,
      visionRadius: visionRadius[role]!,
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
    isConnected: false,
  };
}
