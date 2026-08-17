---
'awesome-publish': minor
---

Add `publish --resume` to finish a release that failed partway, by reading back
what the npm registry, git tags and GitHub releases already have instead of
keeping a state file. Every publish run now warns when the version in
package.json is only half-released, and a retry after a failed publish computes
its next version from the last version that actually shipped instead of skipping
one. Combined GitHub releases are now tagged `release-<short-commit-sha>` instead
of a timestamp, so a retry cannot create a duplicate release, and a release that
already exists has its body brought up to date instead of being left stale.

The `ai-notes-publish` step is gone: AI release notes are now written as the
release body by `github-release` itself rather than PATCHed in afterwards, one
GitHub write instead of two. Changeset deletion also moved after AI note
generation, so the window in which consumed changesets exist only in git's index
no longer spans a network call to an AI provider.
