import { AwesomeLogger } from 'awesome-logging';
import { Phases } from '../pipeline/phases.js';
import type { PipelineStep } from '../pipeline/step.js';
import type { TempDirContext, VersionContext, PublishContext } from '../pipeline/context.js';
import type { PublishResult } from '../types/package-info.js';
import { createAdapter } from '../services/package-manager.js';
import { debug } from '../services/debug.js';

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
    const tag = (ctx as any).cliArgs?.tag as string | undefined
      ?? (ctx as any).cliArgs?.pre as string | undefined;

    const registry = (ctx as any).cliArgs?.registry as string | undefined ?? ctx.config.registry;
    debug('publish-npm', 'package manager', ctx.config.packageManager);
    debug('publish-npm', 'registry', registry);
    debug('publish-npm', 'otp provided', !!otp);
    debug('publish-npm', 'dist-tag', tag ?? 'latest');

    for (const pkg of ctx.packages) {
      const tempDir = ctx.tempDirs.get(pkg.name);
      if (!tempDir) continue;

      const bump = ctx.versionBumps.get(pkg.name);
      const version = bump?.to ?? pkg.version;

      debug('publish-npm', `publishing ${pkg.name}@${version} from ${tempDir}`);

      try {
        await adapter.publish(tempDir, tag, otp, registry);
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
        if (msg.includes('403') || msg.includes('409') || msg.includes('previously published')) {
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

    // If any packages failed, report them but don't throw — let pipeline continue for cleanup
    const failed = [...results.values()].filter(r => r.status === 'failed');
    if (failed.length > 0) {
      const summary = failed.map(f => `  ${f.packageName}@${f.version}: ${f.error}`).join('\n');
      console.error(`\nFailed to publish ${failed.length} package(s):\n${summary}`);
    }

    return { publishResults: results };
  },
};
