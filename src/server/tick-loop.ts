// server/tick-loop.ts — The heartbeat: 1s tick cycle

import type { TickResult } from '../types/index.js';
import type { WorldState } from './world.js';
import type { Database } from './db.js';
import type { ActionQueue } from '../pipeline/action-queue.js';
import type { ActionValidator } from '../pipeline/validator.js';
import type { ActionExecutor, ExecutionResult } from '../pipeline/executor.js';
import type { ResourceProcessor } from '../pipeline/resource-processor.js';
import type { StateBroadcaster } from './broadcaster.js';
import type { GameWebSocketServer } from './ws-server.js';
import { TICK_RATE_MS, SNAPSHOT_INTERVAL_TICKS } from '../shared/constants.js';

export class TickLoop {
  private world: WorldState;
  private actionQueue: ActionQueue;
  private validator: ActionValidator;
  private executor: ActionExecutor;
  private db: Database;
  private resourceProcessor: ResourceProcessor | null = null;
  private broadcaster: StateBroadcaster | null = null;
  private wsServer: GameWebSocketServer | null = null;

  private tickInterval: ReturnType<typeof setInterval> | null = null;

  constructor(
    world: WorldState,
    actionQueue: ActionQueue,
    validator: ActionValidator,
    executor: ActionExecutor,
    db: Database,
  ) {
    this.world = world;
    this.actionQueue = actionQueue;
    this.validator = validator;
    this.executor = executor;
    this.db = db;
  }

  setResourceProcessor(rp: ResourceProcessor): void {
    this.resourceProcessor = rp;
  }

  setBroadcaster(broadcaster: StateBroadcaster, wsServer: GameWebSocketServer): void {
    this.broadcaster = broadcaster;
    this.wsServer = wsServer;
  }

  start(): void {
    this.tickInterval = setInterval(() => this.processTick(), TICK_RATE_MS);
  }

  stop(): void {
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
  }

  processTick(): TickResult {
    const startTime = performance.now();

    // 1. Increment tick
    const tick = ++this.world.tick;

    // 2. Drain action queue
    const rawActions = this.actionQueue.drainAll();

    // 3. Validate batch
    const { validated, rejected } = this.validator.validateBatch(rawActions, this.world);

    // 4. Execute batch
    const executionResult: ExecutionResult = this.executor.executeBatch(validated, this.world, tick);

    // 5. Process continuous effects (movement, gathering progress)
    this.executor.processContinuous(this.world, tick);

    // 6. Process NPC monster AI (Phase 3 — placeholder)
    // this.monsterProcessor.tick(this.world, tick);

    // 7. Process resource regeneration / growth
    if (this.resourceProcessor) {
      this.resourceProcessor.tick(this.world, tick);
    }

    // 8. Process behemoth lifecycle (Phase 3 — placeholder)
    // this.behemothProcessor.tick(this.world, tick);

    // 9. Check respawns
    this.executor.processRespawns(this.world, tick);

    // 10. NPC spawner balance check (Phase 3 — placeholder)
    // this.monsterProcessor.spawnCheck(this.world, tick);

    // 11. Build tick result
    const tickResult: TickResult = {
      tick,
      executed: validated,
      rejected,
      events: [...this.world.tickEvents],
      stateChanges: executionResult.stateChanges,
      spawns: executionResult.spawns,
    };

    // 12. Broadcast personalized state to each connected agent
    if (this.broadcaster && this.wsServer) {
      this.broadcaster.broadcastTick(this.world, tickResult, this.wsServer);
    }

    // 13. Persist (snapshot every SNAPSHOT_INTERVAL_TICKS)
    this.db.persistTickChanges(tickResult);
    if (tick % SNAPSHOT_INTERVAL_TICKS === 0) {
      this.db.snapshotWorld(this.world);
    }

    // 14. Clear tick-scoped data
    this.world.tickMessages = [];
    this.world.tickEvents = [];

    // 15. Log tick performance
    const elapsed = performance.now() - startTime;
    if (elapsed > 500) {
      console.warn(`Tick ${tick} took ${elapsed.toFixed(1)}ms — danger zone`);
    }

    return tickResult;
  }
}
