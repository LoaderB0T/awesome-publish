#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { defineCommand, runMain } from 'citty';
import { publishCommand } from './commands/publish.js';
import { packCommand } from './commands/pack.js';
import { versionCommand } from './commands/version.js';
import { initCommand } from './commands/init.js';
import { changesetCommand } from './commands/changeset.js';
import { statusCommand } from './commands/status.js';

// Single source of truth for the version — read from the installed package.json
// (lib/cli/index.js → ../../package.json) so `--version` never drifts.
function readVersion(): string {
  try {
    const pkgPath = join(dirname(fileURLToPath(import.meta.url)), '../../package.json');
    return JSON.parse(readFileSync(pkgPath, 'utf-8')).version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

// Signal handling for temp-dir cleanup on Ctrl+C is registered by the pipeline
// runner (which knows the active temp dirs). We intentionally do NOT install an
// eager process.exit() handler here — doing so would pre-empt that cleanup.

const main = defineCommand({
  meta: {
    name: 'awesome-publish',
    description: 'Effortless npm package publishing',
    version: readVersion(),
  },
  subCommands: {
    publish: publishCommand,
    pack: packCommand,
    version: versionCommand,
    init: initCommand,
    changeset: changesetCommand,
    status: statusCommand,
  },
});

void runMain(main);
