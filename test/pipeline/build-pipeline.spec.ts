import { describe, it, expect } from 'vitest';
import { buildPipeline } from '../../src/pipeline/build-pipeline.js';
import type { ResolvedConfig } from '../../src/types/config.js';

function config(overrides: Partial<ResolvedConfig> = {}): ResolvedConfig {
  return {
    packageManager: 'pnpm',
    registry: 'https://registry.npmjs.org',
    publishFiles: ['lib'],
    stripScripts: true,
    access: 'public',
    provenance: false,
    requireCleanGit: true,
    gitTag: { enabled: true, prefix: '' },
    changelog: { enabled: true, file: 'CHANGELOG.md' },
    conventionalCommits: false,
    confirmPublish: true,
    syncDependencies: true,
    changesets: { enabled: false, enforceInPR: false },
    github: { releases: { enabled: false, mode: 'per-package', draft: false } },
    aiReleaseNotes: { enabled: false },
    ...overrides,
  };
}

const names = (steps: { name: string }[]) => steps.map(s => s.name);

describe('buildPipeline', () => {
  it('pack does NOT mutate the real tree (no write-versions/changelog/sync-deps)', () => {
    const steps = names(buildPipeline('pack', config()));
    expect(steps).not.toContain('write-versions');
    expect(steps).not.toContain('write-changelog');
    expect(steps).not.toContain('sync-dependencies');
    // But it still packs from a temp dir.
    expect(steps).toContain('build-temp-dir');
    expect(steps).toContain('pack-local');
  });

  it('publish writes versions/changelog to disk', () => {
    const steps = names(buildPipeline('publish', config()));
    expect(steps).toContain('write-versions');
    expect(steps).toContain('write-changelog');
    expect(steps).toContain('publish-npm');
  });

  it('does not generate AI notes when GitHub releases are disabled', () => {
    const steps = names(
      buildPipeline(
        'publish',
        config({
          aiReleaseNotes: { enabled: true },
          aiProvider: { provider: 'anthropic', model: 'claude-sonnet-5' },
        })
      )
    );
    expect(steps).not.toContain('ai-notes-generate');
  });

  it('generates + publishes AI notes when releases are enabled', () => {
    const steps = names(
      buildPipeline(
        'publish',
        config({
          aiReleaseNotes: { enabled: true },
          aiProvider: { provider: 'anthropic', model: 'claude-sonnet-5' },
          github: { releases: { enabled: true, mode: 'per-package', draft: false } },
        })
      )
    );
    expect(steps).toContain('ai-notes-generate');
    expect(steps).toContain('ai-notes-publish');
    expect(steps).toContain('github-release');
  });
});
