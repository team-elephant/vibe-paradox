import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer, type Server as HttpServer } from 'node:http';
import WebSocket from 'ws';
import { GameWebSocketServer } from '../src/server/ws-server.js';
import { WorldState } from '../src/server/world.js';
import { ActionQueue } from '../src/pipeline/action-queue.js';
import type { ServerMessage, ClientMessage } from '../src/types/index.js';

let portCounter = 19200;
function nextPort(): number {
  return portCounter++;
}

/**
 * A buffered WebSocket client that collects all messages from the moment
 * the connection is created, preventing race conditions where messages
 * arrive before a listener is registered.
 */
class TestClient {
  readonly ws: WebSocket;
  private buffer: ServerMessage[] = [];
  private waiters: Array<(msg: ServerMessage) => void> = [];

  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.ws.on('message', (data: Buffer | string) => {
      const msg = JSON.parse(data.toString()) as ServerMessage;
      const waiter = this.waiters.shift();
      if (waiter) {
        waiter(msg);
      } else {
        this.buffer.push(msg);
      }
    });
  }

  /** Wait for the connection to open. */
  async open(): Promise<void> {
    if (this.ws.readyState === WebSocket.OPEN) return;
    return new Promise((resolve, reject) => {
      this.ws.on('open', () => resolve());
      this.ws.on('error', reject);
    });
  }

  /** Get the next message, from buffer or by waiting. */
  nextMessage(): Promise<ServerMessage> {
    const buffered = this.buffer.shift();
    if (buffered) return Promise.resolve(buffered);
    return new Promise((resolve) => {
      this.waiters.push(resolve);
    });
  }

  /** Get the next N messages. */
  async nextMessages(count: number): Promise<ServerMessage[]> {
    const msgs: ServerMessage[] = [];
    for (let i = 0; i < count; i++) {
      msgs.push(await this.nextMessage());
    }
    return msgs;
  }

  send(msg: ClientMessage): void {
    this.ws.send(JSON.stringify(msg));
  }

  async close(): Promise<void> {
    if (this.ws.readyState === WebSocket.CLOSED) return;
    return new Promise((resolve) => {
      this.ws.on('close', () => resolve());
      this.ws.close();
    });
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function authenticateAgent(
  client: TestClient,
  name: string,
  role: 'merchant' | 'fighter' | 'monster',
): Promise<string> {
  await client.nextMessage(); // auth_prompt
  client.send({ type: 'auth', name });
  await client.nextMessages(2); // auth_success + role_prompt
  client.send({ type: 'select_role', role });
  const msg = await client.nextMessage();
  if (msg.type !== 'role_confirmed') throw new Error(`Expected role_confirmed, got ${msg.type}`);
  return msg.agentId;
}

describe('GameWebSocketServer', () => {
  let world: WorldState;
  let actionQueue: ActionQueue;
  let server: GameWebSocketServer;
  let httpServer: HttpServer;
  let port: number;
  const clients: TestClient[] = [];

  beforeEach(async () => {
    port = nextPort();
    world = new WorldState(42);
    actionQueue = new ActionQueue();
    httpServer = createServer();
    await new Promise<void>((resolve) => httpServer.listen(port, '127.0.0.1', () => resolve()));
    server = new GameWebSocketServer(httpServer, world, actionQueue);
  });

  afterEach(async () => {
    for (const client of clients) {
      await client.close();
    }
    clients.length = 0;
    server.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  });

  async function connectClient(): Promise<TestClient> {
    const client = new TestClient(`ws://127.0.0.1:${port}`);
    clients.push(client);
    await client.open();
    return client;
  }

  it('sends auth_prompt on connection', async () => {
    const client = await connectClient();
    const msg = await client.nextMessage();
    expect(msg.type).toBe('auth_prompt');
  });

  it('auth → auth_success + role_prompt for new agent', async () => {
    const client = await connectClient();
    await client.nextMessage(); // auth_prompt

    client.send({ type: 'auth', name: 'TestBot' });
    const messages = await client.nextMessages(2);

    expect(messages[0]!.type).toBe('auth_success');
    expect(messages[1]!.type).toBe('role_prompt');
    if (messages[1]!.type === 'role_prompt') {
      expect(messages[1]!.availableRoles).toContain('merchant');
      expect(messages[1]!.availableRoles).toContain('fighter');
      expect(messages[1]!.availableRoles).toContain('monster');
    }
  });

  it('role selection → role_confirmed with spawn position', async () => {
    const client = await connectClient();
    const agentId = await authenticateAgent(client, 'Fighter1', 'fighter');

    expect(agentId).toMatch(/^agent_/);

    expect(world.agents.size).toBe(1);
    const agent = world.agents.get(agentId)!;
    expect(agent.name).toBe('Fighter1');
    expect(agent.role).toBe('fighter');
    expect(agent.position).toEqual({ x: 500, y: 500 });
    expect(agent.isConnected).toBe(true);
    expect(agent.isAlive).toBe(true);
    expect(agent.stats.health).toBe(100);
    expect(agent.stats.attack).toBe(15);
    expect(agent.stats.defense).toBe(10);
    expect(agent.stats.speed).toBe(4);
    expect(agent.stats.visionRadius).toBe(100);
  });

  it('action is enqueued in actionQueue', async () => {
    const client = await connectClient();
    await authenticateAgent(client, 'Mover', 'fighter');

    client.send({ type: 'action', action: 'move', params: { x: 510, y: 510 }, tick: 0 });
    await delay(50);

    const drained = actionQueue.drainAll();
    expect(drained.length).toBe(1);
    expect(drained[0]!.action).toBe('move');
    expect(drained[0]!.params).toEqual({ type: 'move', x: 510, y: 510 });
  });

  it('duplicate name while connected → auth_error', async () => {
    const client1 = await connectClient();
    await authenticateAgent(client1, 'UniqueBot', 'fighter');

    const client2 = await connectClient();
    await client2.nextMessage(); // auth_prompt
    client2.send({ type: 'auth', name: 'UniqueBot' });
    const msg = await client2.nextMessage();

    expect(msg.type).toBe('auth_error');
    if (msg.type === 'auth_error') {
      expect(msg.reason).toBe('Name taken');
    }
  });

  it('disconnect + reconnect with same name → resumes existing agent', async () => {
    const client1 = await connectClient();
    const originalAgentId = await authenticateAgent(client1, 'Reconnector', 'merchant');

    const agent = world.agents.get(originalAgentId)!;
    expect(agent.isConnected).toBe(true);

    // Disconnect
    await client1.close();
    await delay(50);
    expect(agent.isConnected).toBe(false);

    // Reconnect
    const client2 = await connectClient();
    await client2.nextMessage(); // auth_prompt
    client2.send({ type: 'auth', name: 'Reconnector' });

    const messages = await client2.nextMessages(2);

    expect(messages[0]!.type).toBe('auth_success');
    if (messages[0]!.type === 'auth_success') {
      expect(messages[0]!.agentId).toBe(originalAgentId);
    }

    expect(messages[1]!.type).toBe('role_confirmed');
    if (messages[1]!.type === 'role_confirmed') {
      expect(messages[1]!.role).toBe('merchant');
      expect(messages[1]!.agentId).toBe(originalAgentId);
    }

    expect(agent.isConnected).toBe(true);
    expect(world.agents.size).toBe(1);
  });

  it('ping → pong with serverTick', async () => {
    const client = await connectClient();
    await authenticateAgent(client, 'Pinger', 'fighter');

    world.tick = 42;
    client.send({ type: 'ping' });
    const msg = await client.nextMessage();

    expect(msg.type).toBe('pong');
    if (msg.type === 'pong') {
      expect(msg.serverTick).toBe(42);
    }
  });

  it('creates agent with correct stats for each role', async () => {
    const client1 = await connectClient();
    await authenticateAgent(client1, 'Merchant1', 'merchant');
    const merchant = [...world.agents.values()].find((a) => a.name === 'Merchant1')!;
    expect(merchant.stats.health).toBe(50);
    expect(merchant.stats.attack).toBe(0);
    expect(merchant.stats.defense).toBe(5);
    expect(merchant.stats.speed).toBe(3);
    expect(merchant.stats.visionRadius).toBe(80);

    const client2 = await connectClient();
    await authenticateAgent(client2, 'Monster1', 'monster');
    const monster = [...world.agents.values()].find((a) => a.name === 'Monster1')!;
    expect(monster.stats.health).toBe(80);
    expect(monster.stats.attack).toBe(12);
    expect(monster.stats.defense).toBe(8);
    expect(monster.stats.speed).toBe(5);
    expect(monster.stats.visionRadius).toBe(150);
  });

  it('sendToAgent sends to correct agent', async () => {
    const client = await connectClient();
    const agentId = await authenticateAgent(client, 'Receiver', 'fighter');

    server.sendToAgent(agentId, { type: 'pong', serverTick: 99 });
    const msg = await client.nextMessage();
    expect(msg.type).toBe('pong');
    if (msg.type === 'pong') {
      expect(msg.serverTick).toBe(99);
    }
  });

  it('broadcastToAll sends to all playing agents', async () => {
    const client1 = await connectClient();
    await authenticateAgent(client1, 'Agent1', 'fighter');

    const client2 = await connectClient();
    await authenticateAgent(client2, 'Agent2', 'merchant');

    server.broadcastToAll({ type: 'pong', serverTick: 77 });
    const [msg1, msg2] = await Promise.all([
      client1.nextMessage(),
      client2.nextMessage(),
    ]);

    expect(msg1.type).toBe('pong');
    expect(msg2.type).toBe('pong');
  });

  it('disconnect marks agent as not connected but keeps in world', async () => {
    const client = await connectClient();
    const agentId = await authenticateAgent(client, 'Disconnector', 'fighter');

    const agent = world.agents.get(agentId)!;
    expect(agent.isConnected).toBe(true);

    await client.close();
    await delay(50);

    expect(agent.isConnected).toBe(false);
    expect(world.agents.has(agentId)).toBe(true);
  });

  it('empty name → auth_error', async () => {
    const client = await connectClient();
    await client.nextMessage(); // auth_prompt
    client.send({ type: 'auth', name: '' });
    const msg = await client.nextMessage();
    expect(msg.type).toBe('auth_error');
  });

  it('invalid role → auth_error', async () => {
    const client = await connectClient();
    await client.nextMessage(); // auth_prompt
    client.send({ type: 'auth', name: 'BadRole' });
    await client.nextMessages(2); // auth_success + role_prompt
    client.send({ type: 'select_role', role: 'wizard' as any });
    const msg = await client.nextMessage();
    expect(msg.type).toBe('auth_error');
  });

  it('getConnectedCount returns correct count', async () => {
    expect(server.getConnectedCount()).toBe(0);

    const client1 = await connectClient();
    await authenticateAgent(client1, 'Counter1', 'fighter');
    expect(server.getConnectedCount()).toBe(1);

    const client2 = await connectClient();
    await authenticateAgent(client2, 'Counter2', 'merchant');
    expect(server.getConnectedCount()).toBe(2);
  });
});
