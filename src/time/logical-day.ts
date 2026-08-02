export const DAY_BOUNDARY_HOUR = 4;

export interface LogicalDayResult {
  logicalDate: string;
  rangeStart: Date;
  rangeEnd: Date;
}

export interface MemoryClock {
  getLogicalDay(now?: Date): LogicalDayResult;
  shiftLogicalDate(dateString: string, days: number): string;
}

export function getLogicalDay(now: Date = new Date()): LogicalDayResult {
  const base = new Date(now);
  if (base.getHours() < DAY_BOUNDARY_HOUR) base.setDate(base.getDate() - 1);
  const yyyy = base.getFullYear();
  const mm = String(base.getMonth() + 1).padStart(2, "0");
  const dd = String(base.getDate()).padStart(2, "0");
  const logicalDate = `${yyyy}-${mm}-${dd}`;
  const rangeStart = new Date(base);
  rangeStart.setHours(DAY_BOUNDARY_HOUR, 0, 0, 0);
  const rangeEnd = new Date(rangeStart);
  rangeEnd.setDate(rangeEnd.getDate() + 1);
  return { logicalDate, rangeStart, rangeEnd };
}

export function shiftLogicalDate(dateString: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateString || ""));
  if (!match) return String(dateString || "");
  const shifted = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  shifted.setDate(shifted.getDate() + Number(days || 0));
  return `${shifted.getFullYear()}-${String(shifted.getMonth() + 1).padStart(2, "0")}-${String(shifted.getDate()).padStart(2, "0")}`;
}

export function createLogicalDayClock(now?: () => Date): MemoryClock {
  return {
    getLogicalDay: (d?: Date) => getLogicalDay(d ?? (now ? now() : new Date())),
    shiftLogicalDate,
  };
}
