import fs from "node:fs";
import path from "node:path";
import type { LLMProvider } from "../llm/types.ts";
import type { SessionSummaryManager } from "../summary/session-summary.ts";
import type { FactStore } from "../deep-memory/fact-store.ts";
import {
  assemble,
  assembleWeekFromDaily,
  compileDaily,
  compileEditableFacts,
  compileToday,
  rollDailyWindow,
} from "../compile/compile.ts";
import { processDirtySessions } from "../deep-memory/deep-memory.ts";
import type { MemoryClock } from "../time/logical-day.ts";
import { createLogicalDayClock, shiftLogicalDate } from "../time/logical-day.ts";
import { atomicWriteSync } from "../util/safe-fs.ts";
import { readCompiledResetAt } from "../compile/compiled-memory-state.ts";

export const TURNS_PER_SUMMARY = 10;

const DAILY_STATE_FILE = "daily-state.json";
const DAILY_STEP_KEYS = ["compileDaily", "compileToday", "rollDailyWindow", "compileFacts", "deepMemory"];

export interface MemoryTickerOptions {
  summaryManager: SessionSummaryManager;
  factStore: FactStore;
  getLLM: () => LLMProvider;
  memoryDir: string;
  todayMdPath: string;
  weekMdPath: string;
  longtermMdPath: string;
  factsMdPath: string;
  memoryMdPath: string;
  clock?: MemoryClock;
  timeZone?: string;
  locale?: string;
  getSessionMessages?: (sessionPath: string) => Array<Record<string, any>>;
  onCompiled?: () => void;
}

export interface MemoryTicker {
  notifyTurn(sessionPath: string): Promise<void>;
  notifySessionEnd(sessionPath: string): Promise<void>;
  triggerDaily(): Promise<void>;
  flushSession(sessionPath: string): Promise<void>;
  getHealthStatus(): Record<string, unknown>;
  start(): void;
  stop(): void;
}

function sessionIdFromPath(sessionPath: string): string {
  return path.basename(sessionPath).replace(/\.jsonl$/, "");
}

export function createMemoryTicker(opts: MemoryTickerOptions): MemoryTicker {
  const clock = opts.clock || createLogicalDayClock();
  const locale = opts.locale || "zh-CN";
  const timeZone = opts.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const { summaryManager, factStore, memoryDir } = opts;
  const dailyDir = path.join(memoryDir, "daily");

  const turnCounts = new Map<string, number>();
  const _summaryInProgress = new Set<string>();
  const _dailyStepsCompleted = new Set<string>();
  let _dailyRunning = false;
  let _lastDailyJobDate: string | null = null;
  let _lastErrorSig: string | null = null;
  let _stopped = false;
  let _timer: ReturnType<typeof setInterval> | null = null;

  function _logStepError(label: string, err: unknown): void {
    const msg = err instanceof Error ? err.message : String(err);
    const sig = `${label}|${msg}`;
    if (sig === _lastErrorSig) return;
    _lastErrorSig = sig;
    console.error(`[memory] ${label} 失败: ${msg}`);
  }

  function _markStepRecovered(): void {
    _lastErrorSig = null;
  }

  function _getResetAt(): string | null {
    return readCompiledResetAt(memoryDir);
  }

  async function _doRollingSummary(sessionPath: string, trigger: string): Promise<boolean> {
    const sessionId = sessionIdFromPath(sessionPath);
    if (_summaryInProgress.has(sessionId)) return false;
    _summaryInProgress.add(sessionId);
    try {
      const messages = opts.getSessionMessages?.(sessionPath) || [];
      const result = await summaryManager.rollingSummary(sessionId, messages, opts.getLLM(), {
        locale,
        timeZone,
        resetAt: _getResetAt() || undefined,
        memorySnapshot: {
          userName: "用户",
          identityAndPersonality: "（未提供）",
        },
      });
      if (result.data?.factReplacementRequired === true) {
        await processDirtySessions(summaryManager, factStore, opts.getLLM(), {
          timeZone,
          sessionIds: [sessionId],
        });
      }
      _markStepRecovered();
      return true;
    } catch (err) {
      _logStepError(`滚动摘要 (${trigger})`, err);
      return false;
    } finally {
      _summaryInProgress.delete(sessionId);
    }
  }

  async function _doCompileTodayAndAssemble(): Promise<void> {
    try {
      await compileToday(summaryManager, opts.todayMdPath, opts.getLLM(), {
        since: _getResetAt() || undefined,
        locale,
        timeZone,
      });
      assemble(opts.factsMdPath, opts.todayMdPath, opts.weekMdPath, opts.longtermMdPath, opts.memoryMdPath, { locale });
      opts.onCompiled?.();
      _markStepRecovered();
    } catch (err) {
      _logStepError("compileToday", err);
    }
  }

  function _dailyStatePath(): string {
    return path.join(memoryDir, DAILY_STATE_FILE);
  }

  function _readDailyState(): { logicalDate: string; steps: string[] } | null {
    try {
      const raw = JSON.parse(fs.readFileSync(_dailyStatePath(), "utf-8"));
      return raw?.logicalDate && Array.isArray(raw?.steps) ? { logicalDate: raw.logicalDate, steps: raw.steps } : null;
    } catch {
      return null;
    }
  }

  function _writeDailyState(logicalDate: string, steps: string[]): void {
    atomicWriteSync(_dailyStatePath(), JSON.stringify({ logicalDate, steps, updatedAt: new Date().toISOString() }, null, 2) + "\n");
  }

  async function _doDaily(): Promise<void> {
    if (_dailyRunning || _stopped) return;
    _dailyRunning = true;
    try {
      const today = clock.getLogicalDay().logicalDate;
      const state = _readDailyState();
      if (state?.logicalDate === today) {
        _dailyStepsCompleted.clear();
        for (const step of state.steps) _dailyStepsCompleted.add(step);
      } else {
        _dailyStepsCompleted.clear();
      }
      _dailyStepsCompleted.add("assemble");

      if (!_dailyStepsCompleted.has("compileDaily")) {
        try {
          const yesterday = shiftLogicalDate(today, -1);
          await compileDaily(summaryManager, dailyDir, yesterday, opts.getLLM(), {
            since: _getResetAt() || undefined,
            todayDraftPath: opts.todayMdPath,
            locale,
          });
          _dailyStepsCompleted.add("compileDaily");
        } catch (err) {
          _logStepError("compileDaily", err);
        }
      }
      if (!_dailyStepsCompleted.has("compileToday")) {
        try {
          await compileToday(summaryManager, opts.todayMdPath, opts.getLLM(), {
            since: _getResetAt() || undefined,
            locale,
            timeZone,
          });
          _dailyStepsCompleted.add("compileToday");
        } catch (err) {
          _logStepError("compileToday", err);
        }
      }
      if (!_dailyStepsCompleted.has("rollDailyWindow") && _dailyStepsCompleted.has("compileDaily")) {
        try {
          const { failed } = await rollDailyWindow(dailyDir, opts.longtermMdPath, opts.getLLM(), {
            referenceDate: today,
            locale,
          });
          if (failed.length === 0) _dailyStepsCompleted.add("rollDailyWindow");
        } catch (err) {
          _logStepError("rollDailyWindow", err);
        }
      }
      if (!_dailyStepsCompleted.has("compileFacts")) {
        try {
          await compileEditableFacts(summaryManager, opts.factsMdPath, opts.getLLM(), {
            since: _getResetAt() || undefined,
            locale,
          });
          _dailyStepsCompleted.add("compileFacts");
        } catch (err) {
          _logStepError("compileFacts", err);
        }
      }
      try {
        assembleWeekFromDaily(dailyDir, opts.weekMdPath);
        assemble(opts.factsMdPath, opts.todayMdPath, opts.weekMdPath, opts.longtermMdPath, opts.memoryMdPath, { locale });
        opts.onCompiled?.();
      } catch (err) {
        _logStepError("assemble", err);
      }
      if (!_dailyStepsCompleted.has("deepMemory")) {
        try {
          await processDirtySessions(summaryManager, factStore, opts.getLLM(), {
            since: _getResetAt() || undefined,
            timeZone,
          });
          _dailyStepsCompleted.add("deepMemory");
        } catch (err) {
          _logStepError("deep-memory", err);
        }
      }
      if (DAILY_STEP_KEYS.every((key) => _dailyStepsCompleted.has(key))) {
        _lastDailyJobDate = today;
        _writeDailyState(today, [..._dailyStepsCompleted]);
      }
    } finally {
      _dailyRunning = false;
    }
  }

  async function _checkDailyJob(): Promise<void> {
    if (_stopped) return;
    const today = clock.getLogicalDay().logicalDate;
    if (_lastDailyJobDate !== today) {
      await _doDaily();
    }
  }

  async function notifyTurn(sessionPath: string): Promise<void> {
    if (_stopped) return;
    const sessionKey = sessionIdFromPath(sessionPath);
    const count = (turnCounts.get(sessionKey) || 0) + 1;
    turnCounts.set(sessionKey, count);
    if (count % TURNS_PER_SUMMARY === 0) {
      await _doRollingSummary(sessionPath, "threshold");
      await _doCompileTodayAndAssemble();
    }
    await _checkDailyJob();
  }

  async function notifySessionEnd(sessionPath: string): Promise<void> {
    if (_stopped) return;
    await _doRollingSummary(sessionPath, "session_end");
    await _doCompileTodayAndAssemble();
    await _checkDailyJob();
  }

  async function flushSession(sessionPath: string): Promise<void> {
    await notifySessionEnd(sessionPath);
  }

  function getHealthStatus(): Record<string, unknown> {
    return {
      lastDailyJobDate: _lastDailyJobDate,
      dailyStepsCompleted: [..._dailyStepsCompleted],
      turnCounts: Object.fromEntries(turnCounts),
    };
  }

  function start(): void {
    if (_timer) return;
    _stopped = false;
    _timer = setInterval(() => void _checkDailyJob(), 60 * 60 * 1000);
  }

  function stop(): void {
    _stopped = true;
    if (_timer) {
      clearInterval(_timer);
      _timer = null;
    }
  }

  return {
    notifyTurn,
    notifySessionEnd,
    triggerDaily: () => _doDaily(),
    flushSession,
    getHealthStatus,
    start,
    stop,
  };
}
