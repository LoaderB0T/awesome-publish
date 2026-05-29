import { defineCommand } from 'citty';
import { writeFile, mkdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { randomBytes } from 'node:crypto';
import { AwesomeLogger } from 'awesome-logging';
import { loadConfigFromDir } from '../../config/load-config.js';
import { validateConfig } from '../../config/schema.js';
import { detectPackageManager } from '../../services/package-manager.js';
import { resolvePackages } from '../../services/workspace.js';
import { GitService } from '../../services/git.js';
import { setDebug, debug } from '../../services/debug.js';

function generateId(): string {
  return randomBytes(8).toString('hex');
}

function formatChangeset(
  releases: { name: string; type: 'patch' | 'minor' | 'major' }[],
  summary: string,
  meta: { author?: string | null; email?: string | null; timestamp: string },
): string {
  const lines = ['---'];
  for (const r of releases) {
    lines.push(`"${r.name}": ${r.type}`);
  }
  lines.push('---');
  lines.push('');
  if (meta.author) lines.push(`<!-- author: ${meta.author} -->`);
  if (meta.email) lines.push(`<!-- email: ${meta.email} -->`);
  lines.push(`<!-- timestamp: ${meta.timestamp} -->`);
  lines.push('');
  lines.push(summary);
  lines.push('');
  return lines.join('\n');
}

export const changesetCommand = defineCommand({
  meta: { name: 'changeset', description: 'Generate a changeset for changed packages' },
  args: {
    debug: { type: 'boolean' as const, description: 'Enable verbose debug logging' },
    branch: { type: 'string' as const, description: 'Base branch to compare against', default: 'main' },
    'ignore-git': { type: 'boolean' as const, description: 'Show all packages instead of only git-changed ones' },
  },
  async run({ args }) {
    if (args.debug) setDebug(true);

    const rootDir = process.cwd();
    const pm = detectPackageManager(rootDir);
    const rawConfig = await loadConfigFromDir(rootDir);
    const config = rawConfig
      ? validateConfig(rawConfig, pm)
      : validateConfig({ publishFiles: ['lib'], stripScripts: true }, pm);

    const packages = await resolvePackages(rootDir, config);
    debug('changeset', 'packages', packages.map(p => p.name));

    const git = new GitService(rootDir);
    let changedPackages;

    if (args['ignore-git']) {
      debug('changeset', '--ignore-git flag, showing all packages');
      changedPackages = packages;
    } else {
      // Find changed files since base branch
      const changedFiles = await git.getChangedFilesSince(args.branch);
      debug('changeset', `${changedFiles.length} files changed since ${args.branch}`);

      if (changedFiles.length === 0) {
        console.log(`No changes found since ${args.branch}`);
        return;
      }

      // Map changed files to packages
      changedPackages = packages.filter(pkg => {
        const pkgRelDir = relative(rootDir, pkg.dir);
        if (pkgRelDir === '' || pkgRelDir === '.') return changedFiles.length > 0;
        return changedFiles.some(f => f.startsWith(pkgRelDir + '/') || f.startsWith(pkgRelDir + '\\'));
      });

      debug('changeset', 'changed packages', changedPackages.map(p => p.name));

      if (changedPackages.length === 0) {
        console.log('No packages with changes found');
        return;
      }
    }

    // Select packages via toggle prompt
    const selectedNames = await AwesomeLogger.prompt('toggle', {
      text: 'Select packages to include in changeset:',
      options: changedPackages.map(p => p.name),
      default: changedPackages.map(p => p.name),
    }).result;

    if (selectedNames.length === 0) {
      console.log('No packages selected');
      return;
    }

    debug('changeset', 'selected', selectedNames);

    // Ask bump type per package
    const releases: { name: string; type: 'patch' | 'minor' | 'major' }[] = [];

    for (const name of selectedNames) {
      const bumpType = await AwesomeLogger.prompt('choice', {
        text: `Bump type for ${name}:`,
        options: ['patch', 'minor', 'major'],
      }).result;
      releases.push({ name, type: bumpType as 'patch' | 'minor' | 'major' });
    }

    // Ask for summary
    const summary = await AwesomeLogger.prompt('text', {
      text: 'Changeset summary:',
      hints: [],
      default: '',
      allowOnlyHints: false,
      caseInsensitive: false,
      fuzzyAutoComplete: false,
      validators: [],
    }).result;

    if (!summary.trim()) {
      console.log('Changeset summary cannot be empty');
      return;
    }

    // Gather metadata
    const [author, email] = await Promise.all([
      git.getUserName(),
      git.getUserEmail(),
    ]);
    const timestamp = new Date().toISOString();
    debug('changeset', 'meta', { author, email, timestamp });

    // Write changeset file
    const changesetDir = join(rootDir, '.changeset');
    await mkdir(changesetDir, { recursive: true });

    const id = generateId();
    const filename = `${id}.md`;
    const content = formatChangeset(releases, summary.trim(), { author, email, timestamp });

    await writeFile(join(changesetDir, filename), content);

    console.log(`\nCreated .changeset/${filename}`);
    for (const r of releases) {
      console.log(`  ${r.name}: ${r.type}`);
    }
  },
});
