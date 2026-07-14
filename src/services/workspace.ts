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
  // pnpm/yarn support `!`-prefixed exclusion patterns; honor them as globby
  // ignores rather than feeding them back as literal include patterns.
  const includes = patterns.filter(p => !p.startsWith('!'));
  const ignore = patterns.filter(p => p.startsWith('!')).map(p => p.slice(1));

  const dirs = new Set<string>();
  for (const pattern of includes) {
    const matches = globSync(pattern, { cwd: rootDir, absolute: true, ignore });
    for (const match of matches) {
      if (existsSync(join(match, 'package.json'))) {
        dirs.add(match); // Set dedups overlapping patterns.
      }
    }
  }
  return [...dirs];
}

const DEP_FIELDS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
] as const;

/**
 * Order packages so a dependency is published before any package that depends
 * on it (topological sort over intra-workspace deps). Falls back to the
 * original order if a dependency cycle is detected.
 */
function topoSortPackages(packages: PackageInfo[]): PackageInfo[] {
  const byName = new Map(packages.map(p => [p.name, p]));
  const inDegree = new Map<string, number>();
  const dependents = new Map<string, Set<string>>();
  for (const p of packages) {
    inDegree.set(p.name, 0);
    dependents.set(p.name, new Set());
  }

  for (const p of packages) {
    for (const field of DEP_FIELDS) {
      const deps = p.packageJson[field] as Record<string, string> | undefined;
      if (!deps) continue;
      for (const depName of Object.keys(deps)) {
        if (depName === p.name || !byName.has(depName)) continue;
        if (!dependents.get(depName)!.has(p.name)) {
          dependents.get(depName)!.add(p.name);
          inDegree.set(p.name, inDegree.get(p.name)! + 1);
        }
      }
    }
  }

  const queue = packages.filter(p => inDegree.get(p.name) === 0).map(p => p.name);
  const sorted: PackageInfo[] = [];
  for (let i = 0; i < queue.length; i++) {
    const name = queue[i];
    sorted.push(byName.get(name)!);
    for (const dependent of dependents.get(name)!) {
      const deg = inDegree.get(dependent)! - 1;
      inDegree.set(dependent, deg);
      if (deg === 0) queue.push(dependent);
    }
  }

  return sorted.length === packages.length ? sorted : packages;
}

function matchesFilter(name: string, filter: string): boolean {
  if (filter.includes('*')) {
    const regex = new RegExp(`^${filter.replace(/\*/g, '.*')}$`);
    return regex.test(name);
  }
  return name === filter;
}

export async function resolvePackages(
  rootDir: string,
  rootConfig: ResolvedConfig,
  filter?: string
): Promise<PackageInfo[]> {
  const rootPkg = readPackageJson(rootDir);
  const workspacePatterns = getWorkspacePatterns(rootPkg);

  let packageDirs: string[];

  if (workspacePatterns) {
    packageDirs = resolveGlobPatterns(rootDir, workspacePatterns);
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
    const name = pkg.name as string | undefined;
    const version = pkg.version as string | undefined;

    // C3: Skip packages without name or version
    if (!name || !version) continue;

    // C4: Skip private packages (not publishable)
    if (pkg.private === true) continue;

    if (filter && !matchesFilter(name, filter)) continue;

    const localConfig = await loadConfigFromDir(dir);
    const config = localConfig
      ? validateConfig(localConfig, rootConfig.packageManager)
      : rootConfig;

    packages.push({
      name,
      version,
      dir,
      packageJson: pkg,
      config,
    });
  }

  return topoSortPackages(packages);
}

/**
 * Extract workspace glob patterns from a root package.json. Supports both the
 * array form (`"workspaces": [...]`) and yarn's object form
 * (`"workspaces": { "packages": [...] }`).
 */
function getWorkspacePatterns(rootPkg: Record<string, unknown>): string[] | undefined {
  const ws = rootPkg.workspaces;
  if (Array.isArray(ws)) return ws as string[];
  if (ws && typeof ws === 'object' && Array.isArray((ws as { packages?: unknown }).packages)) {
    return (ws as { packages: string[] }).packages;
  }
  return undefined;
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
