import { defineConfig } from './src/index.js';

// awesome-publish publishes itself. stripScripts drops the dev-only
// `preinstall: only-allow pnpm` (and husky `prepare`) from the published
// manifest so consumers installing with npm/yarn aren't blocked. README and
// LICENSE are copied into the tarball automatically. buildCommand compiles
// lib/ before packing.
export default defineConfig({
  publishFiles: ['lib'],
  stripScripts: true,
  buildCommand: 'pnpm run build',
  changesets: {
    enabled: true,
  },
});
