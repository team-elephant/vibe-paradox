// server/spawner.ts — Agent process manager
// Spawns agent processes as children of the server process.
// Follows the same spawn pattern as agent/launcher.ts.

import { spawn, type ChildProcess } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { UsersDatabase } from './users-db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface SpawnConfig {
  agentId: string;
  name: string;
  role: string;
  userId: string;
  apiKey: string;
  model?: string;
  serverUrl?: string;
}

export class AgentSpawner {
  private processes: Map<string, ChildProcess> = new Map();
  private lastSpawnByUser: Map<string, number> = new Map();
  private db: UsersDatabase;

  private static readonly SPAWN_COOLDOWN_MS = 10_000; // 1 spawn per 10 seconds per user
  private static readonly FORCE_KILL_TIMEOUT_MS = 5_000;

  constructor(db: UsersDatabase) {
    this.db = db;
  }

  /** Resolve the agent entry point — tsx in dev, node in production */
  private resolveAgentPath(): { command: string; args: string[] } {
    // Try built path first
    const builtPath = resolve(__dirname, '../../agent/index.js');
    // In dev, use tsx with the TypeScript source
    // The project root is two levels up from src/server/
    const projectRoot = resolve(__dirname, '../..');
    const srcPath = resolve(projectRoot, 'agent/index.ts');

    // Use tsx for .ts files (dev mode) — matches launcher.ts pattern
    return { command: 'npx', args: ['tsx', srcPath] };
  }

  /** Check if user is within spawn cooldown */
  canSpawn(userId: string): { allowed: boolean; retryAfterMs?: number } {
    const lastSpawn = this.lastSpawnByUser.get(userId);
    if (!lastSpawn) return { allowed: true };

    const elapsed = Date.now() - lastSpawn;
    if (elapsed >= AgentSpawner.SPAWN_COOLDOWN_MS) return { allowed: true };

    return {
      allowed: false,
      retryAfterMs: AgentSpawner.SPAWN_COOLDOWN_MS - elapsed,
    };
  }

  async spawn(config: SpawnConfig): Promise<{ pid: number }> {
    // Check if already running
    if (this.processes.has(config.agentId)) {
      throw new Error('Agent is already running');
    }

    // Rate limit
    const check = this.canSpawn(config.userId);
    if (!check.allowed) {
      throw new Error(`Rate limited. Try again in ${Math.ceil(check.retryAfterMs! / 1000)}s`);
    }

    const { command, args } = this.resolveAgentPath();

    const child = spawn(command, [
      ...args,
      '--server', config.serverUrl || 'ws://localhost:8080',
      '--name', config.name,
      '--role', config.role,
    ], {
      stdio: ['ignore', 'ignore', 'inherit'],
      env: {
        ...process.env,
        ANTHROPIC_API_KEY: config.apiKey,
        VIBE_PARADOX_MODEL: config.model || 'claude-haiku-4-5-20251001',
        AGENT_ID: config.agentId,
        USER_ID: config.userId,
      },
    });

    if (!child.pid) {
      throw new Error('Failed to spawn agent process');
    }

    this.processes.set(config.agentId, child);
    this.lastSpawnByUser.set(config.userId, Date.now());

    // Update DB
    this.db.updateAgentStatus(config.agentId, 'running', child.pid);
    console.log(`[VP] Spawned agent ${config.name} (${config.role}) pid=${child.pid} user=${config.userId}`);

    // Handle exit
    child.on('exit', (code) => {
      this.processes.delete(config.agentId);
      const status = code === 0 ? 'stopped' : 'error';
      this.db.updateAgentStatus(config.agentId, status);
      console.log(`[VP] Agent ${config.name} exited with code ${code} → ${status}`);
    });

    child.on('error', (err) => {
      this.processes.delete(config.agentId);
      this.db.updateAgentStatus(config.agentId, 'error');
      console.error(`[VP] Agent ${config.name} error: ${err.message}`);
    });

    return { pid: child.pid };
  }

  async stop(agentId: string): Promise<void> {
    const child = this.processes.get(agentId);
    if (!child) {
      // Not running — just update DB status
      this.db.updateAgentStatus(agentId, 'stopped');
      return;
    }

    child.kill('SIGTERM');

    // Force kill after timeout
    const forceKillTimer = setTimeout(() => {
      if (!child.killed) {
        child.kill('SIGKILL');
      }
    }, AgentSpawner.FORCE_KILL_TIMEOUT_MS);

    // Clean up timer when process exits
    child.once('exit', () => {
      clearTimeout(forceKillTimer);
    });
  }

  isRunning(agentId: string): boolean {
    return this.processes.has(agentId);
  }

  getRunningIds(): string[] {
    return Array.from(this.processes.keys());
  }

  /** Stop all running agents (for graceful server shutdown) */
  async stopAll(): Promise<void> {
    const ids = this.getRunningIds();
    await Promise.all(ids.map(id => this.stop(id)));
  }
}
