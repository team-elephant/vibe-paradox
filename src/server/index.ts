// server/index.ts — Server entry point
// Wire: DB init → world load/seed → tick loop → broadcaster → WS server
// Graceful shutdown on SIGINT/SIGTERM

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Database } from './db.js';
import { WorldState } from './world.js';
import { seedWorld } from './seed.js';
import { ActionQueue } from '../pipeline/action-queue.js';
import { ActionValidator } from '../pipeline/validator.js';
import { ActionExecutor } from '../pipeline/executor.js';
import { TickLoop } from './tick-loop.js';
import { StateBroadcaster } from './broadcaster.js';
import { GameWebSocketServer } from './ws-server.js';

// --- CLI arg parsing (simple, no commander needed for server) ---

function parseArgs(): { port: number; dbPath: string; seed: number } {
  const args = process.argv.slice(2);
  let port = 8080;
  let dbPath = 'vibe-paradox.db';
  let seed = 42;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--port':
        port = Number(args[++i]);
        break;
      case '--db':
        dbPath = args[++i]!;
        break;
      case '--seed':
        seed = Number(args[++i]);
        break;
    }
  }

  return { port, dbPath, seed };
}

// --- Main ---

const { port, dbPath, seed } = parseArgs();

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(__dirname, '../../db/migrations');

// 1. Init Database + run migrations
console.log(`[VP] Initializing database: ${dbPath}`);
const db = new Database(dbPath);
db.runMigrations(migrationsDir);

// 2. Attempt to load world snapshot from DB
let world: WorldState;
const snapshot = db.loadWorldSnapshot();

if (snapshot) {
  console.log(`[VP] Loaded world snapshot from tick ${snapshot.tick} (seed=${snapshot.seed})`);
  world = new WorldState(snapshot.seed);
  world.tick = snapshot.tick;

  // Restore agents
  for (const agent of snapshot.agents) {
    agent.isConnected = false; // all agents start disconnected on restart
    world.addAgent(agent);
  }

  // Restore resources
  for (const resource of snapshot.resources) {
    world.addResource(resource);
  }

  // Restore NPC monsters
  for (const monster of snapshot.npcMonsters) {
    world.addNpcMonster(monster);
  }

  // Restore behemoths
  for (const behemoth of snapshot.behemoths) {
    world.addBehemoth(behemoth);
  }

  // Restore alliances
  for (const alliance of snapshot.alliances) {
    world.alliances.set(alliance.name, alliance);
  }

  console.log(
    `[VP] Restored: ${world.agents.size} agents, ${world.resources.size} resources, ` +
    `${world.npcMonsters.size} NPCs, ${world.behemoths.size} behemoths, ` +
    `${world.alliances.size} alliances`,
  );
} else {
  console.log(`[VP] No snapshot found. Seeding new world (seed=${seed})...`);
  world = new WorldState(seed);
  seedWorld(world, seed);

  console.log(
    `[VP] World generated: ${world.resources.size} resources, ` +
    `${world.npcMonsters.size} NPCs, ${world.behemoths.size} behemoths`,
  );

  // Save initial snapshot
  db.snapshotWorld(world);
  db.setMetaValue('created_at', new Date().toISOString(), 0);
}

// 3. Wire pipeline components
const actionQueue = new ActionQueue();
const validator = new ActionValidator();
const executor = new ActionExecutor();
const broadcaster = new StateBroadcaster();

// 4. Create tick loop
const tickLoop = new TickLoop(world, actionQueue, validator, executor, db);

// 5. Create WebSocket server
const wsServer = new GameWebSocketServer(port, world, actionQueue);

// 6. Hook broadcaster into tick loop
tickLoop.setBroadcaster(broadcaster, wsServer);

// 7. Start tick loop
tickLoop.start();
console.log(`[VP] Server started on ws://localhost:${port}`);
console.log(`[VP] Tick loop running (1s intervals). Current tick: ${world.tick}`);

// --- Periodic status logging ---

const STATUS_LOG_INTERVAL = 30_000; // every 30 seconds
const statusInterval = setInterval(() => {
  console.log(
    `[VP] Tick ${world.tick} | ` +
    `${wsServer.getConnectedCount()} connected | ` +
    `${world.agents.size} agents | ` +
    `${world.resources.size} resources | ` +
    `${world.npcMonsters.size} NPCs | ` +
    `${world.behemoths.size} behemoths`,
  );
}, STATUS_LOG_INTERVAL);

// --- Graceful shutdown ---

let shuttingDown = false;

function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log(`\n[VP] ${signal} received. Shutting down gracefully...`);

  // 1. Stop tick loop
  tickLoop.stop();
  console.log('[VP] Tick loop stopped.');

  // 2. Stop status logging
  clearInterval(statusInterval);

  // 3. Final snapshot
  console.log(`[VP] Saving final snapshot at tick ${world.tick}...`);
  db.snapshotWorld(world);
  console.log('[VP] Snapshot saved.');

  // 4. Close WebSocket server
  wsServer.close();
  console.log('[VP] WebSocket server closed.');

  // 5. Close database
  db.close();
  console.log('[VP] Database closed.');

  console.log('[VP] Shutdown complete.');
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
