// agent/index.ts — Entry point: spawns CLI as child process, wires stdin/stdout to brain
//
// Feature flag: AGENT_BRAIN_VERSION=1 uses v1 (LLM every tick), =2 uses pipeline (default)

import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { Command } from 'commander';
import type { AgentRole, ServerMessage, TickUpdateData } from '../src/types/index.js';
import { loadConfig } from './config.js';
import { AgentBrain } from './brain.js';
import { AgentBrain as AgentBrainV1 } from './brain-v1.js';

interface Brain {
  onTickUpdate(update: TickUpdateData): Promise<void>;
  onActionRejected(action: string, reason: string): void;
}

const program = new Command();

program
  .name('vibe-paradox-agent')
  .description('AI agent brain for Vibe Paradox')
  .requiredOption('--server <url>', 'Server WebSocket URL')
  .requiredOption('--name <name>', 'Agent display name')
  .requiredOption('--role <role>', 'Agent role (merchant/fighter/monster)')
  .action((opts: { server: string; name: string; role: string }) => {
    const validRoles: AgentRole[] = ['merchant', 'fighter', 'monster'];
    const role = opts.role as AgentRole;
    if (!validRoles.includes(role)) {
      process.stderr.write(`Invalid role: ${opts.role}. Valid: ${validRoles.join(', ')}\n`);
      process.exit(1);
    }

    const config = loadConfig({
      serverUrl: opts.server,
      name: opts.name,
      role,
    });

    // Spawn CLI client as child process
    const cliPath = new URL('../cli/index.ts', import.meta.url).pathname;
    const child = spawn('npx', ['tsx', cliPath, 'connect',
      '--server', config.serverUrl,
      '--agent-name', config.name,
      '--role', config.role,
    ], {
      stdio: ['pipe', 'pipe', 'inherit'],
    });

    // Feature flag: AGENT_BRAIN_VERSION (default: "2")
    const brainVersion = process.env.AGENT_BRAIN_VERSION ?? '2';
    let brain: Brain;

    if (brainVersion === '1') {
      process.stderr.write(`[${config.name}] Using brain v1 (LLM every tick)\n`);
      brain = new AgentBrainV1(config, (action) => {
        const line = JSON.stringify(action) + '\n';
        child.stdin.write(line);
      });
    } else {
      process.stderr.write(`[${config.name}] Using brain v2 (pipeline)\n`);
      brain = new AgentBrain(config, (action) => {
        const line = JSON.stringify(action) + '\n';
        child.stdin.write(line);
      });
    }

    // Wire child stdout → brain
    const rl = createInterface({ input: child.stdout, terminal: false });
    rl.on('line', (line: string) => {
      try {
        const msg = JSON.parse(line) as ServerMessage;
        if (msg.type === 'tick_update') {
          brain.onTickUpdate(msg.data as TickUpdateData).catch((err) => {
            process.stderr.write(`Brain error: ${err instanceof Error ? err.message : String(err)}\n`);
          });
        } else if (msg.type === 'action_rejected') {
          brain.onActionRejected(msg.action, msg.reason);
        }
      } catch {
        // ignore malformed lines
      }
    });

    child.on('exit', (code) => {
      process.stderr.write(`CLI client exited with code ${code}\n`);
      process.exit(code ?? 1);
    });

    // Graceful shutdown
    const shutdown = (): void => {
      process.stderr.write(`Shutting down agent ${config.name}...\n`);
      child.kill('SIGTERM');
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    process.stderr.write(`Agent ${config.name} (${config.role}) starting...\n`);
  });

program.parse();
