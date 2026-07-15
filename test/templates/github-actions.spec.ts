import { describe, it, expect } from 'vitest';
import { generatePublishWorkflow } from '../../src/templates/github-actions.js';

describe('generatePublishWorkflow', () => {
  it('pins a pnpm/action-setup version (M9)', () => {
    const yml = generatePublishWorkflow('pnpm');
    expect(yml).toContain('pnpm/action-setup@v4');
    // Must specify a version or action-setup@v4 hard-fails without a packageManager field.
    expect(yml).toMatch(/pnpm\/action-setup@v4[\s\S]*?version:\s*\d+/);
  });

  it('does not set up pnpm for npm projects', () => {
    const yml = generatePublishWorkflow('npm');
    expect(yml).not.toContain('pnpm/action-setup');
    expect(yml).toContain('npm ci');
  });

  it('injects a build step before publish when buildCommand is set (B4)', () => {
    const yml = generatePublishWorkflow('npm', { buildCommand: 'npm run build' });
    const buildIdx = yml.indexOf('npm run build');
    const publishIdx = yml.indexOf('awesome-publish publish');
    expect(buildIdx).toBeGreaterThan(-1);
    expect(buildIdx).toBeLessThan(publishIdx);
  });

  it('omits a build step when no buildCommand', () => {
    const yml = generatePublishWorkflow('npm');
    expect(yml).not.toContain('run build');
  });

  it('checks out full history + tags so version/changelog resolution works (C2)', () => {
    // A shallow checkout (the default) has no tags and depth 1, making every
    // release look like a first release.
    expect(generatePublishWorkflow('npm')).toContain('fetch-depth: 0');
  });

  it('adds id-token permission only with provenance', () => {
    expect(generatePublishWorkflow('npm', { provenance: true })).toContain('id-token: write');
    expect(generatePublishWorkflow('npm')).not.toContain('id-token: write');
  });
});
