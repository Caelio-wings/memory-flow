import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { LLMProvider } from "../llm/types.ts";
import { atomicWriteSync, safeReadFile } from "../util/safe-fs.ts";
import { normalizeCompiledLLMResult, normalizeCompiledSectionBody, stripThinkTagBlocks } from "./compiled-memory-state.ts";
import {
  TIMELINE_SECTION_TITLES,
  extractFactSection,
  extractMarkdownSection,
  hasFactSectionHeading,
  isEmptyFactSection,
} from "../summary/rolling-summary-format.ts";
import { getLogicalDay, shiftLogicalDate, type MemoryClock } from "../time/logical-day.ts";
import {
  buildCompileDailyPrompt,
  buildCompileEditableFactsPrompt,
  buildCompileLongtermPrompt,
  buildCompileTodayPrompt,
} from "./prompts/compile.ts";
import type { SessionSummaryManager } from "../summary/session-summary.ts";

export const TODAY_STATE_FILE = "today-state.json";
export const EDITABLE_FACTS_STATE_FILE = "editable-facts-state.json";
export const DAILY_WINDOW_RETENTION_DAYS = 6;
export const WEEK_ASSEMBLY_MAX_CHARS = 1200;

const DAILY_FILE_RE = /^(\d{4}-\d{2}-\d{2})\.md$/;
const SUMMARY_EVENT_DATE_TIME_RE = /\b(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})\b/;
const SUMMARY_EVENT_DATE_RE = /\b(\d{4}-\d{2}-\d{2})\b/;
const COMPILED_WEEK_DATE_HEADING_RE = /^#{2,3} (\d{4}-\d{2}-\d{2})$/;

// ---------- timeline event extraction ----------

function splitTimelineListItems(text: string): string[] {
  const items: string[] = [];
  let current = "";
  for (const line of String(text || "").split(/\r?\n/)) {
    const match = line.match(/^\s*[-*+]\s+(.+)$/);
    if (match) {
      if (current.trim()) items.push(current.trim());
      current = match[1].trim();
      continue;
    }
    const trimmed = line.trim();
    if (trimmed && current) current += `\n${trimmed}`;
  }
  if (current.trim()) items.push(current.trim());
  return items;
}

function fallbackSummaryLogicalDate(summaryRecord: any): string | null {
  const localDates = summaryRecord?.source_time_range?.localDates;
  if (Array.isArray(localDates) && localDates.length === 1) return localDates[0];
  const d = summaryRecord?.updated_at || summaryRecord?.created_at;
  if (d && !Number.isNaN(Date.parse(d))) return getLogicalDay(new Date(d)).logicalDate;
  return null;
}

function extractTimelineEvents(summaryRecord: any): Array<Record<string, any>> {
  const timeline = extractMarkdownSection(summaryRecord?.summary || "", TIMELINE_SECTION_TITLES);
  const items = splitTimelineListItems(timeline);
  const events: Array<Record<string, any>> = [];
  const sessionId = summaryRecord?.session_id || "";
  const updatedAt = summaryRecord?.updated_at || summaryRecord?.created_at || "";
  items.forEach((item, index) => {
    const body = item.trim();
    if (!body || body === "无" || body === "None") return;
    let date: string | null = null;
    let time: string | null = null;
    const dt = item.match(SUMMARY_EVENT_DATE_TIME_RE);
    if (dt) {
      date = dt[1];
      time = `${dt[2]}:${dt[3]}`;
    } else {
      const d = item.match(SUMMARY_EVENT_DATE_RE);
      date = d ? d[1] : fallbackSummaryLogicalDate(summaryRecord);
    }
    if (!date) return;
    const timeLabel = time ? `${date} ${time}` : date;
    events.push({
      sessionId,
      summaryUpdatedAt: updatedAt,
      index,
      logicalDate: date,
      timeLabel,
      body,
      key: `${sessionId}:${updatedAt}:${index}:${crypto.createHash("sha1").update(item).digest("hex").slice(0, 12)}`,
    });
  });
  return events;
}

function fallbackSummaryAsEvent(summaryRecord: any, logicalDate: string): Record<string, any> | null {
  const ownerDate = fallbackSummaryLogicalDate(summaryRecord);
  if (ownerDate !== logicalDate) return null;
  const body = normalizeCompiledSectionBody(summaryRecord?.summary || "");
  if (!body) return null;
  return {
    sessionId: summaryRecord?.session_id || "",
    summaryUpdatedAt: summaryRecord?.updated_at || summaryRecord?.created_at || "",
    index: 0,
    logicalDate,
    timeLabel: logicalDate,
    body,
    key: `${summaryRecord?.session_id || ""}:${summaryRecord?.updated_at || ""}:fallback:${crypto.createHash("sha1").update(body).digest("hex").slice(0, 12)}`,
  };
}

function timelineEventsForLogicalDate(
  summaries: any[],
  logicalDate: string,
  includeFallback = false,
): Array<Record<string, any>> {
  const events: Array<Record<string, any>> = [];
  const summariesWithEvents = new Set<string>();
  for (const summary of summaries || []) {
    const extracted = extractTimelineEvents(summary);
    if (extracted.length > 0) summariesWithEvents.add(summary?.session_id || summary);
    events.push(...extracted.filter((e) => e.logicalDate === logicalDate));
  }
  if (includeFallback) {
    for (const summary of summaries || []) {
      const key = summary?.session_id || summary;
      if (summariesWithEvents.has(key)) continue;
      const fallback = fallbackSummaryAsEvent(summary, logicalDate);
      if (fallback) events.push(fallback);
    }
  }
  return events.sort((a, b) => String(a.timeLabel).localeCompare(String(b.timeLabel)));
}

function formatTimelineEventsForCompile(events: Array<Record<string, any>>, opts: { since?: string | null; includeRevisionMarker?: boolean } = {}): string {
  return (events || []).map((event) => {
    const isRevision = opts.includeRevisionMarker && opts.since && !isAfterIso(event.summaryUpdatedAt, opts.since);
    const marker = isRevision ? "（取代先前相关记述）\n" : "";
    return `${marker}- ${event.timeLabel} ${event.body}`.trim();
  }).join("\n");
}

// ---------- today state (watermark) ----------

function todayStatePath(memoryDir: string): string {
  return path.join(memoryDir, TODAY_STATE_FILE);
}

function readTodayState(statePath: string): { logicalDate: string; lastCompiledSummaryUpdatedAt: string | null } | null {
  try {
    const raw = JSON.parse(fs.readFileSync(statePath, "utf-8"));
    const logicalDate = typeof raw?.logicalDate === "string" ? raw.logicalDate : "";
    if (!logicalDate) return null;
    const watermark = raw?.lastCompiledSummaryUpdatedAt;
    return {
      logicalDate,
      lastCompiledSummaryUpdatedAt: watermark && !Number.isNaN(Date.parse(watermark)) ? watermark : null,
    };
  } catch {
    return null;
  }
}

function writeTodayState(statePath: string, logicalDate: string, lastCompiledSummaryUpdatedAt: string): void {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  atomicWriteSync(statePath, JSON.stringify({
    schemaVersion: 1,
    logicalDate,
    lastCompiledSummaryUpdatedAt: lastCompiledSummaryUpdatedAt || null,
    updatedAt: new Date().toISOString(),
  }, null, 2) + "\n");
}

// ---------- summaries helpers ----------

function getCandidateSummaries(summaryManager: SessionSummaryManager, since: string | null): any[] {
  return summaryManager.getAllSummaries()
    .filter((s) => s?.summary)
    .filter((s) => !since || isAfterIso(s.updated_at || s.created_at, since));
}

function latestSummaryUpdate(summaries: any[]): string | null {
  const values = (summaries || [])
    .map((s) => s?.updated_at || s?.created_at || "")
    .filter((v) => v && !Number.isNaN(Date.parse(v)))
    .sort();
  return values.at(-1) || null;
}

function latestIso(a?: string | null, b?: string | null): string | null {
  const values = [a, b].filter((v): v is string => !!v && !Number.isNaN(Date.parse(v))).sort();
  return values.at(-1) || null;
}

function isAfterIso(value?: string, since?: string | null): boolean {
  if (!since) return true;
  if (!value || Number.isNaN(Date.parse(value))) return false;
  return Date.parse(value) > Date.parse(since);
}

function computeFingerprint(keys: string[]): string {
  return crypto.createHash("md5").update(keys.join("\n")).digest("hex");
}

function removeIfExists(filePath: string): void {
  try {
    fs.unlinkSync(filePath);
  } catch (err: any) {
    if (err?.code !== "ENOENT") throw err;
  }
}

// ---------- compileToday ----------

export async function compileToday(
  summaryManager: SessionSummaryManager,
  outputPath: string,
  llm: LLMProvider,
  opts: { since?: string; statePath?: string; locale?: string; timeZone?: string; clock?: MemoryClock } = {},
): Promise<"compiled" | "skipped"> {
  const memoryDir = path.dirname(outputPath);
  fs.mkdirSync(memoryDir, { recursive: true });
  const statePath = opts.statePath || todayStatePath(memoryDir);
  const logicalDate = opts.clock ? opts.clock.getLogicalDay().logicalDate : getLogicalDay().logicalDate;
  let state = readTodayState(statePath);
  if (state && state.logicalDate !== logicalDate) {
    atomicWriteSync(outputPath, "");
    state = null;
  }
  const watermark = latestIso(state?.lastCompiledSummaryUpdatedAt, opts.since || null);
  const sessions = getCandidateSummaries(summaryManager, watermark);
  if (sessions.length === 0) {
    if (!state) {
      const cur = safeReadFile(outputPath, "");
      if (cur.length > 0) atomicWriteSync(outputPath, "");
    }
    return "compiled";
  }
  const nextWatermark = latestSummaryUpdate(sessions);
  const events = timelineEventsForLogicalDate(sessions, logicalDate, true);
  if (events.length === 0) {
    if (!state) {
      const cur = safeReadFile(outputPath, "");
      if (cur.length > 0) atomicWriteSync(outputPath, "");
    }
    if (nextWatermark) writeTodayState(statePath, logicalDate, nextWatermark);
    return "compiled";
  }
  const previousDraft = normalizeCompiledSectionBody(safeReadFile(outputPath, ""));
  const delta = formatTimelineEventsForCompile(events, { since: watermark, includeRevisionMarker: true });
  const input = previousDraft
    ? `## 上一版今日草稿\n\n${previousDraft}\n\n## 新增或修订的时间线条目（delta）\n\n${delta}`
    : `## 新增或修订的时间线条目（delta）\n\n${delta}`;
  const { text } = await llm.chat({ system: buildCompileTodayPrompt(opts.locale), user: input, maxTokens: 450 });
  atomicWriteSync(outputPath, normalizeCompiledLLMResult(text) + "\n");
  if (nextWatermark) writeTodayState(statePath, logicalDate, nextWatermark);
  return "compiled";
}

// ---------- compileDaily ----------

export function listDailyEntries(dailyDir: string, opts: { maxDays?: number } = {}): Array<{ date: string; filePath: string }> {
  const maxDays = opts.maxDays || DAILY_WINDOW_RETENTION_DAYS;
  let names: string[] = [];
  try {
    names = fs.readdirSync(dailyDir);
  } catch {
    return [];
  }
  const entries = names
    .map((name) => name.match(DAILY_FILE_RE))
    .filter((m): m is RegExpMatchArray => Boolean(m))
    .map((m) => ({ date: m[1], filePath: path.join(dailyDir, m[0]) }))
    .sort((a, b) => a.date.localeCompare(b.date));
  return entries.slice(-maxDays);
}

export async function compileDaily(
  summaryManager: SessionSummaryManager,
  dailyDir: string,
  logicalDate: string,
  llm: LLMProvider,
  opts: { since?: string; todayDraftPath?: string; locale?: string } = {},
): Promise<"compiled" | "skipped"> {
  fs.mkdirSync(dailyDir, { recursive: true });
  const outputPath = path.join(dailyDir, `${logicalDate}.md`);
  const fpPath = `${outputPath}.fingerprint`;
  const draftText = opts.todayDraftPath ? normalizeCompiledSectionBody(safeReadFile(opts.todayDraftPath, "")) : "";
  const candidates = getCandidateSummaries(summaryManager, opts.since || null);
  const timelineEvents = timelineEventsForLogicalDate(candidates, logicalDate, false);
  const fallbackEvents = timelineEvents.length === 0
    ? timelineEventsForLogicalDate(candidates, logicalDate, true)
    : [];
  let input: string;
  let fpKeys: string[];
  if (timelineEvents.length > 0) {
    input = formatTimelineEventsForCompile(timelineEvents);
    fpKeys = timelineEvents.map((e) => e.key);
  } else if (draftText) {
    input = draftText;
    fpKeys = [`draft:${draftText}`];
  } else if (fallbackEvents.length > 0) {
    input = formatTimelineEventsForCompile(fallbackEvents);
    fpKeys = fallbackEvents.map((e) => e.key);
  } else {
    removeIfExists(fpPath);
    return "skipped";
  }
  const fp = computeFingerprint(fpKeys);
  try {
    if (safeReadFile(fpPath, "").trim() === fp && fs.existsSync(outputPath)) return "skipped";
  } catch {
    // first compile for this day
  }
  const { text } = await llm.chat({ system: buildCompileDailyPrompt(opts.locale), user: input, maxTokens: 100 });
  const body = normalizeCompiledLLMResult(text);
  atomicWriteSync(outputPath, body ? `## ${logicalDate}\n\n${body}\n` : "");
  atomicWriteSync(fpPath, fp);
  return "compiled";
}

// ---------- week assembly ----------

function normalizeCompiledWeekSectionBody(value: string): string {
  const raw = stripThinkTagBlocks(String(value || "")).trim();
  if (!raw) return "";
  const parts: string[] = [];
  let bodyLines: string[] = [];
  const flush = () => {
    const body = normalizeCompiledSectionBody(bodyLines.join("\n"));
    if (body) parts.push(body);
    bodyLines = [];
  };
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(COMPILED_WEEK_DATE_HEADING_RE);
    if (match) {
      flush();
      parts.push(`### ${match[1]}`);
    } else {
      bodyLines.push(line);
    }
  }
  flush();
  return parts.join("\n\n");
}

export function assembleWeekFromDaily(
  dailyDir: string,
  weekPath: string,
  opts: { maxDays?: number; maxChars?: number } = {},
): void {
  const maxDays = opts.maxDays || DAILY_WINDOW_RETENTION_DAYS;
  const maxChars = opts.maxChars || WEEK_ASSEMBLY_MAX_CHARS;
  const entries = listDailyEntries(dailyDir, { maxDays });
  const blocks = entries.map(({ filePath }) => safeReadFile(filePath, "").trim()).filter(Boolean);
  let content = blocks.join("\n\n");
  if (content.length > maxChars) {
    const kept = [...blocks];
    while (kept.length > 1 && kept.join("\n\n").length > maxChars) kept.shift();
    content = kept.join("\n\n");
    if (content.length > maxChars) content = content.slice(0, maxChars);
  }
  atomicWriteSync(weekPath, content ? `${content}\n` : "");
}

// ---------- roll window / longterm fold ----------

export async function compileLongterm(
  content: string,
  longtermPath: string,
  llm: LLMProvider,
  opts: { locale?: string } = {},
): Promise<"compiled" | "skipped"> {
  fs.mkdirSync(path.dirname(longtermPath), { recursive: true });
  const newContent = String(content || "").trim();
  if (!newContent) return "skipped";
  const fp = computeFingerprint([newContent]);
  const fpPath = `${longtermPath}.fingerprint`;
  try {
    if (safeReadFile(fpPath, "").trim() === fp && fs.existsSync(longtermPath)) return "skipped";
  } catch {
    // first fold
  }
  const prev = safeReadFile(longtermPath, "").trim();
  const input = prev
    ? `## 上一份长期情况\n\n${prev}\n\n## 新沉淀内容\n\n${newContent}`
    : `## 新沉淀内容\n\n${newContent}`;
  const { text } = await llm.chat({ system: buildCompileLongtermPrompt(opts.locale), user: input, maxTokens: 600 });
  atomicWriteSync(longtermPath, normalizeCompiledLLMResult(text) + "\n");
  atomicWriteSync(fpPath, fp);
  return "compiled";
}

export async function rollDailyWindow(
  dailyDir: string,
  longtermPath: string,
  llm: LLMProvider,
  opts: { referenceDate?: string; retentionDays?: number; locale?: string } = {},
): Promise<{ folded: string[]; failed: string[] }> {
  const retentionDays = opts.retentionDays || DAILY_WINDOW_RETENTION_DAYS;
  const referenceDate = opts.referenceDate || getLogicalDay().logicalDate;
  const cutoffDate = shiftLogicalDate(referenceDate, -retentionDays);
  const entries = listDailyEntries(dailyDir, { maxDays: Number.MAX_SAFE_INTEGER })
    .filter(({ date }) => date < cutoffDate);
  if (entries.length === 0) return { folded: [], failed: [] };
  const combined = entries
    .map(({ date, filePath }) => {
      const body = safeReadFile(filePath, "").trim();
      return body ? `## ${date}\n\n${body}` : "";
    })
    .filter(Boolean)
    .join("\n\n");
  if (!combined) {
    for (const { filePath } of entries) removeIfExists(filePath);
    return { folded: entries.map((e) => e.date), failed: [] };
  }
  try {
    await compileLongterm(combined, longtermPath, llm, opts);
    for (const { filePath } of entries) removeIfExists(filePath);
    return { folded: entries.map((e) => e.date), failed: [] };
  } catch {
    return { folded: [], failed: entries.map((e) => e.date) };
  }
}

// ---------- editable facts ----------

function editableFactsStatePath(memoryDir: string): string {
  return path.join(memoryDir, EDITABLE_FACTS_STATE_FILE);
}

function readEditableFactsState(statePath: string): { lastCompiledSummaryUpdatedAt: string | null } {
  try {
    const raw = JSON.parse(fs.readFileSync(statePath, "utf-8"));
    const value = raw?.lastCompiledSummaryUpdatedAt;
    return {
      lastCompiledSummaryUpdatedAt: value && !Number.isNaN(Date.parse(value)) ? value : null,
    };
  } catch {
    return { lastCompiledSummaryUpdatedAt: null };
  }
}

function writeEditableFactsState(statePath: string, lastCompiledSummaryUpdatedAt: string): void {
  if (!lastCompiledSummaryUpdatedAt || Number.isNaN(Date.parse(lastCompiledSummaryUpdatedAt))) return;
  atomicWriteSync(statePath, JSON.stringify({
    lastCompiledSummaryUpdatedAt,
    updatedAt: new Date().toISOString(),
  }, null, 2) + "\n");
}

export function ensureEditableFactsBaseline(
  memoryDir: string,
  summaryManager: SessionSummaryManager,
  opts: { outputPath?: string; statePath?: string } = {},
): boolean {
  fs.mkdirSync(memoryDir, { recursive: true });
  const outputPath = opts.outputPath || path.join(memoryDir, "facts.md");
  const statePath = opts.statePath || editableFactsStatePath(memoryDir);
  if (!fs.existsSync(outputPath)) atomicWriteSync(outputPath, "");
  const state = readEditableFactsState(statePath);
  const latest = latestSummaryUpdate(summaryManager.getAllSummaries());
  // 升级保护：facts.md 已有内容但缺水位时，视为旧摘要已吸收，只建立水位不重编。
  // 首次运行（facts.md 为空）不建水位，让首次编译处理全部现有摘要。
  const hasExistingContent = normalizeCompiledSectionBody(safeReadFile(outputPath, "")).length > 0;
  if (!state.lastCompiledSummaryUpdatedAt && latest && hasExistingContent) {
    writeEditableFactsState(statePath, latest);
    return true;
  }
  return false;
}

export async function compileEditableFacts(
  summaryManager: SessionSummaryManager,
  outputPath: string,
  llm: LLMProvider,
  opts: { since?: string; statePath?: string; locale?: string } = {},
): Promise<"compiled" | "skipped"> {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const statePath = opts.statePath || editableFactsStatePath(path.dirname(outputPath));
  const summaries = summaryManager.getAllSummaries().filter((s) => s?.summary);
  if (ensureEditableFactsBaseline(path.dirname(outputPath), summaryManager, { outputPath, statePath })) return "compiled";
  const state = readEditableFactsState(statePath);
  const since = latestIso(state.lastCompiledSummaryUpdatedAt, opts.since || null);
  const sessions = summaries.filter((s) => {
    const updated = s?.updated_at || s?.created_at || "";
    return updated && (!since || updated > since);
  });
  if (sessions.length === 0) return "skipped";
  const factParts: string[] = [];
  for (const s of sessions) {
    if (!s.summary || !hasFactSectionHeading(s.summary)) continue;
    const text = extractFactSection(s.summary);
    if (text && !isEmptyFactSection(text)) factParts.push(text);
  }
  const nextWatermark = latestSummaryUpdate(sessions);
  if (factParts.length === 0) {
    if (nextWatermark) writeEditableFactsState(statePath, nextWatermark);
    return "compiled";
  }
  const prevFacts = normalizeCompiledSectionBody(safeReadFile(outputPath, ""));
  const newFacts = factParts.join("\n");
  const combined = prevFacts
    ? `## 当前可信 Facts\n\n${prevFacts}\n\n## 新增候选 Facts\n\n${newFacts}`
    : `## 新增候选 Facts\n\n${newFacts}`;
  const { text } = await llm.chat({ system: buildCompileEditableFactsPrompt(opts.locale), user: combined, maxTokens: 300 });
  atomicWriteSync(outputPath, normalizeCompiledLLMResult(text) + "\n");
  if (nextWatermark) writeEditableFactsState(statePath, nextWatermark);
  return "compiled";
}

// ---------- assemble ----------

export function buildCompiledMemoryMarkdown(
  { facts = "", today = "", week = "", longterm = "", locale = "zh-CN" }: Record<string, string> = {},
): string {
  const isZh = locale.startsWith("zh");
  const empty = isZh ? "（暂无）" : "(none)";
  const section = (title: string, content: string) =>
    `## ${title}\n\n${normalizeCompiledSectionBody(content) || empty}`;
  return [
    section(isZh ? "重要事实" : "Key Facts", facts),
    section(isZh ? "今天" : "Today", today),
    section(isZh ? "本周早些时候" : "Earlier this week", week),
    section(isZh ? "长期情况" : "Long-term context", longterm),
  ].join("\n\n") + "\n";
}

export function assemble(
  factsPath: string,
  todayPath: string,
  weekPath: string,
  longtermPath: string,
  memoryMdPath: string,
  opts: { locale?: string } = {},
): void {
  const read = (p: string) => safeReadFile(p, "");
  const facts = normalizeCompiledSectionBody(read(factsPath));
  const today = normalizeCompiledSectionBody(read(todayPath));
  const week = normalizeCompiledWeekSectionBody(read(weekPath));
  const longterm = normalizeCompiledSectionBody(read(longtermPath));
  atomicWriteSync(memoryMdPath, buildCompiledMemoryMarkdown({ facts, today, week, longterm, locale: opts.locale || "zh-CN" }));
}
