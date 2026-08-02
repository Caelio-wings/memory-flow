import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SessionSummaryManager } from "../../src/summary/session-summary.ts";
import { FakeLLM } from "../../src/llm/fake-llm.ts";
import { FactStore } from "../../src/deep-memory/fact-store.ts";
import { processDirtySessions } from "../../src/deep-memory/deep-memory.ts";

describe("processDirtySessions", () => {
  let dir: string;
  let manager: SessionSummaryManager;
  let factStore: FactStore;
  const fake = new FakeLLM();

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-memory-deep-"));
    manager = new SessionSummaryManager(path.join(dir, "summaries"));
    factStore = new FactStore(path.join(dir, "facts.db"));
  });

  afterEach(() => {
    factStore.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("extracts facts from dirty sessions and marks processed", async () => {
    await manager.rollingSummary("s1", [
      { role: "user", content: "用户喜欢极简风格", timestamp: "2026-08-02T10:00:00+08:00" },
    ], fake, { locale: "zh-CN", timeZone: "Asia/Shanghai" });
    const { processed, factsAdded } = await processDirtySessions(manager, factStore, fake, {
      timeZone: "Asia/Shanghai",
    });
    expect(processed).toBe(1);
    expect(factsAdded).toBeGreaterThan(0);
    expect(manager.getDirtySessions().length).toBe(0);
    expect(factStore.size).toBeGreaterThan(0);
  });

  it("replaces session facts when factReplacementRequired", async () => {
    await manager.rollingSummary("s1", [
      { role: "user", content: "用户喜欢极简风格", timestamp: "2026-08-02T10:00:00+08:00" },
    ], fake, { locale: "zh-CN", timeZone: "Asia/Shanghai" });
    await processDirtySessions(manager, factStore, fake, { timeZone: "Asia/Shanghai" });
    await manager.replaceSessionSummary("s1", [
      { role: "user", content: "用户改关注视频剪辑", timestamp: "2026-08-03T09:00:00+08:00" },
    ], fake, { locale: "zh-CN", timeZone: "Asia/Shanghai" });
    await processDirtySessions(manager, factStore, fake, { timeZone: "Asia/Shanghai" });
    const facts = factStore.getBySession("s1");
    expect(facts.some((f) => f.fact.includes("视频剪辑"))).toBe(true);
    expect(facts.some((f) => f.fact.includes("极简风格"))).toBe(false);
  });
});
