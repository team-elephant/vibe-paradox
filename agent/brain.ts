// agent/brain.ts — Pipeline-based AgentBrain (v2)
//
// Runs the 6-stage cognitive pipeline:
//   Perception → Salience → Drives → Router → Planner → Memory
//
// Most ticks → EXECUTE_PLAN (zero LLM cost).
// LLM only called on INTERRUPT, PLAN_COMPLETE, or PLAN_EMPTY.

import type { TickUpdateData } from '../src/types/index.js';
import type { AgentConfig } from './config.js';

// Pipeline stages
import { perceive, type PerceptionInput } from './pipeline/perception.js';
import { scoreSalience } from './pipeline/salience.js';
import { updateDrives, type Drives, type DrivesContext } from './pipeline/drives.js';
import { route } from './pipeline/router.js';
import { generatePlan, PlannerCooldown, type LlmCreateFn } from './pipeline/planner.js';
import { PipelineMemory } from './pipeline/memory.js';
import { PlanExecutor } from './plan-executor.js';
import { createPlannerLlm, createReflectionLlmWithUsage, type LlmConfig } from './llm.js';

export interface BrainAction {
  action: string;
  params: Record<string, unknown>;
  tick: number;
}

// --- Cost Tracking ---

interface CostRates {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

// Per-million-token pricing by model family (OpenRouter pricing)
const MODEL_PRICING: Record<string, CostRates> = {
  haiku: { input: 0.80, output: 4.0, cacheRead: 0.08, cacheWrite: 1.0 },
  sonnet: { input: 3.0, output: 15.0, cacheRead: 0.30, cacheWrite: 3.75 },
  opus: { input: 15.0, output: 75.0, cacheRead: 1.50, cacheWrite: 18.75 },
  'gemini-flash': { input: 0.10, output: 0.40, cacheRead: 0, cacheWrite: 0 },
  deepseek: { input: 0.14, output: 0.28, cacheRead: 0, cacheWrite: 0 },
  llama: { input: 0.30, output: 0.40, cacheRead: 0, cacheWrite: 0 },
};

function getCostRates(model: string): CostRates {
  const lower = model.toLowerCase();
  if (lower.includes('opus')) return MODEL_PRICING.opus;
  if (lower.includes('sonnet')) return MODEL_PRICING.sonnet;
  if (lower.includes('gemini') && lower.includes('flash')) return MODEL_PRICING['gemini-flash'];
  if (lower.includes('deepseek')) return MODEL_PRICING.deepseek;
  if (lower.includes('llama')) return MODEL_PRICING.llama;
  return MODEL_PRICING.haiku; // Default fallback
}

const COST_LOG_INTERVAL_PLANS = 20;

interface UsageTotals {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  planCount: number;
  tickCount: number;
  executePlanTicks: number;
}

function estimateCost(t: UsageTotals, rates: CostRates): number {
  return (
    (t.inputTokens / 1_000_000) * rates.input +
    (t.outputTokens / 1_000_000) * rates.output +
    (t.cacheReadTokens / 1_000_000) * rates.cacheRead +
    (t.cacheWriteTokens / 1_000_000) * rates.cacheWrite
  );
}

function formatNum(n: number): string {
  return n.toLocaleString('en-US');
}

// Global registry so exit handler can log all agents
const activeAgents = new Map<string, { name: string; model: string; provider: string; usage: UsageTotals }>();
let exitHandlerRegistered = false;

function registerExitHandler(): void {
  if (exitHandlerRegistered) return;
  exitHandlerRegistered = true;

  const logFinalTotals = (): void => {
    if (activeAgents.size === 0) return;
    process.stderr.write('\n=== Pipeline Brain v2 — Cost Summary ===\n');
    let grandTotal = 0;
    for (const [, agent] of activeAgents) {
      const cost = estimateCost(agent.usage, getCostRates(agent.model));
      grandTotal += cost;
      const ratio = agent.usage.tickCount > 0
        ? ((agent.usage.executePlanTicks / agent.usage.tickCount) * 100).toFixed(1)
        : '0.0';
      process.stderr.write(
        `[${agent.name}] model: ${agent.model} (${agent.provider}) | ` +
        `${agent.usage.planCount} plans / ${agent.usage.tickCount} ticks (${ratio}% free) | ` +
        `input: ${formatNum(agent.usage.inputTokens)} | ` +
        `output: ${formatNum(agent.usage.outputTokens)} | ` +
        `cache: ${formatNum(agent.usage.cacheReadTokens)} read / ${formatNum(agent.usage.cacheWriteTokens)} write | ` +
        `est cost: $${cost.toFixed(4)}\n`,
      );
    }
    if (activeAgents.size > 1) {
      process.stderr.write(`Total est cost: $${grandTotal.toFixed(4)}\n`);
    }
    process.stderr.write('=========================================\n');
  };

  process.on('SIGINT', () => {
    logFinalTotals();
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    logFinalTotals();
    process.exit(0);
  });
  process.on('exit', () => {
    logFinalTotals();
  });
}

// --- Pipeline Brain ---

export class AgentBrain {
  private config: AgentConfig;
  private llmConfig: LlmConfig;
  private sendAction: (action: BrainAction) => void;

  // Pipeline state
  private prevState: TickUpdateData | null = null;
  private drives: Drives | null = null;
  private memory: PipelineMemory;
  private executor: PlanExecutor;
  private cooldown: PlannerCooldown;

  // Tracking
  private planInFlight = false;
  private lastPlanTick = 0;
  private lastPlanOutcome: string | null = null;
  private drivesContext: DrivesContext = {
    recentDamageTaken: 0,
    ticksSinceLastTrade: 999,
    ticksSinceLastMessage: 999,
    deathCount: 0,
  };
  private usage: UsageTotals = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    planCount: 0,
    tickCount: 0,
    executePlanTicks: 0,
  };

  constructor(config: AgentConfig, sendAction: (action: BrainAction) => void) {
    this.config = config;
    this.sendAction = sendAction;
    this.llmConfig = {
      provider: config.llmProvider,
      apiKey: config.apiKey,
      model: config.model,
    };
    this.memory = new PipelineMemory();
    this.executor = new PlanExecutor();
    this.cooldown = new PlannerCooldown(3);

    // Register for cost tracking on exit
    activeAgents.set(config.name, {
      name: config.name,
      model: config.model,
      provider: config.llmProvider,
      usage: this.usage,
    });
    registerExitHandler();
  }

  async onTickUpdate(update: TickUpdateData): Promise<void> {
    this.usage.tickCount++;

    // --- Stage 1: Perception (always runs, even during planInFlight/death) ---
    const currentPlanStep = this.executor.currentStep ?? undefined;
    const perceptionInput: PerceptionInput = {
      prev: this.prevState,
      curr: update,
      currentPlanStep: currentPlanStep ?? null,
    };
    const perceptions = perceive(perceptionInput);

    // --- Stage 2: Salience ---
    const salience = scoreSalience(perceptions, update.self.role);

    // --- Stage 3: Drives ---
    this.updateDrivesContext(update, perceptions);
    this.drives = updateDrives(this.drives, update, perceptions, this.drivesContext);

    // Dead agents: track death in memory/drives but don't act
    if (update.self.health <= 0) {
      this.memory.logPerceptions(perceptions, update.tick);
      this.executor.clearPlan();
      this.prevState = update;
      return;
    }

    // Don't stack LLM calls — but perception/drives already ran above
    if (this.planInFlight) {
      this.prevState = update;
      return;
    }

    // --- Stage 6 (early): Log perceptions to memory ---
    this.memory.logPerceptions(perceptions, update.tick);

    // --- Stage 4: Router ---
    const ticksSinceLastPlan = update.tick - this.lastPlanTick;
    const decision = route({
      currentPlan: this.executor.currentPlan,
      currentStepIndex: this.executor.stepIndex,
      salience,
      drives: this.drives,
      ticksSinceLastPlan,
      ticksOnCurrentStep: this.executor.ticksOnCurrentStep,
    });

    // --- Act on router decision ---
    switch (decision.type) {
      case 'EXECUTE_PLAN': {
        this.usage.executePlanTicks++;

        // P0 fix: consume step completion/failure perceptions to advance the executor
        const stepCompleted = perceptions.some((p) => p.type === 'plan_step_completed');
        const stepFailed = perceptions.find((p) => p.type === 'plan_step_failed');
        if (stepCompleted) {
          this.memory.logPlanOutcome('completed', 'step completed', update.tick);
          this.executor.advanceStep();
        } else if (stepFailed) {
          const reason = (stepFailed.details.reason as string) ?? 'unknown';
          this.memory.logPlanOutcome('failed', `step failed: ${reason}`, update.tick);
          this.executor.advanceStep();
        }

        // If advancing exhausted the plan, the next tick's router will catch PLAN_COMPLETE.
        // For now, execute the (possibly new) current step.
        const action = this.executor.getNextAction(update);
        if (action) {
          this.sendAction({
            action: action.action,
            params: action.params,
            tick: update.tick,
          });
        } else if (!this.executor.isPlanComplete()) {
          // Step returned null (e.g., no valid target) — advance past it
          this.executor.advanceStep();
          this.memory.logPlanOutcome('failed', 'step returned no valid action', update.tick);
        }
        this.executor.tick();
        break;
      }

      case 'INTERRUPT': {
        // Log the interrupted plan
        if (this.executor.currentPlan) {
          this.memory.logPlanOutcome('interrupted', decision.reason, update.tick);
        }
        this.lastPlanOutcome = `interrupted: ${decision.reason}`;
        await this.generateNewPlan(update, decision.reason);
        break;
      }

      case 'PLAN_COMPLETE': {
        this.memory.logPlanOutcome('completed', 'all steps executed', update.tick);
        this.lastPlanOutcome = 'completed: all steps executed';
        await this.generateNewPlan(update, null);
        break;
      }

      case 'PLAN_EMPTY': {
        this.lastPlanOutcome = null;
        await this.generateNewPlan(update, null);
        break;
      }
    }

    // --- Reflection check ---
    if (this.memory.shouldReflect()) {
      await this.doReflection();
    }

    this.prevState = update;
  }

  // Called when the server rejects an action
  onActionRejected(action: string, reason: string): void {
    this.memory.logPlanOutcome('failed', `${action} rejected: ${reason}`, this.prevState?.tick ?? 0);
    // Advance past the failed step
    this.executor.advanceStep();
  }

  // --- Private: Plan generation ---

  private async generateNewPlan(update: TickUpdateData, interruptReason: string | null): Promise<void> {
    const now = Date.now();
    if (!this.cooldown.canPlan(now)) {
      // Rate limited — clear stale plan so router doesn't resume it, then idle
      this.executor.clearPlan();
      this.sendAction({ action: 'idle', params: {}, tick: update.tick });
      return;
    }

    this.planInFlight = true;
    try {
      const llmCall = createPlannerLlm(this.llmConfig);

      const result = await generatePlan(
        {
          state: update,
          drives: this.drives!,
          memory: this.memory,
          lastPlanOutcome: this.lastPlanOutcome,
          interruptReason,
        },
        llmCall,
        this.config.model,
        this.config.maxTokens,
        this.config.temperature,
      );

      // Update usage
      this.usage.inputTokens += result.inputTokens;
      this.usage.outputTokens += result.outputTokens;
      this.usage.cacheReadTokens += result.cacheReadTokens;
      this.usage.cacheWriteTokens += result.cacheWriteTokens;
      this.usage.planCount++;

      // Set the new plan
      this.executor.setPlan(result.plan);
      this.lastPlanTick = update.tick;
      this.cooldown.recordPlan(Date.now());
      this.memory.logPlanCreated(result.plan.reasoning, result.plan.steps.length, update.tick);

      // Log cost every N plans
      if (this.usage.planCount % COST_LOG_INTERVAL_PLANS === 0) {
        const cost = estimateCost(this.usage, getCostRates(this.config.model));
        const ratio = ((this.usage.executePlanTicks / this.usage.tickCount) * 100).toFixed(1);
        process.stderr.write(
          `[${this.config.name}] ${this.usage.planCount} plans / ${this.usage.tickCount} ticks (${ratio}% free) | ` +
          `model: ${this.config.model} (${this.llmConfig.provider}) | ` +
          `est cost: $${cost.toFixed(4)}\n`,
        );
      }

      // Execute the first step immediately
      const action = this.executor.getNextAction(update);
      if (action) {
        this.sendAction({
          action: action.action,
          params: action.params,
          tick: update.tick,
        });
      }
      this.executor.tick();
    } catch (err) {
      process.stderr.write(
        `[${this.config.name}] LLM error: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      // On error, send idle to keep agent alive
      this.sendAction({ action: 'idle', params: {}, tick: update.tick });
    } finally {
      this.planInFlight = false;
    }
  }

  // --- Private: Reflection ---

  private async doReflection(): Promise<void> {
    try {
      const reflectionLlm = createReflectionLlmWithUsage(this.llmConfig);

      const llmCall = async (prompt: string): Promise<string> => {
        const result = await reflectionLlm(prompt);

        // Track reflection cost
        this.usage.inputTokens += result.inputTokens;
        this.usage.outputTokens += result.outputTokens;
        this.usage.cacheReadTokens += result.cacheReadTokens;
        this.usage.cacheWriteTokens += result.cacheWriteTokens;

        return result.text;
      };

      await this.memory.reflect(llmCall);
    } catch (err) {
      process.stderr.write(
        `[${this.config.name}] Reflection error: ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
  }

  // --- Private: Drives context tracking ---

  private updateDrivesContext(update: TickUpdateData, perceptions: import('./pipeline/perception.js').Perception[]): void {
    // Track damage
    const damagePer = perceptions.find((p) => p.type === 'hp_changed');
    if (damagePer && typeof damagePer.details.delta === 'number' && damagePer.details.delta < 0) {
      this.drivesContext.recentDamageTaken = Math.abs(damagePer.details.delta as number);
    } else {
      this.drivesContext.recentDamageTaken = 0;
    }

    // Track trades
    const hadTrade = perceptions.some((p) => p.type === 'trade_offered');
    if (hadTrade) {
      this.drivesContext.ticksSinceLastTrade = 0;
    } else {
      this.drivesContext.ticksSinceLastTrade++;
    }

    // Track messages
    const hadMessage = perceptions.some((p) => p.type === 'message_received');
    if (hadMessage) {
      this.drivesContext.ticksSinceLastMessage = 0;
    } else {
      this.drivesContext.ticksSinceLastMessage++;
    }

    // Track deaths
    const died = perceptions.some(
      (p) => p.type === 'entity_died' && p.details.isSelf === true,
    );
    if (died) {
      this.drivesContext.deathCount++;
    }
  }
}
