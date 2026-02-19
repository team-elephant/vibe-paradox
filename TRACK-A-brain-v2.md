# TRACK A — Agent Brain v2: ALIVE-Informed Architecture

## Overview

Rewrite the agent decision system to eliminate per-tick LLM calls. Current brain calls the LLM every game tick (~1/second), costing $30+/hour for 6 agents on Haiku. The new architecture uses a deterministic pipeline (inspired by the ALIVE cognitive system and Stanford's Generative Agents paper) that only calls the LLM when a plan is needed or interrupted.

**Target: reduce LLM calls from ~360/min → ~3-5/min for 6 agents (70-100x reduction).**

## Architecture

The brain processes each tick through a pipeline of deterministic stages, with a single LLM call at the end ONLY when the router decides it's necessary.

```
TICK INPUT (world state from server)
       │
       ▼
[1] PERCEPTION — What changed since last tick?
       │
       ▼
[2] SALIENCE GATE — Does this matter enough to interrupt?
       │
       ▼
[3] DRIVES — What do I want? (deterministic math)
       │
       ▼
[4] ROUTER — Do I need to re-think?
       │         │                │
       ▼         ▼                ▼
   EXECUTE   INTERRUPT       PLAN_COMPLETE
   (no LLM)  (call LLM)     (call LLM)
       │         │                │
       ▼         ▼                ▼
[5] PLANNER — Returns multi-step plan (5-20 actions)
       │
       ▼
[6] MEMORY — Log significant events, periodic reflection
```

## Files to Create/Modify

### New files:
- `agent/pipeline/perception.ts` — Stage 1: Delta detection
- `agent/pipeline/salience.ts` — Stage 2: Event scoring & gating
- `agent/pipeline/drives.ts` — Stage 3: Deterministic drive system
- `agent/pipeline/router.ts` — Stage 4: Decision routing
- `agent/pipeline/planner.ts` — Stage 5: LLM plan generation
- `agent/pipeline/memory.ts` — Stage 6: Event logging + reflection
- `agent/plan-executor.ts` — Local plan step execution (no LLM)

### Modify:
- `agent/brain.ts` — Replace monolithic LLM-every-tick with pipeline
- `agent/index.ts` — Wire new pipeline into agent loop

### Do NOT modify:
- `src/server/*` — Game server is Track B territory
- `src/server/dashboard.html` — Track B territory
- Test files — update tests for new architecture

---

## Stage 1: PERCEPTION (`perception.ts`)

Compares current tick state to previous tick state. Returns only what changed.

```typescript
interface Perception {
  type: 'threat_appeared' | 'threat_gone' | 'hp_changed' | 'inventory_changed' |
        'resource_nearby' | 'agent_nearby' | 'plan_step_completed' | 'plan_step_failed' |
        'got_attacked' | 'entity_died' | 'trade_offered' | 'message_received' |
        'level_up' | 'nothing';
  details: Record<string, any>;
  tick: number;
}

function perceive(prevState: WorldState | null, currState: WorldState): Perception[] {
  // Compare entities in vision range
  // Compare HP, inventory, gold
  // Check if current plan step completed or failed
  // Return list of changes (empty if nothing changed)
}
```

Key: If perception returns empty → skip everything, continue executing current plan step.

---

## Stage 2: SALIENCE GATE (`salience.ts`)

Scores each perception. Only high-salience events trigger re-planning.

```typescript
interface SalienceResult {
  shouldInterrupt: boolean;
  maxSalience: number;
  significantEvents: ScoredPerception[];
}

const SALIENCE_SCORES: Record<string, number> = {
  'got_attacked': 1.0,          // Always interrupt
  'hp_changed': 0.8,            // Usually interrupt (took damage)
  'threat_appeared': 0.7,       // Strong enemy nearby
  'trade_offered': 0.6,         // Opportunity
  'plan_step_failed': 0.6,      // Need new approach
  'plan_step_completed': 0.3,   // Expected — continue plan
  'resource_nearby': 0.2,       // Low — note but don't interrupt
  'agent_nearby': 0.2,          // Low — note but don't interrupt
  'nothing': 0.0,               // No-op
};

const INTERRUPT_THRESHOLD = 0.5;
```

Role-specific modifiers:
- **Fighter**: threat_appeared gets +0.2, resource_nearby gets -0.1
- **Merchant**: trade_offered gets +0.2, resource_nearby gets +0.2
- **Monster**: agent_nearby gets +0.3 (prey detected)

---

## Stage 3: DRIVES (`drives.ts`)

Deterministic floating-point values (0.0–1.0) updated every tick. No LLM. Inspired by ALIVE's hypothalamus.

```typescript
interface Drives {
  survival: number;   // f(HP ratio, nearby threat count, nearby threat strength)
  greed: number;      // f(gold amount, nearby resources, inventory space)
  ambition: number;   // f(level, XP to next, nearby XP sources like monsters)
  social: number;     // f(nearby agents, time since last trade, time since last chat)
  caution: number;    // f(HP ratio, death count, recent damage taken)
}

function updateDrives(prev: Drives, state: WorldState, perceptions: Perception[]): Drives {
  // Pure math — examples:
  // survival = 1.0 - (hp / maxHp) + (nearbyThreats * 0.2)
  // greed = max(0, 1.0 - (gold / 100)) + (nearbyResources * 0.1)
  // ambition = (xpToNextLevel < 50) ? 0.8 : 0.3
  // Clamp all to [0, 1]
}
```

Drives are passed to the planner as context so the LLM knows what the agent "wants."

---

## Stage 4: ROUTER (`router.ts`)

The critical decision point. Inspired by ALIVE's thalamus.

```typescript
type RouteDecision =
  | { type: 'EXECUTE_PLAN' }          // Continue current plan, no LLM
  | { type: 'INTERRUPT'; reason: string }    // Re-plan due to high-salience event
  | { type: 'PLAN_COMPLETE' }         // Plan finished, need new one
  | { type: 'PLAN_EMPTY' }           // No plan exists (first tick)

function route(
  currentPlan: Plan | null,
  currentStepIndex: number,
  salience: SalienceResult,
  drives: Drives,
  ticksSinceLastPlan: number
): RouteDecision {
  // No plan → PLAN_EMPTY
  // Plan exists, all steps done → PLAN_COMPLETE
  // High salience event → INTERRUPT
  // Stuck too long (>60 ticks on same step) → INTERRUPT with "stuck" reason
  // Otherwise → EXECUTE_PLAN
}
```

**EXECUTE_PLAN is the common case.** This is what makes it cheap — most ticks just execute the next local action.

---

## Stage 5: PLANNER (`planner.ts`)

The ONE LLM call. Only fires when router says INTERRUPT, PLAN_COMPLETE, or PLAN_EMPTY.

```typescript
interface Plan {
  steps: PlanStep[];
  reasoning: string;  // Why this plan (for memory/debugging)
  createdAtTick: number;
}

interface PlanStep {
  action: string;       // Action type from game protocol
  params: Record<string, any>;
  description: string;  // Human-readable "move to forest at (400,300)"
  expectedTicks: number; // How long this step should take
}
```

### Prompt Design

The planner prompt should be compact. Include:
1. Agent role + stats (HP, ATK, DEF, gold, inventory, position)
2. Current drives (as natural language: "You're low on health and feeling cautious")
3. Nearby entities (filtered — only what's in vision range, max 10 most relevant)
4. Last plan outcome (succeeded/failed/interrupted + why)
5. Memory summary (last 5 significant events)
6. Instruction: "Return a plan of 5-20 sequential actions."

```
You are {name}, a {role} in Vibe Paradox.

Stats: HP {hp}/{maxHp} | ATK {atk} | DEF {def} | Gold {gold} | Level {level}
Position: ({x}, {y})
Inventory: {items}

Your drives:
- Survival: {survival_description}
- Greed: {greed_description}
- Ambition: {ambition_description}

Nearby (within vision):
{filtered_entity_list}

Last plan: {outcome}
Recent memory: {memory_summary}

Create a plan of 5-20 sequential actions. Each action must be one of:
- move <x> <y>
- gather
- attack <target_id>
- craft <recipe>
- trade <target_id> <offer_item> <request_item>
- rest
- chat <target_id> <message>
- idle <ticks>

Respond with JSON:
{
  "reasoning": "brief explanation of strategy",
  "steps": [
    {"action": "move", "params": {"x": 400, "y": 300}, "description": "Move to forest", "expectedTicks": 30},
    ...
  ]
}
```

### Context Budget

Keep total prompt under 1500 tokens input. This is NOT a conversation — it's a single structured query.
- Agent header: ~100 tokens
- Drives: ~50 tokens
- Nearby entities: ~200 tokens (cap at 10 entities)
- Last plan + memory: ~200 tokens
- Instructions + format: ~300 tokens
- **Total: ~850 tokens input, ~300 tokens output**

At Haiku pricing ($0.25/MTok input, $1.25/MTok output):
- Per call: ~$0.0006
- 5 calls/min across 6 agents: ~$0.003/min = **$0.18/hour**

---

## Stage 6: MEMORY (`memory.ts`)

Lightweight event log + periodic reflection. Inspired by Stanford's memory stream but much simpler.

```typescript
interface MemoryEntry {
  tick: number;
  type: 'action' | 'observation' | 'reflection';
  content: string;
  importance: number; // 1-10
}

class AgentMemory {
  entries: MemoryEntry[] = [];  // Capped at 100 most recent
  reflections: string[] = [];   // Higher-level summaries

  // Log significant events (not every tick — only when something happens)
  log(entry: MemoryEntry): void;

  // Every 10 plans, generate a reflection (1 LLM call)
  // "Based on recent experiences, what have you learned?"
  async reflect(): Promise<string>;

  // Return compact summary for planner context (last 5 significant events + 1 reflection)
  getSummary(): string;
}
```

Reflections happen rarely — every ~10 planning cycles. At 1 plan every 30-60 seconds, that's one reflection every 5-10 minutes. Negligible cost.

---

## Plan Executor (`plan-executor.ts`)

Executes plan steps locally without LLM. Translates plan steps into game protocol actions.

```typescript
class PlanExecutor {
  private plan: Plan | null = null;
  private stepIndex: number = 0;
  private ticksOnCurrentStep: number = 0;

  // Set a new plan (from planner)
  setPlan(plan: Plan): void;

  // Get the next action to send to server (called every tick when router says EXECUTE_PLAN)
  getNextAction(state: WorldState): GameAction | null {
    const step = this.plan.steps[this.stepIndex];

    // Translate plan step to game action
    // "move 400 300" → { type: 'move', params: { x: 400, y: 300 } }
    // "gather" → { type: 'gather_resource', params: { targetId: nearestResource.id } }
    // "attack goblin_12" → { type: 'attack', params: { targetId: 'goblin_12' } }
  }

  // Check if current step is complete
  isStepComplete(state: WorldState): boolean {
    // "move 400 300" → agent position within 5 units of target
    // "gather" → gather action confirmed by server event
    // "attack goblin_12" → target dead or out of range
  }

  // Advance to next step
  advanceStep(): void;

  // Is entire plan done?
  isPlanComplete(): boolean;
}
```

---

## Cost Tracking (Carry Forward)

Keep the existing cost tracking from v1. Log every LLM call with:
- Agent name
- Tick number
- Input/output tokens
- Cache hits
- Running total cost estimate

Every 20 plans (not decisions), log a summary line.

---

## Cooldowns & Budget (from ALIVE's Arbiter)

Hard limits to prevent runaway costs:

```typescript
const LIMITS = {
  MIN_TICKS_BETWEEN_PLANS: 10,        // At least 10 ticks (~10s) between LLM calls per agent
  MAX_PLANS_PER_MINUTE: 3,            // Per agent
  MAX_PLANS_PER_HOUR: 60,             // Per agent
  STUCK_THRESHOLD_TICKS: 60,          // Re-plan if stuck for 60 ticks
  MAX_PLAN_STEPS: 20,                 // Cap plan length
  MEMORY_CAP: 100,                    // Max memory entries before pruning
  REFLECTION_INTERVAL_PLANS: 10,      // Reflect every N plans
};
```

---

## Testing

```bash
# Unit tests for each pipeline stage
npx vitest run agent/pipeline/

# Integration test: run 6 agents for 100 ticks, verify:
# - Total LLM calls < 20 (not 100)
# - Plans are multi-step (avg > 5 steps)
# - Cost tracker shows reduced cost
# - Agents actually do things (gather, fight, move)

# Type check
npx tsc --noEmit
```

Test scenarios:
1. **Idle agent** — no threats, no resources nearby → should make 1 plan (explore), execute for many ticks
2. **Combat interrupt** — agent mid-plan, gets attacked → should re-plan immediately
3. **Merchant trade** — merchant near fighter with gold → should plan: approach, trade
4. **Stuck detection** — agent can't reach target → should re-plan after threshold
5. **Cost verification** — run 6 agents for 200 ticks, total LLM calls should be < 50

---

## Migration

1. Keep `agent/brain.ts` as `agent/brain-v1.ts` for reference
2. New `agent/brain.ts` implements the pipeline
3. Feature flag: `AGENT_BRAIN_VERSION=2` env var (default v2, fallback to v1)
4. All existing agent CLI flags (`--fighters`, `--merchants`, `--monsters`) work unchanged

---

## Success Criteria

- [ ] 6 agents run for 1 hour on Haiku for < $0.50
- [ ] Agents create multi-step plans (visible in logs)
- [ ] Agents interrupt plans when attacked
- [ ] Agents resume plans after combat
- [ ] Merchants gather → craft → trade (multi-step behavior emerges)
- [ ] All existing tests pass
- [ ] `npx tsc --noEmit` passes
