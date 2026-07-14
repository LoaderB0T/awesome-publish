import { debug } from './debug.js';

export interface RetryOptions {
  /** Max attempts (including the first). Default 3. */
  retries?: number;
  /** Base delay in ms for exponential backoff. Default 500. */
  baseDelayMs?: number;
  /** Label for debug logging. */
  label?: string;
  /** Return true if the error is worth retrying. Default: retry everything. */
  shouldRetry?: (error: unknown) => boolean;
}

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/**
 * Run an async operation with exponential-backoff retries. Only retries when
 * `shouldRetry` returns true (default: always). The final failure is rethrown.
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const { retries = 3, baseDelayMs = 500, label = 'retry', shouldRetry = () => true } = options;

  let lastError: unknown;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt >= retries || !shouldRetry(error)) throw error;
      const delay = baseDelayMs * 2 ** (attempt - 1);
      debug('retry', `${label}: attempt ${attempt} failed, retrying in ${delay}ms`);
      await sleep(delay);
    }
  }
  throw lastError;
}

/** True for transient network / server errors worth retrying (not 4xx client errors). */
export function isTransientError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  // Retry on network-level failures and 5xx / 429 responses; never on 4xx (incl. 401/403/404/409).
  if (/\b(429|5\d\d)\b/.test(msg)) return true;
  if (/\b4\d\d\b/.test(msg)) return false;
  return /ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|socket hang up|network|timed out|aborted|fetch failed/i.test(
    msg
  );
}
