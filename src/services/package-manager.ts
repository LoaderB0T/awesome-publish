import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

export type PackageManagerName = 'npm' | 'yarn' | 'pnpm';

export interface PublishOptions {
  tag?: string;
  otp?: string;
  registry?: string;
  access?: 'public' | 'restricted';
  provenance?: boolean;
}

export function detectPackageManager(dir: string): PackageManagerName {
  if (existsSync(join(dir, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(join(dir, 'yarn.lock'))) return 'yarn';
  if (existsSync(join(dir, 'package-lock.json'))) return 'npm';
  return 'npm';
}

export interface PackageManagerAdapter {
  publish(dir: string, options?: PublishOptions): Promise<void>;
  pack(dir: string, outDir: string): Promise<string>;
}

/**
 * Reject values that would let a config/CLI value break out of the command
 * string. We run through a shell (see execAsync rationale below), so a value
 * containing shell metacharacters is a shell-injection risk. These are all
 * simple tokens (dist-tags, OTP codes, registry URLs) that never legitimately
 * contain shell metacharacters or whitespace.
 */
function assertSafeToken(value: string, label: string): void {
  if (!/^[\w./:@=+~-]+$/.test(value)) {
    throw new Error(`Unsafe ${label} value: "${value}"`);
  }
}

function quote(s: string): string {
  if (/^[\w./@:-]+$/.test(s)) return s;
  return `"${s.replace(/"/g, '\\"')}"`;
}

/**
 * yarn's `yarn publish` / `yarn pack` have unreliable version-prompt and flag
 * semantics (and differ across yarn classic vs berry). We publish the
 * already-prepared temp dir with the npm CLI instead — it reads the same
 * registry auth (.npmrc) and the temp package.json already carries the correct
 * version. ponytail: yarn berry auth in .yarnrc.yml is not read by npm; document
 * NODE_AUTH_TOKEN / .npmrc for CI.
 */
function publishBinary(pm: PackageManagerName): 'npm' | 'pnpm' {
  return pm === 'pnpm' ? 'pnpm' : 'npm';
}

/**
 * Build the publish command. The package to publish is the shell's cwd (the
 * prepared temp dir), so we never pass a path argument — this sidesteps
 * cross-platform path-quoting entirely. Remaining args are validated tokens.
 */
export function buildPublishCmd(pm: PackageManagerName, options: PublishOptions = {}): string {
  const bin = publishBinary(pm);
  const parts = [bin, 'publish'];

  if (options.tag) {
    assertSafeToken(options.tag, 'tag');
    parts.push('--tag', options.tag);
  }
  if (options.otp) {
    assertSafeToken(options.otp, 'otp');
    parts.push('--otp', options.otp);
  }
  if (options.registry && options.registry.replace(/\/$/, '') !== 'https://registry.npmjs.org') {
    assertSafeToken(options.registry, 'registry');
    parts.push('--registry', options.registry);
  }
  if (options.access) {
    parts.push('--access', options.access);
  }
  if (options.provenance) {
    parts.push('--provenance');
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
  // We use `exec` (a shell) rather than execFile so that on Windows the shell
  // resolves the `npm`/`pnpm` shims (npm.cmd / pnpm.cmd) — execFile cannot run
  // those without shell:true. Injection is prevented by assertSafeToken above
  // and by never passing the (temp) directory as an argument.
  return {
    async publish(dir: string, options: PublishOptions = {}): Promise<void> {
      await execAsync(buildPublishCmd(pm, options), { cwd: dir });
    },
    async pack(dir: string, outDir: string): Promise<string> {
      const { stdout } = await execAsync(buildPackCmd(pm, outDir), { cwd: dir });
      return stdout.trim();
    },
  };
}
