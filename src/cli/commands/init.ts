import { defineCommand } from 'citty';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AwesomeLogger } from 'awesome-logging';
import { generateConfigFile } from '../../templates/config-template.js';
import { generatePublishWorkflow } from '../../templates/github-actions.js';
import { generateChangesetCheckWorkflow } from '../../templates/changeset-check.js';
import { detectPackageManager } from '../../services/package-manager.js';
import type { ResolvedConfig } from '../../types/config.js';

function isMonorepo(rootDir: string): boolean {
  const pkgPath = join(rootDir, 'package.json');
  if (existsSync(pkgPath)) {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    if (Array.isArray(pkg.workspaces) && pkg.workspaces.length > 0) return true;
  }
  return existsSync(join(rootDir, 'pnpm-workspace.yaml'));
}

export const initCommand = defineCommand({
  meta: { name: 'init', description: 'Initialize awesome-publish configuration' },
  args: {},
  async run() {
    const rootDir = process.cwd();
    const pm = detectPackageManager(rootDir);

    console.log('Setting up awesome-publish...\n');
    console.log(`Detected package manager: ${pm}`);

    const mono = isMonorepo(rootDir);
    if (mono) {
      console.log('Detected monorepo workspace\n');
    } else {
      console.log('');
    }

    const publishFilesInput = await AwesomeLogger.prompt('text', {
      text: 'Which files/dirs to include in published package?',
      hints: ['lib', 'dist', 'README.md', 'LICENSE'],
      default: 'lib',
      allowOnlyHints: false,
      caseInsensitive: false,
      fuzzyAutoComplete: false,
      validators: [],
    }).result;

    const publishFiles = publishFilesInput.split(/[,\s]+/).filter(Boolean);

    const stripScripts = await AwesomeLogger.prompt('confirm', {
      text: 'Strip scripts from published package.json?',
      default: 'yes',
    }).result;

    const changesetsEnabled = await AwesomeLogger.prompt('confirm', {
      text: 'Enable changesets for version management?',
      default: 'yes',
    }).result;

    let enforceInPR = false;
    if (changesetsEnabled) {
      enforceInPR = await AwesomeLogger.prompt('confirm', {
        text: 'Enforce changesets in pull requests (via GitHub Action)?',
        default: 'yes',
      }).result;
    }

    const githubReleasesEnabled = await AwesomeLogger.prompt('confirm', {
      text: 'Enable GitHub releases?',
      default: 'yes',
    }).result;

    let releaseMode: 'per-package' | 'combined' = 'per-package';
    if (githubReleasesEnabled) {
      const modeChoice = await AwesomeLogger.prompt('choice', {
        text: 'GitHub release mode?',
        options: ['per-package', 'combined'],
      }).result;
      releaseMode = modeChoice as 'per-package' | 'combined';
    }

    const aiNotesEnabled = await AwesomeLogger.prompt('confirm', {
      text: 'Enable AI-generated release notes?',
      default: 'no',
    }).result;

    let aiProvider: ResolvedConfig['aiProvider'] | undefined;
    if (aiNotesEnabled) {
      const provider = await AwesomeLogger.prompt('choice', {
        text: 'AI provider?',
        options: ['anthropic', 'openai-compatible'],
      }).result;

      const model = await AwesomeLogger.prompt('text', {
        text: 'AI model name?',
        hints: provider === 'anthropic'
          ? ['claude-sonnet-4-20250514', 'claude-haiku-4-20250414']
          : ['gpt-4o', 'gpt-4o-mini'],
        default: provider === 'anthropic' ? 'claude-sonnet-4-20250514' : 'gpt-4o',
        allowOnlyHints: false,
        caseInsensitive: false,
        fuzzyAutoComplete: true,
        validators: [],
      }).result;

      aiProvider = {
        provider: provider as 'anthropic' | 'openai-compatible',
        model,
      };

      if (provider === 'openai-compatible') {
        const baseUrl = await AwesomeLogger.prompt('text', {
          text: 'OpenAI-compatible base URL?',
          hints: ['https://api.openai.com/v1'],
          default: 'https://api.openai.com/v1',
          allowOnlyHints: false,
          caseInsensitive: false,
          fuzzyAutoComplete: false,
          validators: [],
        }).result;
        aiProvider.baseUrl = baseUrl;
      }
    }

    const config: Partial<ResolvedConfig> = {
      publishFiles,
      stripScripts,
      packageManager: pm,
      changesets: { enabled: changesetsEnabled, enforceInPR },
      github: { releases: { enabled: githubReleasesEnabled, mode: releaseMode } },
      aiProvider,
      aiReleaseNotes: { enabled: aiNotesEnabled },
    };

    const configContent = generateConfigFile(config);
    writeFileSync(join(rootDir, 'awesome-publish.config.ts'), configContent);
    console.log('\nCreated awesome-publish.config.ts');

    const writeWorkflow = await AwesomeLogger.prompt('confirm', {
      text: 'Generate GitHub Actions publish workflow?',
      default: 'yes',
    }).result;

    if (writeWorkflow) {
      const workflowDir = join(rootDir, '.github', 'workflows');
      if (!existsSync(workflowDir)) {
        mkdirSync(workflowDir, { recursive: true });
      }
      writeFileSync(join(workflowDir, 'publish.yml'), generatePublishWorkflow(pm));
      console.log('Created .github/workflows/publish.yml');
    }

    if (changesetsEnabled && enforceInPR) {
      const writeChangesetCheck = await AwesomeLogger.prompt('confirm', {
        text: 'Generate changeset enforcement workflow?',
        default: 'yes',
      }).result;

      if (writeChangesetCheck) {
        const workflowDir = join(rootDir, '.github', 'workflows');
        if (!existsSync(workflowDir)) {
          mkdirSync(workflowDir, { recursive: true });
        }
        writeFileSync(join(workflowDir, 'changeset-check.yml'), generateChangesetCheckWorkflow());
        console.log('Created .github/workflows/changeset-check.yml');
      }
    }

    console.log('\nDone! Edit awesome-publish.config.ts to customize.');
    if (aiNotesEnabled) {
      console.log('Set AWESOME_PUBLISH_AI_KEY env var with your API key.');
    }
  },
});
