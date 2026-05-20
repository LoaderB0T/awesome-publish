export const sharedArgs = {
  ci: { type: 'boolean' as const, description: 'Run in CI mode (non-interactive)' },
  'dry-run': { type: 'boolean' as const, description: 'Preview without side effects' },
  filter: { type: 'string' as const, description: 'Process specific packages only (glob on package names)' },
  'ignore-git': { type: 'boolean' as const, description: 'Skip clean git working tree check' },
};
