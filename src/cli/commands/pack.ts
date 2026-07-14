import { defineCommand } from 'citty';
import { sharedArgs } from '../shared-args.js';
import { loadConfigFromDir } from '../../config/load-config.js';
import { validateConfig } from '../../config/schema.js';
import { detectPackageManager } from '../../services/package-manager.js';
import { resolvePackages } from '../../services/workspace.js';
import { buildPipeline } from '../../pipeline/build-pipeline.js';
import { runPipeline } from '../../pipeline/pipeline.js';
import { assertGitClean } from '../git-check.js';
import { setDebug, debug } from '../../services/debug.js';

export const packCommand = defineCommand({
  meta: { name: 'pack', description: 'Pack packages locally without publishing' },
  args: {
    ...sharedArgs,
    bump: { type: 'string', description: 'Version bump type (patch|minor|major)' },
    out: { type: 'string', description: 'Output directory', default: './awesome-publish-pack' },
  },
  async run({ args }) {
    if (args.debug) setDebug(true);

    const rootDir = process.cwd();
    const isCi = args.ci || !!process.env.CI || !!process.env.GITHUB_ACTIONS;

    debug('pack', 'rootDir', rootDir);
    debug('pack', 'ci', isCi, 'out', args.out);

    const pm = detectPackageManager(rootDir);
    debug('pack', 'package manager', pm);

    const rawConfig = await loadConfigFromDir(rootDir);
    const config = rawConfig
      ? validateConfig(rawConfig, pm)
      : validateConfig({ publishFiles: ['lib'], stripScripts: true }, pm);
    debug('pack', 'resolved config', config);

    await assertGitClean(rootDir, config, args['ignore-git']);

    const packages = await resolvePackages(rootDir, config, args.filter);
    debug(
      'pack',
      'resolved packages',
      packages.map(p => `${p.name}@${p.version}`)
    );

    const steps = buildPipeline('pack', config);
    debug(
      'pack',
      'pipeline steps',
      steps.map(s => s.name)
    );

    const ctx = {
      config,
      packages,
      mode: isCi ? ('ci' as const) : ('interactive' as const),
      dryRun: args['dry-run'] ?? false,
      debug: args.debug ?? false,
      rootDir,
      cliArgs: { bump: args.bump, out: args.out },
    };

    const result = await runPipeline(steps, ctx as any);
    if (result.status === 'failed') {
      console.error(`Pack failed at: ${result.failed}\n${result.error?.message ?? ''}`);
      process.exit(1);
    }
    console.log(`\nPacked to: ${args.out}`);
  },
});
