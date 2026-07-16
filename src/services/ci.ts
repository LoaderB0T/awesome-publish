/**
 * True when running in a CI / non-interactive environment. `explicit` is the
 * command's `--ci` flag; `CI` and `GITHUB_ACTIONS` are the standard env signals
 * (most CI providers set `CI=true`).
 */
export function isCiEnv(explicit?: boolean): boolean {
  return !!explicit || !!process.env.CI || !!process.env.GITHUB_ACTIONS;
}
