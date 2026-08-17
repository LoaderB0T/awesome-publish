import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { Phases } from '../pipeline/phases.js';
import type { PipelineStep } from '../pipeline/step.js';
import type { ChangesetContext } from '../pipeline/context.js';
import type { Changeset, ChangesetMeta } from '../types/changeset.js';
import type { BumpType } from '../services/version.js';
import { debug } from '../services/debug.js';

function parseMetaComments(body: string): { meta: ChangesetMeta; summary: string } {
  const meta: ChangesetMeta = {};
  const lines = body.split('\n');
  const remaining: string[] = [];

  for (const line of lines) {
    const metaMatch = line.match(/^<!--\s*(author|email|timestamp):\s*(.+?)\s*-->$/);
    if (metaMatch) {
      const [, key, value] = metaMatch;
      meta[key as keyof ChangesetMeta] = value;
    } else {
      remaining.push(line);
    }
  }

  return { meta: Object.keys(meta).length > 0 ? meta : {}, summary: remaining.join('\n').trim() };
}

export function parseChangesetFile(filePath: string): Changeset | null {
  // Strip a leading UTF-8 BOM (Windows editors add one) and normalize CRLF so
  // the frontmatter regex matches. Tolerate a closing `---` at EOF with no
  // trailing newline or body.
  const content = readFileSync(filePath, 'utf-8').replace(/^﻿/, '').replace(/\r\n/g, '\n');
  const match = content.match(/^---\n([\s\S]*?)\n---(?:\n([\s\S]*))?$/);
  if (!match) return null;

  const [, frontmatter, body = ''] = match;
  const releases: Changeset['releases'] = [];

  for (const line of frontmatter.split('\n')) {
    if (!line.trim()) continue; // blank frontmatter line — ignore silently
    // The package name may be double-quoted ("pkg"), single-quoted ('pkg', the
    // style @changesets/cli writes) or unquoted (pkg) — all valid changesets
    // YAML. The `\2` backreference makes the closing quote match the opening one.
    const lineMatch = line.match(/^\s*(["']?)(.+?)\1\s*:\s*(patch|minor|major|next)\s*$/);
    if (lineMatch) {
      releases.push({ name: lineMatch[2], type: lineMatch[3] as BumpType });
    } else {
      // A non-blank line that isn't a valid `pkg: patch|minor|major` — likely a
      // typo (`"pkg": pathc`). Warn PER LINE: a sibling valid line makes
      // releases.length > 0, so the whole-file warning below never fires and this
      // release intent would otherwise vanish when the changeset file is deleted
      // after a successful publish.
      console.warn(
        `⚠ Changeset ${basename(filePath)}: ignoring invalid frontmatter line "${line.trim()}" ` +
          `(expected \`package-name: patch|minor|major|next\`, name optionally quoted).`
      );
    }
  }

  if (releases.length === 0) {
    // Frontmatter present but no valid `"pkg": patch|minor|major` line — likely a
    // typo (e.g. `pattch`) or an unquoted name. Warn loudly rather than silently
    // dropping a file the user believes queues a release.
    console.warn(
      `⚠ Changeset ${basename(filePath)} has frontmatter but no valid release line ` +
        `(expected \`package-name: patch|minor|major|next\`, name optionally quoted) — ignoring.`
    );
    return null;
  }

  const { meta, summary } = parseMetaComments(body);

  return {
    id: basename(filePath, '.md'),
    summary,
    releases,
    ...(Object.keys(meta).length > 0 ? { meta } : {}),
  };
}

/**
 * Summaries of the changesets that release `packageName`.
 *
 * Sorted by id for a deterministic order across machines (readdir order is
 * filesystem-dependent) and de-duplicated so a repeated note is not listed
 * twice. Shared by the changelog, the AI release-notes prompt and the GitHub
 * release body so all three describe a release the same way.
 */
export function changesetSummariesFor(
  changesets: Changeset[] | undefined,
  packageName: string
): string[] {
  const relevant = changesets
    ?.filter(cs => cs.releases.some(r => r.name === packageName))
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id));
  if (!relevant?.length) return [];

  const seen = new Set<string>();
  const summaries: string[] = [];
  for (const cs of relevant) {
    const summary = cs.summary.trim();
    if (!summary || seen.has(summary)) continue;
    seen.add(summary);
    summaries.push(summary);
  }
  return summaries;
}

export const readChangesetsStep: PipelineStep<
  { rootDir: string; cliArgs?: { resume?: boolean } },
  ChangesetContext
> = {
  name: 'read-changesets',
  phase: Phases.READ_CHANGESETS,
  after: [],
  before: [Phases.DETERMINE_VERSION],

  // --resume finishes the version already in package.json; changesets describe
  // the NEXT release, so reading them would only tempt a bump past it. Leaving
  // `changesets` empty also makes consume-changesets a no-op, so a resumed run
  // can never delete release intent it isn't acting on.
  shouldRun: ctx => ctx.config.changesets.enabled && !ctx.cliArgs?.resume,

  async execute(ctx): Promise<ChangesetContext> {
    const changesetDir = join(ctx.rootDir, '.changeset');
    debug('read-changesets', 'looking in', changesetDir);

    if (!existsSync(changesetDir)) {
      debug('read-changesets', 'no .changeset directory found');
      return { changesets: [] };
    }

    const files = readdirSync(changesetDir).filter(f => f.endsWith('.md') && f !== 'README.md');
    debug('read-changesets', 'found changeset files', files);

    const changesets: Changeset[] = [];
    for (const file of files) {
      const parsed = parseChangesetFile(join(changesetDir, file));
      if (parsed) {
        debug('read-changesets', 'parsed changeset', parsed.id, parsed.releases);
        changesets.push(parsed);
      } else {
        debug('read-changesets', 'skipped invalid changeset', file);
      }
    }

    debug('read-changesets', `total: ${changesets.length} changesets`);
    return { changesets };
  },
};
