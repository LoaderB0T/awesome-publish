import type { ResolvedConfig } from '../types/config.js';
import type { PipelineStep } from './step.js';
import { determineVersionStep } from '../steps/determine-version.js';
import { confirmPublishStep } from '../steps/confirm-publish.js';
import { preflightStep } from '../steps/preflight.js';
import { runBuildStep } from '../steps/run-build.js';
import { syncDependenciesStep } from '../steps/sync-dependencies.js';
import { writeVersionsStep } from '../steps/write-versions.js';
import { writeChangelogStep } from '../steps/write-changelog.js';
import { buildTempDirStep } from '../steps/build-temp-dir.js';
import { modifyPackageJsonStep } from '../steps/modify-package-json.js';
import { publishNpmStep } from '../steps/publish-npm.js';
import { packLocalStep } from '../steps/pack-local.js';
import { gitCommitStep } from '../steps/git-commit.js';
import { gitTagStep } from '../steps/git-tag.js';
import { cleanupStep } from '../steps/cleanup.js';
import { readChangesetsStep } from '../steps/read-changesets.js';
import { consumeChangesetsStep } from '../steps/consume-changesets.js';
import { generateAiNotesStep } from '../steps/generate-ai-notes.js';
import { aiNotesPublishStep } from '../steps/ai-notes-publish.js';
import { createGithubReleaseStep } from '../steps/create-github-release.js';

export type Command = 'publish' | 'pack' | 'version';

function getCoreFeaturesForCommand(
  command: Command,
  config: ResolvedConfig
): PipelineStep<any, any>[] {
  const steps: PipelineStep<any, any>[] = [determineVersionStep];

  if (command === 'publish') {
    steps.push(confirmPublishStep);
    if (config.github.releases.enabled) steps.push(preflightStep);
  }

  // Build publishable artifacts before packing (publish and pack both pack).
  if ((command === 'publish' || command === 'pack') && config.buildCommand) {
    steps.push(runBuildStep);
  }

  // `pack` only builds tarballs — it must NOT mutate the real working tree.
  // Writing the bumped version/changelog/synced deps to disk is only for
  // publish/version; the tarball itself gets the bumped version from
  // modify-package-json (temp copy), so pack doesn't need these.
  if (command === 'publish' || command === 'version') {
    if (config.syncDependencies) {
      steps.push(syncDependenciesStep);
    }
    steps.push(writeVersionsStep);
    if (config.changelog.enabled) {
      steps.push(writeChangelogStep);
    }
  }

  switch (command) {
    case 'publish':
      steps.push(buildTempDirStep, modifyPackageJsonStep, publishNpmStep, gitCommitStep);
      if (config.gitTag.enabled) steps.push(gitTagStep);
      steps.push(cleanupStep);
      break;
    case 'pack':
      steps.push(buildTempDirStep, modifyPackageJsonStep, packLocalStep, cleanupStep);
      break;
    case 'version':
      steps.push(gitCommitStep);
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
    if (config.github.releases.enabled) steps.push(createGithubReleaseStep);
    // AI release notes are only consumed by the GitHub release step, so only
    // generate them when releases are enabled — otherwise it's a wasted (paid)
    // API call with no consumer.
    if (config.aiReleaseNotes.enabled && config.github.releases.enabled) {
      steps.push(generateAiNotesStep, aiNotesPublishStep);
    }
  }

  return steps;
}
