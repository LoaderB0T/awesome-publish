import { defineCommand } from 'citty';
import { sharedArgs } from '../shared-args.js';
import { loadConfigFromDir } from '../../config/load-config.js';
import { validateConfig } from '../../config/schema.js';
import { detectPackageManager } from '../../services/package-manager.js';
import { resolvePackages } from '../../services/workspace.js';
import { buildPipeline } from '../../pipeline/build-pipeline.js';
import { runPipeline } from '../../pipeline/pipeline.js';

export const versionCommand = defineCommand({
  meta: { name: 'version', description: 'Bump package versions without publishing' },
  args: {
    ...sharedArgs,
    bump: { type: 'string', description: 'Version bump type (patch|minor|major)' },
  },
  async run({ args }) {
    const rootDir = process.cwd();
    const isCi = args.ci || !!process.env.CI || !!process.env.GITHUB_ACTIONS;
    const pm = detectPackageManager(rootDir);
    const rawConfig = await loadConfigFromDir(rootDir);
    const config = rawConfig ? validateConfig(rawConfig, pm) : validateConfig({ publishFiles: ['lib'], stripScripts: true }, pm);
    const packages = await resolvePackages(rootDir, config, args.filter);

    const steps = buildPipeline('version', config);
    const ctx = {
      config,
      packages,
      mode: isCi ? 'ci' as const : 'interactive' as const,
      dryRun: args['dry-run'] ?? false,
      rootDir,
      cliArgs: { bump: args.bump },
    };

    const result = await runPipeline(steps, ctx as any);
    if (result.status === 'failed') {
      console.error(`Version failed at: ${result.failed}`);
      process.exit(1);
    }
    console.log('\nVersion bump complete!');
  },
});
