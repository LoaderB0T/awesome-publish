import { describe, it, expect, vi } from 'vitest';
import {
  bumpVersion,
  highestBump,
  validateBumpType,
  validatePreIdentifier,
  stripPrerelease,
  extractPreIdentifier,
  resolvePreVersion,
  assertNoDowngrade,
} from '../../src/services/version.js';

describe('bumpVersion', () => {
  it('bumps patch', () => {
    expect(bumpVersion('1.2.3', 'patch')).toBe('1.2.4');
  });

  it('bumps minor', () => {
    expect(bumpVersion('1.2.3', 'minor')).toBe('1.3.0');
  });

  it('bumps major', () => {
    expect(bumpVersion('1.2.3', 'major')).toBe('2.0.0');
  });

  it('finalizes a prerelease to its target version (standard semver)', () => {
    // semver.inc: finalizing a prerelease keeps the version it was staging,
    // it does not bump past it.
    expect(bumpVersion('1.0.0-beta.1', 'patch')).toBe('1.0.0');
    expect(bumpVersion('1.0.0-beta.1', 'minor')).toBe('1.0.0');
    expect(bumpVersion('2.0.0-rc.3', 'major')).toBe('2.0.0');
  });

  it('handles prerelease with alpha suffix', () => {
    expect(bumpVersion('0.5.0-alpha.0', 'patch')).toBe('0.5.0');
  });

  it('throws on invalid version (too few parts)', () => {
    expect(() => bumpVersion('1.2', 'patch')).toThrow(/Invalid version/);
  });

  it('throws on non-numeric version', () => {
    expect(() => bumpVersion('a.b.c', 'patch')).toThrow(/Invalid version/);
  });

  it('handles zero versions', () => {
    expect(bumpVersion('0.0.0', 'patch')).toBe('0.0.1');
    expect(bumpVersion('0.0.0', 'minor')).toBe('0.1.0');
    expect(bumpVersion('0.0.0', 'major')).toBe('1.0.0');
  });

  describe('zeroBased (changesets-style pre-1.0)', () => {
    it('demotes major→minor and minor→patch while 0.x', () => {
      expect(bumpVersion('0.3.2', 'major', { zeroBased: true })).toBe('0.4.0');
      expect(bumpVersion('0.3.2', 'minor', { zeroBased: true })).toBe('0.3.3');
      expect(bumpVersion('0.3.2', 'patch', { zeroBased: true })).toBe('0.3.3');
    });

    it('never auto-graduates a 0.x package to 1.0.0', () => {
      expect(bumpVersion('0.9.9', 'major', { zeroBased: true })).not.toBe('1.0.0');
    });

    it('does not affect >=1.0.0 versions', () => {
      expect(bumpVersion('1.2.3', 'major', { zeroBased: true })).toBe('2.0.0');
    });

    it('is off by default so explicit --bump major can graduate to 1.0.0', () => {
      expect(bumpVersion('0.3.2', 'major')).toBe('1.0.0');
    });
  });
});

describe('bumpVersion next (prerelease churn)', () => {
  it('switches a differing prerelease line to next.0', () => {
    expect(bumpVersion('0.0.1-pre7', 'next')).toBe('0.0.1-next.0');
  });

  it('increments an existing next prerelease', () => {
    expect(bumpVersion('0.0.1-next.0', 'next')).toBe('0.0.1-next.1');
  });

  it('takes a stable version to the next patch prerelease', () => {
    expect(bumpVersion('0.0.1', 'next')).toBe('0.0.2-next.0');
    expect(bumpVersion('1.2.3', 'next')).toBe('1.2.4-next.0');
  });

  it('never graduates a 0.x package (zeroBased is irrelevant)', () => {
    expect(bumpVersion('0.9.9', 'next', { zeroBased: true })).toBe('0.9.10-next.0');
  });
});

describe('assertNoDowngrade', () => {
  it('allows an increase', () => {
    expect(() => assertNoDowngrade('1.2.3', '1.2.4')).not.toThrow();
  });

  it('allows finalizing a prerelease to its base', () => {
    expect(() => assertNoDowngrade('1.0.0-beta.1', '1.0.0')).not.toThrow();
  });

  it('throws on a strict downgrade', () => {
    expect(() => assertNoDowngrade('1.1.0', '1.0.0')).toThrow(/downgrade/);
    expect(() => assertNoDowngrade('1.1.0-beta.3', '1.1.0-alpha.0')).toThrow(/downgrade/);
  });
});

describe('highestBump', () => {
  it('returns major over minor', () => {
    expect(highestBump('minor', 'major')).toBe('major');
  });

  it('returns minor over patch', () => {
    expect(highestBump('patch', 'minor')).toBe('minor');
  });

  it('returns same when equal', () => {
    expect(highestBump('patch', 'patch')).toBe('patch');
  });

  it('ranks next below every graduating bump', () => {
    expect(highestBump('next', 'patch')).toBe('patch');
    expect(highestBump('next', 'major')).toBe('major');
    expect(highestBump('next', 'next')).toBe('next');
  });
});

describe('validateBumpType', () => {
  it('accepts valid bump types', () => {
    expect(validateBumpType('patch')).toBe('patch');
    expect(validateBumpType('minor')).toBe('minor');
    expect(validateBumpType('major')).toBe('major');
    expect(validateBumpType('next')).toBe('next');
  });

  it('throws on invalid bump type', () => {
    expect(() => validateBumpType('huge')).toThrow(/Invalid bump type/);
    expect(() => validateBumpType('')).toThrow(/Invalid bump type/);
  });
});

describe('validatePreIdentifier', () => {
  it('accepts valid identifiers', () => {
    expect(validatePreIdentifier('beta')).toBe('beta');
    expect(validatePreIdentifier('alpha')).toBe('alpha');
    expect(validatePreIdentifier('rc')).toBe('rc');
    expect(validatePreIdentifier('next')).toBe('next');
    expect(validatePreIdentifier('pre-release')).toBe('pre-release');
  });

  it('rejects invalid identifiers', () => {
    expect(() => validatePreIdentifier('1beta')).toThrow(/Invalid prerelease/);
    expect(() => validatePreIdentifier('be.ta')).toThrow(/Invalid prerelease/);
    expect(() => validatePreIdentifier('be ta')).toThrow(/Invalid prerelease/);
    expect(() => validatePreIdentifier('')).toThrow(/Invalid prerelease/);
  });
});

describe('stripPrerelease', () => {
  it('strips prerelease suffix', () => {
    expect(stripPrerelease('1.0.0-beta.1')).toBe('1.0.0');
    expect(stripPrerelease('2.0.0-rc.0')).toBe('2.0.0');
  });

  it('returns stable version unchanged', () => {
    expect(stripPrerelease('1.0.0')).toBe('1.0.0');
  });
});

describe('extractPreIdentifier', () => {
  it('extracts identifier from prerelease version', () => {
    expect(extractPreIdentifier('1.0.0-beta.1')).toBe('beta');
    expect(extractPreIdentifier('2.0.0-rc.0')).toBe('rc');
    expect(extractPreIdentifier('1.0.0-pre-release.3')).toBe('pre-release');
  });

  it('returns null for stable versions', () => {
    expect(extractPreIdentifier('1.0.0')).toBeNull();
  });

  it('handles identifier without number', () => {
    expect(extractPreIdentifier('1.0.0-beta')).toBe('beta');
  });
});

describe('resolvePreVersion', () => {
  it('returns .0 when package not found (404)', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ status: 404, ok: false });
    const result = await resolvePreVersion(
      'my-pkg',
      '1.1.0',
      'beta',
      'https://registry.npmjs.org',
      mockFetch as any
    );
    expect(result).toBe('1.1.0-beta.0');
  });

  it('increments from existing versions', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({
        versions: {
          '1.0.0': {},
          '1.1.0-beta.0': {},
          '1.1.0-beta.1': {},
          '1.1.0-beta.2': {},
        },
      }),
    });
    const result = await resolvePreVersion(
      'my-pkg',
      '1.1.0',
      'beta',
      'https://registry.npmjs.org',
      mockFetch as any
    );
    expect(result).toBe('1.1.0-beta.3');
  });

  it('returns .0 when no matching prerelease versions exist', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({
        versions: { '1.0.0': {}, '1.1.0-alpha.0': {} },
      }),
    });
    const result = await resolvePreVersion(
      'my-pkg',
      '1.1.0',
      'beta',
      'https://registry.npmjs.org',
      mockFetch as any
    );
    expect(result).toBe('1.1.0-beta.0');
  });

  it('throws on 401/403 with helpful message', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ status: 401, ok: false });
    await expect(
      resolvePreVersion('my-pkg', '1.1.0', 'beta', 'https://registry.npmjs.org', mockFetch as any)
    ).rejects.toThrow(/NPM_TOKEN/);
  });

  it('throws on network error with context', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(
      resolvePreVersion('my-pkg', '1.1.0', 'beta', 'https://registry.npmjs.org', mockFetch as any)
    ).rejects.toThrow(/Failed to query registry/);
  });
});
