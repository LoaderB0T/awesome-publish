import { Phases } from '../pipeline/phases.js';
import type { PipelineStep } from '../pipeline/step.js';
import type { TempDirContext, VersionContext, PublishContext } from '../pipeline/context.js';
import type { PublishResult } from '../types/package-info.js';
import { createAdapter } from '../services/package-manager.js';

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

    for (const pkg of ctx.packages) {
      const tempDir = ctx.tempDirs.get(pkg.name);
      if (!tempDir) continue;

      const bump = ctx.versionBumps.get(pkg.name);
      const version = bump?.to ?? pkg.version;
      const tag = (ctx as any).cliArgs?.tag as string | undefined;

      try {
        await adapter.publish(tempDir, tag);
        results.set(pkg.name, {
          packageName: pkg.name,
          version,
          registry: 'https://registry.npmjs.org',
          status: 'published',
        });
      } catch (error: any) {
        const msg = error?.message ?? String(error);
        if (msg.includes('403') || msg.includes('409') || msg.includes('previously published')) {
          results.set(pkg.name, {
            packageName: pkg.name,
            version,
            registry: 'https://registry.npmjs.org',
            status: 'skipped-already-exists',
          });
        } else {
          throw error;
        }
      }
    }

    return { publishResults: results };
  },
};
