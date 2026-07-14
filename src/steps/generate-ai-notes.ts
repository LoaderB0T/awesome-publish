import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Phases } from '../pipeline/phases.js';
import type { PipelineStep } from '../pipeline/step.js';
import type { VersionContext, AiNotesContext } from '../pipeline/context.js';
import { createAiProvider } from '../services/ai/factory.js';
import { GitService } from '../services/git.js';
import { debug } from '../services/debug.js';

function interpolatePrompt(
  template: string,
  vars: { package: string; version: string; from: string; commits: string; type: string },
): string {
  return template
    .replace(/\{\{package\}\}/g, vars.package)
    .replace(/\{\{version\}\}/g, vars.version)
    .replace(/\{\{from\}\}/g, vars.from)
    .replace(/\{\{commits\}\}/g, vars.commits)
    .replace(/\{\{type\}\}/g, vars.type);
}

export const generateAiNotesStep: PipelineStep<VersionContext & { rootDir: string }, AiNotesContext> = {
  name: 'ai-notes-generate',
  phase: Phases.AI_NOTES_GENERATE,
  after: [Phases.DETERMINE_VERSION],
  before: [Phases.PUBLISH_NPM],
  hasSideEffects: false,

  shouldRun: (ctx) => ctx.config.aiReleaseNotes.enabled && ctx.versionBumps?.size > 0,

  async execute(ctx): Promise<AiNotesContext> {
    const provider = createAiProvider(ctx.config);
    const git = new GitService(ctx.rootDir);
    const releaseNotes = new Map<string, string>();

    let customPromptTemplate = '';
    if (ctx.config.aiReleaseNotes.customPromptFile) {
      const promptPath = resolve(ctx.rootDir, ctx.config.aiReleaseNotes.customPromptFile);
      debug('ai-notes-generate', 'custom prompt file', promptPath);
      if (existsSync(promptPath)) {
        customPromptTemplate = readFileSync(promptPath, 'utf-8');
        debug('ai-notes-generate', `loaded custom prompt (${customPromptTemplate.length} chars)`);
      }
    }

    for (const pkg of ctx.packages) {
      const bump = ctx.versionBumps.get(pkg.name);
      if (!bump) continue;

      const latestTag = await git.getLatestTag(pkg.name);
      debug('ai-notes-generate', `${pkg.name}: latest tag`, latestTag ?? 'none');

      const commits = latestTag
        ? await git.getCommitsSinceTag(latestTag)
        : [];
      debug('ai-notes-generate', `${pkg.name}: ${commits.length} commits since tag`);

      const commitList = commits.map(c => `- ${c.message}`).join('\n');

      const vars = {
        package: pkg.name,
        version: bump.to,
        from: bump.from,
        commits: commitList,
        type: bump.type,
      };

      let prompt: string;
      if (customPromptTemplate) {
        prompt = interpolatePrompt(customPromptTemplate, vars);
      } else {
        prompt = `Generate concise release notes for package "${pkg.name}" version ${bump.to} (from ${bump.from}).\n\nCommits:\n${commitList}\n\nWrite in markdown. Focus on user-facing changes. Be concise.`;
      }

      debug('ai-notes-generate', `${pkg.name}: sending prompt to AI (${prompt.length} chars)`);
      const notes = await provider.generateText(prompt);
      debug('ai-notes-generate', `${pkg.name}: received notes (${notes.length} chars)`);
      releaseNotes.set(pkg.name, notes);
    }

    return { releaseNotes };
  },
};
