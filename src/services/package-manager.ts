import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

export type PackageManagerName = 'npm' | 'yarn' | 'pnpm';

export function detectPackageManager(dir: string): PackageManagerName {
  if (existsSync(join(dir, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(join(dir, 'yarn.lock'))) return 'yarn';
  if (existsSync(join(dir, 'package-lock.json'))) return 'npm';
  return 'npm';
}

export interface PackageManagerAdapter {
  publish(dir: string, tag?: string, otp?: string, registry?: string): Promise<void>;
  pack(dir: string, outDir: string): Promise<string>;
}

function quote(s: string): string {
  if (/^[\w./@:-]+$/.test(s)) return s;
  return `"${s.replace(/"/g, '\\"')}"`;
}

/**
 * yarn's `yarn publish <folder>` / `yarn pack` have unreliable version-prompt
 * and flag semantics (and differ across yarn classic vs berry). We publish the
 * already-prepared temp dir with the npm CLI instead — it reads the same
 * registry auth (.npmrc) and the temp package.json already carries the correct
 * version. ponytail: yarn berry auth in .yarnrc.yml is not read by npm; document
 * NODE_AUTH_TOKEN / .npmrc for CI.
 */
function publishBinary(pm: PackageManagerName): 'npm' | 'pnpm' {
  return pm === 'pnpm' ? 'pnpm' : 'npm';
}

export function buildPublishCmd(
  pm: PackageManagerName,
  dir: string,
  tag?: string,
  otp?: string,
  registry?: string
): string {
  const bin = publishBinary(pm);
  const parts = [bin, 'publish', quote(dir)];
  if (tag) parts.push('--tag', quote(tag));
  if (otp) parts.push('--otp', quote(otp));
  if (registry && registry.replace(/\/$/, '') !== 'https://registry.npmjs.org') {
    parts.push('--registry', quote(registry));
  }
  // --no-git-checks is a pnpm-only flag; npm/yarn reject it. We publish from an
  // isolated temp dir anyway, so there is nothing for pnpm to git-check.
  if (bin === 'pnpm') parts.push('--no-git-checks');
  return parts.join(' ');
}

export function buildPackCmd(pm: PackageManagerName, outDir: string): string {
  // npm (v7+) and pnpm both support --pack-destination. yarn does not, so it
  // falls back to the npm CLI (see publishBinary rationale).
  const bin = publishBinary(pm);
  return [bin, 'pack', '--pack-destination', quote(outDir)].join(' ');
}

export function createAdapter(pm: PackageManagerName): PackageManagerAdapter {
  return {
    async publish(dir: string, tag?: string, otp?: string, registry?: string): Promise<void> {
      await execAsync(buildPublishCmd(pm, dir, tag, otp, registry), { cwd: dir });
    },
    async pack(dir: string, outDir: string): Promise<string> {
      const { stdout } = await execAsync(buildPackCmd(pm, outDir), { cwd: dir });
      return stdout.trim();
    },
  };
}
