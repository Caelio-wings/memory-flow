export interface LLMInput {
  system: string;
  user: string;
  maxTokens: number;
  temperature?: number;
}

export interface LLMOutput {
  text: string;
}

export interface LLMProvider {
  chat(input: LLMInput): Promise<LLMOutput>;
}
