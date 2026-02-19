// agent/config.ts — AgentConfig interface + defaults + env var loading

import type { AgentRole } from '../src/types/index.js';
import type { LlmProvider } from './llm.js';

export interface AgentConfig {
  // Connection
  serverUrl: string;
  name: string;
  role: AgentRole;

  // LLM settings
  apiKey: string;
  model: string;
  maxTokens: number;
  temperature: number;
  llmProvider: LlmProvider;

  // Decision tuning
  idleTimeout: number;           // ticks without action before forcing a decision
  maxEventsInPrompt: number;     // max events included in prompt
  maxMessagesInPrompt: number;   // max chat messages included in prompt
  decisionCooldown: number;      // min ticks between LLM calls
}

const DEFAULTS = {
  model: 'anthropic/claude-haiku-4-5-20251001',
  maxTokens: 200,
  temperature: 0.7,
  idleTimeout: 5,
  maxEventsInPrompt: 5,
  maxMessagesInPrompt: 3,
  decisionCooldown: 2,
} as const;

export function loadConfig(overrides: {
  serverUrl: string;
  name: string;
  role: AgentRole;
}): AgentConfig {
  const llmProvider = (process.env.LLM_PROVIDER ?? 'openrouter') as LlmProvider;

  // Pick the right API key based on provider
  let apiKey: string;
  if (llmProvider === 'openrouter') {
    apiKey = process.env.OPENROUTER_API_KEY ?? '';
    if (!apiKey) {
      // Fall back to ANTHROPIC_API_KEY if set (user may have it configured)
      apiKey = process.env.ANTHROPIC_API_KEY ?? '';
    }
  } else {
    apiKey = process.env.ANTHROPIC_API_KEY ?? '';
  }

  if (!apiKey) {
    const keyName = llmProvider === 'openrouter' ? 'OPENROUTER_API_KEY' : 'ANTHROPIC_API_KEY';
    throw new Error(`${keyName} environment variable is required (LLM_PROVIDER=${llmProvider})`);
  }

  return {
    serverUrl: overrides.serverUrl,
    name: overrides.name,
    role: overrides.role,
    apiKey,
    llmProvider,
    model: process.env.VIBE_PARADOX_MODEL ?? DEFAULTS.model,
    maxTokens: DEFAULTS.maxTokens,
    temperature: DEFAULTS.temperature,
    idleTimeout: DEFAULTS.idleTimeout,
    maxEventsInPrompt: DEFAULTS.maxEventsInPrompt,
    maxMessagesInPrompt: DEFAULTS.maxMessagesInPrompt,
    decisionCooldown: DEFAULTS.decisionCooldown,
  };
}
