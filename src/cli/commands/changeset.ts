import { defineCommand } from 'citty';
import { writeFile, mkdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { randomBytes } from 'node:crypto';
import { AwesomeLogger } from 'awesome-logging';
import { resolveConfigForCommand } from '../../config/load-config.js';
import { detectPackageManager } from '../../services/package-manager.js';
import { resolvePackages } from '../../services/workspace.js';
import { GitService } from '../../services/git.js';
import { validateBumpType } from '../../services/version.js';
import { setDebug, debug } from '../../services/debug.js';

function generateId(): string {
  return randomBytes(8).toString('hex');
}

function formatChangeset(
  releases: { name: string; type: 'patch' | 'minor' | 'major' }[],
  summary: string,
  meta: { author?: string | null; email?: string | null; timestamp: string }
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
    branch: {
      type: 'string' as const,
      description: 'Base branch to compare against',
      default: 'main',
    },
    all: {
      type: 'boolean' as const,
      description: 'Offer all packages instead of only git-changed ones',
    },
    ci: {
      type: 'boolean' as const,
      description: 'Non-interactive: build the changeset from --type/--summary/--packages',
    },
    type: {
      type: 'string' as const,
      description: 'Bump type for --ci mode (patch|minor|major)',
    },
    summary: { type: 'string' as const, description: 'Changeset summary for --ci mode' },
    packages: {
      type: 'string' as const,
      description: 'Comma-separated package names for --ci mode (default: all changed)',
    },
  },
  async run({ args }) {
    if (args.debug) setDebug(true);
    const nonInteractive = args.ci ?? false;

    const rootDir = process.cwd();
    const pm = detectPackageManager(rootDir);
    const config = await resolveConfigForCommand(rootDir, pm);

    const packages = await resolvePackages(rootDir, config);
    debug(
      'changeset',
      'packages',
      packages.map(p => p.name)
    );

    const git = new GitService(rootDir);
    let changedPackages;

    if (args.all || (nonInteractive && args.packages)) {
      // Explicit package list (or --all) bypasses git change detection.
      debug('changeset', 'skipping git change detection');
      changedPackages = packages;
    } else {
      if (!(await git.isRepo())) {
        throw new Error(
          `Not a git repository (${rootDir}). Run \`git init\`, or use --all to select packages without git change detection.`
        );
      }
      // Find changed files since base branch
      const changedFiles = await git.getChangedFilesSince(args.branch);
      debug('changeset', `${changedFiles.length} files changed since ${args.branch}`);

      if (changedFiles.length === 0) {
        console.log(`No changes found since ${args.branch}`);
        return;
      }

      const normalizedFiles = changedFiles.map(f => f.replace(/\\/g, '/'));
      const pkgDirs = packages.map(p => ({
        pkg: p,
        rel: relative(rootDir, p.dir).replace(/\\/g, '/'),
      }));
      const rootPkg = pkgDirs.find(d => d.rel === '' || d.rel === '.');

      // Attribute each changed file to the single package that owns it — the
      // LONGEST matching package dir — so a file in a nested package
      // (packages/a/nested) isn't counted for its parent (packages/a) too.
      // Files under no sub-package belong to the root package (if publishable).
      const owners = new Set<string>();
      for (const f of normalizedFiles) {
        let best: (typeof pkgDirs)[number] | undefined;
        for (const d of pkgDirs) {
          if (d.rel === '' || d.rel === '.') continue;
          if (
            (f === d.rel || f.startsWith(`${d.rel}/`)) &&
            (!best || d.rel.length > best.rel.length)
          ) {
            best = d;
          }
        }
        if (best) owners.add(best.pkg.name);
        else if (rootPkg) owners.add(rootPkg.pkg.name);
      }

      changedPackages = packages.filter(p => owners.has(p.name));

      debug(
        'changeset',
        'changed packages',
        changedPackages.map(p => p.name)
      );

      if (changedPackages.length === 0) {
        console.log('No packages with changes found');
        return;
      }
    }

    const releases: { name: string; type: 'patch' | 'minor' | 'major' }[] = [];
    let summary: string;

    if (nonInteractive) {
      // CI mode: everything comes from flags. One bump type applies to all
      // selected packages (edit the file afterwards for per-package types).
      if (!args.type) throw new Error('--ci requires --type=patch|minor|major');
      if (!args.summary?.trim()) throw new Error('--ci requires --summary');
      const type = validateBumpType(args.type);

      const requested = args.packages
        ? args.packages
            .split(',')
            .map(s => s.trim())
            .filter(Boolean)
        : changedPackages.map(p => p.name);

      const known = new Set(packages.map(p => p.name));
      for (const name of requested) {
        if (!known.has(name)) throw new Error(`Unknown package: "${name}"`);
        releases.push({ name, type });
      }
      if (releases.length === 0) throw new Error('No packages to include in changeset');
      summary = args.summary.trim();
    } else {
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
      for (const name of selectedNames) {
        const bumpType = await AwesomeLogger.prompt('choice', {
          text: `Bump type for ${name}:`,
          options: ['patch', 'minor', 'major'],
        }).result;
        releases.push({ name, type: bumpType as 'patch' | 'minor' | 'major' });
      }

      // Ask for summary
      const summaryInput = await AwesomeLogger.prompt('text', {
        text: 'Changeset summary:',
        hints: [],
        default: '',
        allowOnlyHints: false,
        caseInsensitive: false,
        fuzzyAutoComplete: false,
        validators: [],
      }).result;

      if (!summaryInput.trim()) {
        console.log('Changeset summary cannot be empty');
        return;
      }
      summary = summaryInput.trim();
    }

    // Gather metadata
    const [author, email] = await Promise.all([git.getUserName(), git.getUserEmail()]);
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
