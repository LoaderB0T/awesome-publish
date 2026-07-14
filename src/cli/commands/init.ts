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
    yes: {
      type: 'boolean' as const,
      description: 'Non-interactive: accept sensible defaults without prompting',
    },
    force: {
      type: 'boolean' as const,
      description: 'Overwrite existing config/workflow files instead of skipping them',
    },
    files: {
      type: 'string' as const,
      description: 'Comma/space-separated publishFiles (with --yes). Default: lib',
    },
    build: {
      type: 'string' as const,
      description: 'Build command to run before packing (e.g. "npm run build")',
    },
    provenance: {
      type: 'boolean' as const,
      description: 'Enable npm provenance in the generated workflow',
    },
  },
  async run({ args }) {
    if (args.debug) setDebug(true);

    const rootDir = process.cwd();
    const pm = detectPackageManager(rootDir);
    const nonInteractive = args.yes ?? false;
    const force = args.force ?? false;
    debug('init', 'rootDir', rootDir);
    debug('init', 'package manager', pm, 'nonInteractive', nonInteractive);

    console.log('Setting up awesome-publish...\n');
    console.log(`Detected package manager: ${pm}`);

    const mono = await isMonorepo(rootDir);
    if (mono) {
      console.log('Detected monorepo workspace\n');
    } else {
      console.log('');
    }

    // --- Gather options (defaults in --yes mode, otherwise prompt) ---

    let publishFiles: string[];
    let stripScripts: boolean;
    let buildCommand: string | undefined = args.build || undefined;
    let changesetsEnabled: boolean;
    let enforceInPR = false;
    let githubReleasesEnabled: boolean;
    let releaseMode: 'per-package' | 'combined' = 'per-package';
    let aiNotesEnabled: boolean;
    let provenance = args.provenance ?? false;
    let writeWorkflow = false;
    let writeChangesetCheck = false;
    let aiProvider: ResolvedConfig['aiProvider'] | undefined;

    if (nonInteractive) {
      publishFiles = (args.files ?? 'lib').split(/[,\s]+/).filter(Boolean);
      stripScripts = true;
      changesetsEnabled = true;
      enforceInPR = true;
      githubReleasesEnabled = true;
      aiNotesEnabled = false;
      writeWorkflow = true;
      writeChangesetCheck = true;
    } else {
      const publishFilesInput = await AwesomeLogger.prompt('text', {
        text: 'Which files/dirs to include in published package?',
        hints: ['lib', 'dist', 'README.md', 'LICENSE'],
        default: 'lib',
        allowOnlyHints: false,
        caseInsensitive: false,
        fuzzyAutoComplete: false,
        validators: [],
      }).result;

      publishFiles = publishFilesInput.split(/[,\s]+/).filter(Boolean);

      stripScripts = await AwesomeLogger.prompt('confirm', {
        text: 'Strip scripts from published package.json?',
        default: 'yes',
      }).result;

      const buildInput = await AwesomeLogger.prompt('text', {
        text: 'Build command to run before publishing? (empty for none)',
        hints: [`${pm} run build`],
        default: '',
        allowOnlyHints: false,
        caseInsensitive: false,
        fuzzyAutoComplete: false,
        validators: [],
      }).result;
      buildCommand = buildInput.trim() || undefined;

      changesetsEnabled = await AwesomeLogger.prompt('confirm', {
        text: 'Enable changesets for version management?',
        default: 'yes',
      }).result;

      if (changesetsEnabled) {
        enforceInPR = await AwesomeLogger.prompt('confirm', {
          text: 'Enforce changesets in pull requests (via GitHub Action)?',
          default: 'yes',
        }).result;
      }

      githubReleasesEnabled = await AwesomeLogger.prompt('confirm', {
        text: 'Enable GitHub releases?',
        default: 'yes',
      }).result;

      if (githubReleasesEnabled) {
        const modeChoice = await AwesomeLogger.prompt('choice', {
          text: 'GitHub release mode?',
          options: ['per-package', 'combined'],
        }).result;
        releaseMode = modeChoice as 'per-package' | 'combined';
      }

      provenance = await AwesomeLogger.prompt('confirm', {
        text: 'Enable npm provenance (OIDC) in the workflow?',
        default: 'no',
      }).result;

      aiNotesEnabled = await AwesomeLogger.prompt('confirm', {
        text: 'Enable AI-generated release notes?',
        default: 'no',
      }).result;
    }

    if (aiNotesEnabled) {
      const provider = await AwesomeLogger.prompt('choice', {
        text: 'AI provider?',
        options: ['anthropic', 'openai-compatible'],
      }).result;

      const model = await AwesomeLogger.prompt('text', {
        text: 'AI model name?',
        hints:
          provider === 'anthropic'
            ? ['claude-sonnet-5', 'claude-haiku-4-5-20251001']
            : ['gpt-4o', 'gpt-4o-mini'],
        default: provider === 'anthropic' ? 'claude-sonnet-5' : 'gpt-4o',
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

    if (!nonInteractive) {
      writeWorkflow = await AwesomeLogger.prompt('confirm', {
        text: 'Generate GitHub Actions publish workflow?',
        default: 'yes',
      }).result;

      if (changesetsEnabled && enforceInPR) {
        writeChangesetCheck = await AwesomeLogger.prompt('confirm', {
          text: 'Generate changeset enforcement workflow?',
          default: 'yes',
        }).result;
      } else {
        writeChangesetCheck = false;
      }
    }

    // --- Build config ---

    const config: Partial<ResolvedConfig> = {
      publishFiles,
      stripScripts,
      ...(buildCommand ? { buildCommand } : {}),
      packageManager: pm,
      changesets: { enabled: changesetsEnabled, enforceInPR },
      github: { releases: { enabled: githubReleasesEnabled, mode: releaseMode, draft: false } },
      aiProvider,
      aiReleaseNotes: { enabled: aiNotesEnabled },
      ...(provenance ? { provenance: true } : {}),
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

    // Write a file unless it already exists (unless --force), so re-running
    // init never silently clobbers a hand-edited config or workflow.
    const writeGuarded = async (
      index: number,
      path: string,
      label: string,
      content: string
    ): Promise<void> => {
      checklist.changeState(index, 'inProgress');
      if ((await exists(path)) && !force) {
        checklist.changeState(index, 'skipped', `${label} (already exists — use --force)`);
        return;
      }
      await writeFile(path, content);
      checklist.changeState(index, 'succeeded');
    };

    const ensureWorkflowDir = async (): Promise<string> => {
      const workflowDir = join(rootDir, '.github', 'workflows');
      if (!(await exists(workflowDir))) await mkdir(workflowDir, { recursive: true });
      return workflowDir;
    };

    await writeGuarded(
      0,
      join(rootDir, 'awesome-publish.config.ts'),
      'awesome-publish.config.ts',
      generateConfigFile(config)
    );

    let idx = 1;

    if (writeWorkflow) {
      const workflowDir = await ensureWorkflowDir();
      await writeGuarded(
        idx,
        join(workflowDir, 'publish.yml'),
        '.github/workflows/publish.yml',
        generatePublishWorkflow(pm, { registry: config.registry, provenance, buildCommand })
      );
      idx++;
    }

    if (writeChangesetCheck) {
      const workflowDir = await ensureWorkflowDir();
      await writeGuarded(
        idx,
        join(workflowDir, 'changeset-check.yml'),
        '.github/workflows/changeset-check.yml',
        generateChangesetCheckWorkflow()
      );
    }

    checklist.end();

    console.log('\nDone! Edit awesome-publish.config.ts to customize.');
    if (aiNotesEnabled) {
      console.log('Set AWESOME_PUBLISH_AI_KEY env var with your API key.');
    }
  },
});
