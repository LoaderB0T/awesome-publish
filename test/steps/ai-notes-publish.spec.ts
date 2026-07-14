import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the GitHub service so updateRelease fails the way a post-publish API
// blip / token-scope error would, without touching the network.
const updateRelease = vi.fn();
vi.mock('../../src/services/github.js', () => ({
  parseGitHubRepo: vi.fn(async () => ({ owner: 'acme', repo: 'widget' })),
  GitHubService: class {
    updateRelease = updateRelease;
  },
}));

const { aiNotesPublishStep } = await import('../../src/steps/ai-notes-publish.js');

function makeCtx() {
  return {
    config: { github: { releases: { enabled: true, mode: 'per-package', draft: false } } },
    rootDir: '/tmp/repo',
    releaseNotes: new Map([['pkg-a', 'AI notes body']]),
    releaseIds: new Map([['pkg-a', 123]]),
  } as any;
}

describe('aiNotesPublishStep', () => {
  beforeEach(() => {
    updateRelease.mockReset();
    process.env.GITHUB_TOKEN = 'test-token';
  });
  afterEach(() => {
    delete process.env.GITHUB_TOKEN;
  });

  it('does NOT fail the pipeline when updateRelease throws (release already succeeded)', async () => {
    updateRelease.mockRejectedValue(new Error('403 Forbidden'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Must resolve, not reject — the npm publish + GitHub release are already live.
    await expect(aiNotesPublishStep.execute(makeCtx())).resolves.toBeUndefined();
    expect(updateRelease).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/release itself succeeded/i));

    warn.mockRestore();
  });

  it('attaches notes normally on the happy path', async () => {
    updateRelease.mockResolvedValue(undefined);
    await expect(aiNotesPublishStep.execute(makeCtx())).resolves.toBeUndefined();
    expect(updateRelease).toHaveBeenCalledWith(123, 'AI notes body');
  });
});
