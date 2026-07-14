import { defineCommand } from 'citty';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { loadConfigFromDir } from '../../config/load-config.js';
import { validateConfig } from '../../config/schema.js';
import { detectPackageManager } from '../../services/package-manager.js';
import { resolvePackages } from '../../services/workspace.js';
import { GitService } from '../../services/git.js';
import { determineBumpFromCommits } from '../../services/conventional-commits.js';
import { bumpVersion, highestBump } from '../../services/version.js';
import { tagMatchPrefix } from '../../steps/git-tag.js';
import { setDebug, debug } from '../../services/debug.js';
import type { Changeset } from '../../types/changeset.js';

function parseChangesetFile(filePath: string): Changeset | null {
  // Normalize CRLF so the frontmatter regex matches on Windows-authored files.
  const content = readFileSync(filePath, 'utf-8').replace(/\r\n/g, '\n');
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return null;

  const [, frontmatter, body] = match;
  const releases: Changeset['releases'] = [];

  for (const line of frontmatter.split('\n')) {
    const lineMatch = line.match(/^"(.+)":\s*(patch|minor|major)\s*$/);
    if (lineMatch) {
      releases.push({ name: lineMatch[1], type: lineMatch[2] as 'patch' | 'minor' | 'major' });
    }
  }

  if (releases.length === 0) return null;

  // Strip metadata comments from summary
  const summary = body
    .split('\n')
    .filter(l => !l.match(/^<!--\s*(author|email|timestamp):\s*.+\s*-->$/))
    .join('\n')
    .trim();

  return { id: basename(filePath, '.md'), summary, releases };
}

export const statusCommand = defineCommand({
  meta: { name: 'status', description: 'Show pending changesets and what would be published' },
  args: {
    debug: { type: 'boolean' as const, description: 'Enable verbose debug logging' },
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
    debug(
      'status',
      'packages',
      packages.map(p => p.name)
    );

    const git = new GitService(rootDir);

    // Pending changesets
    const changesetDir = join(rootDir, '.changeset');
    const changesets: Changeset[] = [];
    if (existsSync(changesetDir)) {
      const files = readdirSync(changesetDir).filter(f => f.endsWith('.md') && f !== 'README.md');
      for (const file of files) {
        const parsed = parseChangesetFile(join(changesetDir, file));
        if (parsed) changesets.push(parsed);
      }
    }

    console.log('');

    // Show packages
    console.log(`📦 Packages (${packages.length}):`);
    for (const pkg of packages) {
      const latestTag = await git.getLatestTag(
        tagMatchPrefix(pkg.name, packages.length, config.gitTag.prefix)
      );
      const commits = latestTag ? await git.getCommitsSinceTag(latestTag) : [];
      const commitCount = commits.length;

      let bumpHint = '';
      if (config.conventionalCommits && commitCount > 0) {
        const detected = determineBumpFromCommits(commits);
        if (detected) bumpHint = ` (conventional: ${detected})`;
      }

      console.log(
        `  ${pkg.name}@${pkg.version}  ${commitCount} commits since ${latestTag ?? 'beginning'}${bumpHint}`
      );
    }

    // Show pending changesets
    if (config.changesets.enabled) {
      console.log('');
      if (changesets.length === 0) {
        console.log('📝 No pending changesets');
      } else {
        console.log(`📝 Pending changesets (${changesets.length}):`);
        for (const cs of changesets) {
          const pkgs = cs.releases.map(r => `${r.name}:${r.type}`).join(', ');
          console.log(`  ${cs.id}: ${pkgs}`);
          console.log(`    "${cs.summary}"`);
        }

        // Show what versions would be bumped
        console.log('');
        console.log('📊 Pending version bumps:');
        const bumpTypes = new Map<string, 'patch' | 'minor' | 'major'>();
        for (const cs of changesets) {
          for (const r of cs.releases) {
            const existing = bumpTypes.get(r.name);
            bumpTypes.set(r.name, existing ? highestBump(existing, r.type) : r.type);
          }
        }
        for (const pkg of packages) {
          const type = bumpTypes.get(pkg.name);
          if (type) {
            const newVersion = bumpVersion(pkg.version, type);
            console.log(`  ${pkg.name}: ${pkg.version} → ${newVersion} (${type})`);
          }
        }
      }
    }

    // Config summary
    console.log('');
    console.log('⚙️  Config:');
    console.log(`  Registry: ${config.registry}`);
    console.log(`  Git tags: ${config.gitTag.enabled ? 'enabled' : 'disabled'}`);
    console.log(`  Changelog: ${config.changelog.enabled ? config.changelog.file : 'disabled'}`);
    console.log(`  Changesets: ${config.changesets.enabled ? 'enabled' : 'disabled'}`);
    console.log(`  Conventional commits: ${config.conventionalCommits ? 'enabled' : 'disabled'}`);
    console.log(
      `  GitHub releases: ${config.github.releases.enabled ? `${config.github.releases.mode}${config.github.releases.draft ? ' (draft)' : ''}` : 'disabled'}`
    );
    console.log(`  AI release notes: ${config.aiReleaseNotes.enabled ? 'enabled' : 'disabled'}`);
    console.log(`  Confirm before publish: ${config.confirmPublish ? 'yes' : 'no'}`);
    console.log(`  Sync dependencies: ${config.syncDependencies ? 'enabled' : 'disabled'}`);
    console.log('');
  },
});
