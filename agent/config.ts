// agent/config.ts — AgentConfig interface + defaults + env var loading

import type { AgentRole } from '../src/types/index.js';

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

  // Decision tuning
  idleTimeout: number;           // ticks without action before forcing a decision
  maxEventsInPrompt: number;     // max events included in prompt
  maxMessagesInPrompt: number;   // max chat messages included in prompt
  decisionCooldown: number;      // min ticks between LLM calls
}

const DEFAULTS = {
  model: 'claude-sonnet-4-5-20250929',
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
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY environment variable is required');
  }

  return {
    serverUrl: overrides.serverUrl,
    name: overrides.name,
    role: overrides.role,
    apiKey,
    model: process.env.VIBE_PARADOX_MODEL ?? DEFAULTS.model,
    maxTokens: DEFAULTS.maxTokens,
    temperature: DEFAULTS.temperature,
    idleTimeout: DEFAULTS.idleTimeout,
    maxEventsInPrompt: DEFAULTS.maxEventsInPrompt,
    maxMessagesInPrompt: DEFAULTS.maxMessagesInPrompt,
    decisionCooldown: DEFAULTS.decisionCooldown,
  };
}
