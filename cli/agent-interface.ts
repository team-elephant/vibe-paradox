// cli/agent-interface.ts — stdin/stdout JSON interface
//
// stdout format: one JSON object per line (server messages)
// stdin format: one JSON object per line (action commands)

import { createInterface, type Interface } from 'node:readline';
import type { ServerMessage, ClientMessage, ActionType } from '../src/types/index.js';

/**
 * Writes a server message to stdout as a single JSON line.
 */
export function writeServerMessage(msg: ServerMessage): void {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

/**
 * Reads action commands from stdin line-by-line.
 * Each line is expected to be a JSON object matching the action format:
 *   { "action": "<type>", "params": {...}, "tick": <number> }
 *
 * Returns a readline interface and calls onAction for each valid line.
 */
export function startStdinReader(
  onAction: (msg: ClientMessage) => void,
): Interface {
  const rl = createInterface({
    input: process.stdin,
    terminal: false,
  });

  rl.on('line', (line: string) => {
    const trimmed = line.trim();
    if (trimmed === '') return;

    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;

      // Support shorthand: { action, params, tick } → wrap as ClientMessage
      if ('action' in parsed && typeof parsed.action === 'string') {
        const clientMsg: ClientMessage = {
          type: 'action',
          action: parsed.action as ActionType,
          params: (parsed.params ?? {}) as Record<string, unknown>,
          tick: (typeof parsed.tick === 'number' ? parsed.tick : 0),
        };
        onAction(clientMsg);
        return;
      }

      // Otherwise treat as a raw ClientMessage (e.g. { type: 'ping' })
      if ('type' in parsed) {
        onAction(parsed as ClientMessage);
        return;
      }

      // Unrecognized format — ignore
    } catch {
      // Malformed JSON — silently ignore
    }
  });

  return rl;
}
