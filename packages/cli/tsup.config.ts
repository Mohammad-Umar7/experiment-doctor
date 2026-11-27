import { fileURLToPath } from 'node:url';
import { defineConfig } from 'tsup';

const coreSrc = fileURLToPath(new URL('../core/src/index.ts', import.meta.url));

// Bundle core into dist/cli.js so `npx experiment-doctor` needs no other package.
export default defineConfig({
  entry: { cli: 'src/cli.ts' },
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  clean: true,
  sourcemap: false,
  noExternal: ['@experiment-doctor/core'],
  banner: { js: '#!/usr/bin/env node' },
  esbuildOptions(options) {
    options.alias = { ...(options.alias ?? {}), '@experiment-doctor/core': coreSrc };
  },
});
