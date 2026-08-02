import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { FactStore } from "../../src/deep-memory/fact-store.ts";

describe("FactStore", () => {
  let dir: string;
  let store: FactStore;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "memory-flow-facts-"));
    store = new FactStore(path.join(dir, "facts.db"));
    store.addBatch([
      { fact: "用户喜欢极简风格", tags: ["user-profile", "极简"], time: "2026-08-02T10:00", session_id: "s1" },
      { fact: "用户最近在关注记忆系统", tags: ["记忆系统", "近况"], time: "2026-08-03T09:00", session_id: "s1" },
      { fact: "用户是软件工程师", tags: ["user-profile", "职业"], time: "2026-08-01T08:00", session_id: "s2" },
    ]);
  });

  afterEach(() => {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("finds facts by tag", () => {
    const hits = store.searchByTags(["user-profile"], undefined, 10);
    expect(hits.length).toBeGreaterThanOrEqual(2);
    expect(hits[0].matchCount).toBeGreaterThan(0);
  });

  it("finds Chinese facts by full-text search", () => {
    const hits = store.searchFullText("极简", 10);
    expect(hits.some((h) => h.fact.includes("极简"))).toBe(true);
  });

  it("falls back to LIKE for CJK queries FTS cannot parse", () => {
    const hits = store.searchFullText("记忆系统", 10);
    expect(hits.length).toBeGreaterThan(0);
  });

  it("replaces facts by session", () => {
    store.replaceBySession("s1", [{ fact: "用户改关注视频剪辑", tags: ["近况"], time: null, session_id: "s1" }]);
    const s1 = store.getBySession("s1");
    expect(s1.length).toBe(1);
    expect(s1[0].fact).toContain("视频剪辑");
  });

  it("deletes facts by session", () => {
    store.deleteBySession("s1");
    expect(store.getBySession("s1")).toEqual([]);
  });
});
