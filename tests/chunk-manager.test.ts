import { describe, it, expect } from 'vitest';
import { ChunkManager } from '../src/server/chunk-manager.js';
import type { Position } from '../src/types/index.js';
import { distance } from '../src/types/index.js';

function randomPos(): Position {
  return { x: Math.random() * 1000, y: Math.random() * 1000 };
}

describe('ChunkManager', () => {
  it('should add and retrieve entities', () => {
    const cm = new ChunkManager();
    cm.addEntity('a1', { x: 10, y: 10 });
    cm.addEntity('a2', { x: 15, y: 15 });

    const nearby = cm.getEntitiesInRadius({ x: 10, y: 10 }, 50);
    expect(nearby).toContain('a1');
    expect(nearby).toContain('a2');
  });

  it('should not return entities outside the chunk radius', () => {
    const cm = new ChunkManager();
    cm.addEntity('a1', { x: 10, y: 10 });
    cm.addEntity('a2', { x: 900, y: 900 });

    // Radius 50 around (10,10) — chunks won't overlap with (900,900)
    const nearby = cm.getEntitiesInRadius({ x: 10, y: 10 }, 50);
    expect(nearby).toContain('a1');
    expect(nearby).not.toContain('a2');
  });

  it('should add 100 entities and query radius correctly', () => {
    const cm = new ChunkManager();
    const entities: { id: string; pos: Position }[] = [];

    for (let i = 0; i < 100; i++) {
      const pos = randomPos();
      const id = `entity_${i}`;
      cm.addEntity(id, pos);
      entities.push({ id, pos });
    }

    const center: Position = { x: 500, y: 500 };
    const radius = 100;
    const result = cm.getEntitiesInRadius(center, radius);

    // Exact distance filtering: only entities truly within radius are returned
    for (const entity of entities) {
      const dist = distance(center, entity.pos);
      if (dist <= radius) {
        expect(result).toContain(entity.id);
      } else {
        expect(result).not.toContain(entity.id);
      }
    }
  });

  it('should move entity across chunk boundary correctly', () => {
    const cm = new ChunkManager();
    const oldPos: Position = { x: 10, y: 10 };  // chunk 0_0
    const newPos: Position = { x: 100, y: 100 }; // chunk 3_3

    cm.addEntity('mover', oldPos);

    // Entity should be found near old position
    let nearby = cm.getEntitiesInRadius(oldPos, 5);
    expect(nearby).toContain('mover');

    // Move it
    cm.moveEntity('mover', oldPos, newPos);

    // Old position should NOT contain it anymore
    nearby = cm.getEntitiesInRadius(oldPos, 5);
    expect(nearby).not.toContain('mover');

    // New position should contain it
    nearby = cm.getEntitiesInRadius(newPos, 5);
    expect(nearby).toContain('mover');
  });

  it('should handle move within same chunk (no-op)', () => {
    const cm = new ChunkManager();
    const pos1: Position = { x: 10, y: 10 };
    const pos2: Position = { x: 15, y: 15 };  // same chunk (0_0 for CHUNK_SIZE=32)

    cm.addEntity('same', pos1);
    cm.moveEntity('same', pos1, pos2);

    const nearby = cm.getEntitiesInRadius(pos2, 5);
    expect(nearby).toContain('same');
  });

  it('should remove entity from chunk', () => {
    const cm = new ChunkManager();
    const pos: Position = { x: 50, y: 50 };

    cm.addEntity('removable', pos);
    expect(cm.getEntitiesInRadius(pos, 5)).toContain('removable');

    cm.removeEntity('removable', pos);
    expect(cm.getEntitiesInRadius(pos, 5)).not.toContain('removable');
  });

  it('should handle multiple entities in the same chunk', () => {
    const cm = new ChunkManager();
    cm.addEntity('e1', { x: 5, y: 5 });
    cm.addEntity('e2', { x: 10, y: 10 });
    cm.addEntity('e3', { x: 20, y: 20 });

    const nearby = cm.getEntitiesInRadius({ x: 10, y: 10 }, 32);
    expect(nearby).toContain('e1');
    expect(nearby).toContain('e2');
    expect(nearby).toContain('e3');
  });

  it('should not return duplicates', () => {
    const cm = new ChunkManager();
    cm.addEntity('dup', { x: 50, y: 50 });

    const nearby = cm.getEntitiesInRadius({ x: 50, y: 50 }, 100);
    const count = nearby.filter(id => id === 'dup').length;
    expect(count).toBe(1);
  });

  it('should handle entities at world boundaries', () => {
    const cm = new ChunkManager();
    cm.addEntity('corner', { x: 999, y: 999 });

    const nearby = cm.getEntitiesInRadius({ x: 999, y: 999 }, 10);
    expect(nearby).toContain('corner');
  });

  it('should not return entity outside exact radius even if in neighboring chunk', () => {
    const cm = new ChunkManager();
    // Center at (100, 100). Entity at (133, 100) — distance exactly 33.
    // With radius 32, this entity is in a neighboring chunk but outside the exact radius.
    cm.addEntity('close_but_out', { x: 133, y: 100 });
    // Entity at (130, 100) — distance 30, within radius
    cm.addEntity('inside', { x: 130, y: 100 });

    const nearby = cm.getEntitiesInRadius({ x: 100, y: 100 }, 32);
    expect(nearby).not.toContain('close_but_out');
    expect(nearby).toContain('inside');
  });

  it('should handle zero radius query', () => {
    const cm = new ChunkManager();
    cm.addEntity('zero', { x: 50, y: 50 });

    // Zero radius still queries the chunk at the center
    const nearby = cm.getEntitiesInRadius({ x: 50, y: 50 }, 0);
    expect(nearby).toContain('zero');
  });
});
