import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { readChangesetsStep } from '../../src/steps/read-changesets.js';
import type { ResolvedConfig } from '../../src/types/config.js';

const fixtureDir = resolve(import.meta.dirname, '../fixtures/changesets');

describe('readChangesetsStep', () => {
  it('parses changeset files from .changeset directory', async () => {
    const ctx = {
      config: {
        changesets: { enabled: true, enforceInPR: false },
      } as ResolvedConfig,
      packages: [
        { name: '@scope/pkg-a', version: '1.0.0', dir: fixtureDir, packageJson: {}, config: {} as ResolvedConfig },
      ],
      mode: 'interactive' as const,
      dryRun: false,
      rootDir: fixtureDir,
    };

    const result = await readChangesetsStep.execute(ctx as any);
    expect(result.changesets).toHaveLength(2);

    const feature = result.changesets.find(c => c.id === 'add-feature');
    expect(feature).toBeDefined();
    expect(feature!.releases).toContainEqual({ name: '@scope/pkg-a', type: 'minor' });

    const bug = result.changesets.find(c => c.id === 'fix-bug');
    expect(bug).toBeDefined();
    expect(bug!.releases).toHaveLength(2);
  });

  it('returns empty array when no changeset files exist', async () => {
    const ctx = {
      config: { changesets: { enabled: true, enforceInPR: false } } as ResolvedConfig,
      packages: [],
      mode: 'interactive' as const,
      dryRun: false,
      rootDir: '/nonexistent',
    };

    const result = await readChangesetsStep.execute(ctx as any);
    expect(result.changesets).toEqual([]);
  });
});
