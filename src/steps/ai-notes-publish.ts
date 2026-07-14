import { Phases } from '../pipeline/phases.js';
import type { PipelineStep } from '../pipeline/step.js';
import type { AiNotesContext, GithubReleaseContext } from '../pipeline/context.js';
import { GitHubService } from '../services/github.js';
import { debug } from '../services/debug.js';

export const aiNotesPublishStep: PipelineStep<
  AiNotesContext & GithubReleaseContext & { rootDir: string }
> = {
  name: 'ai-notes-publish',
  phase: Phases.AI_NOTES_PUBLISH,
  after: [Phases.GITHUB_RELEASE],
  before: [Phases.CLEANUP],
  hasSideEffects: true,

  shouldRun: ctx =>
    ctx.config.github.releases.enabled && ctx.releaseNotes?.size > 0 && ctx.releaseIds?.size > 0,

  async execute(ctx): Promise<void> {
    const token = process.env.GITHUB_TOKEN;
    if (!token) {
      debug('ai-notes-publish', 'no GITHUB_TOKEN, skipping');
      return;
    }

    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const exec = promisify(execFile);
    const { stdout } = await exec('git', ['remote', 'get-url', 'origin'], { cwd: ctx.rootDir });
    const match = stdout.trim().match(/[:/]([^/]+)\/([^/.]+?)(?:\.git)?$/);
    if (!match) return;

    const github = new GitHubService(match[1], match[2], token);
    debug('ai-notes-publish', `repo: ${match[1]}/${match[2]}`);
    debug('ai-notes-publish', 'mode', ctx.config.github.releases.mode);

    if (ctx.config.github.releases.mode === 'combined') {
      const releaseId = ctx.releaseIds.get('combined');
      if (!releaseId) return;
      const allNotes = Array.from(ctx.releaseNotes.entries())
        .map(([name, notes]) => `## ${name}\n\n${notes}`)
        .join('\n\n---\n\n');
      debug(
        'ai-notes-publish',
        `updating combined release id=${releaseId} (${allNotes.length} chars)`
      );
      await github.updateRelease(releaseId, allNotes);
    } else {
      for (const [name, notes] of ctx.releaseNotes) {
        const releaseId = ctx.releaseIds.get(name);
        if (releaseId) {
          debug(
            'ai-notes-publish',
            `updating ${name} release id=${releaseId} (${notes.length} chars)`
          );
          await github.updateRelease(releaseId, notes);
        }
      }
    }
  },
};
