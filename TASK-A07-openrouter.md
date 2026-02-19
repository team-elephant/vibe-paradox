# TASK-A07: OpenRouter Integration

- **Status:** READY
- **Priority:** Medium
- **Track:** A
- **Depends on:** A05 ✅

## Description

Replace direct Anthropic SDK calls with OpenRouter-compatible endpoint. This lets us swap models (Haiku, Sonnet, Gemini Flash, DeepSeek, Llama, etc.) via env var without code changes.

OpenRouter uses the OpenAI-compatible chat completions API with an extra `HTTP-Referer` and `X-Title` header. One SDK change, all models unlocked.

## What Changes

The agent planner (`agent/pipeline/planner.ts`) currently calls the Anthropic SDK directly. Swap to OpenRouter's OpenAI-compatible endpoint.

### Option A: Use OpenAI SDK (recommended)
```typescript
import OpenAI from 'openai';

const client = new OpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: process.env.OPENROUTER_API_KEY,
  defaultHeaders: {
    'HTTP-Referer': 'https://vibeparadox.com',
    'X-Title': 'Vibe Paradox',
  },
});

const response = await client.chat.completions.create({
  model: process.env.VIBE_PARADOX_MODEL || 'anthropic/claude-haiku-4-5-20251001',
  messages: [{ role: 'user', content: plannerPrompt }],
  max_tokens: 500,
  response_format: { type: 'json_object' },
});
```

### Option B: Raw fetch (zero deps)
```typescript
const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
    'Content-Type': 'application/json',
    'HTTP-Referer': 'https://vibeparadox.com',
    'X-Title': 'Vibe Paradox',
  },
  body: JSON.stringify({
    model: process.env.VIBE_PARADOX_MODEL || 'anthropic/claude-haiku-4-5-20251001',
    messages: [{ role: 'user', content: plannerPrompt }],
    max_tokens: 500,
  }),
});
```

**Recommend Option B** — zero new deps, planner already constructs a single prompt, no conversation history needed.

## Scope (files you MAY touch)

- `agent/pipeline/planner.ts` — swap LLM call from Anthropic SDK to OpenRouter fetch
- `agent/pipeline/memory.ts` — if reflection uses a separate LLM call, swap that too
- `agent/llm.ts` (create) — shared LLM client wrapper, both planner and memory import from here
- `agent/pipeline/__tests__/planner.test.ts` — update mocks

## Scope (files you may NOT touch)

- `src/server/*` (Track B territory)
- `agent/brain.ts` (pipeline wiring — already done)
- `agent/pipeline/perception.ts`, `salience.ts`, `drives.ts`, `router.ts` (deterministic stages — no LLM)
- `agent/plan-executor.ts` (no LLM)

## Implementation Steps

1. Create `agent/llm.ts` — thin wrapper:
   ```typescript
   export async function llmCall(prompt: string, options?: {
     model?: string;
     maxTokens?: number;
     jsonMode?: boolean;
   }): Promise<{ content: string; usage: { input_tokens: number; output_tokens: number } }> {
     // Check which provider to use
     const provider = process.env.LLM_PROVIDER || 'openrouter'; // 'openrouter' | 'anthropic'
     
     if (provider === 'openrouter') {
       // OpenRouter fetch call
     } else {
       // Keep Anthropic SDK as fallback
     }
   }
   ```

2. Update `planner.ts` — import from `agent/llm.ts` instead of Anthropic SDK directly

3. Update `memory.ts` — same, use shared `llmCall()` for reflections

4. Update cost tracking — OpenRouter returns usage in OpenAI format:
   ```json
   { "usage": { "prompt_tokens": 123, "completion_tokens": 45 } }
   ```
   Map to our existing cost tracker fields.

5. Add model name to cost logs so we can compare costs across models.

## Environment Variables

```bash
# New
OPENROUTER_API_KEY=sk-or-...           # OpenRouter API key
LLM_PROVIDER=openrouter                # 'openrouter' (default) | 'anthropic' (fallback)

# Updated meaning
VIBE_PARADOX_MODEL=anthropic/claude-haiku-4-5-20251001  # OpenRouter model string

# Popular models to try:
# anthropic/claude-haiku-4-5-20251001    — $0.80/MTok in, $4/MTok out (baseline)
# google/gemini-2.0-flash-001           — $0.10/MTok in, $0.40/MTok out (cheap)
# deepseek/deepseek-chat-v3-0324        — $0.14/MTok in, $0.28/MTok out (cheap)  
# meta-llama/llama-3.3-70b-instruct     — $0.30/MTok in, $0.40/MTok out (open)
# anthropic/claude-sonnet-4-5-20250929  — $3/MTok in, $15/MTok out (smart)
```

## Cost Comparison (6 agents, brain v2, per hour)

| Model | Input $/MTok | Output $/MTok | Est. cost/hr |
|---|---|---|---|
| Haiku (direct) | $0.25 | $1.25 | ~$0.18 |
| Haiku (OpenRouter) | $0.80 | $4.00 | ~$0.50 |
| Gemini Flash | $0.10 | $0.40 | ~$0.06 |
| DeepSeek V3 | $0.14 | $0.28 | ~$0.05 |
| Llama 3.3 70B | $0.30 | $0.40 | ~$0.08 |
| Sonnet (OpenRouter) | $3.00 | $15.00 | ~$3.50 |

**Note:** OpenRouter adds markup over direct API pricing. But the model variety is worth it. For soak tests, Gemini Flash or DeepSeek at $0.05-0.06/hr is 3x cheaper than direct Haiku.

## Testing

1. Unit tests: mock the fetch call, verify prompt assembly and response parsing
2. Integration test: set OPENROUTER_API_KEY, run 1 agent for 10 ticks, verify plans come back
3. Model swap test: change VIBE_PARADOX_MODEL env var, restart agent, verify different model works
4. Fallback test: set LLM_PROVIDER=anthropic, verify direct SDK still works

## Definition of Done

- [ ] `agent/llm.ts` created with OpenRouter + Anthropic fallback
- [ ] Planner uses `llmCall()` instead of direct SDK
- [ ] Memory reflections use `llmCall()`
- [ ] Cost tracking works with OpenRouter usage format
- [ ] Model name logged in cost reports
- [ ] Can swap models via env var without code changes
- [ ] Anthropic direct SDK still works as fallback
- [ ] Tests pass: `npx vitest run && npx tsc --noEmit`
- [ ] Scope check passes: `./scripts/scope-check.sh TASK-A07`
