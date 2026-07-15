export const Phases = {
  READ_CHANGESETS: 'read-changesets',
  CONSUME_CHANGESETS: 'consume-changesets',
  DETERMINE_VERSION: 'determine-version',
  CONFIRM_PUBLISH: 'confirm-publish',
  PREFLIGHT: 'preflight',
  RUN_BUILD: 'run-build',
  SYNC_DEPENDENCIES: 'sync-dependencies',
  WRITE_VERSIONS: 'write-versions',
  WRITE_CHANGELOG: 'write-changelog',
  AI_NOTES_GENERATE: 'ai-notes-generate',
  BUILD_TEMP_DIR: 'build-temp-dir',
  MODIFY_PACKAGE_JSON: 'modify-package-json',
  PUBLISH_NPM: 'publish-npm',
  PACK_LOCAL: 'pack-local',
  GIT_COMMIT: 'git-commit',
  GIT_TAG: 'git-tag',
  AI_NOTES_PUBLISH: 'ai-notes-publish',
  GITHUB_RELEASE: 'github-release',
  CLEANUP: 'cleanup',
} as const;

export type Phase = (typeof Phases)[keyof typeof Phases];
