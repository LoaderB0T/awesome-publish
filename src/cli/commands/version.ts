import { defineCommand } from 'citty';
import { sharedArgs } from '../shared-args.js';
import { resolveConfigForCommand } from '../../config/load-config.js';
import { detectPackageManager } from '../../services/package-manager.js';
import { resolvePackages } from '../../services/workspace.js';
import { buildPipeline } from '../../pipeline/build-pipeline.js';
import { runPipeline } from '../../pipeline/pipeline.js';
import { assertGitClean } from '../git-check.js';
import { setDebug, debug } from '../../services/debug.js';
import { isCiEnv } from '../../services/ci.js';

export const versionCommand = defineCommand({
  meta: { name: 'version', description: 'Bump package versions without publishing' },
  args: {
    ...sharedArgs,
    bump: { type: 'string', description: 'Version bump type (patch|minor|major|next)' },
  },
  async run({ args }) {
    if (args.debug) setDebug(true);

    const rootDir = process.cwd();
    const isCi = isCiEnv(args.ci);

    debug('version', 'rootDir', rootDir);
    debug('version', 'ci', isCi);

    const pm = detectPackageManager(rootDir);
    debug('version', 'package manager', pm);

    const config = await resolveConfigForCommand(rootDir, pm);
    debug('version', 'resolved config', config);

    await assertGitClean(rootDir, config, args['ignore-git']);

    const packages = await resolvePackages(rootDir, config, args.filter);
    debug(
      'version',
      'resolved packages',
      packages.map(p => `${p.name}@${p.version}`)
    );

    if (packages.length === 0) {
      throw new Error('No packages found to version');
    }

    const totalPackageCount = args.filter
      ? (await resolvePackages(rootDir, config)).length
      : packages.length;

    const steps = buildPipeline('version', config);
    debug(
      'version',
      'pipeline steps',
      steps.map(s => s.name)
    );

    const ctx = {
      config,
      packages,
      totalPackageCount,
      command: 'version' as const,
      mode: isCi ? ('ci' as const) : ('interactive' as const),
      dryRun: args['dry-run'] ?? false,
      debug: args.debug ?? false,
      rootDir,
      cliArgs: { bump: args.bump },
    };

    const result = await runPipeline(steps, ctx as any);
    if (result.status === 'failed') {
      console.error(`Version failed at: ${result.failed}\n${result.error?.message ?? ''}`);
      process.exit(1);
    }
    console.log('\nVersion bump complete!');
  },
});
