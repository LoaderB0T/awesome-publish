---
'awesome-publish': patch
---

GitHub release notes now use changeset summaries, matching the changelog's
precedence: changesets first, commits as supporting detail. Previously both the
AI prompt and the plain commit-list body were built from commits alone, so
promoting a prerelease to stable produced an empty release — the previous tag is
the prerelease, leaving no commits in range — even though the changesets held
the actual content. Custom AI prompts gain a `{{changesets}}` placeholder.
