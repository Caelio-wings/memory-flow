import { describe, expect, it } from "vitest";
import { DAY_BOUNDARY_HOUR, createLogicalDayClock, getLogicalDay, shiftLogicalDate } from "../../src/time/logical-day.ts";

describe("logical-day", () => {
  it("treats 03:00 as the previous logical day", () => {
    const { logicalDate, rangeStart, rangeEnd } = getLogicalDay(new Date(2026, 7, 3, 3, 0));
    expect(logicalDate).toBe("2026-08-02");
    expect(rangeStart.getHours()).toBe(DAY_BOUNDARY_HOUR);
    expect(rangeEnd.getTime() - rangeStart.getTime()).toBe(24 * 3600 * 1000);
  });

  it("treats 04:00 as the start of the logical day", () => {
    expect(getLogicalDay(new Date(2026, 7, 3, 4, 0)).logicalDate).toBe("2026-08-03");
  });

  it("shifts dates arithmetically", () => {
    expect(shiftLogicalDate("2026-08-02", -1)).toBe("2026-08-01");
    expect(shiftLogicalDate("2026-08-02", 6)).toBe("2026-08-08");
  });

  it("clock can be injected for deterministic tests", () => {
    const clock = createLogicalDayClock(() => new Date(2026, 7, 5, 10, 0));
    expect(clock.getLogicalDay().logicalDate).toBe("2026-08-05");
    expect(clock.shiftLogicalDate("2026-08-05", 1)).toBe("2026-08-06");
  });
});
