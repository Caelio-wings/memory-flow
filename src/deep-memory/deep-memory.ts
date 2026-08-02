import type { LLMProvider } from "../llm/types.ts";
import { scrubPII } from "../util/pii-guard.ts";
import { buildFactTimeContext, normalizeFactTime, resolveMemoryTimeZone } from "../time/time-context.ts";
import { sessionSummaryRevision, type SessionSummaryManager } from "../summary/session-summary.ts";
import type { FactStore } from "./fact-store.ts";
import { buildFactExtractionPrompt } from "./prompts/fact-extraction.ts";

const MAX_RETRIES = 3;
const MAX_CONCURRENT = 3;
const FAIL_COUNT_TTL_MS = 60 * 60 * 1000;
const _failCounts = new Map<string, { count: number; lastUpdated: number }>();

export async function processDirtySessions(
  summaryManager: SessionSummaryManager,
  factStore: FactStore,
  llm: LLMProvider,
  opts: { since?: string; timeZone?: string; sessionIds?: string[] } = {},
): Promise<{ processed: number; factsAdded: number }> {
  const requested = Array.isArray(opts.sessionIds) && opts.sessionIds.length > 0
    ? new Set(opts.sessionIds)
    : null;
  const dirty = summaryManager
    .getDirtySessions({ since: opts.since || undefined })
    .filter((session) => !requested || requested.has(session.session_id));
  if (dirty.length === 0) return { processed: 0, factsAdded: 0 };

  let totalFacts = 0;
  const timeZone = resolveMemoryTimeZone(opts.timeZone);

  const processOne = async (session: any): Promise<void> => {
    const expectedRevision = sessionSummaryRevision(session);
    try {
      const timeContext = buildFactTimeContext(session, { timeZone });
      const replacement = session.factReplacementRequired === true;
      const facts = replacement && !session.summary?.trim()
        ? []
        : await extractFactsFromDiff(session.summary, replacement ? "" : (session.snapshot || ""), llm, timeContext);
      const factEntries = facts.map((f: any) => ({
        fact: f.fact,
        tags: f.tags || [],
        time: f.time || null,
        session_id: session.session_id,
      }));
      if (replacement) factStore.replaceBySession(session.session_id, factEntries);
      else if (factEntries.length > 0) factStore.addBatch(factEntries);
      totalFacts += facts.length;
      const marked = summaryManager.markProcessedIfCurrent(session.session_id, expectedRevision);
      if (marked === false) throw new Error("session summary changed before fact extraction commit");
      _failCounts.delete(session.session_id);
    } catch {
      cleanExpiredFailCounts();
      const prev = _failCounts.get(session.session_id);
      const count = (prev?.count || 0) + 1;
      _failCounts.set(session.session_id, { count, lastUpdated: Date.now() });
      if (count >= MAX_RETRIES && session.factReplacementRequired !== true) {
        summaryManager.markProcessedIfCurrent(session.session_id, expectedRevision);
        _failCounts.delete(session.session_id);
      }
      // replacement stays dirty; retried next pass
    }
  };

  for (let i = 0; i < dirty.length; i += MAX_CONCURRENT) {
    const batch = dirty.slice(i, i + MAX_CONCURRENT);
    await Promise.allSettled(batch.map(processOne));
  }
  return { processed: dirty.length, factsAdded: totalFacts };
}

async function extractFactsFromDiff(
  currentSummary: string,
  previousSnapshot: string,
  llm: LLMProvider,
  timeContext: any = null,
): Promise<Array<{ fact: string; tags: string[]; time: string | null }>> {
  const hasPrevious = !!previousSnapshot;
  const timeContextBlock = buildTimeContextBlock(timeContext);
  const userContent = hasPrevious
    ? `${timeContextBlock}\n\n## 上次快照\n\n${previousSnapshot}\n\n## 当前摘要\n\n${currentSummary}`
    : `${timeContextBlock}\n\n## 摘要内容\n\n${currentSummary}`;
  const { text } = await llm.chat({
    system: buildFactExtractionPrompt({ hasPrevious }),
    user: userContent,
    maxTokens: 4096,
  });
  const jsonStr = normalizeFactJsonOutput(text);
  let facts: any[];
  try {
    facts = JSON.parse(jsonStr);
  } catch (err) {
    throw new Error(`deep memory fact extraction returned invalid JSON: ${String(err)}`);
  }
  if (!Array.isArray(facts)) throw new Error("deep memory fact extraction returned non-array JSON");
  return facts
    .filter((f) => f && typeof f.fact === "string" && f.fact.length > 0)
    .map((f) => {
      const { cleaned } = scrubPII(f.fact);
      return {
        ...f,
        fact: cleaned,
        time: normalizeFactTime(f.time, timeContext || {}),
      };
    });
}

function buildTimeContextBlock(context: any): string {
  const sourceRange = context?.sourceRange || {};
  const timezone = resolveMemoryTimeZone(context?.timezone);
  const localDates = Array.isArray(context?.localDates) && context.localDates.length > 0
    ? context.localDates.join(", ")
    : "未知";
  const range = sourceRange.start || sourceRange.end
    ? `${sourceRange.start || "?"} → ${sourceRange.end || "?"}`
    : "未知";
  const summaryDateTimes = Array.isArray(context?.summaryDateTimes) && context.summaryDateTimes.length > 0
    ? context.summaryDateTimes.join(", ")
    : "无";
  return `## 时间上下文
- 时区：${timezone}
- 会话来源时间范围：${range}
- 会话来源本地日期：${localDates}
- 摘要中明确出现的完整时间：${summaryDateTimes}

时间规则：只允许使用本时间上下文或摘要正文中明确出现的日期。摘要只有 HH:MM 且会话来源只有一个本地日期时，才能把该日期和 HH:MM 合成 time；摘要跨多个本地日期且只有 HH:MM 时，time 填 null。不要从输出格式示例或说明文字中推断日期。`;
}

function normalizeFactJsonOutput(raw: string): string {
  const withoutFence = String(raw || "").trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n\s*```\s*$/, "$1").trim();
  const withoutThoughts = withoutFence
    .replace(/^<(?:think|thinking|thought)\b[^>]*>[\s\S]*?<\/(?:think|thinking|thought)>\s*/gi, "")
    .trim();
  if (withoutThoughts.startsWith("[")) return withoutThoughts;
  const start = withoutThoughts.indexOf("[");
  if (start === -1) return withoutThoughts;
  let depth = 0;
  let inString = false;
  let quote = "";
  let escaped = false;
  for (let i = start; i < withoutThoughts.length; i++) {
    const ch = withoutThoughts[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === quote) inString = false;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = true;
      quote = ch;
      continue;
    }
    if (ch === "[") depth += 1;
    else if (ch === "]") {
      depth -= 1;
      if (depth === 0) return withoutThoughts.slice(start, i + 1);
    }
  }
  return withoutThoughts;
}

function cleanExpiredFailCounts(): void {
  const cutoff = Date.now() - FAIL_COUNT_TTL_MS;
  for (const [key, value] of _failCounts) {
    if (value.lastUpdated < cutoff) _failCounts.delete(key);
  }
}
