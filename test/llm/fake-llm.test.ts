import { describe, expect, it } from "vitest";
import { FakeLLM } from "../../src/llm/fake-llm.ts";
import type { LLMInput } from "../../src/llm/types.ts";

const rollingInput: LLMInput = {
  system: "### Key Facts 与 ### Timeline",
  user: "## 新对话\n\n[2026-08-02 10:00] 用户：我喜欢极简风格\n[2026-08-02 10:05] 助手：已记录",
  maxTokens: 300,
};

describe("FakeLLM", () => {
  it("produces contract-shaped rolling summaries", async () => {
    const fake = new FakeLLM();
    const { text } = await fake.chat(rollingInput);
    expect(text).toMatch(/### Key Facts/);
    expect(text).toMatch(/### Timeline/);
    expect(text).toContain("极简风格");
  });

  it("extracts facts as JSON array", async () => {
    const fake = new FakeLLM();
    const { text } = await fake.chat({
      system: "你是记忆拆分器",
      user: "## 当前摘要\n\n用户喜欢极简风格",
      maxTokens: 1024,
    });
    const facts = JSON.parse(text);
    expect(Array.isArray(facts)).toBe(true);
    expect(facts[0].fact).toContain("极简风格");
    expect(typeof facts[0].tags).toBe("object");
  });

  it("allows handler override for deterministic tests", async () => {
    const fake = new FakeLLM({
      compileToday: () => "- 用户讨论了记忆系统",
    });
    const { text } = await fake.chat({
      system: "今日草稿",
      user: "anything",
      maxTokens: 200,
    });
    expect(text).toBe("- 用户讨论了记忆系统");
  });
});
