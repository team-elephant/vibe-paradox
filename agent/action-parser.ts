// agent/action-parser.ts — Robust JSON extraction from LLM responses

import type { ActionType } from '../src/types/index.js';

export interface ParsedDecision {
  action: ActionType;
  params: Record<string, unknown>;
  plan: string;
}

const KNOWN_ACTIONS: Set<string> = new Set([
  'move', 'gather', 'craft', 'attack', 'talk', 'inspect',
  'trade', 'trade_respond', 'plant', 'water', 'feed', 'climb',
  'form_alliance', 'join_alliance', 'leave_alliance', 'idle',
]);

/**
 * Parses an LLM response into a structured decision.
 * Handles: raw JSON, markdown-wrapped JSON (```json...```), mixed text with JSON.
 * Returns null if parsing fails entirely.
 */
export function parseDecision(llmResponse: string): ParsedDecision | null {
  const trimmed = llmResponse.trim();

  // Try 1: direct JSON parse
  const direct = tryParseJson(trimmed);
  if (direct) return direct;

  // Try 2: extract from markdown code block (with or without closing fence)
  const codeBlockMatch = trimmed.match(/```(?:json|JSON)?\s*\n?([\s\S]*?)```/);
  if (codeBlockMatch) {
    const extracted = tryParseJson(codeBlockMatch[1].trim());
    if (extracted) return extracted;
  }

  // Try 2b: truncated code block (opening fence but no closing fence — LLM hit max_tokens)
  if (!codeBlockMatch) {
    const openFenceMatch = trimmed.match(/```(?:json|JSON)?\s*\n?([\s\S]*)/);
    if (openFenceMatch) {
      const extracted = tryParseJson(openFenceMatch[1].trim());
      if (extracted) return extracted;
    }
  }

  // Try 3: find first { ... } in the response
  const braceStart = trimmed.indexOf('{');
  const braceEnd = trimmed.lastIndexOf('}');
  if (braceStart !== -1 && braceEnd > braceStart) {
    const jsonCandidate = trimmed.slice(braceStart, braceEnd + 1);
    const extracted = tryParseJson(jsonCandidate);
    if (extracted) return extracted;
  }

  // Try 4: truncated JSON — attempt repair by appending common closing sequences
  if (braceStart !== -1) {
    const partial = trimmed.slice(braceStart);
    for (const suffix of ['"}', '"}}', '}}', '}', '"}}']) {
      const repaired = tryParseJson(partial + suffix);
      if (repaired) return repaired;
    }
  }

  return null;
}

function tryParseJson(text: string): ParsedDecision | null {
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;

    const action = parsed.action;
    if (typeof action !== 'string' || !KNOWN_ACTIONS.has(action)) {
      return null;
    }

    const params = (typeof parsed.params === 'object' && parsed.params !== null)
      ? parsed.params as Record<string, unknown>
      : {};

    const plan = typeof parsed.plan === 'string'
      ? parsed.plan
      : '';

    return {
      action: action as ActionType,
      params,
      plan,
    };
  } catch {
    return null;
  }
}
