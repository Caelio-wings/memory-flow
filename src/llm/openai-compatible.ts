import type { LLMInput, LLMProvider } from "./types.ts";

export interface OpenAICompatibleOptions {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}

export class OpenAICompatibleProvider implements LLMProvider {
  constructor(private opts: OpenAICompatibleOptions = {}) {}

  async chat(input: LLMInput): Promise<{ text: string }> {
    const apiKey = this.opts.apiKey || process.env.LLM_API_KEY || "";
    const baseUrl = (this.opts.baseUrl || process.env.LLM_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
    const model = this.opts.model || process.env.LLM_MODEL || "gpt-4o-mini";
    if (!apiKey) throw new Error("LLM_API_KEY is required for OpenAICompatibleProvider");
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: input.system },
          { role: "user", content: input.user },
        ],
        temperature: input.temperature ?? 0.3,
        max_tokens: input.maxTokens,
      }),
    });
    if (!res.ok) {
      throw new Error(`LLM request failed: ${res.status} ${await res.text()}`);
    }
    const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
    const text = data?.choices?.[0]?.message?.content;
    if (typeof text !== "string") throw new Error("LLM response missing content");
    return { text };
  }
}
