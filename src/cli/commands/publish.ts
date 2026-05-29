import { defineCommand } from 'citty';
import { sharedArgs } from '../shared-args.js';
import { loadConfigFromDir } from '../../config/load-config.js';
import { validateConfig } from '../../config/schema.js';
import { detectPackageManager } from '../../services/package-manager.js';
import { resolvePackages } from '../../services/workspace.js';
import { buildPipeline } from '../../pipeline/build-pipeline.js';
import { runPipeline } from '../../pipeline/pipeline.js';
import { GitService } from '../../services/git.js';
import { setDebug, debug } from '../../services/debug.js';

export const publishCommand = defineCommand({
  meta: { name: 'publish', description: 'Publish packages to npm' },
  args: {
    ...sharedArgs,
    bump: { type: 'string', description: 'Version bump type (patch|minor|major)' },
    tag: { type: 'string', description: 'npm dist-tag (e.g., next, beta)' },
  },
  async run({ args }) {
    if (args.debug) setDebug(true);

    const rootDir = process.cwd();
    const isCi = args.ci || !!process.env.CI || !!process.env.GITHUB_ACTIONS;
    const dryRun = args['dry-run'] ?? false;

    debug('publish', 'rootDir', rootDir);
    debug('publish', 'ci', isCi, 'dryRun', dryRun);

    const pm = detectPackageManager(rootDir);
    debug('publish', 'package manager', pm);

    const rawConfig = await loadConfigFromDir(rootDir);
    const config = rawConfig ? validateConfig(rawConfig, pm) : validateConfig({ publishFiles: ['lib'], stripScripts: true }, pm);
    debug('publish', 'resolved config', config);

    if (config.requireCleanGit && !args['ignore-git']) {
      const git = new GitService(rootDir);
      const clean = await git.isWorkingTreeClean();
      debug('publish', 'git clean', clean);
      if (!clean) {
        throw new Error('Working tree is not clean. Commit or stash changes, or use --ignore-git');
      }
    }

    const packages = await resolvePackages(rootDir, config, args.filter);
    debug('publish', 'resolved packages', packages.map(p => `${p.name}@${p.version}`));

    if (packages.length === 0) {
      throw new Error('No packages found to publish');
    }

    const steps = buildPipeline('publish', config);
    debug('publish', 'pipeline steps', steps.map(s => s.name));

    const ctx = {
      config,
      packages,
      mode: isCi ? 'ci' as const : 'interactive' as const,
      dryRun,
      debug: args.debug ?? false,
      rootDir,
      cliArgs: { bump: args.bump, tag: args.tag, otp: args.otp, registry: args.registry },
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
