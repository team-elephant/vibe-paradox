// agent/launcher.ts — Multi-agent launcher

import { spawn, type ChildProcess } from 'node:child_process';
import { Command } from 'commander';

const program = new Command();

program
  .name('vibe-paradox-launcher')
  .description('Launch multiple AI agents for Vibe Paradox')
  .requiredOption('--server <url>', 'Server WebSocket URL')
  .option('--fighters <n>', 'Number of fighter agents', '0')
  .option('--merchants <n>', 'Number of merchant agents', '0')
  .option('--monsters <n>', 'Number of monster agents', '0')
  .action((opts: { server: string; fighters: string; merchants: string; monsters: string }) => {
    const fighterCount = parseInt(opts.fighters, 10);
    const merchantCount = parseInt(opts.merchants, 10);
    const monsterCount = parseInt(opts.monsters, 10);

    const total = fighterCount + merchantCount + monsterCount;
    if (total === 0) {
      process.stderr.write('No agents specified. Use --fighters, --merchants, or --monsters.\n');
      process.exit(1);
    }

    const children: ChildProcess[] = [];
    const agentPath = new URL('./index.ts', import.meta.url).pathname;

    const spawnAgent = (name: string, role: string): void => {
      const child = spawn('npx', ['tsx', agentPath,
        '--server', opts.server,
        '--name', name,
        '--role', role,
      ], {
        stdio: ['ignore', 'ignore', 'inherit'],
      });

      children.push(child);
      process.stderr.write(`Spawned ${name} (${role}) pid=${child.pid}\n`);

      child.on('exit', (code) => {
        process.stderr.write(`${name} exited with code ${code}\n`);
      });
    };

    // Spawn fighters
    for (let i = 1; i <= fighterCount; i++) {
      spawnAgent(`Fighter_${String(i).padStart(3, '0')}`, 'fighter');
    }

    // Spawn merchants
    for (let i = 1; i <= merchantCount; i++) {
      spawnAgent(`Merchant_${String(i).padStart(3, '0')}`, 'merchant');
    }

    // Spawn monsters
    for (let i = 1; i <= monsterCount; i++) {
      spawnAgent(`Monster_${String(i).padStart(3, '0')}`, 'monster');
    }

    process.stderr.write(`Launched ${total} agents (${fighterCount}F/${merchantCount}M/${monsterCount}Mo)\n`);

    // Graceful shutdown
    const shutdown = (): void => {
      process.stderr.write('Shutting down all agents...\n');
      for (const child of children) {
        child.kill('SIGTERM');
      }
      // Force kill after 5 seconds
      setTimeout(() => {
        for (const child of children) {
          if (!child.killed) child.kill('SIGKILL');
        }
        process.exit(0);
      }, 5000);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  });

program.parse();
