import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  detectPackageManager,
  buildPublishCmd,
  buildPackCmd,
} from '../../src/services/package-manager.js';

describe('detectPackageManager', () => {
  it('detects pnpm from pnpm-lock.yaml', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ap-test-'));
    writeFileSync(join(dir, 'pnpm-lock.yaml'), '');
    expect(detectPackageManager(dir)).toBe('pnpm');
  });

  it('detects yarn from yarn.lock', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ap-test-'));
    writeFileSync(join(dir, 'yarn.lock'), '');
    expect(detectPackageManager(dir)).toBe('yarn');
  });

  it('detects npm from package-lock.json', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ap-test-'));
    writeFileSync(join(dir, 'package-lock.json'), '{}');
    expect(detectPackageManager(dir)).toBe('npm');
  });

  it('defaults to npm when no lockfile found', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ap-test-'));
    expect(detectPackageManager(dir)).toBe('npm');
  });
});

describe('buildPublishCmd', () => {
  it('publishes the cwd, not a path argument', () => {
    expect(buildPublishCmd('npm')).toBe('npm publish');
  });

  it('adds --no-git-checks only for pnpm', () => {
    expect(buildPublishCmd('pnpm')).toContain('--no-git-checks');
    expect(buildPublishCmd('npm')).not.toContain('--no-git-checks');
    expect(buildPublishCmd('yarn')).not.toContain('--no-git-checks');
  });

  it('delegates yarn to the npm CLI', () => {
    expect(buildPublishCmd('yarn').startsWith('npm publish')).toBe(true);
    expect(buildPublishCmd('pnpm').startsWith('pnpm publish')).toBe(true);
    expect(buildPublishCmd('npm').startsWith('npm publish')).toBe(true);
  });

  it('includes tag and otp when provided', () => {
    const cmd = buildPublishCmd('npm', { tag: 'beta', otp: '123456' });
    expect(cmd).toContain('--tag beta');
    expect(cmd).toContain('--otp 123456');
  });

  it('adds --access and --provenance when set', () => {
    const cmd = buildPublishCmd('npm', { access: 'public', provenance: true });
    expect(cmd).toContain('--access public');
    expect(cmd).toContain('--provenance');
  });

  it('rejects unsafe token values', () => {
    expect(() => buildPublishCmd('npm', { tag: 'beta; rm -rf /' })).toThrow(/Unsafe/);
  });

  it('adds --registry only for non-default registries (ignoring trailing slash)', () => {
    expect(buildPublishCmd('npm', { registry: 'https://registry.npmjs.org/' })).not.toContain(
      '--registry'
    );
    expect(buildPublishCmd('npm', { registry: 'https://npm.internal/' })).toContain('--registry');
  });
});

describe('buildPackCmd', () => {
  it('uses --pack-destination and delegates yarn to npm', () => {
    expect(buildPackCmd('pnpm', '/out')).toBe('pnpm pack --pack-destination /out');
    expect(buildPackCmd('yarn', '/out')).toBe('npm pack --pack-destination /out');
  });
});
