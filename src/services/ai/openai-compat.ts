import type { AiProvider } from './provider.js';

export class OpenAiCompatProvider implements AiProvider {
  constructor(
    private readonly model: string,
    private readonly apiKey: string,
    private readonly baseUrl: string,
  ) {}

  async generateText(prompt: string): Promise<string> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`AI API error ${response.status}: ${text}`);
    }

    const data = await response.json() as { choices: { message: { content: string } }[] };
    return data.choices[0]?.message?.content ?? '';
  }
}
