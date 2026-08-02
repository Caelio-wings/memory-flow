import { describe, expect, it } from "vitest";
import { buildFactTimeContext, buildSourceTimeRange, normalizeFactTime } from "../../src/time/time-context.ts";

describe("time-context", () => {
  it("builds source time range with local dates", () => {
    const range = buildSourceTimeRange(
      [{ timestamp: "2026-08-02T10:00:00.000Z" }, { timestamp: "2026-08-02T12:00:00.000Z" }],
      { timeZone: "Asia/Shanghai" },
    );
    expect(range?.start).toBe("2026-08-02T10:00:00.000Z");
    expect(range?.localDates).toContain("2026-08-02");
  });

  it("validates full timestamps against summary signals", () => {
    const context = buildFactTimeContext({
      summary: "用户在 2026-08-02 14:30 讨论了记忆系统",
      source_time_range: { timezone: "Asia/Shanghai", localDates: ["2026-08-02"] },
    }, { timeZone: "Asia/Shanghai" });
    expect(normalizeFactTime("2026-08-02T14:30", context)).toBe("2026-08-02T14:30");
  });

  it("returns null when time is absent from summary signals", () => {
    const context = buildFactTimeContext({
      summary: "用户讨论了记忆系统",
      source_time_range: { timezone: "Asia/Shanghai", localDates: ["2026-08-02"] },
    }, { timeZone: "Asia/Shanghai" });
    expect(normalizeFactTime("14:30", context)).toBeNull();
  });

  it("returns null for date-less HH:MM (date combination happens in the LLM prompt)", () => {
    const context = buildFactTimeContext({
      summary: "用户在 14:30 讨论了记忆系统",
      source_time_range: { timezone: "Asia/Shanghai", localDates: ["2026-08-02"] },
    }, { timeZone: "Asia/Shanghai" });
    expect(normalizeFactTime("14:30", context)).toBeNull();
  });
});
