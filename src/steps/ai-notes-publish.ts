import { Phases } from '../pipeline/phases.js';
import type { PipelineStep } from '../pipeline/step.js';
import type {
  AiNotesContext,
  GithubReleaseContext,
  PublishContext,
  VersionContext,
} from '../pipeline/context.js';
import { GitHubService, parseGitHubRepo } from '../services/github.js';
import { buildCombinedReleaseBody } from './create-github-release.js';
import { debug } from '../services/debug.js';

export const aiNotesPublishStep: PipelineStep<
  AiNotesContext & GithubReleaseContext & PublishContext & VersionContext & { rootDir: string }
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

    let owner: string;
    let repo: string;
    try {
      ({ owner, repo } = await parseGitHubRepo(ctx.rootDir));
    } catch {
      return;
    }

    const github = new GitHubService(owner, repo, token);
    debug('ai-notes-publish', `repo: ${owner}/${repo}`);
    debug('ai-notes-publish', 'mode', ctx.config.github.releases.mode);

    // This step runs AFTER npm publish, the git tag, and the GitHub release are
    // all live. Attaching AI notes is a best-effort enhancement — a GitHub API
    // blip or a token-scope error here must never fail the pipeline (which would
    // also skip cleanup) after the release already succeeded. Degrade to a warn,
    // matching generate-ai-notes and the documented "AI never blocks a release".
    try {
      if (ctx.config.github.releases.mode === 'combined') {
        const releaseId = ctx.releaseIds.get('combined');
        if (!releaseId) return;
        const notes = Array.from(ctx.releaseNotes.entries())
          .map(([name, n]) => `## ${name}\n\n${n}`)
          .join('\n\n---\n\n');
        // Keep the "Published packages" version table that create-github-release
        // wrote — updateRelease replaces the whole body, so re-prepend it.
        const allNotes = `${buildCombinedReleaseBody(ctx)}\n\n${notes}`;
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
    } catch (error: any) {
      console.warn(
        `⚠ AI release notes could not be attached (the release itself succeeded): ${error?.message ?? error}`
      );
    }
  },
};
