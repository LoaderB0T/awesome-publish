#!/usr/bin/env node
import { defineCommand, runMain } from 'citty';
import { publishCommand } from './commands/publish.js';
import { packCommand } from './commands/pack.js';
import { versionCommand } from './commands/version.js';
import { initCommand } from './commands/init.js';
import { changesetCommand } from './commands/changeset.js';
import { statusCommand } from './commands/status.js';

// C6: Handle SIGTERM same as SIGINT for graceful shutdown
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    console.log(`\nReceived ${signal}, shutting down...`);
    process.exit(130);
  });
}

const main = defineCommand({
  meta: {
    name: 'awesome-publish',
    description: 'Effortless npm package publishing',
    version: '0.0.1',
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
