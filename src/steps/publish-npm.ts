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
function isVersionConflict(msg: string): boolean {
  return (
    msg.includes('409') ||
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
        const msg = error?.message ?? String(error);
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
          results.set(pkg.name, {
            packageName: pkg.name,
            version,
            registry,
            status: 'failed',
            error: msg,
          });
        }
      }
    }

    // Fail fast if any package failed to publish. Throwing here stops the
    // pipeline before git-tag / github-release run and before cleanup removes
    // the temp dirs, so tags/releases are never created for an unpublished
    // package and the temp dirs are preserved for inspection/retry.
    const failed = [...results.values()].filter(r => r.status === 'failed');
    if (failed.length > 0) {
      const summary = failed.map(f => `  ${f.packageName}@${f.version}: ${f.error}`).join('\n');
      const published = [...results.values()].filter(r => r.status === 'published');
      const publishedSummary = published.length
        ? `\nAlready published this run: ${published.map(p => `${p.packageName}@${p.version}`).join(', ')}`
        : '';
      throw new Error(
        `Failed to publish ${failed.length} package(s):\n${summary}${publishedSummary}`
      );
    }

    return { publishResults: results };
  },
};
