// tests/action-queue.test.ts — ActionQueue tests

import { describe, it, expect, beforeEach } from 'vitest';
import { ActionQueue } from '../src/pipeline/action-queue.js';
import type { RawAction, AgentAction } from '../src/types/index.js';

describe('ActionQueue', () => {
  let queue: ActionQueue;

  beforeEach(() => {
    queue = new ActionQueue();
  });

  it('enqueues and drains a single action', () => {
    const raw: RawAction = {
      action: 'move',
      params: { x: 100, y: 200 },
      tick: 1,
    };

    queue.enqueue('agent_001', raw, 5);
    const actions = queue.drainAll();

    expect(actions).toHaveLength(1);
    expect(actions[0]!.agentId).toBe('agent_001');
    expect(actions[0]!.action).toBe('move');
    expect(actions[0]!.params).toEqual({ type: 'move', x: 100, y: 200 });
    expect(actions[0]!.receivedTick).toBe(1);
    expect(actions[0]!.serverTick).toBe(5);
  });

  it('last-write-wins: enqueue 3 actions for same agent, drain returns only the last', () => {
    queue.enqueue('agent_001', { action: 'move', params: { x: 10, y: 10 }, tick: 1 }, 5);
    queue.enqueue('agent_001', { action: 'move', params: { x: 20, y: 20 }, tick: 1 }, 5);
    queue.enqueue('agent_001', { action: 'move', params: { x: 30, y: 30 }, tick: 1 }, 5);

    const actions = queue.drainAll();
    expect(actions).toHaveLength(1);
    expect(actions[0]!.params).toEqual({ type: 'move', x: 30, y: 30 });
  });

  it('enqueue for 5 different agents returns 5 actions', () => {
    for (let i = 1; i <= 5; i++) {
      queue.enqueue(`agent_00${i}`, { action: 'idle', params: {}, tick: 1 }, 5);
    }

    const actions = queue.drainAll();
    expect(actions).toHaveLength(5);
    const ids = actions.map((a) => a.agentId).sort();
    expect(ids).toEqual(['agent_001', 'agent_002', 'agent_003', 'agent_004', 'agent_005']);
  });

  it('drainAll clears the queue', () => {
    queue.enqueue('agent_001', { action: 'idle', params: {}, tick: 1 }, 5);
    const first = queue.drainAll();
    expect(first).toHaveLength(1);

    const second = queue.drainAll();
    expect(second).toHaveLength(0);
  });

  it('malformed action (missing params) is not queued', () => {
    // Missing required params fields for move
    queue.enqueue('agent_001', { action: 'move', params: {}, tick: 1 } as RawAction, 5);
    const actions = queue.drainAll();
    expect(actions).toHaveLength(0);
  });

  it('malformed action (invalid action type) is not queued', () => {
    queue.enqueue(
      'agent_001',
      { action: 'fly' as any, params: {}, tick: 1 },
      5,
    );
    const actions = queue.drainAll();
    expect(actions).toHaveLength(0);
  });

  it('malformed action (missing tick) is not queued', () => {
    queue.enqueue(
      'agent_001',
      { action: 'idle', params: {}, tick: undefined as any },
      5,
    );
    const actions = queue.drainAll();
    expect(actions).toHaveLength(0);
  });

  it('parses idle action with empty params', () => {
    queue.enqueue('agent_001', { action: 'idle', params: {}, tick: 1 }, 5);
    const actions = queue.drainAll();
    expect(actions).toHaveLength(1);
    expect(actions[0]!.params).toEqual({ type: 'idle' });
  });

  it('parses gather action', () => {
    queue.enqueue(
      'agent_001',
      { action: 'gather', params: { targetId: 'res_abc' }, tick: 1 },
      5,
    );
    const actions = queue.drainAll();
    expect(actions).toHaveLength(1);
    expect(actions[0]!.params).toEqual({ type: 'gather', targetId: 'res_abc' });
  });

  it('rejects gather action with empty targetId', () => {
    queue.enqueue(
      'agent_001',
      { action: 'gather', params: { targetId: '' }, tick: 1 },
      5,
    );
    const actions = queue.drainAll();
    expect(actions).toHaveLength(0);
  });

  it('parses attack action', () => {
    queue.enqueue(
      'agent_001',
      { action: 'attack', params: { targetId: 'npc_xyz' }, tick: 1 },
      5,
    );
    const actions = queue.drainAll();
    expect(actions).toHaveLength(1);
    expect(actions[0]!.params).toEqual({ type: 'attack', targetId: 'npc_xyz' });
  });

  it('parses craft action', () => {
    queue.enqueue(
      'agent_001',
      { action: 'craft', params: { recipeId: 'iron_sword' }, tick: 1 },
      5,
    );
    const actions = queue.drainAll();
    expect(actions).toHaveLength(1);
    expect(actions[0]!.params).toEqual({ type: 'craft', recipeId: 'iron_sword' });
  });

  it('parses talk action (local)', () => {
    queue.enqueue(
      'agent_001',
      { action: 'talk', params: { mode: 'local', message: 'hello' }, tick: 1 },
      5,
    );
    const actions = queue.drainAll();
    expect(actions).toHaveLength(1);
    expect(actions[0]!.params).toEqual({ type: 'talk', mode: 'local', message: 'hello' });
  });

  it('parses talk action (whisper with targetId)', () => {
    queue.enqueue(
      'agent_001',
      { action: 'talk', params: { mode: 'whisper', message: 'psst', targetId: 'agent_002' }, tick: 1 },
      5,
    );
    const actions = queue.drainAll();
    expect(actions).toHaveLength(1);
    expect(actions[0]!.params).toEqual({
      type: 'talk',
      mode: 'whisper',
      message: 'psst',
      targetId: 'agent_002',
    });
  });

  it('rejects whisper without targetId', () => {
    queue.enqueue(
      'agent_001',
      { action: 'talk', params: { mode: 'whisper', message: 'psst' }, tick: 1 },
      5,
    );
    const actions = queue.drainAll();
    expect(actions).toHaveLength(0);
  });

  it('parses trade action', () => {
    queue.enqueue(
      'agent_001',
      {
        action: 'trade',
        params: {
          targetAgentId: 'agent_002',
          offer: [{ itemId: 'iron_sword', quantity: 1 }],
          request: [{ itemId: 'gold', quantity: 50 }],
        },
        tick: 1,
      },
      5,
    );
    const actions = queue.drainAll();
    expect(actions).toHaveLength(1);
    const params = actions[0]!.params;
    expect(params.type).toBe('trade');
    if (params.type === 'trade') {
      expect(params.targetAgentId).toBe('agent_002');
      expect(params.offer).toEqual([{ itemId: 'iron_sword', quantity: 1 }]);
      expect(params.request).toEqual([{ itemId: 'gold', quantity: 50 }]);
    }
  });

  it('rejects trade with invalid offer items', () => {
    queue.enqueue(
      'agent_001',
      {
        action: 'trade',
        params: {
          targetAgentId: 'agent_002',
          offer: [{ itemId: '', quantity: 1 }],
          request: [{ itemId: 'gold', quantity: 50 }],
        },
        tick: 1,
      },
      5,
    );
    const actions = queue.drainAll();
    expect(actions).toHaveLength(0);
  });

  it('parses plant action', () => {
    queue.enqueue(
      'agent_001',
      { action: 'plant', params: { seedId: 'tree_seed', x: 100, y: 200 }, tick: 1 },
      5,
    );
    const actions = queue.drainAll();
    expect(actions).toHaveLength(1);
    expect(actions[0]!.params).toEqual({ type: 'plant', seedId: 'tree_seed', x: 100, y: 200 });
  });

  it('parses water action', () => {
    queue.enqueue(
      'agent_001',
      { action: 'water', params: { x: 100, y: 200 }, tick: 1 },
      5,
    );
    const actions = queue.drainAll();
    expect(actions).toHaveLength(1);
    expect(actions[0]!.params).toEqual({ type: 'water', x: 100, y: 200 });
  });

  it('parses feed action', () => {
    queue.enqueue(
      'agent_001',
      { action: 'feed', params: { behemothId: 'beh_001', itemId: 'food' }, tick: 1 },
      5,
    );
    const actions = queue.drainAll();
    expect(actions).toHaveLength(1);
    expect(actions[0]!.params).toEqual({ type: 'feed', behemothId: 'beh_001', itemId: 'food' });
  });

  it('parses climb action', () => {
    queue.enqueue(
      'agent_001',
      { action: 'climb', params: { behemothId: 'beh_001' }, tick: 1 },
      5,
    );
    const actions = queue.drainAll();
    expect(actions).toHaveLength(1);
    expect(actions[0]!.params).toEqual({ type: 'climb', behemothId: 'beh_001' });
  });

  it('parses form_alliance action', () => {
    queue.enqueue(
      'agent_001',
      { action: 'form_alliance', params: { name: 'Wolves' }, tick: 1 },
      5,
    );
    const actions = queue.drainAll();
    expect(actions).toHaveLength(1);
    expect(actions[0]!.params).toEqual({ type: 'form_alliance', name: 'Wolves' });
  });

  it('parses join_alliance action', () => {
    queue.enqueue(
      'agent_001',
      { action: 'join_alliance', params: { name: 'Wolves' }, tick: 1 },
      5,
    );
    const actions = queue.drainAll();
    expect(actions).toHaveLength(1);
    expect(actions[0]!.params).toEqual({ type: 'join_alliance', name: 'Wolves' });
  });
});
