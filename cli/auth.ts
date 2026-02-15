// cli/auth.ts — Auth message construction

import type { AgentRole, ClientMessage } from '../src/types/index.js';

export function createAuthMessage(name: string): ClientMessage {
  return { type: 'auth', name };
}

export function createRoleSelectionMessage(role: AgentRole): ClientMessage {
  return { type: 'select_role', role };
}

export function createPingMessage(): ClientMessage {
  return { type: 'ping' };
}
