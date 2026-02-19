// agent/brain.ts — Pipeline-based AgentBrain (v2)
//
// Runs the 6-stage cognitive pipeline:
//   Perception → Salience → Drives → Router → Planner → Memory
//
// Most ticks → EXECUTE_PLAN (zero LLM cost).
// LLM only called on INTERRUPT, PLAN_COMPLETE, or PLAN_EMPTY.

import Anthropic from '@anthropic-ai/sdk';
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

export interface BrainAction {
  action: string;
  params: Record<string, unknown>;
  tick: number;
}

// --- Cost Tracking ---

const COST_PER_MTOK = {
  input: 0.80,    // Haiku pricing (default model for v2)
  output: 4.0,
  cacheRead: 0.08,
  cacheWrite: 1.0,
} as const;

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

function estimateCost(t: UsageTotals): number {
  return (
    (t.inputTokens / 1_000_000) * COST_PER_MTOK.input +
    (t.outputTokens / 1_000_000) * COST_PER_MTOK.output +
    (t.cacheReadTokens / 1_000_000) * COST_PER_MTOK.cacheRead +
    (t.cacheWriteTokens / 1_000_000) * COST_PER_MTOK.cacheWrite
  );
}

function formatNum(n: number): string {
  return n.toLocaleString('en-US');
}

// Global registry so exit handler can log all agents
const activeAgents = new Map<string, { name: string; usage: UsageTotals }>();
let exitHandlerRegistered = false;

function registerExitHandler(): void {
  if (exitHandlerRegistered) return;
  exitHandlerRegistered = true;

  const logFinalTotals = (): void => {
    if (activeAgents.size === 0) return;
    process.stderr.write('\n=== Pipeline Brain v2 — Cost Summary ===\n');
    let grandTotal = 0;
    for (const [, agent] of activeAgents) {
      const cost = estimateCost(agent.usage);
      grandTotal += cost;
      const ratio = agent.usage.tickCount > 0
        ? ((agent.usage.executePlanTicks / agent.usage.tickCount) * 100).toFixed(1)
        : '0.0';
      process.stderr.write(
        `[${agent.name}] ${agent.usage.planCount} plans / ${agent.usage.tickCount} ticks (${ratio}% free) | ` +
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
  private client: Anthropic;
  private config: AgentConfig;
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
    this.client = new Anthropic({ apiKey: config.apiKey });
    this.memory = new PipelineMemory();
    this.executor = new PlanExecutor();
    this.cooldown = new PlannerCooldown(3);

    // Register for cost tracking on exit
    activeAgents.set(config.name, { name: config.name, usage: this.usage });
    registerExitHandler();
  }

  async onTickUpdate(update: TickUpdateData): Promise<void> {
    this.usage.tickCount++;

    // Dead agents don't act
    if (update.self.health <= 0) {
      this.prevState = update;
      return;
    }

    // Don't stack LLM calls
    if (this.planInFlight) {
      this.prevState = update;
      return;
    }

    // --- Stage 1: Perception ---
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
        const action = this.executor.getNextAction(update);
        if (action) {
          this.sendAction({
            action: action.action,
            params: action.params,
            tick: update.tick,
          });
        } else {
          // Plan step returned null (e.g., no valid target) — advance to next step
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
      // Rate limited — idle instead
      this.sendAction({ action: 'idle', params: {}, tick: update.tick });
      return;
    }

    this.planInFlight = true;
    try {
      const llmCall: LlmCreateFn = async (params) => {
        const response = await this.client.messages.create({
          model: params.model,
          max_tokens: params.maxTokens,
          temperature: params.temperature,
          system: [{ type: 'text', text: params.system, cache_control: { type: 'ephemeral' } }],
          messages: [{ role: 'user', content: params.user }],
        });

        const text = response.content
          .filter((b): b is Anthropic.TextBlock => b.type === 'text')
          .map((b) => b.text)
          .join('');

        return {
          text,
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
          cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
          cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
        };
      };

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
        const cost = estimateCost(this.usage);
        const ratio = ((this.usage.executePlanTicks / this.usage.tickCount) * 100).toFixed(1);
        process.stderr.write(
          `[${this.config.name}] ${this.usage.planCount} plans / ${this.usage.tickCount} ticks (${ratio}% free) | ` +
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
      const llmCall = async (prompt: string): Promise<string> => {
        const response = await this.client.messages.create({
          model: this.config.model,
          max_tokens: 150,
          temperature: 0.7,
          messages: [{ role: 'user', content: prompt }],
        });

        const text = response.content
          .filter((b): b is Anthropic.TextBlock => b.type === 'text')
          .map((b) => b.text)
          .join('');

        // Track reflection cost
        this.usage.inputTokens += response.usage.input_tokens;
        this.usage.outputTokens += response.usage.output_tokens;
        this.usage.cacheReadTokens += response.usage.cache_read_input_tokens ?? 0;
        this.usage.cacheWriteTokens += response.usage.cache_creation_input_tokens ?? 0;

        return text;
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
