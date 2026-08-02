import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SessionSummaryManager, sessionSummaryRevision } from "../../src/summary/session-summary.ts";
import { FakeLLM } from "../../src/llm/fake-llm.ts";

describe("SessionSummaryManager", () => {
  let dir: string;
  let manager: SessionSummaryManager;
  const fake = new FakeLLM();

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "memory-flow-summary-"));
    manager = new SessionSummaryManager(path.join(dir, "summaries"));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("creates a contract-shaped rolling summary and persists it", async () => {
    const result = await manager.rollingSummary(
      "s1",
      [
        { role: "user", content: "我喜欢极简风格", timestamp: "2026-08-02T10:00:00.000Z" },
        { role: "assistant", content: "好的，已记录", timestamp: "2026-08-02T10:01:00.000Z" },
      ],
      fake,
      { locale: "zh-CN", timeZone: "Asia/Shanghai" },
    );
    expect(result.changed).toBe(true);
    expect(manager.getSummary("s1")?.summary).toMatch(/### 重要事实/);
    expect(manager.getSummary("s1")?.summary).toMatch(/### 事情经过/);
  });

  it("tracks dirty sessions via snapshot and marks processed", async () => {
    await manager.rollingSummary("s1", [
      { role: "user", content: "关注记忆系统", timestamp: "2026-08-02T10:00:00.000Z" },
    ], fake, { locale: "zh-CN" });
    expect(manager.getDirtySessions().some((s) => s.session_id === "s1")).toBe(true);
    const revision = sessionSummaryRevision(manager.getSummary("s1"));
    manager.markProcessedIfCurrent("s1", revision);
    expect(manager.getDirtySessions().some((s) => s.session_id === "s1")).toBe(false);
  });

  it("replaces session summary with factReplacementRequired", async () => {
    const result = await manager.replaceSessionSummary("s1", [
      { role: "user", content: "全新分支内容", timestamp: "2026-08-02T12:00:00.000Z" },
    ], fake, { locale: "zh-CN" });
    expect(result.data?.factReplacementRequired).toBe(true);
    expect(manager.getSummary("s1")?.factReplacementRequired).toBe(true);
  });

  it("invalidates a session", async () => {
    await manager.rollingSummary("s1", [
      { role: "user", content: "关注记忆系统", timestamp: "2026-08-02T10:00:00.000Z" },
    ], fake, { locale: "zh-CN" });
    expect(manager.invalidateSession("s1")).toBe(true);
    expect(manager.getSummary("s1")).toBeNull();
  });
});
