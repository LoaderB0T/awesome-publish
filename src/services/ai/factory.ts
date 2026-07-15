import type { AiProvider } from './provider.js';
import type { ResolvedConfig } from '../../types/config.js';
import { AnthropicProvider } from './anthropic.js';
import { OpenAiCompatProvider } from './openai-compat.js';

export function createAiProvider(config: ResolvedConfig): AiProvider {
  if (!config.aiProvider) {
    throw new Error('AI provider not configured');
  }

  const apiKey = process.env.AWESOME_PUBLISH_AI_KEY;
  if (!apiKey) {
    throw new Error('AWESOME_PUBLISH_AI_KEY environment variable is required');
  }

  switch (config.aiProvider.provider) {
    case 'anthropic':
      return new AnthropicProvider(config.aiProvider.model, apiKey);
    case 'openai-compatible': {
      const baseUrl = config.aiProvider.baseUrl;
      if (!baseUrl) {
        throw new Error('baseUrl is required for openai-compatible provider');
      }
      // The API key is sent as a Bearer header — refuse plaintext http to a
      // non-localhost host so the key can't leak over the wire.
      if (baseUrl.startsWith('http://') && !/^http:\/\/(localhost|127\.0\.0\.1)/.test(baseUrl)) {
        throw new Error('aiProvider.baseUrl must use https (http is only allowed for localhost)');
      }
      return new OpenAiCompatProvider(config.aiProvider.model, apiKey, baseUrl);
    }
  }
}
