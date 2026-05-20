export const Phases = {
  READ_CHANGESETS: 'read-changesets',
  CONSUME_CHANGESETS: 'consume-changesets',
  DETERMINE_VERSION: 'determine-version',
  WRITE_VERSIONS: 'write-versions',
  AI_NOTES_GENERATE: 'ai-notes-generate',
  BUILD_TEMP_DIR: 'build-temp-dir',
  MODIFY_PACKAGE_JSON: 'modify-package-json',
  PUBLISH_NPM: 'publish-npm',
  AI_NOTES_PUBLISH: 'ai-notes-publish',
  GITHUB_RELEASE: 'github-release',
  CLEANUP: 'cleanup',
} as const;

export type Phase = (typeof Phases)[keyof typeof Phases];
