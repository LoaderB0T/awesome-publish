import { describe, it, expect } from 'vitest';
import { changesetSummariesFor } from '../../src/steps/read-changesets.js';
import type { Changeset } from '../../src/types/changeset.js';

const cs = (id: string, summary: string, ...names: string[]): Changeset => ({
  id,
  summary,
  releases: names.map(name => ({ name, type: 'patch' as const })),
});

describe('changesetSummariesFor', () => {
  it('returns only the summaries releasing that package, ordered by id', () => {
    const changesets = [
      cs('zzz', 'Third thing', 'pkg-a'),
      cs('aaa', 'First thing', 'pkg-a', 'pkg-b'),
      cs('mmm', 'Other package only', 'pkg-b'),
    ];
    expect(changesetSummariesFor(changesets, 'pkg-a')).toEqual(['First thing', 'Third thing']);
  });

  it('de-duplicates identical summaries', () => {
    const changesets = [cs('a', 'Same note', 'pkg-a'), cs('b', 'Same note', 'pkg-a')];
    expect(changesetSummariesFor(changesets, 'pkg-a')).toEqual(['Same note']);
  });

  it('is empty for no changesets, undefined changesets, or an unrelated package', () => {
    expect(changesetSummariesFor(undefined, 'pkg-a')).toEqual([]);
    expect(changesetSummariesFor([], 'pkg-a')).toEqual([]);
    expect(changesetSummariesFor([cs('a', 'note', 'pkg-b')], 'pkg-a')).toEqual([]);
  });

  it('drops empty summaries rather than emitting blank bullets', () => {
    expect(changesetSummariesFor([cs('a', '   ', 'pkg-a')], 'pkg-a')).toEqual([]);
  });
});
