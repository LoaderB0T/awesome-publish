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
 * Reject shell metacharacters that survive double-quoting. Unlike assertSafeToken
 * this permits spaces (paths legitimately contain them) but blocks command
 * substitution / chaining ( ` $ ; | & < > ( ) newline ), so a value like an
 * `--out` directory taken from CI env can't inject a command via the shell.
 */
function assertNoShellMeta(value: string, label: string): void {
  if (/[`$;|&<>()\n\r]/.test(value)) {
    throw new Error(`Unsafe ${label} value (shell metacharacters): "${value}"`);
  }
}

/** Redact secrets that Node embeds in exec error messages (the full command line). */
function redactSecrets(msg: string): string {
  return msg
    .replace(/(--otp[= ])\S+/g, '$1***')
    .replace(/(_authToken=)\S+/g, '$1***')
    .replace(/(:\/\/[^@\s/]+:)[^@\s/]+@/g, '$1***@');
}

/**
 * We always publish/pack the already-prepared temp dir with the `npm` CLI,
 * regardless of the project's package manager:
 *   - The temp dir is detached from the workspace and its package.json already
 *     carries the resolved version and `workspace:` ranges, so pnpm/yarn buy us
 *     nothing over npm, which reads the same registry auth (.npmrc).
 *   - yarn's publish/pack flags differ across classic vs berry.
 *   - pnpm has a long tail of bugs not forwarding `--otp` to the registry on
 *     publish, so a valid 2FA code is rejected as EOTP. npm has no such issue.
 * ponytail: yarn berry auth in .yarnrc.yml is not read by npm; document
 * NODE_AUTH_TOKEN / .npmrc for CI.
 */
function publishBinary(_pm: PackageManagerName): 'npm' {
  return 'npm';
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
  return parts.join(' ');
}

export function buildPackCmd(pm: PackageManagerName, outDir: string): string {
  // npm (v7+) and pnpm both support --pack-destination. yarn does not, so it
  // falls back to the npm CLI (see publishBinary rationale).
  assertNoShellMeta(outDir, 'out');
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
      try {
        await execAsync(buildPublishCmd(pm, options), { cwd: dir });
      } catch (error: any) {
        // Node embeds the full command line (including --otp <code>) in the
        // error message/stderr. Redact secrets before it propagates to logs.
        if (error?.message) error.message = redactSecrets(error.message);
        if (error?.stderr) error.stderr = redactSecrets(String(error.stderr));
        throw error;
      }
    },
    async pack(dir: string, outDir: string): Promise<string> {
      const { stdout } = await execAsync(buildPackCmd(pm, outDir), { cwd: dir });
      return stdout.trim();
    },
  };
}
