import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createAiProvider } from '../../../src/services/ai/factory.js';
import type { ResolvedConfig } from '../../../src/types/config.js';

describe('createAiProvider', () => {
  const origEnv = process.env.AWESOME_PUBLISH_AI_KEY;

  beforeEach(() => { process.env.AWESOME_PUBLISH_AI_KEY = 'test-key'; });
  afterEach(() => {
    if (origEnv) process.env.AWESOME_PUBLISH_AI_KEY = origEnv;
    else delete process.env.AWESOME_PUBLISH_AI_KEY;
  });

  it('creates Anthropic provider', () => {
    const config = {
      aiProvider: { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
    } as ResolvedConfig;
    const provider = createAiProvider(config);
    expect(provider).toBeDefined();
  });

  it('throws without aiProvider config', () => {
    const config = {} as ResolvedConfig;
    expect(() => createAiProvider(config)).toThrow(/not configured/);
  });

  it('throws without API key env var', () => {
    delete process.env.AWESOME_PUBLISH_AI_KEY;
    const config = {
      aiProvider: { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
    } as ResolvedConfig;
    expect(() => createAiProvider(config)).toThrow(/AWESOME_PUBLISH_AI_KEY/);
  });
});
