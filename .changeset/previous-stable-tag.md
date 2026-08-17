---
'awesome-publish': patch
---

Commit ranges for changelogs and release notes now start at the previous release
of the same kind: a stable release diffs against the last stable tag, skipping
prereleases published in between, and a prerelease diffs against the previous
prerelease. Promoting `0.0.3-next.0` to `0.0.3` previously diffed against the
prerelease tag, found no commits, and produced an empty changelog entry and
release body. Ranking is by semver rather than `git describe`'s topological
nearest tag, so the range starts at the previous *release*, not at whatever tag
sits closest on the graph.
