import { describe, expect, it } from "vitest";
import { scrubPII } from "../../src/util/pii-guard.ts";

describe("scrubPII", () => {
  it("redacts phone numbers", () => {
    const { cleaned, detected } = scrubPII("联系方式 13800138000 请查收");
    expect(cleaned).toContain("[phone]");
    expect(cleaned).not.toContain("13800138000");
    expect(detected).toContain("phone");
  });

  it("redacts emails", () => {
    const { cleaned, detected } = scrubPII("邮箱 a.b+tag@example.com 已注册");
    expect(cleaned).toContain("[email]");
    expect(cleaned).not.toContain("example.com");
    expect(detected).toContain("email");
  });

  it("redacts 18-digit id cards", () => {
    const { cleaned, detected } = scrubPII("身份证 110101199001011234");
    expect(cleaned).toContain("[id-card]");
    expect(detected).toContain("id-card");
  });

  it("returns empty detected list when clean", () => {
    const { cleaned, detected } = scrubPII("今天天气不错");
    expect(cleaned).toBe("今天天气不错");
    expect(detected).toEqual([]);
  });
});
