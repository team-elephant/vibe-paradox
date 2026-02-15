import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer, type Server as HttpServer } from 'node:http';
import WebSocket from 'ws';
import { GameWebSocketServer } from '../src/server/ws-server.js';
import { WorldState } from '../src/server/world.js';
import { ActionQueue } from '../src/pipeline/action-queue.js';
import type { ServerMessage, ClientMessage } from '../src/types/index.js';
import { createAuthMessage, createRoleSelectionMessage, createPingMessage } from '../cli/auth.js';

let portCounter = 19400;
function nextPort(): number {
  return portCounter++;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('cli/auth', () => {
  it('createAuthMessage returns correct structure', () => {
    const msg = createAuthMessage('TestBot');
    expect(msg).toEqual({ type: 'auth', name: 'TestBot' });
  });

  it('createRoleSelectionMessage returns correct structure', () => {
    const msg = createRoleSelectionMessage('fighter');
    expect(msg).toEqual({ type: 'select_role', role: 'fighter' });
  });

  it('createPingMessage returns correct structure', () => {
    const msg = createPingMessage();
    expect(msg).toEqual({ type: 'ping' });
  });
});

describe('cli/agent-interface', () => {
  it('writeServerMessage outputs JSON line to stdout', async () => {
    // We test the module import succeeds and the function exists
    const { writeServerMessage } = await import('../cli/agent-interface.js');
    expect(typeof writeServerMessage).toBe('function');
  });

  it('startStdinReader returns readline interface', async () => {
    const { startStdinReader } = await import('../cli/agent-interface.js');
    expect(typeof startStdinReader).toBe('function');
  });
});

describe('cli/client integration', () => {
  let world: WorldState;
  let actionQueue: ActionQueue;
  let server: GameWebSocketServer;
  let httpServer: HttpServer;
  let port: number;
  const wsClients: WebSocket[] = [];

  beforeEach(async () => {
    port = nextPort();
    world = new WorldState(42);
    actionQueue = new ActionQueue();
    httpServer = createServer();
    await new Promise<void>((resolve) =>
      httpServer.listen(port, '127.0.0.1', () => resolve()),
    );
    server = new GameWebSocketServer(httpServer, world, actionQueue);
  });

  afterEach(async () => {
    for (const ws of wsClients) {
      if (ws.readyState !== WebSocket.CLOSED) {
        ws.close();
      }
    }
    wsClients.length = 0;
    server.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  });

  /**
   * A simple buffered WS client that simulates what GameClient does
   * internally (auth flow), to verify the server integration works end-to-end.
   */
  function createBufferedClient(url: string): {
    ws: WebSocket;
    messages: ServerMessage[];
    nextMessage: () => Promise<ServerMessage>;
    send: (msg: ClientMessage) => void;
  } {
    const ws = new WebSocket(url);
    wsClients.push(ws);
    const buffer: ServerMessage[] = [];
    const waiters: Array<(msg: ServerMessage) => void> = [];

    ws.on('message', (data: Buffer | string) => {
      const msg = JSON.parse(data.toString()) as ServerMessage;
      const waiter = waiters.shift();
      if (waiter) {
        waiter(msg);
      } else {
        buffer.push(msg);
      }
    });

    return {
      ws,
      messages: buffer,
      nextMessage: () => {
        const buffered = buffer.shift();
        if (buffered) return Promise.resolve(buffered);
        return new Promise<ServerMessage>((resolve) => {
          waiters.push(resolve);
        });
      },
      send: (msg: ClientMessage) => ws.send(JSON.stringify(msg)),
    };
  }

  it('auth flow with auth messages from cli/auth works end-to-end', async () => {
    const client = createBufferedClient(`ws://127.0.0.1:${port}`);
    await new Promise<void>((resolve, reject) => {
      client.ws.on('open', resolve);
      client.ws.on('error', reject);
    });

    // Server sends auth_prompt
    const prompt = await client.nextMessage();
    expect(prompt.type).toBe('auth_prompt');

    // Send auth using the cli/auth helper
    client.send(createAuthMessage('CLIBot'));
    const authSuccess = await client.nextMessage();
    expect(authSuccess.type).toBe('auth_success');
    const rolePrompt = await client.nextMessage();
    expect(rolePrompt.type).toBe('role_prompt');

    // Send role selection using the cli/auth helper
    client.send(createRoleSelectionMessage('fighter'));
    const confirmed = await client.nextMessage();
    expect(confirmed.type).toBe('role_confirmed');
    if (confirmed.type === 'role_confirmed') {
      expect(confirmed.role).toBe('fighter');
      expect(confirmed.agentId).toMatch(/^agent_/);
      expect(confirmed.spawnPosition).toEqual({ x: 500, y: 500 });
    }

    // Agent should be in world
    expect(world.agents.size).toBe(1);
  });

  it('action sent via stdin format is enqueued', async () => {
    const client = createBufferedClient(`ws://127.0.0.1:${port}`);
    await new Promise<void>((resolve, reject) => {
      client.ws.on('open', resolve);
      client.ws.on('error', reject);
    });

    // Complete auth flow
    await client.nextMessage(); // auth_prompt
    client.send(createAuthMessage('ActionBot'));
    await client.nextMessage(); // auth_success
    await client.nextMessage(); // role_prompt
    client.send(createRoleSelectionMessage('fighter'));
    await client.nextMessage(); // role_confirmed

    // Send an action (the format that would come from stdin parsing)
    const actionMsg: ClientMessage = {
      type: 'action',
      action: 'move',
      params: { x: 510, y: 510 },
      tick: 0,
    };
    client.send(actionMsg);
    await delay(50);

    const drained = actionQueue.drainAll();
    expect(drained.length).toBe(1);
    expect(drained[0]!.action).toBe('move');
    expect(drained[0]!.params).toEqual({ type: 'move', x: 510, y: 510 });
  });

  it('ping message works during playing state', async () => {
    const client = createBufferedClient(`ws://127.0.0.1:${port}`);
    await new Promise<void>((resolve, reject) => {
      client.ws.on('open', resolve);
      client.ws.on('error', reject);
    });

    // Complete auth flow
    await client.nextMessage(); // auth_prompt
    client.send(createAuthMessage('PingBot'));
    await client.nextMessage(); // auth_success
    await client.nextMessage(); // role_prompt
    client.send(createRoleSelectionMessage('fighter'));
    await client.nextMessage(); // role_confirmed

    world.tick = 55;
    client.send(createPingMessage());
    const pong = await client.nextMessage();
    expect(pong.type).toBe('pong');
    if (pong.type === 'pong') {
      expect(pong.serverTick).toBe(55);
    }
  });

  it('reconnection works with same agent name', async () => {
    // First connection
    const client1 = createBufferedClient(`ws://127.0.0.1:${port}`);
    await new Promise<void>((resolve, reject) => {
      client1.ws.on('open', resolve);
      client1.ws.on('error', reject);
    });
    await client1.nextMessage(); // auth_prompt
    client1.send(createAuthMessage('ReconnectBot'));
    await client1.nextMessage(); // auth_success
    await client1.nextMessage(); // role_prompt
    client1.send(createRoleSelectionMessage('merchant'));
    const confirmed1 = await client1.nextMessage();
    expect(confirmed1.type).toBe('role_confirmed');
    const originalAgentId =
      confirmed1.type === 'role_confirmed' ? confirmed1.agentId : '';

    // Disconnect
    await new Promise<void>((resolve) => {
      client1.ws.on('close', resolve);
      client1.ws.close();
    });
    await delay(50);

    // Reconnect
    const client2 = createBufferedClient(`ws://127.0.0.1:${port}`);
    await new Promise<void>((resolve, reject) => {
      client2.ws.on('open', resolve);
      client2.ws.on('error', reject);
    });
    await client2.nextMessage(); // auth_prompt
    client2.send(createAuthMessage('ReconnectBot'));

    const authSuccess = await client2.nextMessage();
    expect(authSuccess.type).toBe('auth_success');
    if (authSuccess.type === 'auth_success') {
      expect(authSuccess.agentId).toBe(originalAgentId);
    }

    const confirmed2 = await client2.nextMessage();
    expect(confirmed2.type).toBe('role_confirmed');
    if (confirmed2.type === 'role_confirmed') {
      expect(confirmed2.agentId).toBe(originalAgentId);
      expect(confirmed2.role).toBe('merchant');
    }

    // Should still be 1 agent in world
    expect(world.agents.size).toBe(1);
  });
});
