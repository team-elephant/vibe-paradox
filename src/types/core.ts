// types/core.ts — Fundamental types

export type EntityId = string;
export type Tick = number;
export type ChunkKey = string;

export interface Position {
  x: number;
  y: number;
}

export function distance(a: Position, b: Position): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

export function chunkOf(pos: Position, chunkSize: number): ChunkKey {
  const cx = Math.floor(pos.x / chunkSize);
  const cy = Math.floor(pos.y / chunkSize);
  return `${cx}_${cy}`;
}
