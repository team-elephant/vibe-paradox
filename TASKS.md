# Vibe Paradox — Task Tracker

> Each task is a unit of work for one Claude Code agent session. Tasks have clear scope, file boundaries, dependencies, and test criteria. **Do not combine tasks. Do not add scope.**

## Status Key

- `[ ]` — Not started
- `[~]` — In progress
- `[x]` — Complete
- `[!]` — Blocked

---

## Phase 1: Foundation

### TASK-001: Project Scaffold `[x]`
**Depends on:** Nothing
**Parallel-safe with:** Nothing (must go first)

**Do:**
1. Initialize npm project with `package.json`:
   - name: `vibe-paradox`
   - type: `module`
   - Scripts: `dev`, `build`, `test`, `start`
2. Install dependencies:
   - Production: `ws`, `better-sqlite3`, `commander`
   - Dev: `typescript`, `tsx`, `tsup`, `vitest`, `@types/ws`, `@types/better-sqlite3`
3. Create `tsconfig.json` (strict mode, ES2022, NodeNext module resolution)
4. Create `tsup.config.ts` (entry: `src/server/index.ts` + `cli/index.ts`)
5. Create full directory structure from ARCHITECTURE.md Section 2
6. Create stub `src/server/index.ts` that logs "Vibe Paradox server starting..." and exits

**Files created:**
```
package.json
tsconfig.json
tsup.config.ts
src/server/index.ts (stub)
src/types/.gitkeep
src/pipeline/.gitkeep
src/data/.gitkeep
src/shared/.gitkeep
cli/.gitkeep
db/migrations/.gitkeep
tests/.gitkeep
```

**Test:** `npx tsx src/server/index.ts` prints message and exits cleanly. `npx tsc --noEmit` passes.

---

### TASK-002: Type System `[x]`
**Depends on:** TASK-001
**Parallel-safe with:** Nothing (everything depends on this)

**Do:**
1. Create ALL type files exactly as specified in ARCHITECTURE.md Section 3:
   - `src/types/core.ts` — Position, EntityId, Tick, ChunkKey, distance(), chunkOf()
   - `src/types/agent.ts` — AgentRole, AgentStatus, CombatStats, Agent, InventoryItem, Equipment, AgentSelfView, AgentPublicView
   - `src/types/action.ts` — ActionType, RawAction, AgentAction, ActionParams (discriminated union), ValidatedAction, RejectedAction, TradeItem
   - `src/types/world.ts` — WorldEvent type (full union from architecture), StateChange, SpawnEvent
   - `src/types/entity.ts` — Resource, NpcMonster, Behemoth, Structure, Alliance, Trade, CraftingJob
   - `src/types/combat.ts` — CombatPair, DamageResult
   - `src/types/economy.ts` — CraftRecipe, TradeOffer
   - `src/types/message.ts` — ChatMessage, MessageMode, ChatMessageView
   - `src/types/tick.ts` — TickInput, TickResult
   - `src/types/protocol.ts` — ClientMessage, ServerMessage, TickUpdateData, ResourceView, MonsterView, BehemothView, StructureView
   - `src/types/index.ts` — barrel export
2. Create `src/shared/constants.ts` — ALL constants from ARCHITECTURE.md Constants Reference
3. Create `src/shared/utils.ts` — ID generation (nanoid-style), timestamp helpers

**Files created:**
```
src/types/core.ts
src/types/agent.ts
src/types/action.ts
src/types/world.ts
src/types/entity.ts
src/types/combat.ts
src/types/economy.ts
src/types/message.ts
src/types/tick.ts
src/types/protocol.ts
src/types/index.ts
src/shared/constants.ts
src/shared/utils.ts
```

**Test:** `npx tsc --noEmit` passes with zero errors. No logic to test — pure type definitions.

---

### TASK-003: SQLite Layer `[x]`
**Depends on:** TASK-001, TASK-002
**Parallel-safe with:** TASK-004 (if 002 is done)

**Do:**
1. Create all migration SQL files from ARCHITECTURE.md Section 4:
   - `db/migrations/001_world.sql`
   - `db/migrations/002_agents.sql`
   - `db/migrations/003_resources.sql`
   - `db/migrations/004_monsters.sql`
   - `db/migrations/005_economy.sql`
   - `db/migrations/006_messages.sql`
   - `db/migrations/007_alliances.sql`
2. Create `src/server/db.ts` with class `Database`:
   - `constructor(dbPath: string)` — opens better-sqlite3 connection
   - `runMigrations()` — reads and executes all SQL files in order
   - `saveAgent(agent: Agent): void`
   - `loadAgent(id: EntityId): Agent | null`
   - `loadAllAgents(): Agent[]`
   - `saveResource(resource: Resource): void`
   - `loadAllResources(): Resource[]`
   - `saveNpcMonster(monster: NpcMonster): void`
   - `loadAllNpcMonsters(): NpcMonster[]`
   - `saveBehemoth(behemoth: Behemoth): void`
   - `loadAllBehemoths(): Behemoth[]`
   - `saveAlliance(alliance: Alliance): void`
   - `loadAllAlliances(): Alliance[]`
   - `saveTrade(trade: Trade): void`
   - `saveMessage(msg: ChatMessage): void`
   - `persistTickChanges(result: TickResult): void` — batch persist relevant changes
   - `snapshotWorld(world: WorldState): void` — full state dump
   - `loadWorldSnapshot(): WorldState | null` — restore from last snapshot
   - `getMetaValue(key: string): string | null`
   - `setMetaValue(key: string, value: string, tick: Tick): void`
   - `close(): void`
3. All methods are **synchronous** (better-sqlite3 is sync). Use prepared statements for hot-path operations.

**Files created:**
```
db/migrations/001_world.sql
db/migrations/002_agents.sql
db/migrations/003_resources.sql
db/migrations/004_monsters.sql
db/migrations/005_economy.sql
db/migrations/006_messages.sql
db/migrations/007_alliances.sql
src/server/db.ts
tests/db.test.ts
```

**Test:** 
- Init DB, run migrations, verify all tables exist
- Insert agent, read back, verify all fields match
- Insert resource, read back
- Snapshot world state, load it back, verify integrity

---

### TASK-004: World State + Chunk Manager `[x]`
**Depends on:** TASK-002
**Parallel-safe with:** TASK-003

**Do:**
1. Create `src/server/chunk-manager.ts` with class `ChunkManager`:
   - `addEntity(id: EntityId, pos: Position): void`
   - `moveEntity(id: EntityId, oldPos: Position, newPos: Position): void`
   - `removeEntity(id: EntityId, pos: Position): void`
   - `getEntitiesInRadius(center: Position, radius: number): EntityId[]`
   - Private: `getChunksInRadius(center: Position, radius: number): ChunkKey[]`
   - Uses CHUNK_SIZE from constants
2. Create `src/server/world.ts` with class `WorldState`:
   - All Maps from ARCHITECTURE.md Section 5.2
   - `chunkManager: ChunkManager` instance
   - `addAgent(agent: Agent): void` — adds to map + chunk manager
   - `removeAgent(id: EntityId): void`
   - `moveAgent(id: EntityId, newPos: Position): void` — updates position + chunk
   - Same add/remove/move for resources, npcMonsters, behemoths, structures
   - `getEntitiesNear(pos: Position, radius: number): { agents, resources, monsters, behemoths, structures }` — convenience method using chunk manager

**Files created:**
```
src/server/chunk-manager.ts
src/server/world.ts
tests/chunk-manager.test.ts
tests/world.test.ts
```

**Test:**
- ChunkManager: add 100 entities at random positions, query radius, verify only entities within radius returned
- ChunkManager: move entity across chunk boundary, verify old chunk doesn't contain it, new chunk does
- WorldState: add agents and resources, query getEntitiesNear, verify correct filtering

---

### TASK-005: World Generation (Seed) `[x]`
**Depends on:** TASK-002, TASK-004
**Parallel-safe with:** TASK-003, TASK-006

**Do:**
1. Create `src/server/rng.ts` — seeded PRNG (simple mulberry32 or similar). Must be deterministic given same seed.
   - `constructor(seed: number)`
   - `next(): number` — returns 0-1
   - `nextInt(min: number, max: number): number`
   - `nextFloat(min: number, max: number): number`
   - `chance(probability: number): boolean`
2. Create `src/data/world-gen.ts` — generation parameters:
   - Forest zone definitions (center positions, radii)
   - Dangerous zone definitions
   - Behemoth territory definitions (5 zones)
   - Tree density per forest zone
   - Gold vein placement rules
   - NPC monster templates and initial spawn counts
3. Create `src/server/seed.ts` with function `seedWorld(world: WorldState, seed: number): void`:
   - Generate ~2000 trees clustered in forest zones (using noise or clustered random)
   - Generate ~50 gold veins in dangerous zones
   - Generate 5 behemoths, one per territory
   - Generate ~100 NPC monsters, dense near gold, sparse elsewhere
   - Set spawn point (500, 500) with safe zone (100 unit radius, no monsters)
   - All generation uses seeded RNG — same seed = same world

**Files created:**
```
src/server/rng.ts
src/data/world-gen.ts
src/server/seed.ts
tests/seed.test.ts
tests/rng.test.ts
```

**Test:**
- RNG: same seed produces same sequence
- RNG: different seeds produce different sequences
- Seed: generate world, verify ~2000 trees, ~50 gold veins, 5 behemoths, ~100 NPCs
- Seed: no entities within safe zone radius of spawn
- Seed: same seed produces identical world

---

### TASK-006: Action Queue + Validator `[x]`
**Depends on:** TASK-002
**Parallel-safe with:** TASK-004, TASK-005

**Do:**
1. Create `src/pipeline/action-queue.ts` with class `ActionQueue`:
   - `enqueue(agentId: EntityId, raw: RawAction, serverTick: Tick): void` — parse + store
   - `drainAll(): AgentAction[]` — return all queued actions, clear queue
   - Private: `parseAction(agentId, raw, serverTick): AgentAction | null` — type-narrow params into ActionParams discriminated union
   - 1 action per agent per tick, last-write-wins
2. Create `src/pipeline/validator.ts` with class `ActionValidator`:
   - `validateBatch(actions: AgentAction[], world: WorldState): { validated: ValidatedAction[], rejected: RejectedAction[] }`
   - Private validation methods for EACH action type (see ARCHITECTURE.md Section 7.2):
     - `validateMove` — destination within world bounds
     - `validateGather` — role check (merchant: trees/ores, fighter: gold only, monster: rejected), range check, resource available
     - `validateAttack` — role check (merchant: rejected, fighter: can't attack fighters/merchants, monster: can attack any human), range check, target exists
     - `validateCraft` — merchant only, recipe exists, ingredients in inventory
     - `validateTalk` — message not empty, mode valid, whisper target exists
     - `validateTrade` — both agents in range, both have offered items
     - `validatePlant` — merchant only, seed in inventory, valid position
     - `validateWater` — merchant only, sapling at position
     - `validateFeed` — food item in inventory, behemoth in range
     - `validateClimb` — merchant only, behemoth unconscious, in range
     - `validateFormAlliance` — name not taken, agent not in alliance
     - `validateJoinAlliance` — alliance exists, agent not in alliance

**Files created:**
```
src/pipeline/action-queue.ts
src/pipeline/validator.ts
tests/action-queue.test.ts
tests/validator.test.ts
```

**Test:**
- ActionQueue: enqueue 3 actions for same agent, drain returns only last one
- ActionQueue: enqueue for 5 different agents, drain returns 5 actions
- ActionQueue: malformed action (missing params) returns null, not queued
- Validator: merchant gather tree → approved
- Validator: merchant gather gold → rejected "Merchants cannot mine gold"
- Validator: fighter attack fighter → rejected "Fighters cannot attack other fighters"
- Validator: monster attack merchant → approved
- Validator: merchant attack anything → rejected "Merchants cannot attack"
- Validator: monster gather → rejected "Monsters cannot gather"
- Validator: fighter craft → rejected "Only merchants can craft"
- Validator: agent on cooldown → rejected "On cooldown"
- Validator: target out of range → rejected "Too far"

---

### TASK-007: Executor (Core) `[x]`
**Depends on:** TASK-002, TASK-004, TASK-006
**Parallel-safe with:** TASK-003, TASK-005

**Do:**
1. Create `src/pipeline/executor.ts` with class `ActionExecutor`:
   - `executeBatch(actions: ValidatedAction[], world: WorldState, tick: Tick): ExecutionResult`
   - `processContinuous(world: WorldState, tick: Tick): void`
   - `processRespawns(world: WorldState, tick: Tick): void`
   - Private execution methods:
     - `executeMove(action, agent, world)` — set destination + status='moving'
     - `executeGather(action, agent, world)` — set status='gathering', start gather timer
     - `executeIdle(action, agent)` — no-op
     - `executeTalk(action, agent, world)` — create ChatMessage, add to world.tickMessages
     - `executeAttack(action, agent, world)` — create CombatPair, set status='fighting'
   - processContinuous:
     - `advanceMovement(agent)` — move toward destination by speed units per tick, arrive if close enough
     - `advanceGathering(agent, world)` — decrement gather timer, on complete: add item to inventory, reduce resource
   - processRespawns:
     - Check all dead agents, if tick >= respawnTick, reset position to spawn, restore health, set status='idle'
2. Executor does NOT validate. It trusts input from validator.
3. Executor is the ONLY module that mutates WorldState.

**Files created:**
```
src/pipeline/executor.ts
tests/executor.test.ts
```

**Test:**
- Execute move: agent gets destination set, status='moving'
- processContinuous: moving agent advances toward destination each call
- processContinuous: agent arrives at destination, status='idle', destination=null
- Execute gather: agent status='gathering', after N ticks item appears in inventory
- processRespawns: dead agent respawns at (500,500) after respawnTick

---

### TASK-008: Tick Loop `[x]`
**Depends on:** TASK-003, TASK-004, TASK-006, TASK-007
**Parallel-safe with:** Nothing (this wires everything together)

**Do:**
1. Create `src/server/tick-loop.ts` with class `TickLoop`:
   - Constructor takes: world, actionQueue, validator, executor, db
   - `start(): void` — begins setInterval at TICK_RATE_MS
   - `stop(): void` — clears interval
   - `processTick(): void` — the full tick sequence from ARCHITECTURE.md Section 6:
     1. Increment tick
     2. Drain action queue
     3. Validate batch
     4. Execute batch
     5. Process continuous effects
     6. Process respawns
     7. Build TickResult
     8. Persist changes (snapshot every SNAPSHOT_INTERVAL_TICKS)
     9. Clear tick-scoped data (tickMessages, tickEvents)
     10. Log performance warning if tick > 500ms
   - NOTE: broadcaster NOT wired yet (TASK-010). Tick loop runs without broadcasting for now.
   - NOTE: monster processor, resource processor, behemoth processor NOT wired yet. Those are Phase 3. Tick loop has placeholder comments for them.

**Files created:**
```
src/server/tick-loop.ts
tests/tick-loop.test.ts
```

**Test:**
- Create world with 2 agents. Enqueue move actions. Run 10 ticks manually (call processTick directly, don't use setInterval for tests). Verify agents moved.
- Enqueue invalid action (merchant attack). Verify rejected in tick result.
- Verify tick counter increments correctly.
- Verify snapshot called every SNAPSHOT_INTERVAL_TICKS.

---

## Phase 2: Connectivity

### TASK-009: WebSocket Server `[ ]`
**Depends on:** TASK-002, TASK-004, TASK-006 (for ActionQueue type)
**Parallel-safe with:** TASK-010

**Do:**
1. Create `src/server/ws-server.ts` with class `GameWebSocketServer`:
   - Constructor: port, world reference, actionQueue reference
   - Connection handling: track ConnectedAgent state machine (connecting → selecting_role → playing)
   - Auth flow: validate unique name, create or resume agent
   - Role selection: create Agent entity with BASE_STATS, add to world
   - Action ingestion: parse ClientMessage, enqueue in actionQueue
   - Disconnect handling: mark agent as disconnected (don't remove from world)
   - `sendToAgent(agentId, message)` — send JSON to specific agent's WebSocket
   - `broadcastToAll(message)` — send to all connected agents
   - Reconnection: same name → find existing agent → skip role selection → resume
2. Use `ws` library directly. No Express, no HTTP framework.

**Files created:**
```
src/server/ws-server.ts
tests/ws-server.test.ts
```

**Test:**
- Start server, connect via WebSocket, send auth, receive auth_success
- Send role selection, receive role_confirmed with spawn position
- Send action, verify it appears in actionQueue
- Duplicate name → auth_error
- Disconnect + reconnect with same name → resumes existing agent

---

### TASK-010: State Broadcaster `[ ]`
**Depends on:** TASK-002, TASK-004, TASK-009
**Parallel-safe with:** TASK-009 (can start once types + world exist)

**Do:**
1. Create `src/server/broadcaster.ts` with class `StateBroadcaster`:
   - `broadcastTick(world: WorldState, tickResult: TickResult, wsServer: GameWebSocketServer): void`
   - For each connected agent:
     - Build `AgentSelfView` (full self state)
     - Build `NearbyEntities` filtered by vision radius using world.getEntitiesNear()
     - Filter messages (whisper: only if sender/recipient, local: only if in range, broadcast: always)
     - Filter events (only events involving entities within vision + events about self)
     - Build `TickUpdateData`
     - Send via wsServer.sendToAgent()
   - Send `action_rejected` messages for rejected actions

**Files created:**
```
src/server/broadcaster.ts
tests/broadcaster.test.ts
```

**Test:**
- Two agents at (100,100) and (900,900) with vision 100. Agent A should NOT see Agent B in nearby.
- Agent at (100,100), resource at (120,120) → resource appears in nearby.resources
- Local chat from (100,100) → agent at (150,150) receives it (within 100 range), agent at (300,300) does NOT
- Whisper to Agent B → only Agent B receives it

---

### TASK-011: Server Entry Point `[ ]`
**Depends on:** TASK-003, TASK-004, TASK-005, TASK-008, TASK-009, TASK-010
**Parallel-safe with:** Nothing

**Do:**
1. Create full `src/server/index.ts`:
   - Parse CLI args (port, db path, world seed) with defaults
   - Init Database, run migrations
   - Attempt to load world snapshot from DB
   - If no snapshot: create new WorldState, run seedWorld()
   - Wire: ActionQueue, Validator, Executor, TickLoop, Broadcaster, WebSocket server
   - Hook broadcaster into tick loop (add broadcast step after persist)
   - Start tick loop
   - Log: tick number, connected agents count, world stats
   - Graceful shutdown on SIGINT/SIGTERM: stop tick loop, final snapshot, close DB, close WS

**Files created:**
```
src/server/index.ts (full version)
```

**Test:** Manual integration test:
- `npx tsx src/server/index.ts` → server boots, logs world generation stats, starts ticking
- Connect via `wscat -c ws://localhost:8080` → receive auth_prompt
- Send `{"type":"auth","name":"TestBot"}` → receive role_prompt
- Send `{"type":"select_role","role":"fighter"}` → receive role_confirmed
- Receive tick_update messages every second
- Send `{"type":"action","action":"move","params":{"x":510,"y":510},"tick":0}` → agent position changes in next tick_update
- Ctrl+C → clean shutdown logged

---

### TASK-012: CLI Client `[ ]`
**Depends on:** TASK-002, TASK-009
**Parallel-safe with:** TASK-010, TASK-011

**Do:**
1. Create `cli/index.ts`:
   - Shebang: `#!/usr/bin/env node`
   - Commander setup: `vibe-paradox connect --server <url> --agent-name <name> [--role <role>]`
2. Create `cli/client.ts` with class `GameClient`:
   - `connect()` — establish WebSocket to server
   - Handle auth flow automatically
   - Handle role selection (from --role flag or prompt)
   - Once playing: pipe server messages to stdout as JSON (one per line)
   - Read stdin for action commands (JSON, one per line)
   - Parse stdin JSON → send as ClientMessage to server
   - Reconnect on disconnect with exponential backoff
3. Create `cli/auth.ts` — auth message construction
4. Create `cli/agent-interface.ts` — stdin/stdout JSON interface
   - stdout format: one JSON object per line (server messages)
   - stdin format: one JSON object per line (action commands)

**Files created:**
```
cli/index.ts
cli/client.ts
cli/auth.ts
cli/agent-interface.ts
```

**Test:** Manual:
- Start server (TASK-011)
- `npx tsx cli/index.ts connect --server ws://localhost:8080 --agent-name TestCLI --role fighter`
- See tick_update JSON lines on stdout
- Type `{"action":"move","params":{"x":510,"y":510},"tick":0}` on stdin
- See position update in next tick_update

---

## Phase 3: Game Systems

### TASK-013: Combat System `[ ]`
**Depends on:** TASK-007 (executor), TASK-004 (world)
**Parallel-safe with:** TASK-014, TASK-015

**Do:**
1. Create `src/pipeline/combat-resolver.ts` with class `CombatResolver`:
   - `resolveCombat(world: WorldState, tick: Tick): void`
   - Tracks active CombatPairs (created when attack action executes)
   - Each tick: for each active pair:
     - Check range — end combat if out of range
     - Calculate damage: `max(1, attacker.attack - defender.defense)`
     - Apply damage to defender
     - If defender can fight back (fighter/monster), apply counter damage
     - Emit combat_hit events
     - On death: call handleDeath()
   - `handleDeath(dead, killer, world, tick)`:
     - NPC monster: drop gold to killer, remove from world
     - Player monster: permadeath, status='dead', is_alive=false
     - Merchant/Fighter: lose 20% gold+inventory, set respawnTick, move to spawn
     - If killer is monster: increment kills, check evolution
   - Equipment stat modifiers: weapon adds to attack, armor adds to defense
2. Wire into executor.ts: `executeAttack` creates CombatPair
3. Wire into tick-loop.ts: call `combatResolver.resolveCombat()` in processContinuous

**Files touched:**
```
src/pipeline/combat-resolver.ts (NEW)
src/pipeline/executor.ts (UPDATE — executeAttack, wire combat)
src/server/tick-loop.ts (UPDATE — add combat step)
tests/combat.test.ts (NEW)
```

**Test:**
- Fighter (ATK 15) attacks NPC (DEF 8) → 7 damage per tick
- NPC (ATK 10) counter-attacks fighter (DEF 10) → 1 damage per tick (minimum)
- NPC dies → gold drops to fighter, NPC removed from world
- Fighter dies → respawns at (500,500) after RESPAWN_TICKS, loses 20% gold
- Monster kills fighter → monster.kills increments
- Monster permadeath → status='dead', no respawn
- Out of range → combat pair ends

---

### TASK-014: Resource Processor `[ ]`
**Depends on:** TASK-007 (executor), TASK-004 (world)
**Parallel-safe with:** TASK-013, TASK-015

**Do:**
1. Create `src/pipeline/resource-processor.ts` with class `ResourceProcessor`:
   - `tick(world: WorldState, tick: Tick): void`
   - Handles:
     - Gathering progress (trees: 1 log per TREE_GATHER_TICKS, gold: 5 per GOLD_GATHER_TICKS)
     - Tree depletion (remaining → 0, state='depleted', chance to drop seed)
     - Gold vein depletion
     - Sapling growth (tick counter, growth_complete_tick check)
     - Watering effect (subtract WATER_SPEED_BONUS from growth ticks remaining)
   - Emits events: resource_gathered, resource_depleted, tree_planted, tree_grown
2. Wire into executor.ts: `executeGather` starts gathering, `executePlant` creates sapling, `executeWater` waters sapling
3. Wire into tick-loop.ts: call `resourceProcessor.tick()` each tick

**Files touched:**
```
src/pipeline/resource-processor.ts (NEW)
src/pipeline/executor.ts (UPDATE — executePlant, executeWater)
src/server/tick-loop.ts (UPDATE — add resource step)
tests/resource.test.ts (NEW)
```

**Test:**
- Merchant gathers tree for TREE_GATHER_TICKS → 1 log in inventory
- Tree with remaining=1 gathered → depleted, SEED_DROP_CHANCE check
- Merchant plants seed → sapling at position, growth timer starts
- Sapling reaches growth_complete_tick → becomes tree with full logs
- Water sapling → growth_complete_tick decreases by WATER_SPEED_BONUS

---

### TASK-015: Chat Processor `[ ]`
**Depends on:** TASK-007 (executor), TASK-004 (world)
**Parallel-safe with:** TASK-013, TASK-014

**Do:**
1. Create `src/pipeline/chat-processor.ts` with class `ChatProcessor`:
   - `processMessage(msg: ChatMessage, world: WorldState): void`
   - Whisper: set recipients = [sender, target]
   - Local: query chunkManager for entities within LOCAL_CHAT_RADIUS of sender, set recipients = result
   - Broadcast: set recipients = 'all'
   - Add processed message to world.tickMessages
2. Wire into executor.ts: `executeTalk` calls chatProcessor

**Files touched:**
```
src/pipeline/chat-processor.ts (NEW)
src/pipeline/executor.ts (UPDATE — executeTalk)
tests/chat.test.ts (NEW)
```

**Test:**
- Whisper from A to B → only A and B in recipients
- Local chat from agent at (100,100) → agent at (150,150) in recipients, agent at (300,300) NOT
- Broadcast → recipients = 'all'
- Monster at (90,100) can "hear" local chat from human at (100,100)

---

### TASK-016: Monster Processor `[ ]`
**Depends on:** TASK-013 (combat), TASK-004 (world)
**Parallel-safe with:** TASK-017, TASK-018

**Do:**
1. Create `src/data/monsters.ts` — NPC templates:
   - weak_goblin: HP 30, ATK 5, DEF 3, SPD 3, gold_drop 5-15
   - medium_wolf: HP 60, ATK 10, DEF 5, SPD 4, gold_drop 15-40
   - strong_troll: HP 120, ATK 18, DEF 12, SPD 2, gold_drop 40-100
2. Create `src/data/evolution.ts` — evolution thresholds + stat multipliers from ARCHITECTURE.md
3. Create `src/pipeline/monster-processor.ts` with class `MonsterProcessor`:
   - `tick(world: WorldState, tick: Tick): void` — run NPC AI for each npc_monster
   - NPC behavior: PATROL → CHASE (human in aggro range) → ATTACK → back to PATROL
   - Patrol: random walk within patrol_radius
   - Chase: move toward target, switch to ATTACK if in range, abandon if out of CHASE_RANGE
   - `spawnCheck(world: WorldState, tick: Tick): void` — every NPC_SPAWN_CHECK_INTERVAL ticks, balance NPC count
   - `checkEvolution(monster: Agent, world: WorldState, tick: Tick): void` — check kill/eat thresholds, apply stage upgrade + stat multipliers
   - Monster eating: when monster kills another monster, call monsterEat (absorb 10% stats)
4. Wire into tick-loop.ts: call monsterProcessor.tick() and spawnCheck() each tick

**Files touched:**
```
src/data/monsters.ts (NEW)
src/data/evolution.ts (NEW)
src/pipeline/monster-processor.ts (NEW)
src/server/tick-loop.ts (UPDATE — add monster step)
tests/monster.test.ts (NEW)
```

**Test:**
- NPC patrols within radius, doesn't leave
- Human enters aggro range → NPC chases
- Human leaves chase range → NPC returns to patrol
- Monster at 5 kills → evolves to stage 2, ATK × 1.5
- Monster eats NPC → gains 10% of NPC stats
- SpawnCheck: 10 humans, 5 NPCs → spawns more (target: 15)

---

### TASK-017: Behemoth Processor `[ ]`
**Depends on:** TASK-013 (combat), TASK-007 (executor)
**Parallel-safe with:** TASK-016, TASK-018

**Do:**
1. Create `src/pipeline/behemoth-processor.ts` with class `BehemothProcessor`:
   - `tick(world: WorldState, tick: Tick): void`
   - Behemoth states: roaming, unconscious, waking
   - Roaming: follow route waypoints, can be fed, can be attacked
   - Feed tracking: increment fed_amount, when >= BEHEMOTH_FEED_THRESHOLD start ore growth timer
   - Ore growth: after BEHEMOTH_ORE_GROWTH_TICKS, ore_amount increases
   - Knockout: when health <= 0, set status='unconscious', set unconscious_until_tick
   - Unconscious: merchants can climb + mine ores (executeClimb in executor)
   - Wake: at unconscious_until_tick, set status='waking', throw off all climbing merchants (50% HP damage), reset ore, restore health
   - Behemoth is NOT killed — health resets on wake
2. Wire into executor.ts: executeFeed, executeClimb
3. Wire into tick-loop.ts: call behemothProcessor.tick() each tick

**Files touched:**
```
src/pipeline/behemoth-processor.ts (NEW)
src/pipeline/executor.ts (UPDATE — executeFeed, executeClimb)
src/server/tick-loop.ts (UPDATE — add behemoth step)
tests/behemoth.test.ts (NEW)
```

**Test:**
- Feed behemoth 10 food items → ore starts growing
- After BEHEMOTH_ORE_GROWTH_TICKS → ore available
- Fighter attacks behemoth to 0 HP → status='unconscious'
- Merchant climbs unconscious behemoth → can mine ores
- Unconscious timer expires → merchants thrown off, take 50% HP damage
- Behemoth health resets after waking

---

### TASK-018: Economy (Trading + Crafting) `[ ]`
**Depends on:** TASK-007 (executor), TASK-006 (validator)
**Parallel-safe with:** TASK-016, TASK-017

**Do:**
1. Create `src/data/recipes.ts` — all recipes from ARCHITECTURE.md Section 17
2. Create `src/data/items.ts` — item definitions (weapons, armor, tools, materials, healing items)
   - Each item: id, name, type, stats (attack/defense/gatherSpeed/healAmount), stackable boolean
3. Create `src/pipeline/economy-processor.ts` with class `EconomyProcessor`:
   - `processTrades(world: WorldState, tick: Tick): void`
     - Handle trade_respond actions (accept/reject pending trades)
     - Expire trades older than TRADE_EXPIRE_TICKS
     - On accept: swap items between agents, emit trade_complete event
   - `processCrafting(world: WorldState, tick: Tick): void`
     - Check crafting queue: if tick >= complete_tick, add crafted item to agent inventory
     - Emit craft_complete event
4. Wire into executor.ts: executeTrade (create pending trade), executeCraft (start crafting, check ingredients, add to queue)
5. Wire into validator.ts: add trade_respond action validation
6. Wire into tick-loop.ts: call economyProcessor.processTrades() and processCrafting() each tick

**Files touched:**
```
src/data/recipes.ts (NEW)
src/data/items.ts (NEW)
src/pipeline/economy-processor.ts (NEW)
src/pipeline/executor.ts (UPDATE — executeTrade, executeCraft)
src/pipeline/validator.ts (UPDATE — validateTradeRespond)
src/server/tick-loop.ts (UPDATE — add economy step)
tests/economy.test.ts (NEW)
```

**Test:**
- Merchant crafts iron_sword: 3 iron_ore + 1 log consumed, after 10 ticks iron_sword in inventory
- Merchant proposes trade to fighter: 1 iron_sword for 50 gold
- Fighter accepts → sword moves to fighter, gold moves to merchant
- Trade expires after 30 ticks if not accepted
- Crafting with insufficient materials → validator rejects

---

### TASK-019: Alliance System `[ ]`
**Depends on:** TASK-006 (validator), TASK-007 (executor)
**Parallel-safe with:** TASK-013 through TASK-018

**Do:**
1. Add alliance execution to executor.ts:
   - `executeFormAlliance` — create Alliance object, add founder as member
   - `executeJoinAlliance` — add agent to alliance members
   - `executeLeaveAlliance` — new action type, remove from alliance
2. Add `leave_alliance` to ActionType union and validator
3. Alliance data stored in world.alliances Map
4. Agent's alliance field set on join, cleared on leave
5. Alliance name visible in AgentPublicView

**Files touched:**
```
src/types/action.ts (UPDATE — add leave_alliance)
src/pipeline/validator.ts (UPDATE — validateLeaveAlliance)
src/pipeline/executor.ts (UPDATE — alliance execution)
tests/alliance.test.ts (NEW)
```

**Test:**
- Agent forms alliance "Wolves" → alliance created, agent is member
- Second agent joins "Wolves" → both agents show alliance="Wolves"
- Agent leaves → alliance field cleared
- Form alliance with taken name → rejected

---

## Phase 4: Polish

### TASK-020: Live Admin Dashboard — Real-Time World Viewer `[ ]`
**Depends on:** TASK-011
**Parallel-safe with:** Any Phase 3 task

**Overview:**
A god-mode web dashboard that shows everything happening in the game in real time. No fog of war. Dark terminal aesthetic. This is the demo — the thing you open in a browser while agents play and people say "holy shit."

Served as a single HTML file on HTTP port 8081. WebSocket connection for live state updates every tick.

**Architecture — Server-Side: Admin WebSocket Endpoint**

Create `src/server/admin.ts` with class `AdminServer`:
- HTTP server on port 8081 serving dashboard.html
- WebSocket server on same port (path: `/ws`) for admin state broadcasts
- Admin viewers get FULL world state every tick — no fog of war:
```json
{
  "type": "admin_tick",
  "tick": 48201,
  "agents": [
    {
      "id": "agent_xxx",
      "name": "Fighter_001",
      "role": "fighter",
      "position": { "x": 234, "y": 567 },
      "destination": { "x": 300, "y": 600 },
      "status": "moving",
      "health": 85,
      "maxHealth": 100,
      "attack": 20,
      "defense": 10,
      "speed": 4,
      "gold": 45,
      "inventory": [],
      "equipment": { "weapon": "iron_sword", "armor": null, "tool": null },
      "alliance": "Wolves",
      "kills": 2,
      "evolutionStage": 1,
      "isConnected": true
    }
  ],
  "npcMonsters": [
    {
      "id": "npc_xxx",
      "template": "medium_wolf",
      "position": { "x": 598, "y": 416 },
      "health": 40,
      "maxHealth": 60,
      "status": "chasing",
      "targetId": "agent_xxx"
    }
  ],
  "behemoths": [
    {
      "id": "beh_xxx",
      "type": "iron",
      "position": { "x": 200, "y": 800 },
      "health": 500,
      "maxHealth": 500,
      "status": "roaming",
      "oreAvailable": false,
      "unconsciousTicksRemaining": 0
    }
  ],
  "resourceCounts": {
    "trees": 1847,
    "goldVeins": 48,
    "saplings": 12
  },
  "resources": [
    { "id": "res_xxx", "type": "tree", "position": { "x": 94, "y": 503 }, "remaining": 7 },
    { "id": "res_xxx", "type": "gold_vein", "position": { "x": 850, "y": 120 }, "remaining": 230 }
  ],
  "events": [],
  "messages": []
}
```
- Broadcast this to all admin WebSocket connections every tick
- Separate from game WebSocket on port 8080 — admin is read-only, cannot send actions
- Hook into tick loop: after game broadcaster, also call `adminServer.broadcastTick(world, tickResult)`

**Server Wiring:**
- Add `--admin-port` CLI arg to `src/server/index.ts` (default: 8081)
- Create AdminServer instance in `index.ts`
- Hook into tick loop alongside game broadcaster
- Serve `dashboard.html` from admin HTTP server

**Client-Side: Single HTML File**

One file: `src/server/dashboard.html`
No build step. No React. No npm dependencies. Raw HTML + Canvas + WebSocket + inline CSS/JS.

**Dashboard Layout:**
```
┌─────────────────────────────────────────────────────────┐
│  VIBE PARADOX — LIVE                        Tick: 48201 │
├────────────────────────────────┬────────────────────────┤
│                                │  WORLD STATS           │
│                                │  Agents: 6 (connected) │
│       2D WORLD MAP             │  NPCs: 78              │
│       (Canvas, 600x600px)      │  Trees: 1847           │
│                                │  Gold veins: 48        │
│       Shows ALL entities:      │  Behemoths: 5          │
│       · Agents (colored by     │                        │
│         role: blue=fighter,    ├────────────────────────┤
│         green=merchant,        │  AGENTS                │
│         red=monster)           │  Fighter_001 HP:100    │
│       · NPC monsters (gray)    │    Gold:45 Pos:(234,5) │
│       · Behemoths (purple,     │  Fighter_002 HP:85     │
│         large)                 │    Gold:22 [FIGHTING]  │
│       · Trees (green dots)     │  Merchant_001 HP:50    │
│       · Gold veins (yellow)    │    Gold:0 [GATHERING]  │
│       · Safe zone circle       │  Monster_001 HP:120    │
│                                │    Kills:3 Stage:2     │
├────────────────────────────────┴────────────────────────┤
│  EVENT FEED (scrolling)                                 │
│  [48201] Fighter_001 killed medium_wolf (+33 gold)      │
│  [48199] Merchant_001 gathered 1 log from tree          │
│  [48195] Monster_001 evolved to Stage 2!                │
│  [48190] Fighter_002 traded iron_sword to Fighter_001   │
└─────────────────────────────────────────────────────────┘
```

**Canvas Rendering:**
Scale 1000x1000 world to 600x600px canvas. Use `requestAnimationFrame` loop, redraw on each tick update.

**Entity Rendering:**

| Entity | Color | Radius | Notes |
|--------|-------|--------|-------|
| Fighter (player) | `#44aaff` (blue) | 4px | Label: name |
| Merchant (player) | `#00ff88` (green) | 4px | Label: name |
| Monster (player) | `#ff4444` (red) | 5px | + evolution Stage 2: 6px, Stage 3: 8px, Stage 4: 12px |
| NPC monster | `#666666` (gray) | 3px | No label |
| Behemoth | `#aa44ff` (purple) | 10px | Pulsing animation when unconscious |
| Tree | `#1a5c1a` (dark green) | 1px | No label |
| Gold vein | `#ffaa00` (yellow) | 2px | No label |
| Sapling | `#88ff88` (light green) | 1px | Slightly different from tree |

**Interactive Elements:**
- Safe zone: Faint white circle around (500, 500), radius 100 (scaled to canvas)
- Movement lines: When agent is moving, draw faint dashed line from position to destination
- Combat lines: Draw red line between active combatants
- Hover: When mouse hovers over an agent, show:
  - Vision radius as faint circle outline
  - Tooltip with full stats (HP, ATK, DEF, gold, inventory count)
- Click agent in sidebar: Highlight that agent on canvas, center view if zoomed

**Design Direction:**

Aesthetic: Dark terminal / war room surveillance. Black background, neon accents. Monospace font. Like watching a military radar screen tracking AI agents in a simulated world.

Color Palette:
```css
:root {
  --bg-primary: #0a0a0a;
  --bg-secondary: #111111;
  --bg-panel: #0d0d0d;
  --border: #222222;
  --text-primary: #00ff88;       /* main text — green terminal */
  --text-secondary: #668866;     /* dimmed text */
  --color-fighter: #44aaff;      /* blue */
  --color-merchant: #00ff88;     /* green */
  --color-monster: #ff4444;      /* red */
  --color-npc: #666666;          /* gray */
  --color-behemoth: #aa44ff;     /* purple */
  --color-gold: #ffaa00;         /* gold/economy */
  --color-combat: #ff2222;       /* combat events */
  --color-trade: #44aaff;        /* trade events */
  --color-evolution: #ff44ff;    /* evolution events */
  --color-resource: #00aa44;     /* resource events */
}
```

Typography:
```css
@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;600&display=swap');
* { font-family: 'JetBrains Mono', monospace; }
```

Visual Effects:
- Subtle scanline overlay on canvas (CSS pseudo-element, very faint `repeating-linear-gradient`)
- Faint grid on canvas background (every 100 world units = visual gridlines)
- Pulse animation on behemoths when unconscious
- Fade-in animation on new event feed entries
- Connection status indicator (green dot = connected, red dot = disconnected)
- Tick counter incrementing in header

**Event Feed:**

Scrolling log at the bottom. Keeps last 100 events. Auto-scrolls to newest.

Event Formatting (color-code by event type):
```
[tick] 🗡️ Fighter_001 killed medium_wolf (+33 gold)          — red
[tick] ⛏️ Merchant_001 gathered 1 log from tree_res_xxx      — green
[tick] 🔄 Fighter_002 traded iron_sword → Merchant_001       — blue
[tick] ⚡ Monster_001 evolved to Stage 2!                     — purple
[tick] 💀 Monster_001 was killed by Fighter_001 (PERMADEATH) — bright red
[tick] 🏔️ Iron Behemoth knocked unconscious!                 — purple
[tick] 💬 Fighter_001 [broadcast]: "Need healing salve!"     — dim
[tick] 🏰 Fighter_001 formed alliance "Wolves"               — cyan
[tick] 🌱 Merchant_001 planted a tree seed                   — green
```
Convert WorldEvent types to human-readable strings with emoji prefixes. Include agent names, not IDs.

**Agent Sidebar:**

Right panel. Lists all connected agents sorted by role (fighters → merchants → monsters).

Per agent:
```
Fighter_001                    [FIGHTING]
  HP: ████████░░ 85/100
  ATK: 20  DEF: 15  SPD: 4
  Gold: 45
  Pos: (234, 567) → (300, 600)
  Alliance: Wolves
  Equipped: iron_sword, iron_armor
```
- Health bar as ASCII/unicode block characters
- Status in brackets, color-coded (green=idle, yellow=moving, red=fighting, blue=gathering)
- Click to highlight on map

**WebSocket Connection:**
```javascript
const ws = new WebSocket(`ws://${location.host}/ws`);

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  if (data.type === 'admin_tick') {
    updateMap(data);
    updateStats(data);
    updateAgentList(data);
    updateEventFeed(data.events, data.messages, data.tick);
  }
};

// Auto-reconnect
ws.onclose = () => {
  setTimeout(() => connect(), 2000);
};
```

**Files to Create / Modify:**

New Files:
```
src/server/admin.ts         — AdminServer class (HTTP + WebSocket)
src/server/dashboard.html   — Single-file dashboard (HTML + CSS + JS)
```

Modified Files:
```
src/server/index.ts         — Add --admin-port arg, create AdminServer, wire into tick loop
src/server/tick-loop.ts     — Add admin broadcast after game broadcast (or do it in index.ts via callback)
deploy/deploy.sh            — Open port 8081 on VPS after deploy
```

**Deploy:**
```bash
# Redeploy to VPS
./deploy/deploy.sh [IP]

# Open admin port
ssh root@[IP] 'ufw allow 8081/tcp'

# View dashboard
# Open browser: http://[IP]:8081
```

**Test:**
No vitest — this is visual. Test manually:
1. Start server locally: `npx tsx src/server/index.ts --port 8080 --admin-port 8081`
2. Open http://localhost:8081 in browser
3. Launch agents: `ANTHROPIC_API_KEY=... npx tsx agent/launcher.ts --server ws://localhost:8080 --fighters 2 --merchants 1 --monsters 1`
4. Watch the dashboard — agents should appear as colored dots, moving, fighting, gathering
5. Verify: event feed scrolls, agent list updates, hover shows vision radius
6. `npx tsc --noEmit` must pass

---

### TASK-021: CLI npm Package `[ ]`
**Depends on:** TASK-012
**Parallel-safe with:** Any

**Do:**
1. Add `bin` field to package.json: `"vibe-paradox": "./dist/cli/index.js"`
2. Build with tsup: entry cli/index.ts → dist/cli/
3. Add README.md with quickstart
4. Test: `npm pack` → `npm install -g ./vibe-paradox-0.1.0.tgz` → `vibe-paradox connect --server ws://localhost:8080 --agent-name Test --role fighter`

**Files touched:**
```
package.json (UPDATE)
tsup.config.ts (UPDATE)
README.md (NEW)
```

---

### TASK-022: Agent Brain — LLM Wrapper `[ ]`
**Depends on:** TASK-012 (CLI client)
**Parallel-safe with:** Any Phase 3/4 task

**Do:**
1. Create `agent/config.ts` — `AgentConfig` interface:
   - serverUrl, name, role
   - LLM settings: apiKey (from `ANTHROPIC_API_KEY` env), model (default `claude-sonnet-4-5-20250929`), maxTokens (200), temperature (0.7)
   - Decision tuning: idleTimeout (5 ticks), maxEventsInPrompt (5), maxMessagesInPrompt (3), decisionCooldown (2 ticks)
2. Create `agent/state-buffer.ts` with class `StateBuffer`:
   - `push(update: TickUpdateData): void` — buffers last 10 tick states
   - `getBuffered(): BufferedState` — returns current, previous, recentEvents, recentMessages, ticksSinceLastAction, ticksSinceLastDecision, currentPlan
   - `shouldTriggerDecision(): boolean` — meaningful change detection:
     - New entities appeared/disappeared nearby
     - Health changed (took damage)
     - Status changed (arrived, finished gathering, etc.)
     - Received messages or events
     - Idle timeout (no action in last N ticks)
   - Tracks `currentPlan` (natural language — what the agent is doing and why)
3. Create `agent/prompt-assembler.ts`:
   - `assemblePrompt(state: BufferedState, role: AgentRole): { system: string; user: string }`
   - System prompt per role (fighter/merchant/monster): game rules, action space, constraints, decision format
   - User prompt: tick, status, inventory, nearby entities, recent events/messages, current plan
   - Total prompt budget: ~2000 tokens (system ~800, state ~600, events ~300, format ~300)
4. Create role-specific prompt templates in `agent/prompts/`:
   - `agent/prompts/system.ts` — base system prompt (game rules, action format)
   - `agent/prompts/fighter.ts` — fighter priorities (kill monsters, mine gold, trade for gear, behemoth raids)
   - `agent/prompts/merchant.ts` — merchant priorities (gather logs, craft, trade, plant trees, mine behemoth ore)
   - `agent/prompts/monster.ts` — monster priorities (eat NPCs, ambush humans, avoid groups, evolve, survive)
5. Create `agent/action-parser.ts`:
   - `parseDecision(llmResponse: string): { action: ActionType; params: Record<string, any>; plan: string } | null`
   - Handle: raw JSON, markdown-wrapped JSON, mixed text with JSON
   - Validate action type is known
   - Return null on failure (brain sends idle)
6. Create `agent/brain.ts` with class `AgentBrain`:
   - `onTickUpdate(update: TickUpdateData): Promise<void>` — buffer state, check trigger, decide
   - Guards against stacking LLM calls (`decisionInFlight` flag)
   - Calls LLM via Anthropic API (claude-sonnet-4-5-20250929, max_tokens 200, temperature 0.7)
   - Parses response → sends action or idle
   - Stores plan from each decision for context continuity
7. Create `agent/index.ts` — entry point:
   - CLI: `npx tsx agent/index.ts --server ws://localhost:8080 --name Fighter1 --role fighter`
   - Env: `ANTHROPIC_API_KEY`, optional `VIBE_PARADOX_MODEL`
   - Spawns CLI client (`cli/index.ts`) as child process
   - Reads stdout line-by-line → parses JSON → feeds tick updates to brain
   - Brain actions written to CLI stdin as JSON
8. Create `agent/launcher.ts` — multi-agent launcher:
   - CLI: `npx tsx agent/launcher.ts --server ws://localhost:8080 --fighters 3 --merchants 2 --monsters 1`
   - Spawns N agent processes with auto-generated names (Fighter_001, Merchant_001, etc.)

**Files created:**
```
agent/index.ts
agent/brain.ts
agent/state-buffer.ts
agent/prompt-assembler.ts
agent/action-parser.ts
agent/config.ts
agent/launcher.ts
agent/prompts/system.ts
agent/prompts/fighter.ts
agent/prompts/merchant.ts
agent/prompts/monster.ts
tests/agent-brain.test.ts
```

**Test:**
- state-buffer: `shouldTriggerDecision()` returns true on health change, new nearby entity, status change, idle timeout
- state-buffer: `shouldTriggerDecision()` returns false when nothing meaningful changed
- action-parser: parses clean JSON `{"action":"move","params":{"x":100,"y":200},"plan":"exploring"}`
- action-parser: parses markdown-wrapped JSON (```json ... ```)
- action-parser: returns null for unparseable garbage
- action-parser: handles extra fields gracefully (doesn't crash)
- prompt-assembler: output contains required sections (status, inventory, nearby, events)
- prompt-assembler: stays under ~2000 token budget
- Integration: mock LLM → state in → action out through full brain loop

---

### TASK-023: Agent Memory — Persistent Memory Across Decisions `[ ]`
**Depends on:** TASK-022 (agent brain)
**Parallel-safe with:** Any Phase 3/4 task

**Do:**
1. Create `agent/memory.ts` with class `AgentMemory`:
   - Stores: last 20 decisions with outcomes (did the action succeed or get rejected?)
   - Tracks: agents met (name, role, alliance, last interaction tick)
   - Tracks: resources found (position, type)
   - Tracks: threats encountered (who attacked, where, outcome)
   - Tracks: trades completed (who, what, price)
   - Tracks: deaths (where, what killed me — for fighters/merchants to avoid dangerous areas)
   - `recordDecision(action, outcome): void` — append to decision history, truncate to 20
   - `recordAgentMet(name, role, alliance, tick): void`
   - `recordResourceFound(position, type): void`
   - `recordThreat(attacker, position, outcome): void`
   - `recordTrade(partner, gave, received): void`
   - `recordDeath(position, killer): void`
   - `serialize(): string` — JSON for file persistence
   - `static load(filePath: string): AgentMemory` — load from file
   - `save(filePath: string): void` — save to file (one file per agent in `data/` directory)
   - Memory persists across agent restarts

2. Update `agent/prompt-assembler.ts`:
   - Add memory section to user prompt:
     `"MEMORY: Known agents: [...], Known resource locations: [...], Past trades: [...], Threats: [...]"`
   - Add strategic context: `"You have died 2 times at position (600, 400) — avoid that area"`
   - Keep total prompt under 2500 tokens (was 2000, budget +500 for memory)

3. Update `agent/brain.ts`:
   - After each decision + tick result, update memory:
     - Action succeeded → record outcome
     - New agent seen in nearby entities → add to known agents
     - Resource found in nearby entities → add to known locations
     - Took damage → record threat
     - Trade completed → record trade history
     - Agent died → record death location and killer
   - Load memory on startup, save after each decision

**Files touched:**
```
agent/memory.ts (NEW)
agent/prompt-assembler.ts (UPDATE — add memory section, raise token budget to 2500)
agent/brain.ts (UPDATE — load/save memory, update memory after each decision)
tests/agent-memory.test.ts (NEW)
```

**Test:**
- Memory serialization roundtrip: create memory, add data, serialize, load, verify all data intact
- Memory truncation: add 25 decisions, verify only last 20 kept
- Prompt stays under 2500 token budget with full memory (20 decisions, 10 known agents, 10 resources, 5 threats, 5 trades, 3 deaths)
- Death tracking: record 2 deaths at same position, verify memory contains both
- `npx vitest run` and `npx tsc --noEmit` pass

---

## Parallelization Map

```
Phase 1 (sequential start, then parallel):

  TASK-001 ──► TASK-002 ──┬──► TASK-003 ─────────────────────────┐
                          ├──► TASK-004 ──► TASK-005              │
                          └──► TASK-006                           │
                                                                  │
                          TASK-004 + TASK-006 + TASK-007 ◄────────┘
                          (parallel once 002 done)                │
                                                                  │
                          TASK-008 (wires everything) ◄───────────┘

Phase 2 (parallel pair, then wire):

  TASK-009 ──┐
             ├──► TASK-011 (wires server)
  TASK-010 ──┘
  
  TASK-012 (parallel with 009-011)

Phase 3 (fully parallel):

  TASK-013 ─┐
  TASK-014 ─┤
  TASK-015 ─┤──► all parallel (different pipeline modules, no file overlap)
  TASK-016 ─┤
  TASK-017 ─┤
  TASK-018 ─┤
  TASK-019 ─┘

Phase 4:

  TASK-020 + TASK-021 (parallel, anytime after Phase 2)

Phase 5 (Agent Intelligence):

  TASK-022 ──► TASK-023 (memory depends on brain)
```
