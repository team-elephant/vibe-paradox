// cli/client.ts — WebSocket client wrapper

import WebSocket from 'ws';
import type { AgentRole, ClientMessage, ServerMessage } from '../src/types/index.js';
import { createAuthMessage, createRoleSelectionMessage } from './auth.js';
import { writeServerMessage, startStdinReader } from './agent-interface.js';

const MAX_RECONNECT_DELAY_MS = 30_000;
const INITIAL_RECONNECT_DELAY_MS = 1_000;

export class GameClient {
  private ws: WebSocket | null = null;
  private reconnectDelay = INITIAL_RECONNECT_DELAY_MS;
  private shouldReconnect = true;
  private isConnected = false;

  constructor(
    private readonly serverUrl: string,
    private readonly agentName: string,
    private readonly role?: AgentRole,
  ) {}

  async connect(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.connectInternal(resolve, reject);
    });
  }

  private connectInternal(
    onFirstConnect?: () => void,
    onFirstError?: (err: Error) => void,
  ): void {
    const ws = new WebSocket(this.serverUrl);
    this.ws = ws;
    let firstConnection = true;

    ws.on('open', () => {
      this.isConnected = true;
      this.reconnectDelay = INITIAL_RECONNECT_DELAY_MS;
      process.stderr.write(`Connected to ${this.serverUrl}\n`);
    });

    ws.on('message', (data: Buffer | string) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(data.toString()) as ServerMessage;
      } catch {
        return; // silently drop malformed JSON
      }

      this.handleServerMessage(msg, ws);

      // Output all server messages to stdout as JSON lines
      writeServerMessage(msg);

      // Resolve the connect() promise on first role_confirmed
      if (firstConnection && msg.type === 'role_confirmed') {
        firstConnection = false;
        onFirstConnect?.();
      }
    });

    ws.on('close', () => {
      this.isConnected = false;
      process.stderr.write('Disconnected from server\n');

      if (this.shouldReconnect) {
        process.stderr.write(
          `Reconnecting in ${this.reconnectDelay}ms...\n`,
        );
        setTimeout(() => {
          this.reconnectDelay = Math.min(
            this.reconnectDelay * 2,
            MAX_RECONNECT_DELAY_MS,
          );
          this.connectInternal();
        }, this.reconnectDelay);
      }
    });

    ws.on('error', (err: Error) => {
      process.stderr.write(`WebSocket error: ${err.message}\n`);
      if (firstConnection) {
        firstConnection = false;
        onFirstError?.(err);
      }
    });

    // Wire stdin → server
    startStdinReader((clientMsg: ClientMessage) => {
      this.send(clientMsg);
    });
  }

  private handleServerMessage(msg: ServerMessage, ws: WebSocket): void {
    switch (msg.type) {
      case 'auth_prompt':
        // Automatically send auth
        this.send(createAuthMessage(this.agentName));
        break;

      case 'auth_success':
        // Auth succeeded; if we already have a role_confirmed, we're reconnecting
        break;

      case 'role_prompt':
        // Select role — use pre-selected or default to 'fighter'
        this.send(createRoleSelectionMessage(this.role ?? 'fighter'));
        break;

      case 'auth_error':
        process.stderr.write(`Auth error: ${msg.reason}\n`);
        this.shouldReconnect = false;
        ws.close();
        break;

      // tick_update, action_rejected, event, pong, role_confirmed —
      // all output to stdout via writeServerMessage in the message handler
    }
  }

  send(msg: ClientMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  close(): void {
    this.shouldReconnect = false;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}
