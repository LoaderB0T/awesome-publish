import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { globSync } from 'glob';
import type { PackageInfo } from '../types/package-info.js';
import type { ResolvedConfig } from '../types/config.js';
import { loadConfigFromDir } from '../config/load-config.js';
import { validateConfig } from '../config/schema.js';

function readPackageJson(dir: string): Record<string, unknown> {
  const content = readFileSync(join(dir, 'package.json'), 'utf-8');
  return JSON.parse(content);
}

function resolveGlobPatterns(rootDir: string, patterns: string[]): string[] {
  const dirs: string[] = [];
  for (const pattern of patterns) {
    const matches = globSync(pattern, { cwd: rootDir, absolute: true });
    for (const match of matches) {
      if (existsSync(join(match, 'package.json'))) {
        dirs.push(match);
      }
    }
  }
  return dirs;
}

function matchesFilter(name: string, filter: string): boolean {
  if (filter.includes('*')) {
    const regex = new RegExp('^' + filter.replace(/\*/g, '.*') + '$');
    return regex.test(name);
  }
  return name === filter;
}

export async function resolvePackages(
  rootDir: string,
  rootConfig: ResolvedConfig,
  filter?: string,
): Promise<PackageInfo[]> {
  const rootPkg = readPackageJson(rootDir);
  const workspaces = rootPkg.workspaces as string[] | undefined;

  let packageDirs: string[];

  if (workspaces && Array.isArray(workspaces)) {
    packageDirs = resolveGlobPatterns(rootDir, workspaces);
  } else if (existsSync(join(rootDir, 'pnpm-workspace.yaml'))) {
    const yamlContent = readFileSync(join(rootDir, 'pnpm-workspace.yaml'), 'utf-8');
    const patterns = parseWorkspaceYaml(yamlContent);
    packageDirs = resolveGlobPatterns(rootDir, patterns);
  } else {
    packageDirs = [rootDir];
  }

  const packages: PackageInfo[] = [];

  for (const dir of packageDirs) {
    const pkg = readPackageJson(dir);
    const name = pkg.name as string;

    if (filter && !matchesFilter(name, filter)) continue;

    const localConfig = await loadConfigFromDir(dir);
    const config = localConfig
      ? validateConfig(localConfig, rootConfig.packageManager)
      : rootConfig;

    packages.push({
      name,
      version: pkg.version as string,
      dir,
      packageJson: pkg,
      config,
    });
  }

  return packages;
}

function parseWorkspaceYaml(content: string): string[] {
  const patterns: string[] = [];
  let inPackages = false;
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === 'packages:') {
      inPackages = true;
      continue;
    }
    if (inPackages) {
      if (trimmed.startsWith('- ')) {
        patterns.push(trimmed.slice(2).replace(/['"]/g, ''));
      } else if (trimmed && !trimmed.startsWith('#')) {
        break;
      }
    }
  }
  return patterns;
}
