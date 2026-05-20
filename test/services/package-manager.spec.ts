import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { detectPackageManager } from '../../src/services/package-manager.js';

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
