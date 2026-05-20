#!/usr/bin/env node
import { defineCommand, runMain } from 'citty';
import { publishCommand } from './commands/publish.js';
import { packCommand } from './commands/pack.js';
import { versionCommand } from './commands/version.js';

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
  },
});

runMain(main);
