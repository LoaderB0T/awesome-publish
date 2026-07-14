import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { Phases } from '../pipeline/phases.js';
import type { PipelineStep } from '../pipeline/step.js';
import type { ChangesetContext } from '../pipeline/context.js';
import type { Changeset, ChangesetMeta } from '../types/changeset.js';
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
    const lineMatch = line.match(/^"(.+)":\s*(patch|minor|major)\s*$/);
    if (lineMatch) {
      releases.push({ name: lineMatch[1], type: lineMatch[2] as 'patch' | 'minor' | 'major' });
    }
  }

  if (releases.length === 0) {
    // Frontmatter present but no valid `"pkg": patch|minor|major` line — likely a
    // typo (e.g. `pattch`) or an unquoted name. Warn loudly rather than silently
    // dropping a file the user believes queues a release.
    console.warn(
      `⚠ Changeset ${basename(filePath)} has frontmatter but no valid release line ` +
        `(expected \`"package-name": patch|minor|major\`) — ignoring.`
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

export const readChangesetsStep: PipelineStep<{ rootDir: string }, ChangesetContext> = {
  name: 'read-changesets',
  phase: Phases.READ_CHANGESETS,
  after: [],
  before: [Phases.DETERMINE_VERSION],

  shouldRun: ctx => ctx.config.changesets.enabled,

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
