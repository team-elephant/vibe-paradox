// server/chunk-manager.ts — Spatial indexing via chunk grid

import type { EntityId, Position, ChunkKey } from '../types/index.js';
import { chunkOf, distance } from '../types/index.js';
import { CHUNK_SIZE } from '../shared/constants.js';

export class ChunkManager {
  private chunks: Map<ChunkKey, Set<EntityId>> = new Map();
  private entityPositions: Map<EntityId, Position> = new Map();

  addEntity(id: EntityId, pos: Position): void {
    const key = chunkOf(pos, CHUNK_SIZE);
    let chunk = this.chunks.get(key);
    if (!chunk) {
      chunk = new Set();
      this.chunks.set(key, chunk);
    }
    chunk.add(id);
    this.entityPositions.set(id, pos);
  }

  moveEntity(id: EntityId, oldPos: Position, newPos: Position): void {
    const oldKey = chunkOf(oldPos, CHUNK_SIZE);
    const newKey = chunkOf(newPos, CHUNK_SIZE);

    if (oldKey !== newKey) {
      const oldChunk = this.chunks.get(oldKey);
      if (oldChunk) {
        oldChunk.delete(id);
        if (oldChunk.size === 0) {
          this.chunks.delete(oldKey);
        }
      }

      let newChunk = this.chunks.get(newKey);
      if (!newChunk) {
        newChunk = new Set();
        this.chunks.set(newKey, newChunk);
      }
      newChunk.add(id);
    }
    this.entityPositions.set(id, newPos);
  }

  removeEntity(id: EntityId, pos: Position): void {
    const key = chunkOf(pos, CHUNK_SIZE);
    const chunk = this.chunks.get(key);
    if (chunk) {
      chunk.delete(id);
      if (chunk.size === 0) {
        this.chunks.delete(key);
      }
    }
    this.entityPositions.delete(id);
  }

  getEntitiesInRadius(center: Position, radius: number): EntityId[] {
    const chunkKeys = this.getChunksInRadius(center, radius);
    const result: EntityId[] = [];

    for (const key of chunkKeys) {
      const chunk = this.chunks.get(key);
      if (!chunk) continue;
      for (const id of chunk) {
        const pos = this.entityPositions.get(id);
        if (pos && distance(center, pos) <= radius) {
          result.push(id);
        }
      }
    }

    return result;
  }

  private getChunksInRadius(center: Position, radius: number): ChunkKey[] {
    const minCx = Math.floor((center.x - radius) / CHUNK_SIZE);
    const maxCx = Math.floor((center.x + radius) / CHUNK_SIZE);
    const minCy = Math.floor((center.y - radius) / CHUNK_SIZE);
    const maxCy = Math.floor((center.y + radius) / CHUNK_SIZE);

    const keys: ChunkKey[] = [];
    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cy = minCy; cy <= maxCy; cy++) {
        keys.push(`${cx}_${cy}`);
      }
    }
    return keys;
  }
}
