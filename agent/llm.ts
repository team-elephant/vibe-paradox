// agent/llm.ts — Shared LLM client wrapper
//
// Supports two providers:
//   - 'openrouter' (default): OpenRouter's OpenAI-compatible API via fetch
//   - 'anthropic': Direct Anthropic SDK (fallback)
//
// Both planner.ts and memory.ts import from here.

import type { LlmCreateFn } from './pipeline/planner.js';
import type { LlmCallFn } from './pipeline/memory.js';

export type LlmProvider = 'openrouter' | 'anthropic';

export interface LlmConfig {
  provider: LlmProvider;
  apiKey: string;
  model: string;
}

// --- OpenRouter provider ---

interface OpenRouterChoice {
  message?: { content?: string };
}

interface OpenRouterResponse {
  choices?: OpenRouterChoice[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
  error?: { message?: string };
}

async function openRouterCall(params: {
  system: string;
  user: string;
  model: string;
  maxTokens: number;
  temperature: number;
  apiKey: string;
}): Promise<{
  text: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}> {
  const body = {
    model: params.model,
    messages: [
      { role: 'system', content: params.system },
      { role: 'user', content: params.user },
    ],
    max_tokens: params.maxTokens,
    temperature: params.temperature,
  };

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://vibeparadox.com',
      'X-Title': 'Vibe Paradox',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => 'unknown error');
    throw new Error(`OpenRouter API error ${res.status}: ${errorText}`);
  }

  const data = (await res.json()) as OpenRouterResponse;

  if (data.error) {
    throw new Error(`OpenRouter error: ${data.error.message}`);
  }

  const text = data.choices?.[0]?.message?.content ?? '';
  const inputTokens = data.usage?.prompt_tokens ?? 0;
  const outputTokens = data.usage?.completion_tokens ?? 0;

  return {
    text,
    inputTokens,
    outputTokens,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  };
}

// --- Anthropic provider ---

async function anthropicCall(params: {
  system: string;
  user: string;
  model: string;
  maxTokens: number;
  temperature: number;
  apiKey: string;
}): Promise<{
  text: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}> {
  // Dynamic import so we don't hard-fail if the SDK isn't installed
  // when using OpenRouter exclusively
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: params.apiKey });

  const response = await client.messages.create({
    model: params.model,
    max_tokens: params.maxTokens,
    temperature: params.temperature,
    system: [{ type: 'text', text: params.system, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: params.user }],
  });

  let text = '';
  for (const block of response.content) {
    if (block.type === 'text') {
      text += block.text;
    }
  }

  const usage = response.usage as unknown as Record<string, number>;

  return {
    text,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
  };
}

// --- Factory: create LlmCreateFn for planner ---

export function createPlannerLlm(config: LlmConfig): LlmCreateFn {
  return async (params) => {
    const callFn = config.provider === 'openrouter' ? openRouterCall : anthropicCall;
    return callFn({
      system: params.system,
      user: params.user,
      model: params.model,
      maxTokens: params.maxTokens,
      temperature: params.temperature,
      apiKey: config.apiKey,
    });
  };
}

// --- Factory: create LlmCallFn for memory reflections ---

export function createReflectionLlm(config: LlmConfig): LlmCallFn {
  return async (prompt: string): Promise<string> => {
    const callFn = config.provider === 'openrouter' ? openRouterCall : anthropicCall;
    const result = await callFn({
      system: 'You are a helpful assistant.',
      user: prompt,
      model: config.model,
      maxTokens: 150,
      temperature: 0.7,
      apiKey: config.apiKey,
    });
    return result.text;
  };
}

// --- Simple llmCall for memory reflections that also returns usage ---

export interface ReflectionResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export function createReflectionLlmWithUsage(config: LlmConfig): (prompt: string) => Promise<ReflectionResult> {
  return async (prompt: string): Promise<ReflectionResult> => {
    const callFn = config.provider === 'openrouter' ? openRouterCall : anthropicCall;
    return callFn({
      system: 'You are a helpful assistant.',
      user: prompt,
      model: config.model,
      maxTokens: 150,
      temperature: 0.7,
      apiKey: config.apiKey,
    });
  };
}
