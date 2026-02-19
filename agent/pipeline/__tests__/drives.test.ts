import { describe, it, expect } from 'vitest';
import {
  updateDrives,
  getDefaultDrives,
  describeDrives,
  type Drives,
  type DrivesContext,
} from '../drives.js';
import type { TickUpdateData } from '../../../src/types/protocol.js';
import type { AgentSelfView } from '../../../src/types/agent.js';
import type { Perception } from '../perception.js';

// --- Test helpers ---

function makeSelf(overrides: Partial<AgentSelfView> = {}): AgentSelfView {
  return {
    id: 'agent_1',
    name: 'TestAgent',
    role: 'fighter',
    position: { x: 100, y: 100 },
    status: 'idle',
    health: 100,
    maxHealth: 100,
    attack: 10,
    defense: 5,
    speed: 3,
    gold: 50,
    inventory: [],
    equipment: { weapon: null, armor: null, tool: null },
    alliance: null,
    kills: 0,
    evolutionStage: 0,
    actionCooldown: 0,
    ...overrides,
  };
}

function makeTick(overrides: Partial<TickUpdateData> = {}): TickUpdateData {
  return {
    tick: 1,
    self: makeSelf(),
    nearby: {
      agents: [],
      resources: [],
      monsters: [],
      behemoths: [],
      structures: [],
    },
    messages: [],
    events: [],
    ...overrides,
  };
}

function makeContext(overrides: Partial<DrivesContext> = {}): DrivesContext {
  return {
    recentDamageTaken: 0,
    ticksSinceLastTrade: 50,
    ticksSinceLastMessage: 50,
    deathCount: 0,
    ...overrides,
  };
}

function makePerception(type: Perception['type'], tick = 1): Perception {
  return { type, details: {}, tick };
}

// --- Tests ---

describe('updateDrives', () => {
  describe('default drives', () => {
    it('returns default drives when prev is null', () => {
      const drives = getDefaultDrives();
      expect(drives.survival).toBe(0.5);
      expect(drives.greed).toBe(0.5);
      expect(drives.ambition).toBe(0.5);
      expect(drives.social).toBe(0.3);
      expect(drives.caution).toBe(0.3);
    });
  });

  describe('clamping', () => {
    it('all drive values are clamped to [0, 1]', () => {
      const state = makeTick({ self: makeSelf({ health: 1, maxHealth: 100 }) });
      const ctx = makeContext({ recentDamageTaken: 999, deathCount: 100 });
      const drives = updateDrives(null, state, [makePerception('got_attacked')], ctx);

      for (const [key, value] of Object.entries(drives)) {
        expect(value, `${key} should be >= 0`).toBeGreaterThanOrEqual(0);
        expect(value, `${key} should be <= 1`).toBeLessThanOrEqual(1);
      }
    });

    it('drives stay within [0, 1] for healthy rich agent', () => {
      const state = makeTick({ self: makeSelf({ health: 100, gold: 500 }) });
      const ctx = makeContext();
      const drives = updateDrives(null, state, [], ctx);

      for (const [key, value] of Object.entries(drives)) {
        expect(value, `${key} should be >= 0`).toBeGreaterThanOrEqual(0);
        expect(value, `${key} should be <= 1`).toBeLessThanOrEqual(1);
      }
    });
  });

  describe('survival drive', () => {
    it('increases when HP is low', () => {
      const healthy = makeTick({ self: makeSelf({ health: 100, maxHealth: 100 }) });
      const injured = makeTick({ self: makeSelf({ health: 20, maxHealth: 100 }) });
      const ctx = makeContext();

      const dHealthy = updateDrives(null, healthy, [], ctx);
      const dInjured = updateDrives(null, injured, [], ctx);

      expect(dInjured.survival).toBeGreaterThan(dHealthy.survival);
    });

    it('increases when threats are nearby', () => {
      const noThreats = makeTick();
      const withThreats = makeTick({
        nearby: {
          agents: [],
          resources: [],
          monsters: [
            { id: 'm1', position: { x: 110, y: 100 }, type: 'goblin', health: 30, maxHealth: 30, evolutionStage: 0, isNpc: true, status: 'patrol' },
            { id: 'm2', position: { x: 120, y: 100 }, type: 'wolf', health: 20, maxHealth: 20, evolutionStage: 0, isNpc: true, status: 'chase' },
          ],
          behemoths: [],
          structures: [],
        },
      });
      const ctx = makeContext();

      const dSafe = updateDrives(null, noThreats, [], ctx);
      const dThreatened = updateDrives(null, withThreats, [], ctx);

      expect(dThreatened.survival).toBeGreaterThan(dSafe.survival);
    });

    it('spikes when got_attacked perception is present', () => {
      const state = makeTick();
      const ctx = makeContext();

      const dNormal = updateDrives(null, state, [], ctx);
      const dAttacked = updateDrives(null, state, [makePerception('got_attacked')], ctx);

      expect(dAttacked.survival).toBeGreaterThan(dNormal.survival);
    });
  });

  describe('greed drive', () => {
    it('decreases when agent has lots of gold', () => {
      const poor = makeTick({ self: makeSelf({ gold: 0 }) });
      const rich = makeTick({ self: makeSelf({ gold: 200 }) });
      const ctx = makeContext();

      const dPoor = updateDrives(null, poor, [], ctx);
      const dRich = updateDrives(null, rich, [], ctx);

      expect(dPoor.greed).toBeGreaterThan(dRich.greed);
    });

    it('increases when resources are nearby', () => {
      const noResources = makeTick();
      const withResources = makeTick({
        nearby: {
          agents: [],
          resources: [
            { id: 'r1', type: 'tree', position: { x: 105, y: 100 }, remaining: 3, state: 'available' },
            { id: 'r2', type: 'gold_vein', position: { x: 110, y: 100 }, remaining: 5, state: 'available' },
          ],
          monsters: [],
          behemoths: [],
          structures: [],
        },
      });
      const ctx = makeContext();

      const dEmpty = updateDrives(null, noResources, [], ctx);
      const dResources = updateDrives(null, withResources, [], ctx);

      expect(dResources.greed).toBeGreaterThan(dEmpty.greed);
    });

    it('decreases when inventory is full', () => {
      const emptyInv = makeTick({ self: makeSelf({ inventory: [] }) });
      const fullInv = makeTick({
        self: makeSelf({
          inventory: [
            { id: 'wood', quantity: 10 },
            { id: 'stone', quantity: 10 },
          ],
        }),
      });
      const ctx = makeContext();

      const dEmpty = updateDrives(null, emptyInv, [], ctx);
      const dFull = updateDrives(null, fullInv, [], ctx);

      expect(dEmpty.greed).toBeGreaterThan(dFull.greed);
    });
  });

  describe('ambition drive', () => {
    it('responds to nearby monsters (XP opportunities)', () => {
      const noMonsters = makeTick();
      const withMonsters = makeTick({
        nearby: {
          agents: [],
          resources: [],
          monsters: [
            { id: 'm1', position: { x: 110, y: 100 }, type: 'goblin', health: 30, maxHealth: 30, evolutionStage: 0, isNpc: true, status: 'idle' },
            { id: 'm2', position: { x: 120, y: 100 }, type: 'wolf', health: 20, maxHealth: 20, evolutionStage: 0, isNpc: true, status: 'idle' },
            { id: 'm3', position: { x: 130, y: 100 }, type: 'bear', health: 50, maxHealth: 50, evolutionStage: 0, isNpc: true, status: 'idle' },
          ],
          behemoths: [],
          structures: [],
        },
      });
      const ctx = makeContext();

      const dNoM = updateDrives(null, noMonsters, [], ctx);
      const dWithM = updateDrives(null, withMonsters, [], ctx);

      expect(dWithM.ambition).toBeGreaterThan(dNoM.ambition);
    });

    it('decreases with higher evolution stage', () => {
      const lowStage = makeTick({ self: makeSelf({ evolutionStage: 0 }) });
      const highStage = makeTick({ self: makeSelf({ evolutionStage: 3 }) });
      const ctx = makeContext();

      const dLow = updateDrives(null, lowStage, [], ctx);
      const dHigh = updateDrives(null, highStage, [], ctx);

      expect(dLow.ambition).toBeGreaterThan(dHigh.ambition);
    });
  });

  describe('social drive', () => {
    it('increases when agents are nearby', () => {
      const alone = makeTick();
      const social = makeTick({
        nearby: {
          agents: [
            { id: 'a2', name: 'Friend', role: 'merchant', position: { x: 120, y: 100 }, status: 'idle', health: 80, maxHealth: 80, alliance: null, evolutionStage: 0 },
          ],
          resources: [],
          monsters: [],
          behemoths: [],
          structures: [],
        },
      });
      const ctx = makeContext();

      const dAlone = updateDrives(null, alone, [], ctx);
      const dSocial = updateDrives(null, social, [], ctx);

      expect(dSocial.social).toBeGreaterThan(dAlone.social);
    });

    it('increases when time since last trade is high', () => {
      const recentTrade = makeContext({ ticksSinceLastTrade: 10 });
      const longAgo = makeContext({ ticksSinceLastTrade: 500 });
      const state = makeTick();

      const dRecent = updateDrives(null, state, [], recentTrade);
      const dLongAgo = updateDrives(null, state, [], longAgo);

      expect(dLongAgo.social).toBeGreaterThan(dRecent.social);
    });

    it('decreases slightly when receiving messages (already interacting)', () => {
      const state = makeTick();
      const ctx = makeContext();

      const dNoMsg = updateDrives(null, state, [], ctx);
      const dWithMsg = updateDrives(null, state, [makePerception('message_received')], ctx);

      expect(dWithMsg.social).toBeLessThan(dNoMsg.social);
    });
  });

  describe('caution drive', () => {
    it('increases when HP is low', () => {
      const healthy = makeTick({ self: makeSelf({ health: 100, maxHealth: 100 }) });
      const injured = makeTick({ self: makeSelf({ health: 20, maxHealth: 100 }) });
      const ctx = makeContext();

      const dHealthy = updateDrives(null, healthy, [], ctx);
      const dInjured = updateDrives(null, injured, [], ctx);

      expect(dInjured.caution).toBeGreaterThan(dHealthy.caution);
    });

    it('increases with recent damage', () => {
      const noDamage = makeContext({ recentDamageTaken: 0 });
      const heavyDamage = makeContext({ recentDamageTaken: 80 });
      const state = makeTick();

      const dNoDmg = updateDrives(null, state, [], noDamage);
      const dHeavyDmg = updateDrives(null, state, [], heavyDamage);

      expect(dHeavyDmg.caution).toBeGreaterThan(dNoDmg.caution);
    });

    it('increases with more deaths', () => {
      const noDeaths = makeContext({ deathCount: 0 });
      const manyDeaths = makeContext({ deathCount: 5 });
      const state = makeTick();

      const dNoDeath = updateDrives(null, state, [], noDeaths);
      const dManyDeath = updateDrives(null, state, [], manyDeaths);

      expect(dManyDeath.caution).toBeGreaterThan(dNoDeath.caution);
    });
  });

  describe('smoothing', () => {
    it('blends new values with previous drives', () => {
      const prevDrives: Drives = {
        survival: 0.9,
        greed: 0.9,
        ambition: 0.9,
        social: 0.9,
        caution: 0.9,
      };

      // Healthy agent with no threats — raw survival should be low
      const state = makeTick({ self: makeSelf({ health: 100, maxHealth: 100 }) });
      const ctx = makeContext();

      const drives = updateDrives(prevDrives, state, [], ctx);

      // With smoothing, survival should be between raw low value and previous 0.9
      // Not jumping immediately to the new value
      expect(drives.survival).toBeLessThan(0.9);
      expect(drives.survival).toBeGreaterThan(0.1);
    });

    it('converges over multiple ticks', () => {
      const state = makeTick({ self: makeSelf({ health: 100, maxHealth: 100 }) });
      const ctx = makeContext();

      // Start at high survival
      let drives: Drives = {
        survival: 0.9,
        greed: 0.5,
        ambition: 0.5,
        social: 0.3,
        caution: 0.3,
      };

      // Apply multiple ticks — survival should gradually decrease
      const survivalHistory: number[] = [drives.survival];
      for (let i = 0; i < 10; i++) {
        drives = updateDrives(drives, state, [], ctx);
        survivalHistory.push(drives.survival);
      }

      // Each subsequent value should be closer to the raw value (decreasing)
      for (let i = 1; i < survivalHistory.length; i++) {
        expect(survivalHistory[i]).toBeLessThanOrEqual(survivalHistory[i - 1]);
      }
    });
  });

  describe('first tick (null previous)', () => {
    it('uses default drives as base for smoothing', () => {
      const state = makeTick();
      const ctx = makeContext();
      const drives = updateDrives(null, state, [], ctx);

      // Should produce valid drives
      for (const [key, value] of Object.entries(drives)) {
        expect(value, `${key}`).toBeGreaterThanOrEqual(0);
        expect(value, `${key}`).toBeLessThanOrEqual(1);
      }
    });
  });
});

describe('describeDrives', () => {
  it('produces natural language descriptions', () => {
    const drives: Drives = {
      survival: 0.9,
      greed: 0.5,
      ambition: 0.3,
      social: 0.1,
      caution: 0.7,
    };
    const desc = describeDrives(drives);

    expect(desc).toContain('Survival: very high');
    expect(desc).toContain('Greed: moderate');
    expect(desc).toContain('Ambition: low');
    expect(desc).toContain('Social: very low');
    expect(desc).toContain('Caution: high');
  });

  it('includes numeric values', () => {
    const drives: Drives = {
      survival: 0.85,
      greed: 0.42,
      ambition: 0.33,
      social: 0.15,
      caution: 0.67,
    };
    const desc = describeDrives(drives);

    expect(desc).toContain('0.85');
    expect(desc).toContain('0.42');
    expect(desc).toContain('0.33');
    expect(desc).toContain('0.15');
    expect(desc).toContain('0.67');
  });

  it('describes level thresholds correctly', () => {
    // Exact boundary test
    const drives: Drives = {
      survival: 0.8,  // very high (>= 0.8)
      greed: 0.6,     // high (>= 0.6)
      ambition: 0.4,  // moderate (>= 0.4)
      social: 0.2,    // low (>= 0.2)
      caution: 0.19,  // very low (< 0.2)
    };
    const desc = describeDrives(drives);

    expect(desc).toContain('Survival: very high');
    expect(desc).toContain('Greed: high');
    expect(desc).toContain('Ambition: moderate');
    expect(desc).toContain('Social: low');
    expect(desc).toContain('Caution: very low');
  });
});
