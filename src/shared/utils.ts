// shared/utils.ts — ID generation, timestamp helpers

import { randomBytes } from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

function nanoid(size: number): string {
  const bytes = randomBytes(size);
  let id = '';
  for (let i = 0; i < size; i++) {
    id += ALPHABET[bytes[i]! % ALPHABET.length];
  }
  return id;
}

export function generateAgentId(): string {
  return `agent_${nanoid(8)}`;
}

export function generateNpcId(): string {
  return `npc_${nanoid(8)}`;
}

export function generateResourceId(): string {
  return `res_${nanoid(8)}`;
}

export function generateBehemothId(): string {
  return `beh_${nanoid(8)}`;
}

export function generateStructureId(): string {
  return `str_${nanoid(8)}`;
}

export function generateTradeId(): string {
  return `trade_${nanoid(8)}`;
}

export function generateMessageId(): string {
  return `msg_${nanoid(8)}`;
}

export function generateAllianceId(): string {
  return `ally_${nanoid(8)}`;
}

export function nowISO(): string {
  return new Date().toISOString();
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
