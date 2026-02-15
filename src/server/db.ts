// server/db.ts — SQLite persistence layer

import BetterSqlite3 from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type {
  EntityId,
  Tick,
  Agent,
  Resource,
  NpcMonster,
  Behemoth,
  Alliance,
  Trade,
  ChatMessage,
  TickResult,
} from '../types/index.js';

export class Database {
  private db: BetterSqlite3.Database;

  // Prepared statements (initialized after migrations)
  private stmts!: {
    upsertAgent: BetterSqlite3.Statement;
    loadAgent: BetterSqlite3.Statement;
    loadAllAgents: BetterSqlite3.Statement;
    upsertResource: BetterSqlite3.Statement;
    loadAllResources: BetterSqlite3.Statement;
    upsertNpcMonster: BetterSqlite3.Statement;
    loadAllNpcMonsters: BetterSqlite3.Statement;
    upsertBehemoth: BetterSqlite3.Statement;
    loadAllBehemoths: BetterSqlite3.Statement;
    upsertAlliance: BetterSqlite3.Statement;
    upsertAllianceMember: BetterSqlite3.Statement;
    loadAllAlliances: BetterSqlite3.Statement;
    loadAllianceMembers: BetterSqlite3.Statement;
    upsertTrade: BetterSqlite3.Statement;
    insertMessage: BetterSqlite3.Statement;
    getMeta: BetterSqlite3.Statement;
    setMeta: BetterSqlite3.Statement;
  };

  constructor(dbPath: string) {
    this.db = new BetterSqlite3(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
  }

  runMigrations(migrationsDir: string): void {
    // Create migration tracking table (idempotent)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS _migrations (
        name TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);

    const applied = new Set(
      (this.db.prepare('SELECT name FROM _migrations').all() as { name: string }[])
        .map(r => r.name)
    );

    const files = readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = readFileSync(join(migrationsDir, file), 'utf-8');
      this.db.exec(sql);
      this.db.prepare('INSERT INTO _migrations (name) VALUES (?)').run(file);
    }

    this.prepareStatements();
  }

  private prepareStatements(): void {
    this.stmts = {
      upsertAgent: this.db.prepare(`
        INSERT OR REPLACE INTO agents (
          id, name, role, position_x, position_y, destination_x, destination_y,
          status, health, max_health, attack, defense, speed, vision_radius,
          gold, inventory, equipment, alliance, kills, monster_eats,
          evolution_stage, action_cooldown, respawn_tick, connected_at,
          last_action_tick, is_alive, is_connected
        ) VALUES (
          @id, @name, @role, @position_x, @position_y, @destination_x, @destination_y,
          @status, @health, @max_health, @attack, @defense, @speed, @vision_radius,
          @gold, @inventory, @equipment, @alliance, @kills, @monster_eats,
          @evolution_stage, @action_cooldown, @respawn_tick, @connected_at,
          @last_action_tick, @is_alive, @is_connected
        )
      `),

      loadAgent: this.db.prepare('SELECT * FROM agents WHERE id = ?'),

      loadAllAgents: this.db.prepare('SELECT * FROM agents'),

      upsertResource: this.db.prepare(`
        INSERT OR REPLACE INTO resources (
          id, type, position_x, position_y, remaining, max_capacity,
          state, growth_start_tick, growth_complete_tick, created_at
        ) VALUES (
          @id, @type, @position_x, @position_y, @remaining, @max_capacity,
          @state, @growth_start_tick, @growth_complete_tick, @created_at
        )
      `),

      loadAllResources: this.db.prepare('SELECT * FROM resources'),

      upsertNpcMonster: this.db.prepare(`
        INSERT OR REPLACE INTO npc_monsters (
          id, template, position_x, position_y, health, max_health,
          attack, defense, speed, status, patrol_origin_x, patrol_origin_y,
          patrol_radius, target_id, gold_drop, created_at
        ) VALUES (
          @id, @template, @position_x, @position_y, @health, @max_health,
          @attack, @defense, @speed, @status, @patrol_origin_x, @patrol_origin_y,
          @patrol_radius, @target_id, @gold_drop, @created_at
        )
      `),

      loadAllNpcMonsters: this.db.prepare('SELECT * FROM npc_monsters'),

      upsertBehemoth: this.db.prepare(`
        INSERT OR REPLACE INTO behemoths (
          id, type, position_x, position_y, health, max_health,
          status, ore_amount, ore_max, fed_amount, unconscious_until_tick, route
        ) VALUES (
          @id, @type, @position_x, @position_y, @health, @max_health,
          @status, @ore_amount, @ore_max, @fed_amount, @unconscious_until_tick, @route
        )
      `),

      loadAllBehemoths: this.db.prepare('SELECT * FROM behemoths'),

      upsertAlliance: this.db.prepare(`
        INSERT OR REPLACE INTO alliances (name, founder_id, created_at)
        VALUES (@name, @founder_id, @created_at)
      `),

      upsertAllianceMember: this.db.prepare(`
        INSERT OR REPLACE INTO alliance_members (alliance_name, agent_id, joined_at)
        VALUES (@alliance_name, @agent_id, @joined_at)
      `),

      loadAllAlliances: this.db.prepare('SELECT * FROM alliances'),

      loadAllianceMembers: this.db.prepare(
        'SELECT agent_id, joined_at FROM alliance_members WHERE alliance_name = ?'
      ),

      upsertTrade: this.db.prepare(`
        INSERT OR REPLACE INTO trades (
          id, tick, buyer_id, seller_id, offered, received,
          status, created_at, resolved_at
        ) VALUES (
          @id, @tick, @buyer_id, @seller_id, @offered, @received,
          @status, @created_at, @resolved_at
        )
      `),

      insertMessage: this.db.prepare(`
        INSERT INTO messages (
          id, tick, sender_id, mode, content, target_id,
          position_x, position_y, created_at
        ) VALUES (
          @id, @tick, @sender_id, @mode, @content, @target_id,
          @position_x, @position_y, @created_at
        )
      `),

      getMeta: this.db.prepare('SELECT value FROM world_meta WHERE key = ?'),

      setMeta: this.db.prepare(`
        INSERT OR REPLACE INTO world_meta (key, value, updated_at)
        VALUES (@key, @value, @updated_at)
      `),
    };
  }

  // --- Agent ---

  saveAgent(agent: Agent): void {
    this.stmts.upsertAgent.run({
      id: agent.id,
      name: agent.name,
      role: agent.role,
      position_x: agent.position.x,
      position_y: agent.position.y,
      destination_x: agent.destination?.x ?? null,
      destination_y: agent.destination?.y ?? null,
      status: agent.status,
      health: agent.stats.health,
      max_health: agent.stats.maxHealth,
      attack: agent.stats.attack,
      defense: agent.stats.defense,
      speed: agent.stats.speed,
      vision_radius: agent.stats.visionRadius,
      gold: agent.gold,
      inventory: JSON.stringify(agent.inventory),
      equipment: JSON.stringify(agent.equipment),
      alliance: agent.alliance,
      kills: agent.kills,
      monster_eats: agent.monsterEats,
      evolution_stage: agent.evolutionStage,
      action_cooldown: agent.actionCooldown,
      respawn_tick: agent.respawnTick,
      connected_at: agent.connectedAt,
      last_action_tick: agent.lastActionTick,
      is_alive: agent.isAlive ? 1 : 0,
      is_connected: agent.isConnected ? 1 : 0,
    });
  }

  loadAgent(id: EntityId): Agent | null {
    const row = this.stmts.loadAgent.get(id) as AgentRow | undefined;
    if (!row) return null;
    return this.rowToAgent(row);
  }

  loadAllAgents(): Agent[] {
    const rows = this.stmts.loadAllAgents.all() as AgentRow[];
    return rows.map(row => this.rowToAgent(row));
  }

  private rowToAgent(row: AgentRow): Agent {
    return {
      id: row.id,
      name: row.name,
      role: row.role as Agent['role'],
      position: { x: row.position_x, y: row.position_y },
      destination: row.destination_x != null && row.destination_y != null
        ? { x: row.destination_x, y: row.destination_y }
        : null,
      status: row.status as Agent['status'],
      stats: {
        health: row.health,
        maxHealth: row.max_health,
        attack: row.attack,
        defense: row.defense,
        speed: row.speed,
        visionRadius: row.vision_radius,
      },
      gold: row.gold,
      inventory: JSON.parse(row.inventory),
      equipment: JSON.parse(row.equipment),
      alliance: row.alliance,
      kills: row.kills,
      monsterEats: row.monster_eats,
      evolutionStage: row.evolution_stage,
      actionCooldown: row.action_cooldown,
      respawnTick: row.respawn_tick,
      connectedAt: row.connected_at,
      lastActionTick: row.last_action_tick,
      isAlive: row.is_alive === 1,
      isConnected: row.is_connected === 1,
    };
  }

  // --- Resource ---

  saveResource(resource: Resource): void {
    this.stmts.upsertResource.run({
      id: resource.id,
      type: resource.type,
      position_x: resource.position.x,
      position_y: resource.position.y,
      remaining: resource.remaining,
      max_capacity: resource.maxCapacity,
      state: resource.state,
      growth_start_tick: resource.growthStartTick,
      growth_complete_tick: resource.growthCompleteTick,
      created_at: resource.createdAt,
    });
  }

  loadAllResources(): Resource[] {
    const rows = this.stmts.loadAllResources.all() as ResourceRow[];
    return rows.map(row => ({
      id: row.id,
      type: row.type as Resource['type'],
      position: { x: row.position_x, y: row.position_y },
      remaining: row.remaining,
      maxCapacity: row.max_capacity,
      state: row.state as Resource['state'],
      growthStartTick: row.growth_start_tick,
      growthCompleteTick: row.growth_complete_tick,
      createdAt: row.created_at,
    }));
  }

  // --- NPC Monster ---

  saveNpcMonster(monster: NpcMonster): void {
    this.stmts.upsertNpcMonster.run({
      id: monster.id,
      template: monster.template,
      position_x: monster.position.x,
      position_y: monster.position.y,
      health: monster.health,
      max_health: monster.maxHealth,
      attack: monster.attack,
      defense: monster.defense,
      speed: monster.speed,
      status: monster.status,
      patrol_origin_x: monster.patrolOrigin.x,
      patrol_origin_y: monster.patrolOrigin.y,
      patrol_radius: monster.patrolRadius,
      target_id: monster.targetId,
      gold_drop: monster.goldDrop,
      created_at: monster.createdAt,
    });
  }

  loadAllNpcMonsters(): NpcMonster[] {
    const rows = this.stmts.loadAllNpcMonsters.all() as NpcMonsterRow[];
    return rows.map(row => ({
      id: row.id,
      template: row.template,
      position: { x: row.position_x, y: row.position_y },
      health: row.health,
      maxHealth: row.max_health,
      attack: row.attack,
      defense: row.defense,
      speed: row.speed,
      status: row.status,
      behavior: 'patrol' as const,
      patrolOrigin: { x: row.patrol_origin_x, y: row.patrol_origin_y },
      patrolRadius: row.patrol_radius,
      targetId: row.target_id,
      goldDrop: row.gold_drop,
      createdAt: row.created_at,
    }));
  }

  // --- Behemoth ---

  saveBehemoth(behemoth: Behemoth): void {
    this.stmts.upsertBehemoth.run({
      id: behemoth.id,
      type: behemoth.type,
      position_x: behemoth.position.x,
      position_y: behemoth.position.y,
      health: behemoth.health,
      max_health: behemoth.maxHealth,
      status: behemoth.status,
      ore_amount: behemoth.oreAmount,
      ore_max: behemoth.oreMax,
      fed_amount: behemoth.fedAmount,
      unconscious_until_tick: behemoth.unconsciousUntilTick,
      route: JSON.stringify(behemoth.route),
    });
  }

  loadAllBehemoths(): Behemoth[] {
    const rows = this.stmts.loadAllBehemoths.all() as BehemothRow[];
    return rows.map(row => ({
      id: row.id,
      type: row.type,
      position: { x: row.position_x, y: row.position_y },
      health: row.health,
      maxHealth: row.max_health,
      attack: 30,
      defense: 20,
      status: row.status as Behemoth['status'],
      oreAmount: row.ore_amount,
      oreMax: row.ore_max,
      fedAmount: row.fed_amount,
      unconsciousUntilTick: row.unconscious_until_tick,
      route: JSON.parse(row.route),
      currentWaypoint: 0,
    }));
  }

  // --- Alliance ---

  saveAlliance(alliance: Alliance): void {
    this.stmts.upsertAlliance.run({
      name: alliance.name,
      founder_id: alliance.founder,
      created_at: alliance.createdAt,
    });

    for (const memberId of alliance.members) {
      this.stmts.upsertAllianceMember.run({
        alliance_name: alliance.name,
        agent_id: memberId,
        joined_at: alliance.createdAt,
      });
    }
  }

  loadAllAlliances(): Alliance[] {
    const rows = this.stmts.loadAllAlliances.all() as AllianceRow[];
    return rows.map(row => {
      const memberRows = this.stmts.loadAllianceMembers.all(row.name) as AllianceMemberRow[];
      const members = new Set<EntityId>(memberRows.map(m => m.agent_id));
      return {
        name: row.name,
        founder: row.founder_id,
        members,
        createdAt: row.created_at,
      };
    });
  }

  // --- Trade ---

  saveTrade(trade: Trade): void {
    this.stmts.upsertTrade.run({
      id: trade.id,
      tick: trade.tick,
      buyer_id: trade.buyerId,
      seller_id: trade.sellerId,
      offered: JSON.stringify(trade.offered),
      received: JSON.stringify(trade.requested),
      status: trade.status,
      created_at: trade.createdAt,
      resolved_at: trade.resolvedAt,
    });
  }

  // --- Message ---

  saveMessage(msg: ChatMessage): void {
    this.stmts.insertMessage.run({
      id: msg.id,
      tick: msg.tick,
      sender_id: msg.senderId,
      mode: msg.mode,
      content: msg.content,
      target_id: msg.targetId,
      position_x: msg.position.x,
      position_y: msg.position.y,
      created_at: msg.tick,
    });
  }

  // --- Tick Persistence ---

  persistTickChanges(result: TickResult): void {
    const runAll = this.db.transaction(() => {
      for (const change of result.stateChanges) {
        // State changes are granular — we persist the full entity on critical events
        // For now, we rely on snapshotWorld for full persistence
      }
    });
    runAll();
  }

  // --- World Snapshot ---

  snapshotWorld(world: {
    tick: Tick;
    seed: number;
    agents: Map<EntityId, Agent>;
    resources: Map<EntityId, Resource>;
    npcMonsters: Map<EntityId, NpcMonster>;
    behemoths: Map<EntityId, Behemoth>;
    alliances: Map<string, Alliance>;
  }): void {
    const runAll = this.db.transaction(() => {
      this.setMetaValue('current_tick', String(world.tick), world.tick);
      this.setMetaValue('world_seed', String(world.seed), world.tick);
      this.setMetaValue('last_snapshot_tick', String(world.tick), world.tick);

      for (const agent of world.agents.values()) {
        this.saveAgent(agent);
      }
      for (const resource of world.resources.values()) {
        this.saveResource(resource);
      }
      for (const monster of world.npcMonsters.values()) {
        this.saveNpcMonster(monster);
      }
      for (const behemoth of world.behemoths.values()) {
        this.saveBehemoth(behemoth);
      }
      for (const alliance of world.alliances.values()) {
        this.saveAlliance(alliance);
      }
    });
    runAll();
  }

  loadWorldSnapshot(): {
    tick: Tick;
    seed: number;
    agents: Agent[];
    resources: Resource[];
    npcMonsters: NpcMonster[];
    behemoths: Behemoth[];
    alliances: Alliance[];
  } | null {
    const tickStr = this.getMetaValue('current_tick');
    const seedStr = this.getMetaValue('world_seed');
    if (tickStr == null || seedStr == null) return null;

    return {
      tick: Number(tickStr),
      seed: Number(seedStr),
      agents: this.loadAllAgents(),
      resources: this.loadAllResources(),
      npcMonsters: this.loadAllNpcMonsters(),
      behemoths: this.loadAllBehemoths(),
      alliances: this.loadAllAlliances(),
    };
  }

  // --- Meta ---

  getMetaValue(key: string): string | null {
    const row = this.stmts.getMeta.get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  setMetaValue(key: string, value: string, tick: Tick): void {
    this.stmts.setMeta.run({ key, value, updated_at: tick });
  }

  // --- Lifecycle ---

  close(): void {
    this.db.close();
  }
}

// --- Row types for SQL result mapping ---

interface AgentRow {
  id: string;
  name: string;
  role: string;
  position_x: number;
  position_y: number;
  destination_x: number | null;
  destination_y: number | null;
  status: string;
  health: number;
  max_health: number;
  attack: number;
  defense: number;
  speed: number;
  vision_radius: number;
  gold: number;
  inventory: string;
  equipment: string;
  alliance: string | null;
  kills: number;
  monster_eats: number;
  evolution_stage: number;
  action_cooldown: number;
  respawn_tick: number | null;
  connected_at: number;
  last_action_tick: number;
  is_alive: number;
  is_connected: number;
  created_at: string;
}

interface ResourceRow {
  id: string;
  type: string;
  position_x: number;
  position_y: number;
  remaining: number;
  max_capacity: number;
  state: string;
  growth_start_tick: number | null;
  growth_complete_tick: number | null;
  created_at: number;
}

interface NpcMonsterRow {
  id: string;
  template: string;
  position_x: number;
  position_y: number;
  health: number;
  max_health: number;
  attack: number;
  defense: number;
  speed: number;
  status: string;
  patrol_origin_x: number;
  patrol_origin_y: number;
  patrol_radius: number;
  target_id: string | null;
  gold_drop: number;
  created_at: number;
}

interface BehemothRow {
  id: string;
  type: string;
  position_x: number;
  position_y: number;
  health: number;
  max_health: number;
  status: string;
  ore_amount: number;
  ore_max: number;
  fed_amount: number;
  unconscious_until_tick: number | null;
  route: string;
}

interface AllianceRow {
  name: string;
  founder_id: string;
  created_at: number;
}

interface AllianceMemberRow {
  agent_id: string;
  joined_at: number;
}
