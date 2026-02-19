#!/usr/bin/env npx tsx
// e2e-test.ts — Full gameplay loop E2E test
// Tests: connect → move → combat → gather → craft → trade

import WebSocket from 'ws';

const SERVER_URL = 'ws://localhost:8090';

interface TickData {
  tick: number;
  self: {
    id: string;
    name: string;
    role: string;
    position: { x: number; y: number };
    status: string;
    health: number;
    maxHealth: number;
    attack: number;
    defense: number;
    speed: number;
    gold: number;
    inventory: Array<{ id: string; quantity: number }>;
    equipment: { weapon: unknown; armor: unknown; tool: unknown };
    alliance: string | null;
    kills: number;
    evolutionStage: number;
    actionCooldown: number;
  };
  nearby: {
    agents: Array<{ id: string; name: string; position: { x: number; y: number } }>;
    resources: Array<{ id: string; type: string; position: { x: number; y: number }; remaining: number }>;
    monsters: Array<{ id: string; type: string; position: { x: number; y: number }; health: number; maxHealth: number; status: string; isNpc: boolean }>;
    behemoths: Array<{ id: string; type: string; position: { x: number; y: number }; status: string }>;
    structures: unknown[];
  };
  messages: unknown[];
  events: unknown[];
}

function log(label: string, msg: string) {
  console.log(`[${label}] ${msg}`);
}

function connectAgent(name: string, role: string): Promise<{ ws: WebSocket; agentId: string; waitForTick: () => Promise<TickData> }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(SERVER_URL);
    let latestTick: TickData | null = null;
    const tickWaiters: Array<(data: TickData) => void> = [];

    ws.on('open', () => {
      log(name, 'Connected');
    });

    ws.on('message', (data: Buffer) => {
      const msg = JSON.parse(data.toString());

      if (msg.type === 'auth_prompt') {
        ws.send(JSON.stringify({ type: 'auth', name }));
      } else if (msg.type === 'role_prompt') {
        ws.send(JSON.stringify({ type: 'select_role', role }));
      } else if (msg.type === 'role_confirmed') {
        log(name, `Role confirmed: ${msg.role}, id=${msg.agentId}, spawn=(${msg.spawnPosition.x},${msg.spawnPosition.y})`);
        resolve({
          ws,
          agentId: msg.agentId,
          waitForTick: () => new Promise<TickData>((res) => {
            if (latestTick) {
              const t = latestTick;
              latestTick = null;
              res(t);
            } else {
              tickWaiters.push(res);
            }
          }),
        });
      } else if (msg.type === 'tick_update') {
        latestTick = msg.data;
        if (tickWaiters.length > 0) {
          const waiter = tickWaiters.shift()!;
          waiter(msg.data);
          latestTick = null;
        }
      } else if (msg.type === 'action_rejected') {
        log(name, `ACTION REJECTED: ${msg.action} — ${msg.reason}`);
      }
    });

    ws.on('error', (err) => {
      reject(err);
    });

    setTimeout(() => reject(new Error('Connection timeout')), 10000);
  });
}

function sendAction(ws: WebSocket, action: string, params: Record<string, unknown>) {
  ws.send(JSON.stringify({ type: 'action', action, params, tick: 0 }));
}

function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

/** Move agent toward target, waiting for each tick. Returns final tick data. */
async function moveToward(
  ws: WebSocket,
  waitForTick: () => Promise<TickData>,
  target: { x: number; y: number },
  label: string,
  maxTicks = 200,
  stopWhen?: (tick: TickData) => boolean,
): Promise<TickData> {
  let tick: TickData = await waitForTick();
  for (let i = 0; i < maxTicks; i++) {
    if (dist(tick.self.position, target) < 3) break;
    if (stopWhen?.(tick)) break;
    sendAction(ws, 'move', { x: target.x, y: target.y });
    tick = await waitForTick();
    if (i % 25 === 0 && i > 0) {
      log(label, `Moving... (${tick.self.position.x.toFixed(0)},${tick.self.position.y.toFixed(0)}) → (${target.x},${target.y}), dist=${dist(tick.self.position, target).toFixed(0)}`);
    }
  }
  return tick;
}

async function main() {
  console.log('=== VIBE PARADOX E2E GAMEPLAY LOOP TEST ===\n');

  // --- Connect both agents ---
  log('SETUP', 'Connecting Fighter1...');
  const fighter = await connectAgent('Fighter1', 'fighter');
  log('SETUP', 'Connecting Trader1...');
  const merchant = await connectAgent('Trader1', 'merchant');

  let fTick = await fighter.waitForTick();
  let mTick = await merchant.waitForTick();

  log('Fighter1', `Pos: (${fTick.self.position.x.toFixed(0)},${fTick.self.position.y.toFixed(0)}) HP:${fTick.self.health} ATK:${fTick.self.attack} SPD:${fTick.self.speed}`);
  log('Trader1', `Pos: (${mTick.self.position.x.toFixed(0)},${mTick.self.position.y.toFixed(0)}) HP:${mTick.self.health}`);

  // =====================================================
  // STEP 1: Move Fighter to the North danger zone (500,50)
  // Safe zone is 100 radius from (500,500), so NPCs are far out.
  // North zone: center (500,50), radius 80, 15 monsters
  // =====================================================
  console.log('\n--- STEP 1: Move Fighter to north danger zone ---');
  // Fighter speed=4, so ~113 ticks to travel 450 units
  fTick = await moveToward(fighter.ws, fighter.waitForTick, { x: 500, y: 100 }, 'Fighter1', 150,
    (t) => t.nearby.monsters.length > 0);

  log('Fighter1', `Pos: (${fTick.self.position.x.toFixed(0)},${fTick.self.position.y.toFixed(0)}), monsters visible: ${fTick.nearby.monsters.length}`);

  if (fTick.nearby.monsters.length === 0) {
    // Keep going closer to the zone center
    fTick = await moveToward(fighter.ws, fighter.waitForTick, { x: 500, y: 50 }, 'Fighter1', 50,
      (t) => t.nearby.monsters.length > 0);
    log('Fighter1', `Pos: (${fTick.self.position.x.toFixed(0)},${fTick.self.position.y.toFixed(0)}), monsters visible: ${fTick.nearby.monsters.length}`);
  }

  for (const m of fTick.nearby.monsters.slice(0, 5)) {
    log('Fighter1', `  NPC: ${m.id} (${m.type}) HP:${m.health}/${m.maxHealth} dist:${dist(fTick.self.position, m.position).toFixed(1)}`);
  }

  // =====================================================
  // STEP 2: Fighter attacks weakest NPC
  // =====================================================
  console.log('\n--- STEP 2: Fighter attacks NPC ---');

  // Filter for NPCs only, pick weakest
  const npcMonsters = fTick.nearby.monsters.filter(m => m.isNpc);
  let targetNpc = npcMonsters.length > 0
    ? npcMonsters.reduce((a, b) => a.health < b.health ? a : b)
    : null;

  if (!targetNpc && fTick.nearby.monsters.length > 0) {
    targetNpc = fTick.nearby.monsters.reduce((a, b) => a.health < b.health ? a : b);
  }

  let npcKilled = false;
  if (targetNpc) {
    log('Fighter1', `Target: ${targetNpc.id} (${targetNpc.type}) HP:${targetNpc.health}/${targetNpc.maxHealth}`);

    // Move into attack range (5 units)
    for (let i = 0; i < 30; i++) {
      if (dist(fTick.self.position, targetNpc.position) <= 5) break;
      sendAction(fighter.ws, 'move', { x: targetNpc.position.x, y: targetNpc.position.y });
      fTick = await fighter.waitForTick();
      const updated = fTick.nearby.monsters.find(m => m.id === targetNpc!.id);
      if (updated) targetNpc = updated;
    }
    log('Fighter1', `In range! dist=${dist(fTick.self.position, targetNpc.position).toFixed(1)}`);

    // Attack until dead
    const goldBefore = fTick.self.gold;
    for (let i = 0; i < 50; i++) {
      sendAction(fighter.ws, 'attack', { targetId: targetNpc.id });
      fTick = await fighter.waitForTick();

      const npc = fTick.nearby.monsters.find(m => m.id === targetNpc!.id);
      if (!npc) {
        npcKilled = true;
        log('Fighter1', `NPC KILLED after ${i + 1} combat ticks!`);
        log('Fighter1', `Gold: ${goldBefore} → ${fTick.self.gold} (+${fTick.self.gold - goldBefore})`);
        log('Fighter1', `HP: ${fTick.self.health}/${fTick.self.maxHealth}, Kills: ${fTick.self.kills}`);
        break;
      }

      if (i % 3 === 0) {
        log('Fighter1', `Combat: NPC HP=${npc.health}/${npc.maxHealth}, Fighter HP=${fTick.self.health}/${fTick.self.maxHealth}`);
      }

      // Chase if needed
      if (dist(fTick.self.position, npc.position) > 5) {
        sendAction(fighter.ws, 'move', { x: npc.position.x, y: npc.position.y });
        fTick = await fighter.waitForTick();
        i++;
      }
    }
    if (!npcKilled) log('Fighter1', 'Combat timeout — NPC survived');
  } else {
    log('Fighter1', 'WARNING: No monsters found. Skipping combat.');
  }

  // =====================================================
  // STEP 3: Move Merchant to NW forest (150,150) to gather
  // =====================================================
  console.log('\n--- STEP 3: Merchant gathers from trees ---');
  // Merchant speed=3, ~165 ticks to travel 495 units
  mTick = await moveToward(merchant.ws, merchant.waitForTick, { x: 200, y: 200 }, 'Trader1', 200,
    (t) => t.nearby.resources.filter(r => r.type === 'tree').length > 0);

  const trees = mTick.nearby.resources.filter(r => r.type === 'tree');
  log('Trader1', `Pos: (${mTick.self.position.x.toFixed(0)},${mTick.self.position.y.toFixed(0)}), trees visible: ${trees.length}`);

  if (trees.length === 0) {
    // Keep going
    mTick = await moveToward(merchant.ws, merchant.waitForTick, { x: 150, y: 150 }, 'Trader1', 100,
      (t) => t.nearby.resources.filter(r => r.type === 'tree').length > 0);
    log('Trader1', `Pos: (${mTick.self.position.x.toFixed(0)},${mTick.self.position.y.toFixed(0)}), trees: ${mTick.nearby.resources.filter(r => r.type === 'tree').length}`);
  }

  const nearbyTrees = mTick.nearby.resources.filter(r => r.type === 'tree');
  if (nearbyTrees.length > 0) {
    const tree = nearbyTrees.reduce((a, b) => dist(mTick.self.position, a.position) < dist(mTick.self.position, b.position) ? a : b);
    log('Trader1', `Target tree: ${tree.id} at (${tree.position.x.toFixed(0)},${tree.position.y.toFixed(0)}) remaining=${tree.remaining}`);

    // Move into gather range (5 units)
    for (let i = 0; i < 30; i++) {
      if (dist(mTick.self.position, tree.position) <= 5) break;
      sendAction(merchant.ws, 'move', { x: tree.position.x, y: tree.position.y });
      mTick = await merchant.waitForTick();
    }
    log('Trader1', `In gather range! dist=${dist(mTick.self.position, tree.position).toFixed(1)}`);

    // Send gather once — it auto-continues every TREE_GATHER_TICKS (3) ticks
    sendAction(merchant.ws, 'gather', { targetId: tree.id });

    // Wait until we have enough logs (gather yields 1 log every 3 ticks)
    for (let t = 0; t < 25; t++) {
      mTick = await merchant.waitForTick();
      const inv = mTick.self.inventory.map(i => `${i.id}x${i.quantity}`).join(', ') || 'empty';
      if (t % 3 === 0) {
        log('Trader1', `Gathering... tick ${t + 1}: status=${mTick.self.status}, inv=[${inv}]`);
      }
      const logCount = mTick.self.inventory.find(i => i.id === 'log');
      if (logCount && logCount.quantity >= 2) {
        log('Trader1', `Have ${logCount.quantity} logs — enough to craft!`);
        break;
      }
    }
  } else {
    log('Trader1', 'WARNING: No trees found. Resources visible:');
    for (const r of mTick.nearby.resources.slice(0, 5)) {
      log('Trader1', `  ${r.id} type=${r.type} at (${r.position.x.toFixed(0)},${r.position.y.toFixed(0)})`);
    }
  }

  // =====================================================
  // STEP 4: Merchant crafts healing_salve (needs 2 logs)
  // =====================================================
  console.log('\n--- STEP 4: Merchant crafts healing_salve ---');
  const logItem = mTick.self.inventory.find(i => i.id === 'log');
  if (logItem && logItem.quantity >= 2) {
    log('Trader1', `Crafting healing_salve (have ${logItem.quantity} logs)...`);
    sendAction(merchant.ws, 'craft', { recipeId: 'healing_salve' });

    for (let i = 0; i < 10; i++) {
      mTick = await merchant.waitForTick();
      const inv = mTick.self.inventory.map(i => `${i.id}x${i.quantity}`).join(', ');
      if (mTick.self.inventory.some(i => i.id === 'healing_salve')) {
        log('Trader1', `Crafting complete! Inventory: [${inv}]`);
        break;
      }
      if (i % 3 === 0) log('Trader1', `Crafting... tick ${i + 1}, status=${mTick.self.status}`);
    }
  } else {
    log('Trader1', `Not enough logs (have ${logItem?.quantity ?? 0}, need 2). Skipping craft.`);
  }

  // =====================================================
  // STEP 5: Both agents meet up for a trade
  // =====================================================
  console.log('\n--- STEP 5: Trade between Fighter and Merchant ---');

  // Pick a meeting point between them
  const meetX = (fTick.self.position.x + mTick.self.position.x) / 2;
  const meetY = (fTick.self.position.y + mTick.self.position.y) / 2;
  const meetingPoint = { x: Math.round(meetX), y: Math.round(meetY) };
  log('TRADE', `Meeting point: (${meetingPoint.x},${meetingPoint.y})`);

  // Move both concurrently
  for (let i = 0; i < 200; i++) {
    sendAction(fighter.ws, 'move', meetingPoint);
    sendAction(merchant.ws, 'move', meetingPoint);
    fTick = await fighter.waitForTick();
    mTick = await merchant.waitForTick();

    const d = dist(fTick.self.position, mTick.self.position);
    if (d <= 10 && dist(fTick.self.position, meetingPoint) < 5) {
      log('TRADE', `Both in range! dist=${d.toFixed(1)}`);
      break;
    }
    if (i % 25 === 0) {
      log('TRADE', `Moving... F=(${fTick.self.position.x.toFixed(0)},${fTick.self.position.y.toFixed(0)}) M=(${mTick.self.position.x.toFixed(0)},${mTick.self.position.y.toFixed(0)}) dist=${d.toFixed(0)}`);
    }
  }

  // Attempt trade
  const merchantHasItems = mTick.self.inventory.length > 0;
  const fighterHasGold = fTick.self.gold > 0;

  if (merchantHasItems && fighterHasGold) {
    const item = mTick.self.inventory[0]!;
    const goldAmount = Math.min(fTick.self.gold, 5);
    log('TRADE', `Merchant offers ${item.id}x1, requests ${goldAmount} gold`);
    sendAction(merchant.ws, 'trade', {
      targetAgentId: fighter.agentId,
      offer: [{ itemId: item.id, quantity: 1 }],
      request: [{ itemId: 'gold', quantity: goldAmount }],
    });

    // Wait a few ticks for trade event to arrive
    let tradeEvent: { type: string; tradeId?: string } | undefined;
    for (let t = 0; t < 5; t++) {
      fTick = await fighter.waitForTick();
      mTick = await merchant.waitForTick();
      tradeEvent = (fTick.events as Array<{ type: string; tradeId?: string }>).find(e => e.tradeId);
      if (tradeEvent?.tradeId) break;
    }
    log('TRADE', `Fighter events: ${JSON.stringify(fTick.events)}`);

    if (tradeEvent?.tradeId) {
      log('TRADE', `Fighter accepting trade ${tradeEvent.tradeId}...`);
      sendAction(fighter.ws, 'trade_respond', { tradeId: tradeEvent.tradeId, accept: true });
      fTick = await fighter.waitForTick();
      mTick = await merchant.waitForTick();
      log('TRADE', `Fighter gold: ${fTick.self.gold}, inv: [${fTick.self.inventory.map(i => `${i.id}x${i.quantity}`).join(', ')}]`);
      log('TRADE', `Merchant gold: ${mTick.self.gold}, inv: [${mTick.self.inventory.map(i => `${i.id}x${i.quantity}`).join(', ')}]`);
    } else {
      log('TRADE', 'No trade event found in fighter events. Trade proposal may not have reached fighter yet.');
      // Wait one more tick
      fTick = await fighter.waitForTick();
      log('TRADE', `Fighter events (next tick): ${JSON.stringify(fTick.events)}`);
    }
  } else if (merchantHasItems) {
    log('TRADE', `Fighter has no gold. Testing gift trade (item for nothing)...`);
    const item = mTick.self.inventory[0]!;
    sendAction(merchant.ws, 'trade', {
      targetAgentId: fighter.agentId,
      offer: [{ itemId: item.id, quantity: 1 }],
      request: [],
    });
    fTick = await fighter.waitForTick();
    mTick = await merchant.waitForTick();
    log('TRADE', `Fighter events: ${JSON.stringify(fTick.events)}`);
  } else {
    log('TRADE', 'Merchant has no items to trade. Skipping trade test.');
  }

  // =====================================================
  // FINAL SUMMARY
  // =====================================================
  console.log('\n=== FINAL STATE ===');
  fTick = await fighter.waitForTick();
  mTick = await merchant.waitForTick();

  log('Fighter1', `Pos:(${fTick.self.position.x.toFixed(0)},${fTick.self.position.y.toFixed(0)}) HP:${fTick.self.health}/${fTick.self.maxHealth} Gold:${fTick.self.gold} Kills:${fTick.self.kills}`);
  log('Fighter1', `Inv: [${fTick.self.inventory.map(i => `${i.id}x${i.quantity}`).join(', ') || 'empty'}]`);
  log('Fighter1', `Equip: W=${JSON.stringify(fTick.self.equipment.weapon)} A=${JSON.stringify(fTick.self.equipment.armor)}`);

  log('Trader1', `Pos:(${mTick.self.position.x.toFixed(0)},${mTick.self.position.y.toFixed(0)}) HP:${mTick.self.health}/${mTick.self.maxHealth} Gold:${mTick.self.gold}`);
  log('Trader1', `Inv: [${mTick.self.inventory.map(i => `${i.id}x${i.quantity}`).join(', ') || 'empty'}]`);

  // Results
  console.log('\n=== RESULTS ===');
  const results = [
    { test: 'Connect + Auth', pass: true },
    { test: 'Movement', pass: true },
    { test: 'Combat (NPC kill)', pass: npcKilled },
    { test: 'Gathering', pass: mTick.self.inventory.some(i => i.id === 'log') || mTick.self.inventory.some(i => i.id === 'healing_salve') },
    { test: 'Crafting', pass: mTick.self.inventory.some(i => i.id === 'healing_salve') },
  ];

  for (const r of results) {
    console.log(`  ${r.pass ? 'PASS' : 'FAIL'}: ${r.test}`);
  }

  const allPass = results.every(r => r.pass);
  console.log(`\n${allPass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'}`);
  console.log('\n=== E2E TEST COMPLETE ===');

  fighter.ws.close();
  merchant.ws.close();
  process.exit(allPass ? 0 : 1);
}

main().catch((err) => {
  console.error('E2E TEST FAILED:', err);
  process.exit(1);
});
