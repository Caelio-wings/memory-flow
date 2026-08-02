import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { FactStore } from "../../src/deep-memory/fact-store.ts";
import { createMemorySearch } from "../../src/deep-memory/memory-search.ts";

describe("createMemorySearch", () => {
  let dir: string;
  let store: FactStore;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-memory-search-"));
    store = new FactStore(path.join(dir, "facts.db"));
    store.addBatch([
      { fact: "用户喜欢极简风格", tags: ["user-profile", "极简"], time: "2026-08-02T10:00", session_id: "s1" },
      { fact: "用户最近在关注记忆系统", tags: ["记忆系统", "近况"], time: "2026-08-03T09:00", session_id: "s1" },
    ]);
  });

  afterEach(() => {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("prioritizes tag hits", async () => {
    const search = createMemorySearch(store);
    const { results } = await search({ tags: ["user-profile"] });
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].source).toBe("tag");
  });

  it("falls back to full-text when tag hits are insufficient", async () => {
    const search = createMemorySearch(store);
    const { results } = await search({ query: "极简" });
    expect(results.some((r) => r.fact.includes("极简"))).toBe(true);
  });

  it("applies date filters", async () => {
    const search = createMemorySearch(store);
    const { results } = await search({ query: "用户", date_from: "2026-08-03", date_to: "2026-08-03" });
    expect(results.every((r) => (r.time ?? "") >= "2026-08-03" && (r.time ?? "") <= "2026-08-03T23:59")).toBe(true);
  });

  it("returns empty text when nothing matches", async () => {
    const search = createMemorySearch(store);
    const { results, text } = await search({ query: "不存在的关键词xyz" });
    expect(results.length).toBe(0);
    expect(text).toContain("没有");
  });
});
