import fs from "node:fs";
import path from "node:path";
import type { LLMProvider } from "../llm/types.ts";
import { scrubPII } from "../util/pii-guard.ts";
import { atomicWriteSync, safeReadFile } from "../util/safe-fs.ts";
import { buildSourceTimeRange, formatZonedDateTime, resolveMemoryTimeZone } from "../time/time-context.ts";
import {
  MAX_ROLLING_SUMMARY_FORMAT_REPAIRS,
  buildRollingSummaryFormatRequirements,
  validateRollingSummaryFormat,
} from "./rolling-summary-format.ts";
import { buildRollingSummaryPrompt } from "./prompts/rolling-summary.ts";

export interface SummaryRecord {
  session_id: string;
  created_at: string;
  updated_at: string;
  summary: string;
  messageCount: number;
  source_time_range: unknown;
  snapshot: string;
  snapshot_at: string | null;
  factReplacementRequired?: boolean;
}

export function sessionSummaryRevision(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  return JSON.stringify({
    updatedAt: d.updated_at || null,
    summary: d.summary || "",
    snapshot: d.snapshot || "",
    factReplacementRequired: d.factReplacementRequired === true,
  });
}

export interface RollingSummaryResult {
  summary: string;
  changed: boolean;
  data: SummaryRecord | null;
  reason?: string;
}

export class SessionSummaryManager {
  private _cache = new Map<string, SummaryRecord>();
  private _cachePopulated = false;

  constructor(private summariesDir: string) {
    fs.mkdirSync(summariesDir, { recursive: true });
  }

  getSummary(sessionId: string): SummaryRecord | null {
    if (this._cache.has(sessionId)) return this._cache.get(sessionId)!;
    try {
      const data = JSON.parse(fs.readFileSync(this._filePath(sessionId), "utf-8")) as SummaryRecord;
      this._cache.set(sessionId, data);
      return data;
    } catch {
      return null;
    }
  }

  saveSummary(sessionId: string, data: SummaryRecord): void {
    const fp = this._filePath(sessionId);
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    atomicWriteSync(fp, JSON.stringify(data, null, 2) + "\n");
    this._cache.set(sessionId, data);
  }

  invalidateSession(sessionId: string): boolean {
    const normalized = String(sessionId || "").trim();
    if (!normalized) throw new Error("session summary invalidation requires sessionId");
    const hadCache = this._cache.delete(normalized);
    try {
      fs.unlinkSync(this._filePath(normalized));
      return true;
    } catch (err: any) {
      if (err?.code === "ENOENT") return hadCache;
      throw err;
    }
  }

  getDirtySessions(opts: { since?: string } = {}): SummaryRecord[] {
    this._ensureCachePopulated();
    const since = normalizeSince(opts.since);
    const dirty: SummaryRecord[] = [];
    for (const data of this._cache.values()) {
      if (!data?.summary && data?.factReplacementRequired !== true) continue;
      if (since && !isAfter(data.updated_at || data.created_at, since)) continue;
      if (data.factReplacementRequired === true || data.summary !== (data.snapshot || "")) {
        dirty.push(data);
      }
    }
    return dirty;
  }

  markProcessed(sessionId: string): boolean {
    const data = this.getSummary(sessionId);
    if (!data) return false;
    this.saveSummary(sessionId, {
      ...data,
      snapshot: data.summary,
      snapshot_at: new Date().toISOString(),
      factReplacementRequired: false,
    });
    return true;
  }

  isRevisionCurrent(sessionId: string, expected: string | null): boolean {
    return expected != null && sessionSummaryRevision(this.getSummary(sessionId)) === expected;
  }

  markProcessedIfCurrent(sessionId: string, expected: string | null): boolean {
    if (!this.isRevisionCurrent(sessionId, expected)) return false;
    return this.markProcessed(sessionId);
  }

  getAllSummaries(): SummaryRecord[] {
    this._ensureCachePopulated();
    return [...this._cache.values()]
      .filter((data) => data?.summary)
      .sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""));
  }

  clearAll(): void {
    fs.mkdirSync(this.summariesDir, { recursive: true });
    for (const file of this._listFiles()) {
      try { fs.unlinkSync(file); } catch (err: any) {
        if (err?.code !== "ENOENT") throw err;
      }
    }
    this.clearCache();
  }

  clearCache(): void {
    this._cache.clear();
    this._cachePopulated = false;
  }

  async rollingSummary(
    sessionId: string,
    messages: Array<Record<string, any>>,
    llm: LLMProvider,
    opts: { locale?: string; timeZone?: string; resetAt?: string; memorySnapshot?: Record<string, string> } = {},
  ): Promise<RollingSummaryResult> {
    const existing = this.getSummary(sessionId);
    const prevSummary = existing?.summary || "";
    const timeZone = resolveMemoryTimeZone(opts.timeZone);
    const convText = this._buildConversationText(messages, timeZone);
    if (!convText) {
      return { summary: prevSummary, changed: false, data: null, reason: "empty_conversation" };
    }
    const turnCount = messages.filter((m) => m?.role === "user").length;
    const { totalBudget, visibleMaxTokens } = this._rollingSummaryBudget(turnCount);
    const factBudget = Math.max(15, Math.round(totalBudget * 0.3));
    const timelineBudget = totalBudget - factBudget;
    const { system, user } = buildRollingSummaryPrompt({
      locale: opts.locale,
      existingSummary: prevSummary,
      conversationText: convText,
      factBudget,
      timelineBudget,
      memorySnapshot: opts.memorySnapshot,
    });
    const { text } = await llm.chat({
      system,
      user,
      maxTokens: visibleMaxTokens,
    });
    let summary = await this._validateAndRepair(text, turnCount, llm);
    const { cleaned, detected } = scrubPII(summary);
    if (detected.length > 0) summary = cleaned;
    const finalValidation = validateRollingSummaryFormat(summary);
    if (!finalValidation.ok) {
      throw new Error(`rolling summary format invalid after PII scrub: ${finalValidation.issues.join("; ")}`);
    }
    const now = new Date().toISOString();
    const data: SummaryRecord = {
      session_id: sessionId,
      created_at: existing?.created_at || now,
      updated_at: now,
      summary: summary.trim(),
      messageCount: messages.length,
      source_time_range: buildSourceTimeRange(messages, { timeZone }) || existing?.source_time_range || null,
      snapshot: existing?.snapshot || "",
      snapshot_at: existing?.snapshot_at || null,
      factReplacementRequired: existing?.factReplacementRequired === true,
    };
    this.saveSummary(sessionId, data);
    return { summary: data.summary, changed: true, data, reason: detected.length > 0 ? "pii_redacted" : "" };
  }

  async replaceSessionSummary(
    sessionId: string,
    messages: Array<Record<string, any>>,
    llm: LLMProvider,
    opts: { locale?: string; timeZone?: string; memorySnapshot?: Record<string, string> } = {},
  ): Promise<RollingSummaryResult> {
    const existing = this.getSummary(sessionId);
    const timeZone = resolveMemoryTimeZone(opts.timeZone);
    const convText = this._buildConversationText(messages, timeZone);
    if (!convText) {
      const now = new Date().toISOString();
      const data: SummaryRecord = {
        session_id: sessionId,
        created_at: existing?.created_at || now,
        updated_at: now,
        summary: "",
        messageCount: messages.length,
        source_time_range: null,
        snapshot: existing?.snapshot || "",
        snapshot_at: existing?.snapshot_at || null,
        factReplacementRequired: true,
      };
      this.saveSummary(sessionId, data);
      return { summary: "", changed: true, data, reason: "empty_branch_replacement" };
    }
    const turnCount = messages.filter((m) => m?.role === "user").length;
    const { totalBudget, visibleMaxTokens } = this._rollingSummaryBudget(turnCount);
    const factBudget = Math.max(15, Math.round(totalBudget * 0.3));
    const timelineBudget = totalBudget - factBudget;
    const { system, user } = buildRollingSummaryPrompt({
      locale: opts.locale,
      conversationText: convText,
      factBudget,
      timelineBudget,
      memorySnapshot: opts.memorySnapshot,
    });
    const { text } = await llm.chat({ system, user, maxTokens: visibleMaxTokens });
    let summary = await this._validateAndRepair(text, turnCount, llm);
    const { cleaned, detected } = scrubPII(summary);
    if (detected.length > 0) summary = cleaned;
    const now = new Date().toISOString();
    const data: SummaryRecord = {
      session_id: sessionId,
      created_at: existing?.created_at || now,
      updated_at: now,
      summary: summary.trim(),
      messageCount: messages.length,
      source_time_range: buildSourceTimeRange(messages, { timeZone }),
      snapshot: existing?.snapshot || "",
      snapshot_at: existing?.snapshot_at || null,
      factReplacementRequired: true,
    };
    this.saveSummary(sessionId, data);
    return { summary: data.summary, changed: true, data, reason: detected.length > 0 ? "pii_redacted" : "" };
  }

  private async _validateAndRepair(text: string, turnCount: number, llm: LLMProvider): Promise<string> {
    let summary = String(text || "").trim();
    let validation = summary ? validateRollingSummaryFormat(summary) : { ok: true, issues: [] as string[] };
    let repairsUsed = 0;
    while (!validation.ok && repairsUsed < MAX_ROLLING_SUMMARY_FORMAT_REPAIRS) {
      repairsUsed += 1;
      const { visibleMaxTokens } = this._rollingSummaryBudget(turnCount);
      const system = "你是记忆系统滚动摘要的格式修复器。请把给定草稿中的信息原样重排进规定结构：不新增、不删除、不改写任何事实内容，不要解释，直接输出修复后的摘要全文。\n\n" + buildRollingSummaryFormatRequirements("zh-CN");
      const { text: repaired } = await llm.chat({ system, user: buildRepairInput(validation.issues, summary), maxTokens: visibleMaxTokens });
      summary = repaired.trim();
      if (!summary) {
        validation = { ok: false, issues: [...validation.issues, "format repair attempt returned empty output"] };
        break;
      }
      validation = validateRollingSummaryFormat(summary);
    }
    if (!validation.ok) {
      throw new Error(`rolling summary format invalid after ${repairsUsed} repair attempt(s): ${validation.issues.join("; ")}`);
    }
    return summary;
  }

  private _rollingSummaryBudget(turnCount: number): { totalBudget: number; visibleMaxTokens: number } {
    const totalBudget = Math.min(400, Math.max(40, turnCount * 40));
    const visibleMaxTokens = Math.max(150, Math.min(750, Math.round(totalBudget * 1.5)));
    return { totalBudget, visibleMaxTokens };
  }

  private _buildConversationText(messages: Array<Record<string, any>>, timeZone: string): string {
    const parts: string[] = [];
    for (const msg of messages || []) {
      const segments = this._extractSegments(msg);
      if (segments.length === 0) continue;
      let timePrefix = "";
      if (msg?.timestamp) {
        const d = new Date(msg.timestamp);
        if (!Number.isNaN(d.getTime())) timePrefix = `[${formatZonedDateTime(d, timeZone)}] `;
      }
      const speaker = msg?.role === "user" ? "用户" : "助手";
      for (const segment of segments) {
        parts.push(`${timePrefix}${speaker}：${segment}`);
      }
    }
    return parts.join("\n\n");
  }

  private _extractSegments(msg: Record<string, any>): string[] {
    const content = msg?.content;
    if (typeof content === "string") return content.trim() ? [content.trim()] : [];
    if (!Array.isArray(content)) return [];
    const segments: string[] = [];
    for (const block of content) {
      if (block?.type === "text" && block.text) segments.push(String(block.text).trim());
      if (msg?.role === "assistant" && Array.isArray(block?.tool_calls)) {
        for (const call of block.tool_calls) {
          if (call?.function?.name) segments.push(`（使用了工具 ${call.function.name}）`);
        }
      }
    }
    return segments.filter(Boolean);
  }

  private _filePath(sessionId: string): string {
    const cleanId = String(sessionId || "").replace(/\.jsonl$/, "");
    return path.join(this.summariesDir, `${cleanId}.json`);
  }

  private _listFiles(): string[] {
    try {
      return fs.readdirSync(this.summariesDir)
        .filter((f) => f.endsWith(".json"))
        .map((f) => path.join(this.summariesDir, f));
    } catch {
      return [];
    }
  }

  private _ensureCachePopulated(): void {
    if (this._cachePopulated) return;
    for (const file of this._listFiles()) {
      try {
        const data = JSON.parse(fs.readFileSync(file, "utf-8")) as SummaryRecord;
        if (data?.session_id) this._cache.set(data.session_id, data);
      } catch {
        // skip malformed files
      }
    }
    this._cachePopulated = true;
  }
}

function normalizeSince(value?: string): string | null {
  if (!value || Number.isNaN(Date.parse(value))) return null;
  return new Date(value).toISOString();
}

function isAfter(value: string, since: string): boolean {
  if (!value) return false;
  const ts = Date.parse(value);
  return !Number.isNaN(ts) && ts > Date.parse(since);
}

function buildRepairInput(issues: string[], summaryText: string): string {
  return `## 校验失败原因

${issues.map((issue) => `- ${issue}`).join("\n")}

## 待修复草稿

<draft-summary>
${summaryText}
</draft-summary>`;
}
