let debugEnabled = false;

export function setDebug(enabled: boolean): void {
  debugEnabled = enabled;
}

export function isDebug(): boolean {
  return debugEnabled;
}

export function debug(label: string, ...args: unknown[]): void {
  if (!debugEnabled) return;
  const timestamp = new Date().toISOString().slice(11, 23);
  const formatted = args
    .map(a => {
      if (a instanceof Map) return JSON.stringify(Object.fromEntries(a), null, 2);
      if (typeof a === 'object' && a !== null) return JSON.stringify(a, null, 2);
      return String(a);
    })
    .join(' ');
  console.error(`\x1b[90m[${timestamp}] [DEBUG] ${label}:\x1b[0m ${formatted}`);
}
