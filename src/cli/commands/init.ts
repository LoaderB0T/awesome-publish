import { defineCommand } from 'citty';
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { join } from 'node:path';
import { AwesomeLogger } from 'awesome-logging';
import { generateConfigFile } from '../../templates/config-template.js';
import { generatePublishWorkflow } from '../../templates/github-actions.js';
import { generateChangesetCheckWorkflow } from '../../templates/changeset-check.js';
import { detectPackageManager } from '../../services/package-manager.js';
import { setDebug, debug } from '../../services/debug.js';
import type { ResolvedConfig } from '../../types/config.js';

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function isMonorepo(rootDir: string): Promise<boolean> {
  const pkgPath = join(rootDir, 'package.json');
  if (await exists(pkgPath)) {
    const pkg = JSON.parse(await readFile(pkgPath, 'utf-8'));
    if (Array.isArray(pkg.workspaces) && pkg.workspaces.length > 0) return true;
  }
  return exists(join(rootDir, 'pnpm-workspace.yaml'));
}

export const initCommand = defineCommand({
  meta: { name: 'init', description: 'Initialize awesome-publish configuration' },
  args: {
    debug: { type: 'boolean' as const, description: 'Enable verbose debug logging' },
  },
  async run({ args }) {
    if (args.debug) setDebug(true);

    const rootDir = process.cwd();
    const pm = detectPackageManager(rootDir);
    debug('init', 'rootDir', rootDir);
    debug('init', 'package manager', pm);

    console.log('Setting up awesome-publish...\n');
    console.log(`Detected package manager: ${pm}`);

    const mono = await isMonorepo(rootDir);
    if (mono) {
      console.log('Detected monorepo workspace\n');
    } else {
      console.log('');
    }

    // --- Prompts ---

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
        hints:
          provider === 'anthropic'
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

    const writeWorkflow = await AwesomeLogger.prompt('confirm', {
      text: 'Generate GitHub Actions publish workflow?',
      default: 'yes',
    }).result;

    let writeChangesetCheck = false;
    if (changesetsEnabled && enforceInPR) {
      writeChangesetCheck = await AwesomeLogger.prompt('confirm', {
        text: 'Generate changeset enforcement workflow?',
        default: 'yes',
      }).result;
    }

    // --- Build config ---

    const config: Partial<ResolvedConfig> = {
      publishFiles,
      stripScripts,
      packageManager: pm,
      changesets: { enabled: changesetsEnabled, enforceInPR },
      github: { releases: { enabled: githubReleasesEnabled, mode: releaseMode, draft: false } },
      aiProvider,
      aiReleaseNotes: { enabled: aiNotesEnabled },
    };

    // --- Write files with checklist progress ---

    const items = [
      { text: 'Write awesome-publish.config.ts', state: 'pending' as const },
      ...(writeWorkflow
        ? [{ text: 'Write .github/workflows/publish.yml', state: 'pending' as const }]
        : []),
      ...(writeChangesetCheck
        ? [{ text: 'Write .github/workflows/changeset-check.yml', state: 'pending' as const }]
        : []),
    ];

    const checklist = AwesomeLogger.log('checklist', { items, logAllFinalStates: true });

    // Config file
    checklist.changeState(0, 'inProgress');
    const configContent = generateConfigFile(config);
    await writeFile(join(rootDir, 'awesome-publish.config.ts'), configContent);
    checklist.changeState(0, 'succeeded');

    let idx = 1;

    // Publish workflow
    if (writeWorkflow) {
      checklist.changeState(idx, 'inProgress');
      const workflowDir = join(rootDir, '.github', 'workflows');
      if (!(await exists(workflowDir))) {
        await mkdir(workflowDir, { recursive: true });
      }
      await writeFile(join(workflowDir, 'publish.yml'), generatePublishWorkflow(pm));
      checklist.changeState(idx, 'succeeded');
      idx++;
    }

    // Changeset check workflow
    if (writeChangesetCheck) {
      checklist.changeState(idx, 'inProgress');
      const workflowDir = join(rootDir, '.github', 'workflows');
      if (!(await exists(workflowDir))) {
        await mkdir(workflowDir, { recursive: true });
      }
      await writeFile(join(workflowDir, 'changeset-check.yml'), generateChangesetCheckWorkflow());
      checklist.changeState(idx, 'succeeded');
    }

    checklist.end();

    console.log('\nDone! Edit awesome-publish.config.ts to customize.');
    if (aiNotesEnabled) {
      console.log('Set AWESOME_PUBLISH_AI_KEY env var with your API key.');
    }
  },
});
