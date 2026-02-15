import { describe, it, expect } from 'vitest';
import { SeededRng } from '../src/server/rng.js';

describe('SeededRng', () => {
  it('same seed produces same sequence', () => {
    const rng1 = new SeededRng(42);
    const rng2 = new SeededRng(42);

    const seq1 = Array.from({ length: 100 }, () => rng1.next());
    const seq2 = Array.from({ length: 100 }, () => rng2.next());

    expect(seq1).toEqual(seq2);
  });

  it('different seeds produce different sequences', () => {
    const rng1 = new SeededRng(42);
    const rng2 = new SeededRng(123);

    const seq1 = Array.from({ length: 10 }, () => rng1.next());
    const seq2 = Array.from({ length: 10 }, () => rng2.next());

    expect(seq1).not.toEqual(seq2);
  });

  it('next() returns values in [0, 1)', () => {
    const rng = new SeededRng(99);

    for (let i = 0; i < 1000; i++) {
      const val = rng.next();
      expect(val).toBeGreaterThanOrEqual(0);
      expect(val).toBeLessThan(1);
    }
  });

  it('nextInt returns values in [min, max] inclusive', () => {
    const rng = new SeededRng(77);

    const results = new Set<number>();
    for (let i = 0; i < 1000; i++) {
      const val = rng.nextInt(3, 7);
      expect(val).toBeGreaterThanOrEqual(3);
      expect(val).toBeLessThanOrEqual(7);
      expect(Number.isInteger(val)).toBe(true);
      results.add(val);
    }

    // Should hit all values 3-7 in 1000 tries
    expect(results.size).toBe(5);
  });

  it('nextFloat returns values in [min, max)', () => {
    const rng = new SeededRng(55);

    for (let i = 0; i < 1000; i++) {
      const val = rng.nextFloat(10, 20);
      expect(val).toBeGreaterThanOrEqual(10);
      expect(val).toBeLessThan(20);
    }
  });

  it('chance returns boolean and respects probability', () => {
    const rng = new SeededRng(33);

    // With p=1 should always return true
    for (let i = 0; i < 100; i++) {
      expect(rng.chance(1)).toBe(true);
    }

    // With p=0 should always return false
    const rng2 = new SeededRng(33);
    for (let i = 0; i < 100; i++) {
      expect(rng2.chance(0)).toBe(false);
    }

    // With p=0.5, should get roughly half true (statistical but robust with 10000 samples)
    const rng3 = new SeededRng(44);
    let trueCount = 0;
    const samples = 10000;
    for (let i = 0; i < samples; i++) {
      if (rng3.chance(0.5)) trueCount++;
    }
    expect(trueCount).toBeGreaterThan(samples * 0.4);
    expect(trueCount).toBeLessThan(samples * 0.6);
  });
});
