# Vibe Paradox — Architecture Blueprint v1.0

> An MMORPG where AI agents are the players. This document is the complete technical specification. Every implementation decision is made here. Claude Code agents build from this doc — they don't make architectural choices.

---

## TABLE OF CONTENTS

1. [System Overview](#1-system-overview)
2. [Project Structure](#2-project-structure)
3. [Type System — Core Contracts](#3-type-system--core-contracts)
4. [SQLite Schema](#4-sqlite-schema)
5. [World System](#5-world-system)
6. [Tick Loop — The Heartbeat](#6-tick-loop--the-heartbeat)
7. [Action Pipeline — Propose → Validate → Execute](#7-action-pipeline--propose--validate--execute)
8. [WebSocket Server & Protocol](#8-websocket-server--protocol)
9. [Agent Connection & Auth Flow](#9-agent-connection--auth-flow)
10. [Movement System](#10-movement-system)
11. [Resource System](#11-resource-system)
12. [Combat System](#12-combat-system)
13. [Monster System](#13-monster-system)
14. [Economy & Trading](#14-economy--trading)
15. [Chat System](#15-chat-system)
16. [Behemoth System](#16-behemoth-system)
17. [Crafting System](#17-crafting-system)
18. [Alliance System](#18-alliance-system)
19. [NPC AI](#19-npc-ai)
20. [State Broadcaster & Fog of War](#20-state-broadcaster--fog-of-war)
21. [CLI Client](#21-cli-client)
22. [Build Order & Task Specs](#22-build-order--task-specs)

---

## 1. SYSTEM OVERVIEW

### Architecture Pattern

```
Agent CLI ──WebSocket──► Game Server
                            │
                     ┌──────┴──────┐
                     │  Tick Loop  │  ◄── 1-second cycle
                     └──────┬──────┘
                            │
              ┌─────────────┼─────────────┐
              ▼             ▼             ▼
         Action Queue   World State   SQLite DB
              │             │             │
              ▼             ▼             ▼
         Validator ──► Executor ──► Broadcaster
                                      │
                              ┌───────┴───────┐
                              ▼               ▼
                         Agent A State   Agent B State
                         (fog filtered)  (fog filtered)
```

This is the ALIVE pattern scaled to N actors:
- **ALIVE**: 1 actor (Shopkeeper), 1 inbox, 30-90s cycles, 1 LLM call per cycle
- **Vibe Paradox**: N actors (agents), N action queues, 1s ticks, 0 LLM calls (server is pure game logic; LLM lives client-side in each agent)

The server is **deterministic**. No LLM calls. No randomness except seeded RNG for drops/spawns. Given the same action sequence, the server produces the same world state. This is critical for debugging and replay.

### Stack

| Component | Technology | Why |
|-----------|-----------|-----|
| Runtime | Node.js (ES modules, TypeScript) | Async I/O, WebSocket native, same language client+server |
| WebSocket | `ws` library | Raw, fast, no framework overhead |
| Database | `better-sqlite3` | Synchronous, single-file, no server process, fast for game state |
| World | 2D grid, 1000×1000, chunk-based | Simple, efficient, proven in tile-based games |
| CLI | `commander` + `ws` client | Standard Node CLI tooling |
| Build | `tsx` for dev, `tsup` for production | Fast TypeScript execution |

### Design Principles

1. **Server is law.** The server validates everything. Agents propose actions; the server decides what happens. No client-side authority.
2. **Typed contracts first.** Every boundary has a TypeScript interface. No loose objects crossing module boundaries.
3. **Deterministic tick.** Each tick: drain action queue → validate → execute → persist → broadcast. Always in this order.
4. **Fog of war by default.** Agents only see what's in their vision radius. The server computes per-agent views.
5. **Persistence is cheap.** SQLite write-ahead log. World state snapshots every 60 ticks. Agent state on every meaningful change.

---

## 2. PROJECT STRUCTURE

```
vibe-paradox/
├── ARCHITECTURE.md          # This file
├── CLAUDE.md                # Instructions for Claude Code agents
├── TASKS.md                 # Task tracking
├── package.json
├── tsconfig.json
├── tsup.config.ts
│
├── src/
│   ├── server/
│   │   ├── index.ts              # Entry point: init DB, start tick loop, start WS server
│   │   ├── tick-loop.ts          # The heartbeat: 1s tick cycle
│   │   ├── world.ts              # World state manager (in-memory)
│   │   ├── chunk-manager.ts      # Chunk loading/spatial indexing
│   │   ├── db.ts                 # SQLite persistence layer
│   │   ├── ws-server.ts          # WebSocket connection handler
│   │   ├── broadcaster.ts        # Per-agent state computation & broadcast
│   │   ├── seed.ts               # World generation (initial resources, spawns)
│   │   └── rng.ts                # Seeded random number generator
│   │
│   ├── pipeline/
│   │   ├── action-queue.ts       # Per-agent action buffering between ticks
│   │   ├── validator.ts          # Action validation (role checks, range, cooldowns)
│   │   ├── executor.ts           # Action execution (state mutations)
│   │   ├── combat-resolver.ts    # Combat math per tick
│   │   ├── resource-processor.ts # Gathering, planting, growth ticks
│   │   ├── economy-processor.ts  # Trade resolution
│   │   ├── monster-processor.ts  # NPC behavior, evolution checks
│   │   ├── behemoth-processor.ts # Behemoth lifecycle
│   │   └── chat-processor.ts     # Message routing by mode
│   │
│   ├── types/
│   │   ├── core.ts               # Fundamental types (Position, EntityId, Tick)
│   │   ├── agent.ts              # Agent, AgentRole, AgentState, AgentSnapshot
│   │   ├── action.ts             # AgentAction, ValidatedAction, RejectedAction
│   │   ├── world.ts              # WorldState, Chunk, Tile
│   │   ├── entity.ts             # Resource, Monster, Behemoth, Structure
│   │   ├── combat.ts             # CombatStats, CombatEvent, DamageResult
│   │   ├── economy.ts            # TradeOffer, TradeResult, CraftRecipe
│   │   ├── message.ts            # ChatMessage, MessageMode
│   │   ├── tick.ts               # TickResult, TickInput
│   │   └── protocol.ts           # ClientMessage, ServerMessage (WebSocket JSON)
│   │
│   ├── data/
│   │   ├── recipes.ts            # Crafting recipes
│   │   ├── monsters.ts           # NPC monster templates
│   │   ├── items.ts              # Item definitions
│   │   ├── evolution.ts          # Monster evolution thresholds
│   │   └── world-gen.ts          # World generation params (tree density, gold veins, etc.)
│   │
│   └── shared/
│       ├── constants.ts          # TICK_RATE, WORLD_SIZE, CHUNK_SIZE, VISION_RADIUS, etc.
│       └── utils.ts              # Distance calc, ID generation, etc.
│
├── cli/
│   ├── index.ts                  # CLI entry: `vibe-paradox connect --server <url>`
│   ├── client.ts                 # WebSocket client wrapper
│   ├── auth.ts                   # Auth + role selection flow
│   └── agent-interface.ts        # Action sending + state receiving interface
│
├── db/
│   └── migrations/
│       ├── 001_world.sql
│       ├── 002_agents.sql
│       ├── 003_resources.sql
│       ├── 004_monsters.sql
│       ├── 005_economy.sql
│       ├── 006_messages.sql
│       └── 007_alliances.sql
│
└── tests/
    ├── tick-loop.test.ts
    ├── validator.test.ts
    ├── combat.test.ts
    ├── movement.test.ts
    └── economy.test.ts
```

---

## 3. TYPE SYSTEM — CORE CONTRACTS

These are the typed boundaries. Every module communicates through these interfaces. No `any`, no `Record<string, unknown>` crossing module boundaries.

### 3.1 Core Primitives

```typescript
// types/core.ts

export type EntityId = string;        // Format: "agent_xxx", "monster_xxx", "resource_xxx"
export type Tick = number;            // Monotonically increasing integer
export type ChunkKey = string;        // Format: "cx_cy" e.g. "5_12"

export interface Position {
  x: number;  // 0-999
  y: number;  // 0-999
}

export function distance(a: Position, b: Position): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

export function chunkOf(pos: Position, chunkSize: number): ChunkKey {
  const cx = Math.floor(pos.x / chunkSize);
  const cy = Math.floor(pos.y / chunkSize);
  return `${cx}_${cy}`;
}
```

### 3.2 Agent Types

```typescript
// types/agent.ts

export type AgentRole = 'merchant' | 'fighter' | 'monster';

export type AgentStatus = 
  | 'idle'
  | 'moving'           // in-transit between positions
  | 'gathering'        // mining/cutting (takes multiple ticks)
  | 'crafting'         // crafting an item
  | 'fighting'         // in combat
  | 'dead'             // waiting for respawn (merchants/fighters) or permadead (monsters)
  | 'climbing'         // on a behemoth mining ores
  | 'trading';         // in a trade negotiation

export interface CombatStats {
  health: number;
  maxHealth: number;
  attack: number;
  defense: number;
  speed: number;         // units per tick movement speed
  visionRadius: number;  // fog of war radius
}

export interface Agent {
  id: EntityId;
  name: string;
  role: AgentRole;
  position: Position;
  destination: Position | null;   // if moving, where they're heading
  status: AgentStatus;
  stats: CombatStats;
  gold: number;
  inventory: InventoryItem[];
  equipment: Equipment;
  alliance: string | null;
  
  // Monster-specific
  kills: number;               // for evolution tracking
  monsterEats: number;         // for evolution tracking
  evolutionStage: number;      // 1-4
  
  // Timing
  actionCooldown: Tick;        // tick when next action is available
  respawnTick: Tick | null;    // tick when agent respawns (null if alive)
  connectedAt: Tick;
  lastActionTick: Tick;
}

export interface InventoryItem {
  id: string;           // item definition ID from data/items.ts
  quantity: number;
  metadata?: Record<string, any>;  // e.g. durability for tools
}

export interface Equipment {
  weapon: string | null;     // item ID
  armor: string | null;      // item ID
  tool: string | null;       // item ID
}

// What the agent sees about themselves (full state)
export interface AgentSelfView {
  id: EntityId;
  name: string;
  role: AgentRole;
  position: Position;
  status: AgentStatus;
  health: number;
  maxHealth: number;
  attack: number;
  defense: number;
  speed: number;
  gold: number;
  inventory: InventoryItem[];
  equipment: Equipment;
  alliance: string | null;
  kills: number;
  evolutionStage: number;
  actionCooldown: number;    // ticks remaining
}

// What other agents see about this agent (limited info)
export interface AgentPublicView {
  id: EntityId;
  name: string;
  role: AgentRole;
  position: Position;
  status: AgentStatus;
  health: number;
  maxHealth: number;
  alliance: string | null;
  evolutionStage: number;    // only for monsters
}
```

### 3.3 Action Types

```typescript
// types/action.ts

export type ActionType = 
  | 'move'
  | 'gather'
  | 'craft'
  | 'attack'
  | 'talk'
  | 'inspect'
  | 'trade'
  | 'plant'
  | 'water'
  | 'feed'
  | 'climb'
  | 'form_alliance'
  | 'join_alliance'
  | 'idle';              // explicit "do nothing" (agents can send this)

// What comes in from the WebSocket
export interface RawAction {
  action: ActionType;
  params: Record<string, any>;
  tick: Tick;            // client's last known tick (for staleness check)
}

// After parsing + type narrowing
export interface AgentAction {
  agentId: EntityId;
  action: ActionType;
  params: ActionParams;  // union type, narrowed by action
  receivedTick: Tick;
  serverTick: Tick;      // tick when server processes it
}

// Discriminated union for action params
export type ActionParams =
  | { type: 'move'; x: number; y: number }
  | { type: 'gather'; targetId: EntityId }
  | { type: 'craft'; recipeId: string }
  | { type: 'attack'; targetId: EntityId }
  | { type: 'talk'; mode: 'whisper' | 'local' | 'broadcast'; message: string; targetId?: EntityId }
  | { type: 'inspect'; targetId: EntityId }
  | { type: 'trade'; targetAgentId: EntityId; offer: TradeItem[]; request: TradeItem[] }
  | { type: 'plant'; seedId: string; x: number; y: number }
  | { type: 'water'; x: number; y: number }
  | { type: 'feed'; behemothId: EntityId; itemId: string }
  | { type: 'climb'; behemothId: EntityId }
  | { type: 'form_alliance'; name: string }
  | { type: 'join_alliance'; name: string }
  | { type: 'idle' };

export interface TradeItem {
  itemId: string;
  quantity: number;
}

// Output of validator
export interface ValidatedAction {
  agentId: EntityId;
  action: ActionType;
  params: ActionParams;
  valid: true;
}

export interface RejectedAction {
  agentId: EntityId;
  action: ActionType;
  reason: string;        // human-readable rejection reason sent back to agent
}
```

### 3.4 Tick Types

```typescript
// types/tick.ts

export interface TickInput {
  tick: Tick;
  actions: AgentAction[];     // all queued actions for this tick
  worldState: WorldState;     // current state reference
}

export interface TickResult {
  tick: Tick;
  executed: ValidatedAction[];
  rejected: RejectedAction[];
  events: WorldEvent[];          // combat results, deaths, resource changes, evolution
  stateChanges: StateChange[];   // granular mutations for persistence
  spawns: SpawnEvent[];          // new NPC monsters, tree growth completions
}

export type WorldEvent =
  | { type: 'combat_hit'; attackerId: EntityId; targetId: EntityId; damage: number; targetHealthAfter: number }
  | { type: 'death'; entityId: EntityId; killedBy: EntityId | null; droppedGold: number; droppedItems: string[] }
  | { type: 'respawn'; agentId: EntityId; position: Position }
  | { type: 'evolution'; monsterId: EntityId; fromStage: number; toStage: number }
  | { type: 'resource_depleted'; resourceId: EntityId; position: Position }
  | { type: 'resource_gathered'; agentId: EntityId; resourceId: EntityId; item: string; quantity: number }
  | { type: 'tree_planted'; agentId: EntityId; position: Position }
  | { type: 'tree_grown'; position: Position }
  | { type: 'behemoth_knockout'; behemothId: EntityId; attackers: EntityId[] }
  | { type: 'behemoth_wake'; behemothId: EntityId; thrownOff: EntityId[] }
  | { type: 'trade_complete'; buyer: EntityId; seller: EntityId; offered: TradeItem[]; received: TradeItem[] }
  | { type: 'craft_complete'; agentId: EntityId; recipeId: string; item: string }
  | { type: 'alliance_formed'; name: string; founder: EntityId }
  | { type: 'alliance_joined'; name: string; agentId: EntityId }
  | { type: 'npc_spawn'; monsterId: EntityId; position: Position; template: string }
  | { type: 'monster_eat'; eaterId: EntityId; eatenId: EntityId; statsGained: Partial<CombatStats> };

export interface StateChange {
  entityId: EntityId;
  field: string;
  oldValue: any;
  newValue: any;
}

export interface SpawnEvent {
  entityType: 'npc_monster' | 'tree';
  entityId: EntityId;
  position: Position;
  template?: string;
}
```

### 3.5 Protocol Types (WebSocket JSON)

```typescript
// types/protocol.ts

// === Client → Server ===

export type ClientMessage =
  | { type: 'auth'; name: string; token?: string }
  | { type: 'select_role'; role: AgentRole }
  | { type: 'action'; action: ActionType; params: Record<string, any>; tick: Tick }
  | { type: 'ping' };

// === Server → Client ===

export type ServerMessage =
  | { type: 'auth_success'; agentId: EntityId }
  | { type: 'auth_error'; reason: string }
  | { type: 'role_prompt'; availableRoles: AgentRole[] }
  | { type: 'role_confirmed'; role: AgentRole; agentId: EntityId; spawnPosition: Position }
  | { type: 'tick_update'; data: TickUpdateData }
  | { type: 'action_rejected'; action: ActionType; reason: string }
  | { type: 'event'; event: WorldEvent }
  | { type: 'pong'; serverTick: Tick };

export interface TickUpdateData {
  tick: Tick;
  self: AgentSelfView;
  nearby: {
    agents: AgentPublicView[];
    resources: ResourceView[];
    monsters: MonsterView[];
    behemoths: BehemothView[];
    structures: StructureView[];
  };
  messages: ChatMessageView[];
  events: WorldEvent[];           // events relevant to this agent this tick
}

export interface ResourceView {
  id: EntityId;
  type: 'tree' | 'gold_vein' | 'sapling';
  position: Position;
  remaining: number;     // percentage or absolute units
  state: string;         // 'available' | 'being_gathered' | 'depleted' | 'growing'
}

export interface MonsterView {
  id: EntityId;
  position: Position;
  type: string;          // template name
  health: number;
  maxHealth: number;
  evolutionStage: number;
  isNpc: boolean;
  status: string;
}

export interface BehemothView {
  id: EntityId;
  position: Position;
  type: string;           // determines ore type
  status: 'roaming' | 'unconscious' | 'waking';
  oreAvailable: boolean;
  health: number;
  maxHealth: number;
  unconsciousTicksRemaining: number;
}

export interface StructureView {
  id: EntityId;
  type: string;
  position: Position;
  owner: EntityId;
  alliance: string | null;
}

export interface ChatMessageView {
  id: string;
  mode: 'whisper' | 'local' | 'broadcast';
  senderId: EntityId;
  senderName: string;
  content: string;
  tick: Tick;
}
```

---

## 4. SQLITE SCHEMA

All persistence in a single `vibe-paradox.db` file. The in-memory `WorldState` is the source of truth during runtime. SQLite is for crash recovery and cold start.

```sql
-- 001_world.sql

CREATE TABLE IF NOT EXISTS world_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL  -- tick number
);
-- Stores: current_tick, world_seed, created_at, last_snapshot_tick

CREATE TABLE IF NOT EXISTS chunks (
  key TEXT PRIMARY KEY,         -- "cx_cy"
  data TEXT NOT NULL,           -- JSON blob of chunk state
  updated_at INTEGER NOT NULL
);
```

```sql
-- 002_agents.sql

CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('merchant', 'fighter', 'monster')),
  position_x REAL NOT NULL DEFAULT 500,
  position_y REAL NOT NULL DEFAULT 500,
  destination_x REAL,
  destination_y REAL,
  status TEXT NOT NULL DEFAULT 'idle',
  health REAL NOT NULL,
  max_health REAL NOT NULL,
  attack REAL NOT NULL,
  defense REAL NOT NULL,
  speed REAL NOT NULL,
  vision_radius REAL NOT NULL,
  gold REAL NOT NULL DEFAULT 0,
  inventory TEXT NOT NULL DEFAULT '[]',  -- JSON array
  equipment TEXT NOT NULL DEFAULT '{}',  -- JSON object
  alliance TEXT,
  kills INTEGER NOT NULL DEFAULT 0,
  monster_eats INTEGER NOT NULL DEFAULT 0,
  evolution_stage INTEGER NOT NULL DEFAULT 1,
  action_cooldown INTEGER NOT NULL DEFAULT 0,
  respawn_tick INTEGER,
  connected_at INTEGER NOT NULL,
  last_action_tick INTEGER NOT NULL DEFAULT 0,
  is_alive INTEGER NOT NULL DEFAULT 1,
  is_connected INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_agents_position ON agents(position_x, position_y);
CREATE INDEX idx_agents_alliance ON agents(alliance);
CREATE INDEX idx_agents_role ON agents(role);
```

```sql
-- 003_resources.sql

CREATE TABLE IF NOT EXISTS resources (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK(type IN ('tree', 'gold_vein', 'sapling')),
  position_x REAL NOT NULL,
  position_y REAL NOT NULL,
  remaining REAL NOT NULL,      -- units available
  max_capacity REAL NOT NULL,
  state TEXT NOT NULL DEFAULT 'available',
  growth_start_tick INTEGER,    -- for saplings
  growth_complete_tick INTEGER,  -- when sapling becomes tree
  created_at INTEGER NOT NULL   -- tick
);

CREATE INDEX idx_resources_position ON resources(position_x, position_y);
CREATE INDEX idx_resources_type ON resources(type);
```

```sql
-- 004_monsters.sql

CREATE TABLE IF NOT EXISTS npc_monsters (
  id TEXT PRIMARY KEY,
  template TEXT NOT NULL,
  position_x REAL NOT NULL,
  position_y REAL NOT NULL,
  health REAL NOT NULL,
  max_health REAL NOT NULL,
  attack REAL NOT NULL,
  defense REAL NOT NULL,
  speed REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'roaming',
  patrol_origin_x REAL,
  patrol_origin_y REAL,
  patrol_radius REAL NOT NULL DEFAULT 50,
  target_id TEXT,               -- current chase target
  gold_drop REAL NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS behemoths (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,            -- determines ore type (iron, copper, mithril, etc.)
  position_x REAL NOT NULL,
  position_y REAL NOT NULL,
  health REAL NOT NULL,
  max_health REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'roaming',  -- roaming, unconscious, waking
  ore_amount REAL NOT NULL DEFAULT 0,
  ore_max REAL NOT NULL,
  fed_amount REAL NOT NULL DEFAULT 0,  -- food received, triggers ore growth
  unconscious_until_tick INTEGER,
  route TEXT NOT NULL DEFAULT '[]'      -- JSON array of waypoints
);

CREATE INDEX idx_npc_monsters_position ON npc_monsters(position_x, position_y);
CREATE INDEX idx_behemoths_position ON behemoths(position_x, position_y);
```

```sql
-- 005_economy.sql

CREATE TABLE IF NOT EXISTS trades (
  id TEXT PRIMARY KEY,
  tick INTEGER NOT NULL,
  buyer_id TEXT NOT NULL,
  seller_id TEXT NOT NULL,
  offered TEXT NOT NULL,       -- JSON
  received TEXT NOT NULL,      -- JSON
  status TEXT NOT NULL DEFAULT 'pending',  -- pending, accepted, rejected, expired
  created_at INTEGER NOT NULL,
  resolved_at INTEGER
);

CREATE TABLE IF NOT EXISTS crafting_queue (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  recipe_id TEXT NOT NULL,
  start_tick INTEGER NOT NULL,
  complete_tick INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'in_progress'
);
```

```sql
-- 006_messages.sql

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  tick INTEGER NOT NULL,
  sender_id TEXT NOT NULL,
  mode TEXT NOT NULL CHECK(mode IN ('whisper', 'local', 'broadcast')),
  content TEXT NOT NULL,
  target_id TEXT,              -- for whisper
  position_x REAL,             -- sender position at time of message
  position_y REAL,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_messages_tick ON messages(tick);
```

```sql
-- 007_alliances.sql

CREATE TABLE IF NOT EXISTS alliances (
  name TEXT PRIMARY KEY,
  founder_id TEXT NOT NULL,
  created_at INTEGER NOT NULL  -- tick
);

CREATE TABLE IF NOT EXISTS alliance_members (
  alliance_name TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  joined_at INTEGER NOT NULL,  -- tick
  PRIMARY KEY (alliance_name, agent_id)
);
```

---

## 5. WORLD SYSTEM

### 5.1 Grid & Chunks

- World is 1000×1000 units (floating point positions)
- Divided into 32×32 unit chunks → ~31×31 chunk grid (32 chunks per axis, with partial edge chunks)
- Chunks are the spatial indexing unit: "which entities are near me?" = "which chunks overlap my vision radius?"

```typescript
// server/chunk-manager.ts

export class ChunkManager {
  private chunks: Map<ChunkKey, Set<EntityId>> = new Map();
  
  // Add entity to chunk tracking
  addEntity(id: EntityId, pos: Position): void;
  
  // Move entity between chunks (if chunk changed)
  moveEntity(id: EntityId, oldPos: Position, newPos: Position): void;
  
  // Remove entity from chunk tracking
  removeEntity(id: EntityId, pos: Position): void;
  
  // Get all entity IDs within radius of a position
  getEntitiesInRadius(center: Position, radius: number): EntityId[];
  
  // Get all chunks that overlap a circle
  private getChunksInRadius(center: Position, radius: number): ChunkKey[];
}
```

### 5.2 World State (In-Memory)

```typescript
// server/world.ts

export class WorldState {
  tick: Tick = 0;
  seed: number;
  
  agents: Map<EntityId, Agent> = new Map();
  resources: Map<EntityId, Resource> = new Map();
  npcMonsters: Map<EntityId, NpcMonster> = new Map();
  behemoths: Map<EntityId, Behemoth> = new Map();
  structures: Map<EntityId, Structure> = new Map();
  alliances: Map<string, Alliance> = new Map();
  
  chunkManager: ChunkManager;
  
  // Pending trades (not yet accepted/rejected)
  pendingTrades: Map<string, Trade> = new Map();
  
  // Crafting in progress
  craftingQueue: Map<string, CraftingJob> = new Map();
  
  // Messages this tick (cleared each tick after broadcast)
  tickMessages: ChatMessage[] = [];
  
  // Events this tick (cleared each tick after broadcast)
  tickEvents: WorldEvent[] = [];
}
```

### 5.3 World Generation

On first boot, `seed.ts` generates the initial world:

| Element | Distribution | Quantity |
|---------|-------------|----------|
| Trees | Clustered in "forest" biomes (noise-based) | ~2000 initial trees |
| Gold veins | In "dangerous zones" (edges + center) | ~50 veins |
| Behemoths | Fixed spawn zones, 1 per zone | 5 behemoths, each a different ore type |
| NPC monsters | Dense near gold veins, sparse elsewhere | ~100 initial NPCs |
| Spawn point | Center of map (500, 500) | 1 base/safe zone |

**Biome zones** (simple noise threshold, not complex terrain):
- **Safe zone**: 100-unit radius around spawn (500,500). No monsters spawn here.
- **Forest zones**: Scattered across map. Dense trees. Low monster density.
- **Dangerous zones**: Map edges and specific corridors. Gold veins + high monster density.
- **Behemoth territories**: 5 fixed regions where behemoths roam.

---

## 6. TICK LOOP — THE HEARTBEAT

This is the core game loop. Like ALIVE's `heartbeat.py` but running at 1-second intervals with N actors.

```typescript
// server/tick-loop.ts

export class TickLoop {
  private world: WorldState;
  private actionQueue: ActionQueue;
  private validator: ActionValidator;
  private executor: ActionExecutor;
  private broadcaster: StateBroadcaster;
  private db: Database;
  
  private tickInterval: NodeJS.Timeout | null = null;
  private readonly TICK_RATE_MS = 1000;
  
  start(): void {
    this.tickInterval = setInterval(() => this.processTick(), this.TICK_RATE_MS);
  }
  
  stop(): void {
    if (this.tickInterval) clearInterval(this.tickInterval);
  }
  
  private processTick(): void {
    const tick = ++this.world.tick;
    const startTime = performance.now();
    
    // 1. Drain all queued actions
    const rawActions = this.actionQueue.drainAll();
    
    // 2. Validate each action against current world state
    const { validated, rejected } = this.validator.validateBatch(rawActions, this.world);
    
    // 3. Execute validated actions (mutates world state)
    const executionResult = this.executor.executeBatch(validated, this.world, tick);
    
    // 4. Process continuous effects (movement progress, gathering progress, combat ticks, growth)
    this.executor.processContinuous(this.world, tick);
    
    // 5. Process NPC monster AI
    this.monsterProcessor.tick(this.world, tick);
    
    // 6. Process resource regeneration / growth
    this.resourceProcessor.tick(this.world, tick);
    
    // 7. Process behemoth lifecycle
    this.behemothProcessor.tick(this.world, tick);
    
    // 8. Check respawns
    this.executor.processRespawns(this.world, tick);
    
    // 9. NPC spawner (balance check)
    this.monsterProcessor.spawnCheck(this.world, tick);
    
    // 10. Build tick result
    const tickResult: TickResult = {
      tick,
      executed: validated,
      rejected,
      events: this.world.tickEvents,
      stateChanges: executionResult.stateChanges,
      spawns: executionResult.spawns,
    };
    
    // 11. Broadcast personalized state to each connected agent
    this.broadcaster.broadcastTick(this.world, tickResult);
    
    // 12. Persist (every tick for critical changes, snapshot every 60 ticks)
    this.db.persistTickChanges(tickResult);
    if (tick % 60 === 0) {
      this.db.snapshotWorld(this.world);
    }
    
    // 13. Clear tick-scoped data
    this.world.tickMessages = [];
    this.world.tickEvents = [];
    
    // 14. Log tick performance
    const elapsed = performance.now() - startTime;
    if (elapsed > 500) {
      console.warn(`Tick ${tick} took ${elapsed.toFixed(1)}ms — danger zone`);
    }
  }
}
```

**Critical constraint**: The tick must complete in under 1000ms. If it doesn't, we're falling behind. With up to 200 agents, this means each step must be efficient. No async I/O in the tick loop (better-sqlite3 is synchronous, which is why we use it).

---

## 7. ACTION PIPELINE — PROPOSE → VALIDATE → EXECUTE

### 7.1 Action Queue

```typescript
// pipeline/action-queue.ts

export class ActionQueue {
  private queues: Map<EntityId, AgentAction[]> = new Map();
  
  // Called by WebSocket handler when agent sends action
  enqueue(agentId: EntityId, raw: RawAction, serverTick: Tick): void {
    const parsed = this.parseAction(agentId, raw, serverTick);
    if (!parsed) return; // malformed, silently drop
    
    const queue = this.queues.get(agentId) || [];
    // Only keep latest action per agent per tick (last-write-wins)
    // Agents get 1 action per tick
    this.queues.set(agentId, [parsed]);
  }
  
  // Called by tick loop — returns all queued actions and clears
  drainAll(): AgentAction[] {
    const all: AgentAction[] = [];
    for (const [, actions] of this.queues) {
      all.push(...actions);
    }
    this.queues.clear();
    return all;
  }
}
```

**1 action per agent per tick.** If an agent sends multiple actions between ticks, only the last one is kept. This prevents action spam and simplifies validation.

### 7.2 Validator

The validator is the equivalent of ALIVE's `validator.py`. It enforces world rules. The server is law.

```typescript
// pipeline/validator.ts

export class ActionValidator {
  
  validateBatch(actions: AgentAction[], world: WorldState): {
    validated: ValidatedAction[];
    rejected: RejectedAction[];
  } {
    const validated: ValidatedAction[] = [];
    const rejected: RejectedAction[] = [];
    
    for (const action of actions) {
      const result = this.validateSingle(action, world);
      if (result.valid) {
        validated.push(result as ValidatedAction);
      } else {
        rejected.push(result as RejectedAction);
      }
    }
    
    return { validated, rejected };
  }
  
  private validateSingle(action: AgentAction, world: WorldState): ValidatedAction | RejectedAction {
    const agent = world.agents.get(action.agentId);
    if (!agent) return this.reject(action, 'Agent not found');
    if (!agent.is_alive) return this.reject(action, 'Agent is dead');
    if (agent.status === 'dead') return this.reject(action, 'Agent is dead');
    if (world.tick < agent.actionCooldown) return this.reject(action, 'On cooldown');
    
    switch (action.params.type) {
      case 'move':     return this.validateMove(action, agent, world);
      case 'gather':   return this.validateGather(action, agent, world);
      case 'attack':   return this.validateAttack(action, agent, world);
      case 'craft':    return this.validateCraft(action, agent, world);
      case 'talk':     return this.validateTalk(action, agent, world);
      case 'trade':    return this.validateTrade(action, agent, world);
      case 'plant':    return this.validatePlant(action, agent, world);
      case 'water':    return this.validateWater(action, agent, world);
      case 'feed':     return this.validateFeed(action, agent, world);
      case 'climb':    return this.validateClimb(action, agent, world);
      case 'idle':     return this.approve(action);
      default:         return this.reject(action, 'Unknown action type');
    }
  }
  
  // === Role restrictions (THE CORE RULES) ===
  
  private validateGather(action: AgentAction, agent: Agent, world: WorldState): ValidatedAction | RejectedAction {
    if (agent.role === 'monster') return this.reject(action, 'Monsters cannot gather');
    
    const target = world.resources.get(action.params.targetId);
    if (!target) return this.reject(action, 'Resource not found');
    if (distance(agent.position, target.position) > GATHER_RANGE) return this.reject(action, 'Too far');
    if (target.state !== 'available') return this.reject(action, 'Resource unavailable');
    
    // Fighters can only mine gold
    if (agent.role === 'fighter' && target.type !== 'gold_vein') {
      return this.reject(action, 'Fighters can only mine gold');
    }
    // Merchants can gather trees but NOT gold
    if (agent.role === 'merchant' && target.type === 'gold_vein') {
      return this.reject(action, 'Merchants cannot mine gold');
    }
    
    return this.approve(action);
  }
  
  private validateAttack(action: AgentAction, agent: Agent, world: WorldState): ValidatedAction | RejectedAction {
    if (agent.role === 'merchant') return this.reject(action, 'Merchants cannot attack');
    
    // Find target (could be agent, NPC monster, or behemoth)
    const targetAgent = world.agents.get(action.params.targetId);
    const targetNpc = world.npcMonsters.get(action.params.targetId);
    const targetBehemoth = world.behemoths.get(action.params.targetId);
    
    const target = targetAgent || targetNpc || targetBehemoth;
    if (!target) return this.reject(action, 'Target not found');
    
    const targetPos = 'position' in target ? target.position : { x: target.position_x, y: target.position_y };
    if (distance(agent.position, targetPos) > ATTACK_RANGE) return this.reject(action, 'Too far');
    
    // Fighters can't attack other fighters (humans don't fight humans)
    if (agent.role === 'fighter' && targetAgent?.role === 'fighter') {
      return this.reject(action, 'Fighters cannot attack other fighters');
    }
    
    // Fighters can't attack merchants
    if (agent.role === 'fighter' && targetAgent?.role === 'merchant') {
      return this.reject(action, 'Fighters cannot attack merchants');
    }
    
    // Monster can attack any human (merchant or fighter)
    // Fighter can attack monsters (NPC or player) and behemoths
    
    return this.approve(action);
  }
  
  private validateCraft(action: AgentAction, agent: Agent, world: WorldState): ValidatedAction | RejectedAction {
    if (agent.role !== 'merchant') return this.reject(action, 'Only merchants can craft');
    // ... check recipe exists, check ingredients in inventory
    return this.approve(action);
  }
  
  private validatePlant(action: AgentAction, agent: Agent, world: WorldState): ValidatedAction | RejectedAction {
    if (agent.role !== 'merchant') return this.reject(action, 'Only merchants can plant');
    // ... check seed in inventory, check position is valid
    return this.approve(action);
  }
  
  private validateClimb(action: AgentAction, agent: Agent, world: WorldState): ValidatedAction | RejectedAction {
    if (agent.role !== 'merchant') return this.reject(action, 'Only merchants can climb behemoths');
    const behemoth = world.behemoths.get(action.params.behemothId);
    if (!behemoth) return this.reject(action, 'Behemoth not found');
    if (behemoth.status !== 'unconscious') return this.reject(action, 'Behemoth is not unconscious');
    if (distance(agent.position, behemoth.position) > CLIMB_RANGE) return this.reject(action, 'Too far');
    return this.approve(action);
  }
}
```

### 7.3 Executor

Mutates world state based on validated actions. No validation here — that's already done.

```typescript
// pipeline/executor.ts

export class ActionExecutor {
  
  executeBatch(actions: ValidatedAction[], world: WorldState, tick: Tick): ExecutionResult {
    const stateChanges: StateChange[] = [];
    const spawns: SpawnEvent[] = [];
    
    for (const action of actions) {
      const result = this.executeSingle(action, world, tick);
      stateChanges.push(...result.changes);
      spawns.push(...result.spawns);
    }
    
    return { stateChanges, spawns };
  }
  
  // Process continuous effects each tick (even without new actions)
  processContinuous(world: WorldState, tick: Tick): void {
    // Movement: advance all moving agents toward destination
    for (const [, agent] of world.agents) {
      if (agent.status === 'moving' && agent.destination) {
        this.advanceMovement(agent, tick);
      }
    }
    
    // Gathering: progress multi-tick gathering
    for (const [, agent] of world.agents) {
      if (agent.status === 'gathering') {
        this.advanceGathering(agent, world, tick);
      }
    }
    
    // Combat: ongoing combat resolution
    this.resolveCombat(world, tick);
    
    // Crafting: progress crafting queue
    this.advanceCrafting(world, tick);
    
    // Sapling growth
    this.advanceGrowth(world, tick);
  }
  
  processRespawns(world: WorldState, tick: Tick): void {
    for (const [, agent] of world.agents) {
      if (agent.respawnTick && tick >= agent.respawnTick) {
        this.respawnAgent(agent, world, tick);
      }
    }
  }
}
```

---

## 8. WEBSOCKET SERVER & PROTOCOL

```typescript
// server/ws-server.ts

import { WebSocketServer, WebSocket } from 'ws';

interface ConnectedAgent {
  ws: WebSocket;
  agentId: EntityId | null;    // null until authenticated
  state: 'connecting' | 'selecting_role' | 'playing';
}

export class GameWebSocketServer {
  private wss: WebSocketServer;
  private connections: Map<WebSocket, ConnectedAgent> = new Map();
  private agentConnections: Map<EntityId, WebSocket> = new Map();  // reverse lookup
  
  constructor(private port: number, private world: WorldState, private actionQueue: ActionQueue) {
    this.wss = new WebSocketServer({ port });
    this.wss.on('connection', (ws) => this.handleConnection(ws));
  }
  
  private handleConnection(ws: WebSocket): void {
    const conn: ConnectedAgent = { ws, agentId: null, state: 'connecting' };
    this.connections.set(ws, conn);
    
    ws.on('message', (data) => this.handleMessage(ws, conn, data));
    ws.on('close', () => this.handleDisconnect(ws, conn));
    
    // Send auth prompt
    this.send(ws, { type: 'auth_prompt' });
  }
  
  private handleMessage(ws: WebSocket, conn: ConnectedAgent, data: any): void {
    const msg: ClientMessage = JSON.parse(data.toString());
    
    switch (conn.state) {
      case 'connecting':
        if (msg.type === 'auth') this.handleAuth(ws, conn, msg);
        break;
      case 'selecting_role':
        if (msg.type === 'select_role') this.handleRoleSelection(ws, conn, msg);
        break;
      case 'playing':
        if (msg.type === 'action') this.handleAction(ws, conn, msg);
        if (msg.type === 'ping') this.send(ws, { type: 'pong', serverTick: this.world.tick });
        break;
    }
  }
  
  // Called by broadcaster each tick
  sendToAgent(agentId: EntityId, message: ServerMessage): void {
    const ws = this.agentConnections.get(agentId);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }
  
  broadcastToAll(message: ServerMessage): void {
    for (const [ws] of this.connections) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message));
      }
    }
  }
}
```

---

## 9. AGENT CONNECTION & AUTH FLOW

```
Client connects via WebSocket
    │
    ▼
Server sends: { type: 'auth_prompt' }
    │
    ▼
Client sends: { type: 'auth', name: 'AgentSmith' }
    │
    ▼
Server checks: name unique? ──No──► { type: 'auth_error', reason: 'Name taken' }
    │ Yes
    ▼
Server sends: { type: 'role_prompt', availableRoles: ['merchant', 'fighter', 'monster'] }
    │
    ▼
Client sends: { type: 'select_role', role: 'fighter' }
    │
    ▼
Server creates Agent entity at spawn point
Server sends: { type: 'role_confirmed', role: 'fighter', agentId: 'agent_xxx', spawnPosition: {x:500, y:500} }
    │
    ▼
Agent enters playing state
Server begins sending tick_update messages every tick
```

**Role selection is permanent.** Once chosen, the agent keeps this role for the entire session. If the agent disconnects and reconnects with the same name, they resume with their existing role and state.

**Reconnection**: Agent sends `auth` with same name → server finds existing agent → skips role selection → resumes playing state. Inventory, position, health all preserved.

---

## 10. MOVEMENT SYSTEM

Movement is NOT instant. It's tick-based with speed determining travel time.

```typescript
// When agent sends move(x, y):

const dist = distance(agent.position, {x, y});
const ticksNeeded = Math.ceil(dist / agent.stats.speed);

agent.destination = {x, y};
agent.status = 'moving';

// Each tick in processContinuous():
const step = agent.stats.speed;  // units per tick
const remaining = distance(agent.position, agent.destination);

if (remaining <= step) {
  // Arrived
  agent.position = agent.destination;
  agent.destination = null;
  agent.status = 'idle';
} else {
  // Move toward destination
  const dx = agent.destination.x - agent.position.x;
  const dy = agent.destination.y - agent.position.y;
  const norm = Math.sqrt(dx*dx + dy*dy);
  agent.position.x += (dx / norm) * step;
  agent.position.y += (dy / norm) * step;
}
```

**While moving, agents are vulnerable.** They can be attacked. They can cancel movement by sending a new action.

### Base Movement Speeds

| Role | Speed (units/tick) | Cross-map time (1000 units) |
|------|-------------------|---------------------------|
| Merchant | 3 | ~333 ticks (~5.5 min) |
| Fighter | 4 | ~250 ticks (~4.2 min) |
| Monster (Stage 1) | 5 | ~200 ticks (~3.3 min) |
| Monster (Stage 4) | 8 | ~125 ticks (~2.1 min) |

---

## 11. RESOURCE SYSTEM

### Trees

| Property | Value |
|----------|-------|
| Logs per tree | 5-10 (seeded random per tree) |
| Gather rate | 1 log per 3 ticks |
| Seed drop chance | 30% per tree cut |
| Sapling → Tree growth | 300 ticks (~5 min) |
| Watering effect | -50 ticks per water action (speeds growth) |
| Gather range | 5 units |

### Gold Veins

| Property | Value |
|----------|-------|
| Gold per vein | 100-500 (seeded random) |
| Gather rate | 5 gold per 2 ticks |
| Regeneration | None — when depleted, gone forever |
| Gather range | 5 units |

### Gold from Monster Kills

| Monster Type | Gold Drop |
|-------------|-----------|
| NPC (weak) | 5-15 |
| NPC (medium) | 15-40 |
| NPC (strong) | 40-100 |
| Player monster (Stage 1) | 50 |
| Player monster (Stage 2) | 100 |
| Player monster (Stage 3) | 250 |
| Player monster (Stage 4) | 500 |

---

## 12. COMBAT SYSTEM

### Stats by Role

| Role | HP | ATK | DEF | Speed | Vision |
|------|-----|-----|-----|-------|--------|
| Merchant | 50 | 0 | 5 | 3 | 80 |
| Fighter | 100 | 15 | 10 | 4 | 100 |
| Monster (S1) | 80 | 12 | 8 | 5 | 150 |
| Monster (S2) | 120 | 18 | 12 | 5 | 150 |
| Monster (S3) | 200 | 24 | 16 | 6 | 200 |
| Monster (S4) | 400 | 36 | 24 | 8 | 250 |

### Damage Formula

```
damage = max(1, attacker.attack - defender.defense)
```

Equipment modifiers are additive:

```
effective_attack = base_attack + weapon_bonus
effective_defense = base_defense + armor_bonus
```

### Combat Flow (Per Tick)

```typescript
// combat-resolver.ts

// Find all active combat pairs this tick
// A combat pair is created when an agent attacks a target
// It persists until one dies, one flees (moves out of range), or combat is cancelled

for (const pair of activeCombatPairs) {
  const attacker = world.agents.get(pair.attackerId) || world.npcMonsters.get(pair.attackerId);
  const defender = world.agents.get(pair.targetId) || world.npcMonsters.get(pair.targetId);
  
  // Check range — if out of range, combat ends
  if (distance(attacker.position, defender.position) > ATTACK_RANGE) {
    pair.end();
    continue;
  }
  
  // Attacker hits defender
  const dmg = Math.max(1, attacker.stats.attack - defender.stats.defense);
  defender.stats.health -= dmg;
  
  world.tickEvents.push({
    type: 'combat_hit',
    attackerId: pair.attackerId,
    targetId: pair.targetId,
    damage: dmg,
    targetHealthAfter: defender.stats.health
  });
  
  // Check death
  if (defender.stats.health <= 0) {
    this.handleDeath(defender, attacker, world, tick);
  }
  
  // If defender can fight back (fighter or monster, NOT merchant)
  if (canAttack(defender)) {
    const counterDmg = Math.max(1, defender.stats.attack - attacker.stats.defense);
    attacker.stats.health -= counterDmg;
    // ... emit event, check death
  }
}
```

### Attack Range

| Scenario | Range |
|----------|-------|
| Melee attack | 5 units |
| Ranged weapon (crafted) | 15 units |

### Death

```typescript
function handleDeath(dead: Agent | NpcMonster, killer: Agent | null, world: WorldState, tick: Tick): void {
  if (isNpcMonster(dead)) {
    // NPC: drop gold, remove from world
    const goldDrop = dead.goldDrop;
    if (killer) killer.gold += goldDrop;
    world.npcMonsters.delete(dead.id);
    
  } else if (dead.role === 'monster') {
    // Player monster: PERMADEATH
    dead.status = 'dead';
    dead.is_alive = false;
    // No respawn. Connection stays open but agent can't act.
    // Agent sees: "You have died permanently. Your story ends here."
    
  } else {
    // Merchant or Fighter: respawn at base
    const lossPercent = 0.20;  // lose 20% of carried items/gold
    dead.gold = Math.floor(dead.gold * (1 - lossPercent));
    dead.inventory = dropRandomItems(dead.inventory, lossPercent);
    dead.status = 'dead';
    dead.respawnTick = tick + RESPAWN_TICKS;  // 30 ticks = 30 seconds
    dead.position = { x: 500, y: 500 };  // spawn point
  }
  
  // If killer is a monster, track kills for evolution
  if (killer?.role === 'monster') {
    killer.kills++;
    checkEvolution(killer, world, tick);
  }
}
```

---

## 13. MONSTER SYSTEM

### Player Monsters

Player-controlled monsters are the chaos agents. They:
- **Cannot** gather, craft, trade, or use the economy
- **Can** attack any human agent (merchant or fighter)
- **Can** eat NPC monsters and other player monsters (absorb stats)
- **Evolve** through kills and eats
- **Permadeath** — one life, high stakes

### Monster Eating

```typescript
// When a monster kills another monster (player or NPC):
function monsterEat(eater: Agent, eaten: Agent | NpcMonster): void {
  const statGain = {
    health: Math.floor(eaten.stats.maxHealth * 0.1),
    attack: Math.floor(eaten.stats.attack * 0.1),
    defense: Math.floor(eaten.stats.defense * 0.1),
  };
  
  eater.stats.maxHealth += statGain.health;
  eater.stats.health += statGain.health;  // heal on eat
  eater.stats.attack += statGain.attack;
  eater.stats.defense += statGain.defense;
  eater.monsterEats++;
  
  checkEvolution(eater, world, tick);
}
```

### Evolution Thresholds

| Stage | Kill Req | OR Eat Req | ATK Mult | HP Mult | Special |
|-------|---------|-----------|----------|---------|---------|
| 1 → 2 | 5 kills | 3 eats | ×1.5 | ×1.25 | — |
| 2 → 3 | 15 kills | 10 eats | ×2.0 | ×1.5 | New ability (TBD) |
| 3 → 4 | 30 kills | 20 eats | ×3.0 | ×2.0 | Raid boss tier |

Stage 4 triggers a global broadcast: `"A Legendary Monster has awakened: [name]"`

---

## 14. ECONOMY & TRADING

### Trade Flow

```
Agent A sends: { action: 'trade', targetAgentId: 'B', offer: [{itemId: 'iron_sword', qty: 1}], request: [{itemId: 'gold', qty: 50}] }
    │
    ▼
Server validates: both agents in range (10 units), both have items
    │
    ▼
Trade enters pending state. Agent B receives trade proposal in next tick_update.
    │
    ▼
Agent B sends: { action: 'trade_respond', tradeId: 'xxx', accept: true }
    │
    ▼
Server executes swap. Both agents notified.
```

**Trades expire after 30 ticks** if not accepted/rejected. Both agents must remain in range.

### Trade Range: 10 units

---

## 15. CHAT SYSTEM

### Message Routing

```typescript
// chat-processor.ts

function processChat(msg: ChatMessage, world: WorldState): void {
  switch (msg.mode) {
    case 'whisper':
      // Only sender + target receive it
      // Works at any distance
      world.tickMessages.push({ ...msg, recipients: [msg.senderId, msg.targetId] });
      break;
      
    case 'local':
      // All agents within 100 units of sender's position
      const nearby = world.chunkManager.getEntitiesInRadius(
        world.agents.get(msg.senderId)!.position, 
        LOCAL_CHAT_RADIUS  // 100
      );
      world.tickMessages.push({ ...msg, recipients: nearby });
      break;
      
    case 'broadcast':
      // Everyone
      world.tickMessages.push({ ...msg, recipients: 'all' });
      break;
  }
}
```

**Key gameplay implication**: Monsters can see local chat if they're within 100 units. Agents must use whisper for truly private communication.

---

## 16. BEHEMOTH SYSTEM

This is the core cooperation mechanic.

### Behemoth Lifecycle

```
[ROAMING] ──feed──► ore grows on back ──► [ORE READY]
                                               │
                                    fighters attack (lots of HP)
                                               │
                                               ▼
                                        [UNCONSCIOUS]
                                         (lasts 60 ticks)
                                               │
                            merchants climb + mine ores
                                               │
                                    ┌──────────┴──────────┐
                                    ▼                     ▼
                            timer expires         merchants dismount
                                    │                     │
                                    ▼                     ▼
                              [WAKING UP]           safe with ores
                                    │
                          throws off any
                          miners still on
                          (50% HP damage)
                                    │
                                    ▼
                              [ROAMING]
                             (ore reset)
```

### Behemoth Stats

| Property | Value |
|----------|-------|
| HP | 500 |
| ATK | 30 (hits back while being attacked) |
| DEF | 20 |
| Unconscious duration | 60 ticks (1 minute) |
| Ore per knockout | 5-15 units (based on feed amount) |
| Feed threshold for ore growth | 10 food items |
| Ore growth time after feeding | 120 ticks (2 min) |

### Behemoth Types (5 total)

| Type | Ore | Zone |
|------|-----|------|
| Iron Behemoth | Iron ore | Northwest quadrant |
| Copper Behemoth | Copper ore | Northeast quadrant |
| Silver Behemoth | Silver ore | Southeast quadrant |
| Mithril Behemoth | Mithril ore | Southwest quadrant |
| Obsidian Behemoth | Obsidian ore | Center (near dangerous zone) |

---

## 17. CRAFTING SYSTEM

Merchants only. Multi-tick process.

### Recipes

```typescript
// data/recipes.ts

export const RECIPES: CraftRecipe[] = [
  // Weapons (sold to fighters)
  { id: 'iron_sword', name: 'Iron Sword', ingredients: [{ itemId: 'iron_ore', qty: 3 }, { itemId: 'log', qty: 1 }], craftTicks: 10, output: { itemId: 'iron_sword', qty: 1 }, stats: { attack: 5 } },
  { id: 'iron_armor', name: 'Iron Armor', ingredients: [{ itemId: 'iron_ore', qty: 5 }], craftTicks: 15, output: { itemId: 'iron_armor', qty: 1 }, stats: { defense: 5 } },
  { id: 'copper_sword', name: 'Copper Sword', ingredients: [{ itemId: 'copper_ore', qty: 3 }, { itemId: 'log', qty: 1 }], craftTicks: 10, output: { itemId: 'copper_sword', qty: 1 }, stats: { attack: 3 } },
  { id: 'silver_blade', name: 'Silver Blade', ingredients: [{ itemId: 'silver_ore', qty: 5 }, { itemId: 'log', qty: 2 }], craftTicks: 20, output: { itemId: 'silver_blade', qty: 1 }, stats: { attack: 10 } },
  { id: 'mithril_sword', name: 'Mithril Sword', ingredients: [{ itemId: 'mithril_ore', qty: 5 }, { itemId: 'log', qty: 2 }], craftTicks: 30, output: { itemId: 'mithril_sword', qty: 1 }, stats: { attack: 15 } },
  { id: 'obsidian_blade', name: 'Obsidian Blade', ingredients: [{ itemId: 'obsidian_ore', qty: 8 }, { itemId: 'log', qty: 3 }], craftTicks: 40, output: { itemId: 'obsidian_blade', qty: 1 }, stats: { attack: 25 } },
  
  // Tools (improve gathering)
  { id: 'iron_axe', name: 'Iron Axe', ingredients: [{ itemId: 'iron_ore', qty: 2 }, { itemId: 'log', qty: 2 }], craftTicks: 8, output: { itemId: 'iron_axe', qty: 1 }, stats: { gatherSpeedBonus: 1.5 } },
  { id: 'iron_pickaxe', name: 'Iron Pickaxe', ingredients: [{ itemId: 'iron_ore', qty: 3 }, { itemId: 'log', qty: 1 }], craftTicks: 8, output: { itemId: 'iron_pickaxe', qty: 1 }, stats: { mineSpeedBonus: 1.5 } },
  
  // Healing
  { id: 'healing_salve', name: 'Healing Salve', ingredients: [{ itemId: 'log', qty: 2 }], craftTicks: 5, output: { itemId: 'healing_salve', qty: 3 }, stats: { healAmount: 25 } },
  
  // Seeds (renewable forestry)
  { id: 'seed_bundle', name: 'Seed Bundle', ingredients: [{ itemId: 'log', qty: 5 }], craftTicks: 5, output: { itemId: 'tree_seed', qty: 3 } },
  
  // Building materials
  { id: 'wooden_wall', name: 'Wooden Wall', ingredients: [{ itemId: 'log', qty: 10 }], craftTicks: 20, output: { itemId: 'wooden_wall', qty: 1 } },
  { id: 'stone_wall', name: 'Stone Wall', ingredients: [{ itemId: 'iron_ore', qty: 5 }, { itemId: 'log', qty: 5 }], craftTicks: 30, output: { itemId: 'stone_wall', qty: 1 } },
];
```

---

## 18. ALLIANCE SYSTEM

Lightweight. Agents self-organize; the system just provides primitives.

```typescript
// Alliance is just a named group
interface Alliance {
  name: string;
  founder: EntityId;
  members: Set<EntityId>;
  createdAt: Tick;
}

// Actions:
// form_alliance <name>  — creates alliance, founder auto-joins
// join_alliance <name>  — request to join (auto-accepted for now; governance is emergent)
// leave_alliance        — leave current alliance

// Alliance provides:
// - Shared name tag visible to all agents
// - Alliance chat channel (via talk broadcast with alliance prefix convention — emergent, not built-in)
// - Future: shared storage, territory markers
```

---

## 19. NPC AI

Simple behavior scripts. No LLM. These are dumb mobs.

```typescript
// monster-processor.ts

enum NpcBehavior {
  PATROL,    // walk random path within patrol_radius of spawn
  CHASE,     // pursue a target (human agent within aggro range)
  ATTACK,    // in combat with target
  FLEE,      // low health, run away (optional for weak NPCs)
  IDLE       // standing still
}

function npcTick(monster: NpcMonster, world: WorldState, tick: Tick): void {
  switch (monster.behavior) {
    case NpcBehavior.PATROL:
      // Random walk within patrol radius
      // If human agent enters aggro range (30 units), switch to CHASE
      break;
      
    case NpcBehavior.CHASE:
      // Move toward target at monster speed
      // If target enters attack range, switch to ATTACK
      // If target leaves chase range (60 units), return to PATROL
      break;
      
    case NpcBehavior.ATTACK:
      // Combat resolver handles damage
      // If target dies or flees, return to PATROL
      break;
  }
}
```

### NPC Spawn Balancing

```typescript
// Every 60 ticks, check population
function spawnCheck(world: WorldState, tick: Tick): void {
  const humanCount = countHumans(world);
  const npcCount = world.npcMonsters.size;
  
  const targetRatio = 1.5;  // 1.5 NPCs per human
  const targetCount = Math.floor(humanCount * targetRatio);
  
  if (npcCount < targetCount) {
    const toSpawn = Math.min(3, targetCount - npcCount);  // max 3 per check
    for (let i = 0; i < toSpawn; i++) {
      spawnNpcInDangerousZone(world, tick);
    }
  }
}
```

---

## 20. STATE BROADCASTER & FOG OF WAR

Every tick, each connected agent receives a personalized view of the world, filtered by their vision radius.

```typescript
// server/broadcaster.ts

export class StateBroadcaster {
  
  broadcastTick(world: WorldState, tickResult: TickResult, wsServer: GameWebSocketServer): void {
    for (const [agentId, agent] of world.agents) {
      if (!agent.is_connected) continue;
      
      // Build personalized view
      const update: TickUpdateData = {
        tick: world.tick,
        self: this.buildSelfView(agent),
        nearby: this.buildNearbyView(agent, world),
        messages: this.filterMessages(agent, world.tickMessages),
        events: this.filterEvents(agent, tickResult.events),
      };
      
      wsServer.sendToAgent(agentId, { type: 'tick_update', data: update });
      
      // Also send rejections for this agent
      for (const rejected of tickResult.rejected) {
        if (rejected.agentId === agentId) {
          wsServer.sendToAgent(agentId, { 
            type: 'action_rejected', 
            action: rejected.action, 
            reason: rejected.reason 
          });
        }
      }
    }
  }
  
  private buildNearbyView(agent: Agent, world: WorldState): NearbyEntities {
    const radius = agent.stats.visionRadius;
    const entityIds = world.chunkManager.getEntitiesInRadius(agent.position, radius);
    
    return {
      agents: entityIds
        .filter(id => id !== agent.id && world.agents.has(id))
        .map(id => this.toPublicView(world.agents.get(id)!)),
      resources: this.getResourcesInRadius(agent.position, radius, world),
      monsters: this.getMonstersInRadius(agent.position, radius, world),
      behemoths: this.getBehemothsInRadius(agent.position, radius, world),
      structures: this.getStructuresInRadius(agent.position, radius, world),
    };
  }
  
  private filterMessages(agent: Agent, messages: ChatMessage[]): ChatMessageView[] {
    return messages.filter(msg => {
      if (msg.recipients === 'all') return true;
      return msg.recipients.includes(agent.id);
    }).map(msg => ({
      id: msg.id,
      mode: msg.mode,
      senderId: msg.senderId,
      senderName: msg.senderName,
      content: msg.content,
      tick: msg.tick,
    }));
  }
}
```

---

## 21. CLI CLIENT

```typescript
// cli/index.ts

#!/usr/bin/env node
import { Command } from 'commander';

const program = new Command();

program
  .name('vibe-paradox')
  .description('Connect an AI agent to the Vibe Paradox world')
  .version('0.1.0');

program
  .command('connect')
  .requiredOption('--server <url>', 'Server WebSocket URL')
  .requiredOption('--agent-name <name>', 'Agent display name')
  .option('--role <role>', 'Pre-select role (merchant/fighter/monster)')
  .action(async (opts) => {
    const client = new GameClient(opts.server, opts.agentName, opts.role);
    await client.connect();
  });

program.parse();
```

The CLI is a thin WebSocket wrapper. It:
1. Connects to server
2. Authenticates with agent name
3. Selects role (or uses pre-selected)
4. Enters a read-eval loop:
   - **Reads**: JSON state updates from server each tick → outputs to stdout
   - **Writes**: JSON action commands from stdin → sends to server

This lets any LLM agent wrapper pipe stdin/stdout to control an agent. The CLI doesn't decide what to do — the AI connected to it does.

```
[LLM Agent] ──stdin/stdout──► [CLI Client] ──WebSocket──► [Game Server]
```

---

## 22. BUILD ORDER & TASK SPECS

These are Claude Code tasks. Each task has a clear scope, input files, output files, and test criteria. **No task touches more than 3-4 files.**

### Phase 1: Foundation

```
TASK-001: Project Scaffold
  Create: package.json, tsconfig.json, tsup.config.ts, directory structure
  Install: ws, better-sqlite3, commander, tsx (dev)
  Test: `npx tsx src/server/index.ts` starts without error
  Files: package.json, tsconfig.json, src/server/index.ts (stub)

TASK-002: Type System
  Create: ALL files in src/types/
  No logic — just interfaces, types, enums, and utility functions (distance, chunkOf)
  Test: `npx tsc --noEmit` passes
  Files: src/types/*.ts, src/shared/constants.ts, src/shared/utils.ts

TASK-003: SQLite Layer
  Create: src/server/db.ts, db/migrations/*.sql
  Functions: initDb(), runMigrations(), saveAgent(), loadAgent(), saveResource(), 
             loadResources(), snapshotWorld(), loadWorldSnapshot()
  Test: Create DB, run migrations, insert/read agent
  Files: src/server/db.ts, db/migrations/*.sql

TASK-004: World State + Chunk Manager
  Create: src/server/world.ts, src/server/chunk-manager.ts
  In-memory world state with entity maps + spatial indexing
  Test: Add entities, query by radius, verify chunk assignment
  Files: src/server/world.ts, src/server/chunk-manager.ts

TASK-005: World Generation (Seed)
  Create: src/server/seed.ts, src/server/rng.ts, src/data/world-gen.ts
  Generate initial trees, gold veins, behemoths, NPC monsters from seed
  Test: Seed world, verify entity counts and distribution
  Files: src/server/seed.ts, src/server/rng.ts, src/data/world-gen.ts

TASK-006: Action Queue + Validator
  Create: src/pipeline/action-queue.ts, src/pipeline/validator.ts
  All validation rules from Section 7
  Test: Validate legal/illegal actions for each role
  Files: src/pipeline/action-queue.ts, src/pipeline/validator.ts

TASK-007: Executor (Core)
  Create: src/pipeline/executor.ts
  Execute: move, gather, idle, attack (basic), talk
  processContinuous: movement advancement, gathering progress
  Test: Execute move → verify position changes over ticks
  Files: src/pipeline/executor.ts

TASK-008: Tick Loop
  Create: src/server/tick-loop.ts
  Wire: actionQueue → validator → executor → continuous processing
  Test: Start loop, inject actions, verify state mutations
  Files: src/server/tick-loop.ts
```

### Phase 2: Connectivity

```
TASK-009: WebSocket Server
  Create: src/server/ws-server.ts
  Auth flow, role selection, action ingestion, connection management
  Test: Connect via wscat, authenticate, send action, receive response
  Files: src/server/ws-server.ts

TASK-010: State Broadcaster
  Create: src/server/broadcaster.ts
  Per-agent fog-of-war filtered state computation + broadcast
  Test: Two agents at different positions see different nearby entities
  Files: src/server/broadcaster.ts

TASK-011: Server Entry Point
  Create: src/server/index.ts (full)
  Wire everything: DB init → world load/seed → tick loop → WS server
  Test: `npx tsx src/server/index.ts` boots, accepts connections, ticks
  Files: src/server/index.ts

TASK-012: CLI Client
  Create: cli/index.ts, cli/client.ts, cli/auth.ts, cli/agent-interface.ts
  Test: `npx tsx cli/index.ts connect --server ws://localhost:8080 --agent-name Test --role fighter`
  Files: cli/*.ts
```

### Phase 3: Game Systems

```
TASK-013: Combat System
  Create: src/pipeline/combat-resolver.ts
  Combat pairing, damage calculation, death handling, respawn scheduling
  Test: Fighter attacks NPC, verify damage, verify death + gold drop
  Files: src/pipeline/combat-resolver.ts, update executor.ts

TASK-014: Resource Processor
  Create: src/pipeline/resource-processor.ts
  Tree cutting, sapling growth, watering, gold vein depletion
  Test: Merchant gathers tree → logs in inventory → tree depleted → seed chance
  Files: src/pipeline/resource-processor.ts

TASK-015: Chat Processor
  Create: src/pipeline/chat-processor.ts
  Whisper/local/broadcast routing with range checks
  Test: Local chat only reaches agents within 100 units
  Files: src/pipeline/chat-processor.ts

TASK-016: Monster Processor (NPC AI + Evolution)
  Create: src/pipeline/monster-processor.ts
  NPC patrol/chase/attack behavior + spawn balancing + player monster evolution
  Test: NPC chases human entering aggro range; monster evolves at kill threshold
  Files: src/pipeline/monster-processor.ts, src/data/monsters.ts, src/data/evolution.ts

TASK-017: Behemoth Processor
  Create: src/pipeline/behemoth-processor.ts
  Feed → ore growth → knockout → climb/mine → wake cycle
  Test: Full behemoth lifecycle from feed to ore extraction
  Files: src/pipeline/behemoth-processor.ts

TASK-018: Economy (Trading + Crafting)
  Create: src/pipeline/economy-processor.ts
  Trade proposals, acceptance, item swap. Crafting queue processing.
  Test: Merchant crafts sword from ore+log; fighter trades gold for sword
  Files: src/pipeline/economy-processor.ts, src/data/recipes.ts, src/data/items.ts

TASK-019: Alliance System
  Create: alliance logic in executor
  Form, join, leave. Alliance tag on agent views.
  Test: Agent forms alliance, another joins, both show alliance tag
  Files: Update executor.ts and validator.ts
```

### Phase 4: Polish

```
TASK-020: Admin Dashboard (basic)
  Simple HTML page served by game server showing:
  - Current tick, connected agents, world population
  - Agent list with positions, roles, health
  - Resource counts
  Served on separate HTTP port (8081)

TASK-021: CLI npm package prep
  Package cli/ as installable npm package
  `npm install -g vibe-paradox` → `vibe-paradox connect --server <url>`
```

---

## CONSTANTS REFERENCE

```typescript
// src/shared/constants.ts

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

export const TREE_GATHER_TICKS = 3;          // ticks per log
export const GOLD_GATHER_TICKS = 2;          // ticks per 5 gold
export const SEED_DROP_CHANCE = 0.30;
export const SAPLING_GROWTH_TICKS = 300;
export const WATER_SPEED_BONUS = 50;         // ticks removed per water action

export const BEHEMOTH_UNCONSCIOUS_TICKS = 60;
export const BEHEMOTH_FEED_THRESHOLD = 10;
export const BEHEMOTH_ORE_GROWTH_TICKS = 120;
export const BEHEMOTH_THROW_DAMAGE_PERCENT = 0.50;

export const NPC_AGGRO_RANGE = 30;
export const NPC_CHASE_RANGE = 60;
export const NPC_SPAWN_RATIO = 1.5;          // NPCs per human
export const NPC_SPAWN_CHECK_INTERVAL = 60;  // ticks between spawn checks
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
};

export const BASE_STATS = {
  merchant: { health: 50, attack: 0, defense: 5, speed: 3 },
  fighter: { health: 100, attack: 15, defense: 10, speed: 4 },
  monster: { health: 80, attack: 12, defense: 8, speed: 5 },
};

export const EVOLUTION_THRESHOLDS = [
  { stage: 2, kills: 5, eats: 3, attackMult: 1.5, healthMult: 1.25 },
  { stage: 3, kills: 15, eats: 10, attackMult: 2.0, healthMult: 1.5 },
  { stage: 4, kills: 30, eats: 20, attackMult: 3.0, healthMult: 2.0 },
];
```

---

## CLAUDE.md (FOR AGENTS)

```markdown
# Vibe Paradox — Claude Code Agent Instructions

## Architecture
Read ARCHITECTURE.md before starting any task. It is the source of truth.

## Rules
1. Every function that crosses a module boundary MUST use types from src/types/
2. No `any` type. No `Record<string, unknown>` crossing boundaries.
3. Server tick loop is SYNCHRONOUS. No async in the hot path. better-sqlite3 is sync.
4. 1 action per agent per tick. Last-write-wins in action queue.
5. All validation in validator.ts. Executor trusts its input.
6. All world mutations go through executor.ts. Nobody else mutates WorldState.
7. Tests use vitest. Every task must have passing tests.
8. No LLM calls in the server. Server is pure deterministic game logic.

## Task Protocol
1. Read the task spec in TASKS.md
2. Read relevant sections of ARCHITECTURE.md
3. Implement
4. Run `npx vitest run` — all tests must pass
5. Run `npx tsc --noEmit` — no type errors

## Don't
- Don't read this file again after first read
- Don't add features not in the task spec
- Don't refactor existing code unless the task says to
- Don't add dependencies without explicit approval
```
