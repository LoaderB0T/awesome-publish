# Changelog

## 0.0.10 (2026-08-17)

- Commit ranges for changelogs and release notes now start at the previous release
of the same kind: a stable release diffs against the last stable tag, skipping
prereleases published in between, and a prerelease diffs against the previous
prerelease. Promoting `0.0.3-next.0` to `0.0.3` previously diffed against the
prerelease tag, found no commits, and produced an empty changelog entry and
release body. Ranking is by semver rather than `git describe`'s topological
nearest tag, so the range starts at the previous *release*, not at whatever tag
sits closest on the graph.
- GitHub release notes now use changeset summaries, matching the changelog's
precedence: changesets first, commits as supporting detail. Previously both the
AI prompt and the plain commit-list body were built from commits alone, so
promoting a prerelease to stable produced an empty release — the previous tag is
the prerelease, leaving no commits in range — even though the changesets held
the actual content. Custom AI prompts gain a `{{changesets}}` placeholder.

## 0.0.9 (2026-08-17)

- Tidy up GitHub release formatting. A combined release is now titled with its
  date (`Release 2026-08-17 20:07`, taken from the release commit so a resume
  keeps the original) instead of its sha tag, each package gets exactly one
  `## name version` heading, and the `---` rules between package sections are
  gone since a heading already renders one. The built-in AI prompt asks for no
  title, and a model-authored heading that just restates the package name is
  stripped if it adds one anyway.

## 0.0.8 (2026-08-17)

- Version bump

## 0.0.7 (2026-08-07)

- Version bump

## 0.0.6 (2026-07-16)

- Version bump

## 0.0.5 (2026-07-16)

- Version bump

## 0.0.4 (2026-07-15)

- cl

## 0.0.3 (2026-07-15)

- publish dir

## 0.0.2 (2026-07-14)

- fixes

## 0.0.1 (2026-07-14)

- initial commit
