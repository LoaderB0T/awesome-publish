#!/usr/bin/env node
import { defineCommand, runMain } from 'citty';
import { publishCommand } from './commands/publish.js';

const main = defineCommand({
  meta: {
    name: 'awesome-publish',
    description: 'Effortless npm package publishing',
    version: '0.0.1',
  },
  subCommands: {
    publish: publishCommand,
  },
});

runMain(main);
