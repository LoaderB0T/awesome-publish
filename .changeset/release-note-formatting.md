---
'awesome-publish': patch
---

Tidy up GitHub release formatting. A combined release is now titled with its
date (`Release 2026-08-17 20:07`, taken from the release commit so a resume
keeps the original) instead of its sha tag, each package gets exactly one
`## name version` heading, and the `---` rules between package sections are
gone since a heading already renders one. The built-in AI prompt asks for no
title, and a model-authored heading that just restates the package name is
stripped if it adds one anyway.
