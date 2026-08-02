import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SessionSummaryManager } from "../../src/summary/session-summary.ts";
import { FakeLLM } from "../../src/llm/fake-llm.ts";
import { FactStore } from "../../src/deep-memory/fact-store.ts";
import { createMemoryTicker, type MemoryTickerOptions } from "../../src/ticker/memory-ticker.ts";
import { createLogicalDayClock } from "../../src/time/logical-day.ts";

describe("createMemoryTicker", () => {
  let dir: string;
  let memoryDir: string;
  let summaryManager: SessionSummaryManager;
  let factStore: FactStore;
  let sessionPath: string;
  let messagesByPath: Record<string, Array<Record<string, any>>>;
  const fake = new FakeLLM();
  const clock = createLogicalDayClock(() => new Date(2026, 7, 5, 10, 0));

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "memory-flow-ticker-"));
    memoryDir = path.join(dir, "memory");
    summaryManager = new SessionSummaryManager(path.join(memoryDir, "summaries"));
    factStore = new FactStore(path.join(dir, "facts.db"));
    sessionPath = path.join(dir, "s1.jsonl");
    messagesByPath = {
      [sessionPath]: [
        { role: "user", content: "用户喜欢极简风格", timestamp: "2026-08-04T10:00:00+08:00" },
      ],
    };
  });

  afterEach(() => {
    factStore.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function makeTicker(overrides: Partial<MemoryTickerOptions> = {}) {
    return createMemoryTicker({
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
      getSessionMessages: (p) => messagesByPath[p] || [],
      ...overrides,
    });
  }

  it("triggers a rolling summary at the 10th turn", async () => {
    const ticker = makeTicker();
    for (let i = 0; i < 10; i++) await ticker.notifyTurn(sessionPath);
    expect(summaryManager.getSummary("s1")?.summary).toMatch(/### 重要事实/);
    ticker.stop();
  });

  it("runs the full daily pipeline and produces memory.md", async () => {
    const ticker = makeTicker();
    await ticker.notifySessionEnd(sessionPath);
    await ticker.triggerDaily();
    expect(fs.existsSync(path.join(memoryDir, "daily", "2026-08-04.md"))).toBe(true);
    expect(fs.readFileSync(path.join(memoryDir, "facts.md"), "utf-8")).toContain("极简风格");
    expect(fs.readFileSync(path.join(memoryDir, "memory.md"), "utf-8")).toContain("## 重要事实");
    expect(factStore.size).toBeGreaterThan(0);
    ticker.stop();
  });

  it("daily job is idempotent across repeated triggers", async () => {
    const ticker = makeTicker();
    await ticker.notifySessionEnd(sessionPath);
    await ticker.triggerDaily();
    const firstMemory = fs.readFileSync(path.join(memoryDir, "memory.md"), "utf-8");
    await ticker.triggerDaily();
    expect(fs.readFileSync(path.join(memoryDir, "memory.md"), "utf-8")).toBe(firstMemory);
    ticker.stop();
  });
});
