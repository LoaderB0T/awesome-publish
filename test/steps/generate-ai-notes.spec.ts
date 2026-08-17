import { describe, it, expect } from 'vitest';
import { stripRedundantHeading } from '../../src/steps/generate-ai-notes.js';

describe('stripRedundantHeading', () => {
  it('drops a leading heading that restates the package name', () => {
    const notes = '## @awdlab/jig-themes 0.0.3-next.0\n\n- Pre-release version bump.';
    expect(stripRedundantHeading(notes, '@awdlab/jig-themes')).toBe('- Pre-release version bump.');
  });

  it('keeps a leading heading that is real content', () => {
    const notes = '## Features\n\n- Added a thing.';
    expect(stripRedundantHeading(notes, '@awdlab/jig-themes')).toBe(notes);
  });

  it('leaves notes without any heading untouched', () => {
    expect(stripRedundantHeading('- Added a thing.', 'pkg-a')).toBe('- Added a thing.');
  });

  it('does not strip a later heading that mentions the package', () => {
    const notes = '- Added a thing.\n\n## pkg-a internals\n\n- More.';
    expect(stripRedundantHeading(notes, 'pkg-a')).toBe(notes);
  });
});
