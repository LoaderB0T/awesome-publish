import { defineCommand } from 'citty';
import { sharedArgs } from '../shared-args.js';
import { loadConfigFromDir } from '../../config/load-config.js';
import { validateConfig } from '../../config/schema.js';
import { detectPackageManager } from '../../services/package-manager.js';
import { resolvePackages } from '../../services/workspace.js';
import { buildPipeline } from '../../pipeline/build-pipeline.js';
import { runPipeline } from '../../pipeline/pipeline.js';
import { GitService } from '../../services/git.js';

export const packCommand = defineCommand({
  meta: { name: 'pack', description: 'Pack packages locally without publishing' },
  args: {
    ...sharedArgs,
    bump: { type: 'string', description: 'Version bump type (patch|minor|major)' },
    out: { type: 'string', description: 'Output directory', default: './awesome-publish-pack' },
  },
  async run({ args }) {
    const rootDir = process.cwd();
    const isCi = args.ci || !!process.env.CI || !!process.env.GITHUB_ACTIONS;
    const pm = detectPackageManager(rootDir);
    const rawConfig = await loadConfigFromDir(rootDir);
    const config = rawConfig ? validateConfig(rawConfig, pm) : validateConfig({ publishFiles: ['lib'], stripScripts: true }, pm);

    if (config.requireCleanGit && !args['ignore-git']) {
      const git = new GitService(rootDir);
      if (!await git.isWorkingTreeClean()) {
        throw new Error('Working tree is not clean. Commit or stash changes, or use --ignore-git');
      }
    }

    const packages = await resolvePackages(rootDir, config, args.filter);

    const steps = buildPipeline('pack', config);
    const ctx = {
      config,
      packages,
      mode: isCi ? 'ci' as const : 'interactive' as const,
      dryRun: args['dry-run'] ?? false,
      rootDir,
      cliArgs: { bump: args.bump, out: args.out },
    };

    const result = await runPipeline(steps, ctx as any);
    if (result.status === 'failed') {
      console.error(`Pack failed at: ${result.failed}`);
      process.exit(1);
    }
    console.log(`\nPacked to: ${args.out}`);
  },
});
