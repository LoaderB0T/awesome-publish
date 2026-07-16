import { defineCommand } from 'citty';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { resolveConfigForCommand } from '../../config/load-config.js';
import { detectPackageManager } from '../../services/package-manager.js';
import { resolvePackages } from '../../services/workspace.js';
import { GitService } from '../../services/git.js';
import { determineBumpFromCommits } from '../../services/conventional-commits.js';
import { bumpVersion, highestBump, type BumpType } from '../../services/version.js';
import { tagMatchPrefix } from '../../steps/git-tag.js';
import { parseChangesetFile } from '../../steps/read-changesets.js';
import { setDebug, debug } from '../../services/debug.js';
import type { Changeset } from '../../types/changeset.js';

export const statusCommand = defineCommand({
  meta: { name: 'status', description: 'Show pending changesets and what would be published' },
  args: {
    debug: { type: 'boolean' as const, description: 'Enable verbose debug logging' },
  },
  async run({ args }) {
    if (args.debug) setDebug(true);

    const rootDir = process.cwd();
    const pm = detectPackageManager(rootDir);
    const config = await resolveConfigForCommand(rootDir, pm);

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

    // Effective bump per package, using the SAME precedence as publish:
    // changesets first, then conventional commits. (status has no --bump/--pre.)
    const changesetBumpTypes = new Map<string, BumpType>();
    for (const cs of changesets) {
      for (const r of cs.releases) {
        const existing = changesetBumpTypes.get(r.name);
        changesetBumpTypes.set(r.name, existing ? highestBump(existing, r.type) : r.type);
      }
    }
    const effectiveBumps = new Map<
      string,
      { from: string; to: string; type: BumpType; source: string }
    >();

    // Show packages
    console.log(`📦 Packages (${packages.length}):`);
    for (const pkg of packages) {
      const latestTag = await git.getLatestTag(
        tagMatchPrefix(pkg.name, packages.length, config.gitTag.prefix)
      );
      const commits = latestTag
        ? await git.getCommitsSinceTag(latestTag)
        : await git.getAllCommits();
      const commitCount = commits.length;

      let type: BumpType | undefined;
      let source = '';
      if (config.changesets.enabled && changesetBumpTypes.has(pkg.name)) {
        type = changesetBumpTypes.get(pkg.name);
        source = 'changeset';
      } else if (config.conventionalCommits) {
        const detected = determineBumpFromCommits(commits);
        if (detected) {
          type = detected;
          source = 'conventional';
        }
      }

      let hint = '';
      if (type) {
        const to = bumpVersion(pkg.version, type, { zeroBased: true });
        effectiveBumps.set(pkg.name, { from: pkg.version, to, type, source });
        hint = ` → ${to} (${type}, ${source})`;
      }

      console.log(
        `  ${pkg.name}@${pkg.version}  ${commitCount} commits since ${latestTag ?? 'beginning'}${hint}`
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
      }
    }

    // Unified version-bump preview (changesets and/or conventional commits).
    if (effectiveBumps.size > 0) {
      console.log('');
      console.log('📊 Pending version bumps:');
      for (const pkg of packages) {
        const b = effectiveBumps.get(pkg.name);
        if (b) console.log(`  ${pkg.name}: ${b.from} → ${b.to} (${b.type}, ${b.source})`);
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
