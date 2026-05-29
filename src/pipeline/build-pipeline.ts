import type { ResolvedConfig } from '../types/config.js';
import type { PipelineStep } from './step.js';
import { determineVersionStep } from '../steps/determine-version.js';
import { confirmPublishStep } from '../steps/confirm-publish.js';
import { syncDependenciesStep } from '../steps/sync-dependencies.js';
import { writeVersionsStep } from '../steps/write-versions.js';
import { writeChangelogStep } from '../steps/write-changelog.js';
import { buildTempDirStep } from '../steps/build-temp-dir.js';
import { modifyPackageJsonStep } from '../steps/modify-package-json.js';
import { publishNpmStep } from '../steps/publish-npm.js';
import { packLocalStep } from '../steps/pack-local.js';
import { gitTagStep } from '../steps/git-tag.js';
import { cleanupStep } from '../steps/cleanup.js';
import { readChangesetsStep } from '../steps/read-changesets.js';
import { consumeChangesetsStep } from '../steps/consume-changesets.js';
import { generateAiNotesStep } from '../steps/generate-ai-notes.js';
import { aiNotesPublishStep } from '../steps/ai-notes-publish.js';
import { createGithubReleaseStep } from '../steps/create-github-release.js';

export type Command = 'publish' | 'pack' | 'version';

function getCoreFeaturesForCommand(command: Command, config: ResolvedConfig): PipelineStep<any, any>[] {
  const steps: PipelineStep<any, any>[] = [determineVersionStep];

  if (command === 'publish') {
    steps.push(confirmPublishStep);
  }

  if (config.syncDependencies) {
    steps.push(syncDependenciesStep);
  }

  steps.push(writeVersionsStep);

  if (config.changelog.enabled) {
    steps.push(writeChangelogStep);
  }

  switch (command) {
    case 'publish':
      steps.push(buildTempDirStep, modifyPackageJsonStep, publishNpmStep);
      if (config.gitTag.enabled) steps.push(gitTagStep);
      steps.push(cleanupStep);
      break;
    case 'pack':
      steps.push(buildTempDirStep, modifyPackageJsonStep, packLocalStep, cleanupStep);
      break;
    case 'version':
      if (config.gitTag.enabled) steps.push(gitTagStep);
      steps.push(cleanupStep);
      break;
  }

  return steps;
}

export function buildPipeline(command: Command, config: ResolvedConfig): PipelineStep<any, any>[] {
  const steps = getCoreFeaturesForCommand(command, config);

  if (config.changesets.enabled) {
    steps.push(readChangesetsStep);
    if (command === 'publish' || command === 'version') {
      steps.push(consumeChangesetsStep);
    }
  }

  if (command === 'publish') {
    if (config.aiReleaseNotes.enabled) steps.push(generateAiNotesStep);
    if (config.github.releases.enabled) steps.push(createGithubReleaseStep);
    if (config.aiReleaseNotes.enabled && config.github.releases.enabled) steps.push(aiNotesPublishStep);
  }

  return steps;
}
