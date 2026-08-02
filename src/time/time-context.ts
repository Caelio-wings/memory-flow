const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const FACT_TIME_RE = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/;
const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

export function resolveMemoryTimeZone(value?: string): string {
  const fallback = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const candidate = typeof value === "string" && value.trim() ? value.trim() : fallback;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: candidate }).format(new Date());
    return candidate;
  } catch {
    return fallback;
  }
}

export function getZonedDateTimeParts(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: resolveMemoryTimeZone(timeZone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((p) => [p.type, p.value]));
  const hour = parts.hour === "24" ? "00" : parts.hour;
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${hour}:${parts.minute}` };
}

export function formatZonedDateTime(date: Date, timeZone: string): string {
  const parts = getZonedDateTimeParts(date, timeZone);
  return `${parts.date} ${parts.time}`;
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort();
}

export function buildSourceTimeRange(messages: Array<{ timestamp?: string }>, opts: { timeZone?: string } = {}) {
  const timeZone = resolveMemoryTimeZone(opts.timeZone);
  const dates = (Array.isArray(messages) ? messages : [])
    .map((m) => {
      const d = m?.timestamp ? new Date(m.timestamp) : null;
      return d && !Number.isNaN(d.getTime()) ? d : null;
    })
    .filter((d): d is Date => d !== null)
    .sort((a, b) => a.getTime() - b.getTime());
  if (dates.length === 0) return null;
  const start = dates[0];
  const end = dates[dates.length - 1];
  const localDates = new Set<string>();
  for (let t = start.getTime(); t <= end.getTime(); t += SIX_HOURS_MS) {
    localDates.add(getZonedDateTimeParts(new Date(t), timeZone).date);
  }
  localDates.add(getZonedDateTimeParts(end, timeZone).date);
  return {
    start: start.toISOString(),
    end: end.toISOString(),
    timezone: timeZone,
    localDates: uniqueSorted([...localDates]),
  };
}

export function extractSummaryTimeSignals(summary: string) {
  const text = typeof summary === "string" ? summary : "";
  const dateTimes = new Set<string>();
  const dates = new Set<string>();
  const times = new Set<string>();
  for (const m of text.matchAll(/\b(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})\b/g)) {
    const h = Number(m[2]);
    const min = Number(m[3]);
    if (!(h >= 0 && h <= 23 && min >= 0 && min <= 59)) continue;
    dates.add(m[1]);
    times.add(`${m[2]}:${m[3]}`);
    dateTimes.add(`${m[1]}T${m[2]}:${m[3]}`);
  }
  for (const m of text.matchAll(/\b(\d{4}-\d{2}-\d{2})\b/g)) dates.add(m[1]);
  for (const m of text.matchAll(/(^|[^\d])(\d{2}):(\d{2})(?!\d)/g)) {
    const h = Number(m[2]);
    const min = Number(m[3]);
    if (!(h >= 0 && h <= 23 && min >= 0 && min <= 59)) continue;
    times.add(`${m[2]}:${m[3]}`);
  }
  return {
    dateTimes: uniqueSorted([...dateTimes]),
    dates: uniqueSorted([...dates]),
    times: uniqueSorted([...times]),
  };
}

export function buildFactTimeContext(summaryRecord: any, opts: { timeZone?: string } = {}) {
  const raw = summaryRecord?.source_time_range;
  const timeZone = resolveMemoryTimeZone(raw?.timezone || opts.timeZone);
  const localDates = Array.isArray(raw?.localDates)
    ? raw.localDates.filter((d: string) => DATE_RE.test(String(d)))
    : [];
  const start = raw?.start ? new Date(raw.start) : null;
  const end = raw?.end ? new Date(raw.end) : null;
  const sourceRange = {
    start: start && !Number.isNaN(start.getTime()) ? start.toISOString() : null,
    end: end && !Number.isNaN(end.getTime()) ? end.toISOString() : null,
    timezone: timeZone,
    localDates,
  };
  const summarySignals = extractSummaryTimeSignals(summaryRecord?.summary);
  return {
    timezone: timeZone,
    sourceRange,
    localDates,
    singleSourceDate: localDates.length === 1 ? localDates[0] : null,
    spansMultipleSourceDates: localDates.length > 1,
    summaryDates: summarySignals.dates,
    summaryDateTimes: summarySignals.dateTimes,
    summaryTimes: summarySignals.times,
  };
}

export function normalizeFactTime(value: string | null | undefined, context: any = {}): string | null {
  if (value == null || value === "") return null;
  const match = String(value).trim().match(FACT_TIME_RE);
  if (!match) return null;
  const date = match[1];
  const time = `${match[2]}:${match[3]}`;
  const h = Number(match[2]);
  const min = Number(match[3]);
  if (!(h >= 0 && h <= 23 && min >= 0 && min <= 59)) return null;
  const summaryTimes = new Set(context.summaryTimes || []);
  const summaryDates = new Set(context.summaryDates || []);
  const summaryDateTimes = new Set(context.summaryDateTimes || []);
  const localDates = Array.isArray(context.localDates) ? context.localDates : [];
  if (summaryTimes.size === 0 || !summaryTimes.has(time)) return null;
  const candidate = `${date}T${time}`;
  if (summaryDateTimes.has(candidate)) return candidate;
  if (summaryDates.has(date) && (localDates.length === 0 || localDates.includes(date))) return candidate;
  if (localDates.includes(date) && !context.spansMultipleSourceDates) return candidate;
  if (context.singleSourceDate) return `${context.singleSourceDate}T${time}`;
  return null;
}
