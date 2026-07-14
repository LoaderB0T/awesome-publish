import type { AiProvider } from './provider.js';
import { withRetry, isTransientError } from '../retry.js';

const REQUEST_TIMEOUT_MS = 60_000;
const MAX_TOKENS = 2048;

export class OpenAiCompatProvider implements AiProvider {
  constructor(
    private readonly model: string,
    private readonly apiKey: string,
    private readonly baseUrl: string
  ) {}

  async generateText(prompt: string): Promise<string> {
    return withRetry(
      async () => {
        const response = await fetch(`${this.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: this.model,
            max_tokens: MAX_TOKENS,
            messages: [{ role: 'user', content: prompt }],
          }),
          // Guard against a hung endpoint stalling the whole release.
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });

        if (!response.ok) {
          const text = await response.text();
          throw new Error(`AI API error ${response.status}: ${text}`);
        }

        // A proxy/gateway can return non-JSON (HTML error page) on a 200;
        // guard the parse so it surfaces as a clear error, not a raw SyntaxError.
        let data: { choices?: { message?: { content?: string } }[] };
        try {
          data = (await response.json()) as typeof data;
        } catch {
          throw new Error('AI API returned a non-JSON response');
        }
        return data.choices?.[0]?.message?.content ?? '';
      },
      { label: 'openai-compat generateText', shouldRetry: isTransientError }
    );
  }
}
