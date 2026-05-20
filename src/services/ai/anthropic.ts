import type { AiProvider } from './provider.js';

export class AnthropicProvider implements AiProvider {
  constructor(
    private readonly model: string,
    private readonly apiKey: string,
  ) {}

  async generateText(prompt: string): Promise<string> {
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const client = new Anthropic({ apiKey: this.apiKey });
    const response = await client.messages.create({
      model: this.model,
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }],
    });
    const textBlock = response.content.find(b => b.type === 'text');
    return textBlock?.text ?? '';
  }
}
