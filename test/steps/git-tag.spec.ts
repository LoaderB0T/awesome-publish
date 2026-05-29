import { describe, it, expect } from 'vitest';
import { buildTagName } from '../../src/steps/git-tag.js';

describe('buildTagName', () => {
  it('single package: v{version}', () => {
    expect(buildTagName('my-pkg', '1.2.3', 1, '')).toBe('v1.2.3');
  });

  it('single package with prefix', () => {
    expect(buildTagName('my-pkg', '1.2.3', 1, 'release-')).toBe('release-v1.2.3');
  });

  it('multi-package: {name}@{version}', () => {
    expect(buildTagName('my-pkg', '1.2.3', 3, '')).toBe('my-pkg@1.2.3');
  });

  it('multi-package with prefix', () => {
    expect(buildTagName('@scope/pkg', '2.0.0', 2, 'v-')).toBe('v-@scope/pkg@2.0.0');
  });
});
