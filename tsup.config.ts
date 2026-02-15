import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/server/index.ts', 'cli/index.ts'],
  format: ['esm'],
  target: 'node18',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  dts: true,
});
