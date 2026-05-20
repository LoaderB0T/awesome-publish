import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type PackageManagerName = 'npm' | 'yarn' | 'pnpm';

export function detectPackageManager(dir: string): PackageManagerName {
  if (existsSync(join(dir, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(join(dir, 'yarn.lock'))) return 'yarn';
  if (existsSync(join(dir, 'package-lock.json'))) return 'npm';
  return 'npm';
}

export interface PackageManagerAdapter {
  publish(dir: string, tag?: string): Promise<void>;
  pack(dir: string, outDir: string): Promise<string>;
}

function buildPublishArgs(pm: PackageManagerName, dir: string, tag?: string): { cmd: string; args: string[] } {
  const args = ['publish', dir];
  if (tag) args.push('--tag', tag);
  args.push('--no-git-checks');
  return { cmd: pm, args };
}

function buildPackArgs(_pm: PackageManagerName, _dir: string, outDir: string): { cmd: string; args: string[] } {
  return { cmd: _pm, args: ['pack', '--pack-destination', outDir] };
}

export function createAdapter(pm: PackageManagerName): PackageManagerAdapter {
  return {
    async publish(dir: string, tag?: string): Promise<void> {
      const { cmd, args } = buildPublishArgs(pm, dir, tag);
      await execFileAsync(cmd, args, { cwd: dir });
    },
    async pack(dir: string, outDir: string): Promise<string> {
      const { cmd, args } = buildPackArgs(pm, dir, outDir);
      const { stdout } = await execFileAsync(cmd, args, { cwd: dir });
      return stdout.trim();
    },
  };
}
