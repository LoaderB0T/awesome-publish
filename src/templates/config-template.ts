import type { ResolvedConfig } from '../types/config.js';

export function generateConfigFile(config: Partial<ResolvedConfig>): string {
  const lines = [
    `import { defineConfig } from 'awesome-publish';`,
    ``,
    `export default defineConfig({`,
  ];

  if (config.publishDir) {
    // publishDir mode: pack from the built dir; publishFiles is an optional
    // copy filter (defaults to the whole dir), so don't scaffold a misleading one.
    lines.push(`  publishDir: ${JSON.stringify(config.publishDir)},`);
  } else {
    lines.push(`  publishFiles: ${JSON.stringify(config.publishFiles ?? ['lib'])},`);
  }
  lines.push(`  stripScripts: ${config.stripScripts ?? true},`);

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
