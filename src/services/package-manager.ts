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
  publish(dir: string, tag?: string, otp?: string): Promise<void>;
  pack(dir: string, outDir: string): Promise<string>;
}

function quote(s: string): string {
  if (/^[\w./@:-]+$/.test(s)) return s;
  return `"${s.replace(/"/g, '\\"')}"`;
}

function buildPublishCmd(pm: PackageManagerName, dir: string, tag?: string, otp?: string): string {
  const parts = [pm, 'publish', quote(dir)];
  if (tag) parts.push('--tag', quote(tag));
  if (otp) parts.push('--otp', quote(otp));
  parts.push('--no-git-checks');
  return parts.join(' ');
}

function buildPackCmd(pm: PackageManagerName, outDir: string): string {
  return [pm, 'pack', '--pack-destination', quote(outDir)].join(' ');
}

export function createAdapter(pm: PackageManagerName): PackageManagerAdapter {
  return {
    async publish(dir: string, tag?: string, otp?: string): Promise<void> {
      await execAsync(buildPublishCmd(pm, dir, tag, otp), { cwd: dir });
    },
    async pack(dir: string, outDir: string): Promise<string> {
      const { stdout } = await execAsync(buildPackCmd(pm, outDir), { cwd: dir });
      return stdout.trim();
    },
  };
}
