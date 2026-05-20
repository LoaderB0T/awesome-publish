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
    case 'openai-compatible':
      if (!config.aiProvider.baseUrl) {
        throw new Error('baseUrl is required for openai-compatible provider');
      }
      return new OpenAiCompatProvider(config.aiProvider.model, apiKey, config.aiProvider.baseUrl);
  }
}
