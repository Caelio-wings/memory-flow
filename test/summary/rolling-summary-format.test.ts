import { describe, expect, it } from "vitest";
import {
  buildRollingSummaryFormatRequirements,
  extractFactSection,
  extractMarkdownSection,
  getFactSectionTitle,
  hasFactSectionHeading,
  isEmptyFactSection,
  validateRollingSummaryFormat,
} from "../../src/summary/rolling-summary-format.ts";

describe("rolling-summary-format", () => {
  it("prompt requirements contain the exact zh titles", () => {
    const zh = buildRollingSummaryFormatRequirements("zh-CN");
    expect(zh).toContain("### 重要事实");
    expect(zh).toContain("### 事情经过");
    const en = buildRollingSummaryFormatRequirements("en-US");
    expect(en).toContain("### Key Facts");
    expect(en).toContain("### Timeline");
  });

  it("validates a well-formed summary", () => {
    const text = "### 重要事实\n\n- 用户喜欢极简风格\n\n### 事情经过\n\n- 2026-08-02 10:00 讨论记忆系统";
    expect(validateRollingSummaryFormat(text).ok).toBe(true);
  });

  it("rejects a summary missing the timeline heading", () => {
    const result = validateRollingSummaryFormat("### 重要事实\n\n- 用户喜欢极简风格");
    expect(result.ok).toBe(false);
    expect(result.issues.join()).toContain("timeline");
  });

  it("rejects an empty facts body", () => {
    const text = "### 重要事实\n\n### 事情经过\n\n- 2026-08-02 10:00 讨论记忆系统";
    expect(validateRollingSummaryFormat(text).ok).toBe(false);
  });

  it("extracts the facts section", () => {
    const text = "### 重要事实\n\n- 用户喜欢极简风格\n\n### 事情经过\n\n- 2026-08-02 10:00 讨论记忆系统";
    expect(extractFactSection(text)).toContain("极简风格");
    expect(extractMarkdownSection(text, ["事情经过"])).toContain("讨论记忆系统");
    expect(hasFactSectionHeading(text)).toBe(true);
    expect(isEmptyFactSection("- 无")).toBe(true);
    expect(getFactSectionTitle("en-US")).toBe("Key Facts");
  });
});
