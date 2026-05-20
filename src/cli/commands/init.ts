import { defineCommand } from 'citty';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { generateConfigFile } from '../../templates/config-template.js';
import { generatePublishWorkflow } from '../../templates/github-actions.js';
import { generateChangesetCheckWorkflow } from '../../templates/changeset-check.js';
import { detectPackageManager } from '../../services/package-manager.js';

export const initCommand = defineCommand({
  meta: { name: 'init', description: 'Initialize awesome-publish configuration' },
  args: {},
  async run() {
    const rootDir = process.cwd();
    const pm = detectPackageManager(rootDir);

    console.log('Setting up awesome-publish...\n');
    console.log(`Detected package manager: ${pm}\n`);

    const config: Record<string, unknown> = {
      publishFiles: ['lib'],
      packageManager: pm,
    };

    const configContent = generateConfigFile(config as any);
    writeFileSync(join(rootDir, 'awesome-publish.config.ts'), configContent);
    console.log('Created awesome-publish.config.ts');

    const workflowDir = join(rootDir, '.github', 'workflows');
    if (!existsSync(workflowDir)) {
      mkdirSync(workflowDir, { recursive: true });
    }
    writeFileSync(join(workflowDir, 'publish.yml'), generatePublishWorkflow(pm));
    console.log('Created .github/workflows/publish.yml');

    console.log('\nDone! Edit awesome-publish.config.ts to customize.');
  },
});
