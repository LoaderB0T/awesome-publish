import type { ResolvedConfig } from '../types/config.js';

export function generateConfigFile(config: Partial<ResolvedConfig>): string {
  const lines = [
    `import { defineConfig } from 'awesome-publish';`,
    ``,
    `export default defineConfig({`,
    `  publishFiles: ${JSON.stringify(config.publishFiles ?? ['lib'])},`,
    `  stripScripts: ${config.stripScripts ?? true},`,
  ];

  if (config.buildCommand) {
    lines.push(`  buildCommand: ${JSON.stringify(config.buildCommand)},`);
  }

  if (config.provenance) {
    lines.push(`  provenance: true,`);
  }

  if (config.packageManager) {
    lines.push(`  packageManager: ${JSON.stringify(config.packageManager)},`);
  }

  if (config.changesets?.enabled) {
    lines.push(`  changesets: {`);
    lines.push(`    enabled: true,`);
    if (config.changesets.enforceInPR) {
      lines.push(`    enforceInPR: true,`);
    }
    lines.push(`  },`);
  }

  if (config.github?.releases?.enabled) {
    lines.push(`  github: {`);
    lines.push(`    releases: {`);
    lines.push(`      enabled: true,`);
    lines.push(`      mode: '${config.github.releases.mode}',`);
    lines.push(`    },`);
    lines.push(`  },`);
  }

  if (config.aiProvider) {
    lines.push(`  aiProvider: {`);
    lines.push(`    provider: ${JSON.stringify(config.aiProvider.provider)},`);
    lines.push(`    model: ${JSON.stringify(config.aiProvider.model)},`);
    if (config.aiProvider.baseUrl) {
      lines.push(`    baseUrl: ${JSON.stringify(config.aiProvider.baseUrl)},`);
    }
    lines.push(`  },`);
    lines.push(`  aiReleaseNotes: true,`);
  }

  lines.push(`});`);
  lines.push(``);
  return lines.join('\n');
}
