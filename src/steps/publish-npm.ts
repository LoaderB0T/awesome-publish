import { AwesomeLogger } from 'awesome-logging';
import { Phases } from '../pipeline/phases.js';
import type { PipelineStep } from '../pipeline/step.js';
import type { TempDirContext, VersionContext, PublishContext } from '../pipeline/context.js';
import type { PublishResult } from '../types/package-info.js';
import { createAdapter } from '../services/package-manager.js';
import { withRetry, isTransientError } from '../services/retry.js';
import { debug } from '../services/debug.js';

// A publish failure that means "this version is already on the registry" —
// safe to treat as skip. Distinct from other 403s (permission denied, OTP
// required, org membership) which are real failures.
// npm's "not logged in" errors — surfaced with an actionable hint since a
// first-time local publisher hits this before anything else.
function isAuthError(msg: string): boolean {
  return (
    /ENEEDAUTH/i.test(msg) ||
    /need(?:s)? auth/i.test(msg) ||
    /must be logged in/i.test(msg) ||
    // "401", npm's "E401" code, but not "1401".
    /(?<![0-9])E?401\b/.test(msg)
  );
}

// npm's 2FA one-time-password errors. Distinct from a plain 401 (not logged in)
// — the user IS authenticated but the OTP is missing/wrong/expired, so the hint
// is different: send a fresh code, don't re-login.
function isOtpError(msg: string): boolean {
  return /EOTP/i.test(msg) || /one[- ]time pass(?:word)?/i.test(msg) || /otp/i.test(msg);
}

function isVersionConflict(msg: string): boolean {
  return (
    // "409" or npm's "E409" code, but not an unrelated "1409"/port so a real
    // failure isn't misclassified as an already-exists skip.
    /(?<![0-9])E?409\b/.test(msg) ||
    /EPUBLISHCONFLICT/i.test(msg) ||
    /cannot publish over/i.test(msg) ||
    /previously published/i.test(msg) ||
    /over the previously published/i.test(msg)
  );
}

async function resolveOtp(ctx: any): Promise<string | undefined> {
  const cliOtp = ctx.cliArgs?.otp as string | undefined;
  if (cliOtp) return cliOtp;

  if (ctx.mode === 'interactive') {
    const otp = await AwesomeLogger.prompt('text', {
      text: 'Enter npm OTP code (leave empty to skip):',
    }).result;
    return otp?.trim() || undefined;
  }

  return undefined;
}

export const publishNpmStep: PipelineStep<TempDirContext & VersionContext, PublishContext> = {
  name: 'publish-npm',
  phase: Phases.PUBLISH_NPM,
  after: [Phases.MODIFY_PACKAGE_JSON],
  before: [Phases.GITHUB_RELEASE],
  hasSideEffects: true,

  shouldRun: () => true,

  async execute(ctx): Promise<PublishContext> {
    const adapter = createAdapter(ctx.config.packageManager);
    const results = new Map<string, PublishResult>();
    const otp = await resolveOtp(ctx);
    // --tag explicit > --pre identifier > undefined (defaults to 'latest')
    const tag =
      ((ctx as any).cliArgs?.tag as string | undefined) ??
      ((ctx as any).cliArgs?.pre as string | undefined);

    const registry = ((ctx as any).cliArgs?.registry as string | undefined) ?? ctx.config.registry;
    const provenance =
      ((ctx as any).cliArgs?.provenance as boolean | undefined) ?? ctx.config.provenance;
    debug('publish-npm', 'package manager', ctx.config.packageManager);
    debug('publish-npm', 'registry', registry);
    debug('publish-npm', 'otp provided', !!otp);
    debug('publish-npm', 'dist-tag', tag ?? 'latest');
    debug('publish-npm', 'provenance', provenance);

    for (const pkg of ctx.packages) {
      const tempDir = ctx.tempDirs.get(pkg.name);
      if (!tempDir) continue;

      const bump = ctx.versionBumps.get(pkg.name);
      // Skip packages with no version bump — nothing to publish (avoids
      // re-publishing the current version, which would 403 as already-exists).
      if (!bump) {
        debug('publish-npm', `${pkg.name}: no version bump, skipping`);
        continue;
      }
      const version = bump.to;

      debug('publish-npm', `publishing ${pkg.name}@${version} from ${tempDir}`);

      // --access only applies to scoped packages; npm warns/ignores it otherwise.
      const access = pkg.name.startsWith('@') ? ctx.config.access : undefined;

      try {
        await withRetry(
          () => adapter.publish(tempDir, { tag, otp, registry, access, provenance }),
          {
            label: `publish ${pkg.name}`,
            shouldRetry: err => isTransientError(err),
          }
        );
        debug('publish-npm', `${pkg.name}@${version} published successfully`);
        results.set(pkg.name, {
          packageName: pkg.name,
          version,
          registry,
          status: 'published',
        });
      } catch (error: any) {
        // Node's exec error `.message` is only "Command failed: <cmd>" — the
        // actual npm/pnpm reason (EOTP, E402, 403, network) lives in stderr.
        // Fold it in or the failure is undiagnosable. The adapter already
        // redacted secrets in both message and stderr.
        const stderr = error?.stderr ? String(error.stderr).trim() : '';
        const msg = [error?.message ?? String(error), stderr].filter(Boolean).join('\n');
        debug('publish-npm', `${pkg.name} publish error`, msg);
        if (isVersionConflict(msg)) {
          debug('publish-npm', `${pkg.name}@${version} already exists, skipping`);
          results.set(pkg.name, {
            packageName: pkg.name,
            version,
            registry,
            status: 'skipped-already-exists',
          });
        } else {
          // C2: Record per-package failure instead of aborting entire publish
          const error = isAuthError(msg)
            ? `${msg}\n    → npm authentication required. Run \`npm login\`, or set up an .npmrc with a token (in CI: NODE_AUTH_TOKEN via actions/setup-node).`
            : isOtpError(msg)
              ? `${msg}\n    → npm needs a valid 2FA one-time password. Re-run with a fresh code via \`--otp <code>\` (codes expire in ~30s).`
              : msg;
          results.set(pkg.name, {
            packageName: pkg.name,
            version,
            registry,
            status: 'failed',
            error,
          });
        }
      }
    }

    // Fail fast if any package failed to publish. Throwing here stops the
    // pipeline before git-tag / github-release run, so tags/releases are never
    // created for an unpublished package. In a monorepo some packages may have
    // already published before the failure — surface exactly which, since those
    // are live on npm and the git/GitHub steps did NOT run, so they need manual
    // tagging/recovery.
    const failed = [...results.values()].filter(r => r.status === 'failed');
    if (failed.length > 0) {
      const summary = failed.map(f => `  ${f.packageName}@${f.version}: ${f.error}`).join('\n');
      const published = [...results.values()].filter(r => r.status === 'published');
      const publishedSummary = published.length
        ? `\n\n⚠ Already published to npm this run (NOT tagged/committed — recover manually): ${published
            .map(p => `${p.packageName}@${p.version}`)
            .join(', ')}`
        : '';
      throw new Error(
        `Failed to publish ${failed.length} package(s):\n${summary}${publishedSummary}`
      );
    }

    return { publishResults: results };
  },
};
