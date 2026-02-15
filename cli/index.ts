#!/usr/bin/env node
// cli/index.ts — CLI entry point

import { Command } from 'commander';
import type { AgentRole } from '../src/types/index.js';
import { GameClient } from './client.js';

const program = new Command();

program
  .name('vibe-paradox')
  .description('Connect an AI agent to the Vibe Paradox world')
  .version('0.1.0');

program
  .command('connect')
  .description('Connect to a Vibe Paradox server')
  .requiredOption('--server <url>', 'Server WebSocket URL')
  .requiredOption('--agent-name <name>', 'Agent display name')
  .option('--role <role>', 'Pre-select role (merchant/fighter/monster)')
  .action(async (opts: { server: string; agentName: string; role?: string }) => {
    const validRoles: AgentRole[] = ['merchant', 'fighter', 'monster'];
    const role = opts.role as AgentRole | undefined;

    if (role && !validRoles.includes(role)) {
      process.stderr.write(
        `Invalid role: ${role}. Valid roles: ${validRoles.join(', ')}\n`,
      );
      process.exit(1);
    }

    const client = new GameClient(opts.server, opts.agentName, role);

    // Graceful shutdown
    const shutdown = (): void => {
      process.stderr.write('Shutting down...\n');
      client.close();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    try {
      await client.connect();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`Failed to connect: ${msg}\n`);
      process.exit(1);
    }
  });

program.parse();
