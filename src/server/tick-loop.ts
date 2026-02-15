// server/tick-loop.ts — The heartbeat: 1s tick cycle

import type { TickResult } from '../types/index.js';
import type { WorldState } from './world.js';
import type { Database } from './db.js';
import type { ActionQueue } from '../pipeline/action-queue.js';
import type { ActionValidator } from '../pipeline/validator.js';
import type { ActionExecutor, ExecutionResult } from '../pipeline/executor.js';
import type { CombatResolver } from '../pipeline/combat-resolver.js';
import type { ResourceProcessor } from '../pipeline/resource-processor.js';
import type { BehemothProcessor } from '../pipeline/behemoth-processor.js';
import type { StateBroadcaster } from './broadcaster.js';
import type { GameWebSocketServer } from './ws-server.js';
import type { AdminServer } from './admin.js';
import type { EconomyProcessor } from '../pipeline/economy-processor.js';
import type { MonsterProcessor } from '../pipeline/monster-processor.js';
import { TICK_RATE_MS, SNAPSHOT_INTERVAL_TICKS } from '../shared/constants.js';

export class TickLoop {
  private world: WorldState;
  private actionQueue: ActionQueue;
  private validator: ActionValidator;
  private executor: ActionExecutor;
  private combatResolver: CombatResolver | null = null;
  private db: Database;
  private resourceProcessor: ResourceProcessor | null = null;
  private economyProcessor: EconomyProcessor | null = null;
  private behemothProcessor: BehemothProcessor | null = null;
  private broadcaster: StateBroadcaster | null = null;
  private wsServer: GameWebSocketServer | null = null;
  private adminServer: AdminServer | null = null;
  private monsterProcessor: MonsterProcessor | null = null;

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

  setCombatResolver(combatResolver: CombatResolver): void {
    this.combatResolver = combatResolver;
  }

  setResourceProcessor(rp: ResourceProcessor): void {
    this.resourceProcessor = rp;
  }

  setEconomyProcessor(economyProcessor: EconomyProcessor): void {
    this.economyProcessor = economyProcessor;
  }

  setBehemothProcessor(processor: BehemothProcessor): void {
    this.behemothProcessor = processor;
  }

  setBroadcaster(broadcaster: StateBroadcaster, wsServer: GameWebSocketServer): void {
    this.broadcaster = broadcaster;
    this.wsServer = wsServer;
  }

  setAdminServer(adminServer: AdminServer): void {
    this.adminServer = adminServer;
  }

  setMonsterProcessor(monsterProcessor: MonsterProcessor): void {
    this.monsterProcessor = monsterProcessor;
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

    // 5b. Resolve combat and cleanup inactive pairs
    if (this.combatResolver) {
      this.combatResolver.resolveCombat(this.executor.combatPairs, this.world, tick);
      this.executor.cleanupCombatPairs();
    }

    // 6. Process NPC monster AI
    if (this.monsterProcessor) {
      this.monsterProcessor.tick(this.world, tick);
    }

    // 7. Process resource regeneration / growth
    if (this.resourceProcessor) {
      this.resourceProcessor.tick(this.world, tick);
    }

    // 8. Process behemoth lifecycle
    if (this.behemothProcessor) {
      const throwOffs = this.behemothProcessor.tick(this.world, tick);
      // Executor handles agent mutations from behemoth throw-offs
      if (throwOffs.length > 0) {
        this.executor.processThrowOffs(throwOffs, this.world, tick);
      }
    }

    // 8.5. Process economy (trades expiry + crafting completion)
    // EconomyProcessor returns result objects; executor applies mutations.
    if (this.economyProcessor) {
      const tradeResults = this.economyProcessor.processTrades(this.world, tick);
      this.executor.applyTradeExpiry(tradeResults, this.world);

      const craftResults = this.economyProcessor.processCrafting(this.world, tick);
      this.executor.applyCraftCompletion(craftResults, this.world);
    }

    // 9. Check respawns
    this.executor.processRespawns(this.world, tick);

    // 10. NPC spawner balance check
    if (this.monsterProcessor) {
      this.monsterProcessor.spawnCheck(this.world, tick);
    }

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

    // 12b. Broadcast full state to admin dashboard viewers
    if (this.adminServer) {
      this.adminServer.broadcastTick(this.world, tickResult);
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
