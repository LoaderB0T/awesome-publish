import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { readChangesetsStep, parseChangesetFile } from '../../src/steps/read-changesets.js';
import type { ResolvedConfig } from '../../src/types/config.js';

const fixtureDir = resolve(import.meta.dirname, '../fixtures/changesets');

describe('readChangesetsStep', () => {
  it('parses changeset files from .changeset directory', async () => {
    const ctx = {
      config: {
        changesets: { enabled: true, enforceInPR: false },
      } as ResolvedConfig,
      packages: [
        {
          name: '@scope/pkg-a',
          version: '1.0.0',
          dir: fixtureDir,
          packageJson: {},
          config: {} as ResolvedConfig,
        },
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
    expect(feature!.summary).toBe('Added a new feature');
    expect(feature!.meta).toEqual({
      author: 'Test User',
      email: 'test@example.com',
      timestamp: '2026-05-29T14:30:00.000Z',
    });

    const bug = result.changesets.find(c => c.id === 'fix-bug');
    expect(bug).toBeDefined();
    expect(bug!.releases).toHaveLength(2);
    expect(bug!.meta).toBeUndefined();
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

  it('warns about (but does not silently drop) a malformed frontmatter line beside a valid one (H1)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ap-cs-'));
    const file = join(dir, 'typo.md');
    // pkg-a is valid; pkg-b has a typo'd bump type — without a per-line warning
    // this loss would be invisible (the file still parses via the valid line and
    // is deleted after publish).
    writeFileSync(file, '---\n"pkg-a": patch\n"pkg-b": pathc\n---\nfix both\n');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const parsed = parseChangesetFile(file);
      expect(parsed?.releases).toEqual([{ name: 'pkg-a', type: 'patch' }]);
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/pkg-b.*pathc|invalid frontmatter/i));
    } finally {
      warn.mockRestore();
    }
  });
});
