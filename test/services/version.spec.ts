import { describe, it, expect, vi } from 'vitest';
import {
  bumpVersion,
  highestBump,
  validateBumpType,
  validatePreIdentifier,
  stripPrerelease,
  extractPreIdentifier,
  resolvePreVersion,
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
});

describe('validateBumpType', () => {
  it('accepts valid bump types', () => {
    expect(validateBumpType('patch')).toBe('patch');
    expect(validateBumpType('minor')).toBe('minor');
    expect(validateBumpType('major')).toBe('major');
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
