import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SessionSummaryManager } from "../../src/summary/session-summary.ts";
import { FakeLLM } from "../../src/llm/fake-llm.ts";
import { FactStore } from "../../src/deep-memory/fact-store.ts";
import { createMemoryTicker } from "../../src/ticker/memory-ticker.ts";
import { createMemorySearch } from "../../src/deep-memory/memory-search.ts";
import { createLogicalDayClock } from "../../src/time/logical-day.ts";
import conversations from "../../examples/conversations.json" with { type: "json" };

describe("e2e demo pipeline", () => {
  let dir: string;
  let memoryDir: string;
  let summaryManager: SessionSummaryManager;
  let factStore: FactStore;
  const fake = new FakeLLM();
  const clock = createLogicalDayClock(() => new Date(2026, 7, 5, 10, 0));

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "memory-flow-e2e-"));
    memoryDir = path.join(dir, "memory");
    summaryManager = new SessionSummaryManager(path.join(memoryDir, "summaries"));
    factStore = new FactStore(path.join(dir, "facts.db"));
  });

  afterEach(() => {
    factStore.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("feeds sessions, advances days, and searches memories", async () => {
    const ticker = createMemoryTicker({
      summaryManager,
      factStore,
      getLLM: () => fake,
      memoryDir,
      todayMdPath: path.join(memoryDir, "today.md"),
      weekMdPath: path.join(memoryDir, "week.md"),
      longtermMdPath: path.join(memoryDir, "longterm.md"),
      factsMdPath: path.join(memoryDir, "facts.md"),
      memoryMdPath: path.join(memoryDir, "memory.md"),
      clock,
      timeZone: "Asia/Shanghai",
      locale: "zh-CN",
      getSessionMessages: (p) => {
        const id = path.basename(p).replace(/\.jsonl$/, "");
        return conversations.sessions.find((s) => s.id === id)?.messages || [];
      },
    });

    for (const session of conversations.sessions) {
      await ticker.notifySessionEnd(path.join(dir, `${session.id}.jsonl`));
    }
    await ticker.triggerDaily();

    expect(summaryManager.getAllSummaries().length).toBe(3);
    const memoryMd = fs.readFileSync(path.join(memoryDir, "memory.md"), "utf-8");
    expect(memoryMd).toContain("## 重要事实");
    expect(memoryMd).toContain("## 今天");
    expect(factStore.size).toBeGreaterThan(0);

    const search = createMemorySearch(factStore);
    const tagHits = await search({ tags: ["user-profile"] });
    expect(tagHits.results.length).toBeGreaterThan(0);
    const textHits = await search({ query: "记忆系统" });
    expect(textHits.results.length).toBeGreaterThan(0);
    ticker.stop();
  });
});
