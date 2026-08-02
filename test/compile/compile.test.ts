import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SessionSummaryManager } from "../../src/summary/session-summary.ts";
import { FakeLLM } from "../../src/llm/fake-llm.ts";
import type { LLMInput, LLMProvider } from "../../src/llm/types.ts";
import {
  assemble,
  assembleWeekFromDaily,
  compileDaily,
  compileEditableFacts,
  compileLongterm,
  compileToday,
  rollDailyWindow,
} from "../../src/compile/compile.ts";
import { getLogicalDay, shiftLogicalDate } from "../../src/time/logical-day.ts";

class CountingLLM implements LLMProvider {
  calls = 0;
  constructor(private inner: LLMProvider) {}
  async chat(input: LLMInput): Promise<{ text: string }> {
    this.calls += 1;
    return this.inner.chat(input);
  }
}

describe("compile pipeline", () => {
  let dir: string;
  let memoryDir: string;
  let summaryManager: SessionSummaryManager;
  let fake: FakeLLM;
  let today: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-memory-compile-"));
    memoryDir = path.join(dir, "memory");
    summaryManager = new SessionSummaryManager(path.join(memoryDir, "summaries"));
    fake = new FakeLLM();
    today = getLogicalDay().logicalDate;
  });

  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("assemble produces four sections", () => {
    fs.mkdirSync(memoryDir, { recursive: true });
    const memoryMd = path.join(memoryDir, "memory.md");
    assemble(
      path.join(memoryDir, "facts.md"),
      path.join(memoryDir, "today.md"),
      path.join(memoryDir, "week.md"),
      path.join(memoryDir, "longterm.md"),
      memoryMd,
      { locale: "zh-CN" },
    );
    const content = fs.readFileSync(memoryMd, "utf-8");
    expect(content).toContain("## 重要事实");
    expect(content).toContain("## 今天");
    expect(content).toContain("## 本周早些时候");
    expect(content).toContain("## 长期情况");
  });

  it("compileToday is watermark-incremental", async () => {
    fs.mkdirSync(memoryDir, { recursive: true });
    const todayMd = path.join(memoryDir, "today.md");
    const counting = new CountingLLM(fake);
    await summaryManager.rollingSummary(
      "s1",
      [{ role: "user", content: "用户讨论了记忆系统", timestamp: `${today}T10:00:00+08:00` }],
      fake,
      { locale: "zh-CN", timeZone: "Asia/Shanghai" },
    );
    await compileToday(summaryManager, todayMd, counting, { locale: "zh-CN", timeZone: "Asia/Shanghai" });
    expect(counting.calls).toBe(1);
    expect(fs.readFileSync(todayMd, "utf-8").length).toBeGreaterThan(0);
    await compileToday(summaryManager, todayMd, counting, { locale: "zh-CN", timeZone: "Asia/Shanghai" });
    expect(counting.calls).toBe(1);
  });

  it("compileDaily dedups by fingerprint", async () => {
    fs.mkdirSync(memoryDir, { recursive: true });
    const todayMd = path.join(memoryDir, "today.md");
    const dailyDir = path.join(memoryDir, "daily");
    await summaryManager.rollingSummary(
      "s1",
      [{ role: "user", content: "用户讨论了记忆系统", timestamp: `${today}T10:00:00+08:00` }],
      fake,
      { locale: "zh-CN", timeZone: "Asia/Shanghai" },
    );
    await compileToday(summaryManager, todayMd, fake, { locale: "zh-CN", timeZone: "Asia/Shanghai" });
    const counting = new CountingLLM(fake);
    await compileDaily(summaryManager, dailyDir, today, counting, { todayDraftPath: todayMd, locale: "zh-CN" });
    expect(counting.calls).toBe(1);
    expect(fs.readFileSync(path.join(dailyDir, `${today}.md`), "utf-8")).toContain(`## ${today}`);
    await compileDaily(summaryManager, dailyDir, today, counting, { todayDraftPath: todayMd, locale: "zh-CN" });
    expect(counting.calls).toBe(1);
  });

  it("compileLongterm skips unchanged input by fingerprint", async () => {
    fs.mkdirSync(memoryDir, { recursive: true });
    const longtermPath = path.join(memoryDir, "longterm.md");
    const counting = new CountingLLM(fake);
    await compileLongterm("用户喜欢极简风格", longtermPath, counting, { locale: "zh-CN" });
    expect(counting.calls).toBe(1);
    await compileLongterm("用户喜欢极简风格", longtermPath, counting, { locale: "zh-CN" });
    expect(counting.calls).toBe(1);
  });

  it("assembleWeekFromDaily joins daily files", () => {
    const dailyDir = path.join(memoryDir, "daily");
    fs.mkdirSync(dailyDir, { recursive: true });
    const d1 = shiftLogicalDate(today, -2);
    const d2 = shiftLogicalDate(today, -1);
    fs.writeFileSync(path.join(dailyDir, `${d1}.md`), `## ${d1}\n\n第一天\n`);
    fs.writeFileSync(path.join(dailyDir, `${d2}.md`), `## ${d2}\n\n第二天\n`);
    const weekPath = path.join(memoryDir, "week.md");
    assembleWeekFromDaily(dailyDir, weekPath);
    const content = fs.readFileSync(weekPath, "utf-8");
    expect(content).toContain(d1);
    expect(content).toContain(d2);
  });

  it("rollDailyWindow folds expired entries into longterm", async () => {
    fs.mkdirSync(path.join(memoryDir, "daily"), { recursive: true });
    const oldDate = shiftLogicalDate(today, -10);
    const dailyDir = path.join(memoryDir, "daily");
    const longtermPath = path.join(memoryDir, "longterm.md");
    fs.writeFileSync(path.join(dailyDir, `${oldDate}.md`), `## ${oldDate}\n\n用户讨论了记忆系统\n`);
    const { folded } = await rollDailyWindow(dailyDir, longtermPath, fake, { referenceDate: today });
    expect(folded).toContain(oldDate);
    expect(fs.existsSync(path.join(dailyDir, `${oldDate}.md`))).toBe(false);
    expect(fs.readFileSync(longtermPath, "utf-8").length).toBeGreaterThan(0);
  });

  it("compileEditableFacts writes facts.md and respects watermark", async () => {
    fs.mkdirSync(memoryDir, { recursive: true });
    const factsMd = path.join(memoryDir, "facts.md");
    const counting = new CountingLLM(fake);
    // 首次运行：空 facts.md + 现有摘要 → 直接编译
    await summaryManager.rollingSummary(
      "s1",
      [{ role: "user", content: "用户喜欢极简风格", timestamp: `${today}T10:00:00+08:00` }],
      fake,
      { locale: "zh-CN", timeZone: "Asia/Shanghai" },
    );
    await compileEditableFacts(summaryManager, factsMd, counting, { locale: "zh-CN" });
    expect(counting.calls).toBe(1);
    expect(fs.readFileSync(factsMd, "utf-8")).toContain("极简风格");
    // 新增摘要 → 增量编译
    await summaryManager.rollingSummary(
      "s2",
      [{ role: "user", content: "用户开始关注视频剪辑", timestamp: `${today}T14:00:00+08:00` }],
      fake,
      { locale: "zh-CN", timeZone: "Asia/Shanghai" },
    );
    await compileEditableFacts(summaryManager, factsMd, counting, { locale: "zh-CN" });
    expect(counting.calls).toBe(2);
    expect(fs.readFileSync(factsMd, "utf-8")).toContain("视频剪辑");
    // 无新摘要 → 不再调用 LLM
    await compileEditableFacts(summaryManager, factsMd, counting, { locale: "zh-CN" });
    expect(counting.calls).toBe(2);
  });
});
