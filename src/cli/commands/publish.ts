import { defineCommand } from 'citty';
import { sharedArgs } from '../shared-args.js';
import { resolveConfigForCommand } from '../../config/load-config.js';
import { detectPackageManager } from '../../services/package-manager.js';
import { resolvePackages } from '../../services/workspace.js';
import { buildPipeline } from '../../pipeline/build-pipeline.js';
import { runPipeline } from '../../pipeline/pipeline.js';
import { validatePreIdentifier } from '../../services/version.js';
import { assertGitClean } from '../git-check.js';
import { setDebug, debug } from '../../services/debug.js';
import { isCiEnv } from '../../services/ci.js';

export const publishCommand = defineCommand({
  meta: { name: 'publish', description: 'Publish packages to npm' },
  args: {
    ...sharedArgs,
    bump: { type: 'string', description: 'Version bump type (patch|minor|major|next)' },
    tag: { type: 'string', description: 'npm dist-tag (e.g., next, beta)' },
    pre: {
      type: 'string',
      description: 'Publish as prerelease (e.g. --pre beta, --pre alpha, --pre rc)',
    },
    provenance: {
      type: 'boolean',
      description: 'Publish with npm provenance (requires OIDC, e.g. GitHub Actions id-token)',
    },
    resume: {
      type: 'boolean',
      description:
        'Finish a release that failed partway (publishes/tags/releases the version already in package.json instead of bumping)',
    },
  },
  async run({ args }) {
    if (args.debug) setDebug(true);

    const rootDir = process.cwd();
    const isCi = isCiEnv(args.ci);
    const dryRun = args['dry-run'] ?? false;
    const pre = args.pre ? validatePreIdentifier(args.pre) : undefined;

    debug('publish', 'rootDir', rootDir);
    debug('publish', 'ci', isCi, 'dryRun', dryRun);

    const pm = detectPackageManager(rootDir);
    debug('publish', 'package manager', pm);

    const config = await resolveConfigForCommand(rootDir, pm);
    debug('publish', 'resolved config', config);

    // A local run that died between write-versions and git-commit leaves the
    // bumped package.json uncommitted — that dirty tree IS the unfinished
    // release, so --resume must not be blocked by the clean-tree gate.
    await assertGitClean(rootDir, config, args['ignore-git'] || args.resume);

    const packages = await resolvePackages(rootDir, config, args.filter);
    debug(
      'publish',
      'resolved packages',
      packages.map(p => `${p.name}@${p.version}`)
    );

    if (packages.length === 0) {
      throw new Error('No packages found to publish');
    }

    // Total workspace package count, independent of --filter, so tag naming and
    // commit scoping stay correct on a filtered monorepo release. Only pay the
    // second resolve when a filter is actually narrowing the set.
    const totalPackageCount = args.filter
      ? (await resolvePackages(rootDir, config)).length
      : packages.length;

    const steps = buildPipeline('publish', config);
    debug(
      'publish',
      'pipeline steps',
      steps.map(s => s.name)
    );

    const ctx = {
      config,
      packages,
      totalPackageCount,
      command: 'publish' as const,
      mode: isCi ? ('ci' as const) : ('interactive' as const),
      dryRun,
      debug: args.debug ?? false,
      rootDir,
      cliArgs: {
        bump: args.bump,
        tag: args.tag,
        otp: args.otp,
        registry: args.registry,
        pre,
        provenance: args.provenance,
        resume: args.resume ?? false,
      },
    };

    const result = await runPipeline(steps, ctx as any);

    if (result.status === 'failed') {
      console.error(`\nFailed at step: ${result.failed}`);
      if (result.error) console.error(result.error.message);
      console.log(`Completed: ${result.completed.join(', ') || 'none'}`);
      console.log(`Skipped: ${result.skipped.join(', ') || 'none'}`);
      process.exit(1);
    }

    console.log('\nPublish complete!');
  },
});
