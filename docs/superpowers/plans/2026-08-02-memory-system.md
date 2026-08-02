# agent-memory 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按已确认的设计规格，从零实现 `agent-memory`——一个忠实移植 OpenHanako 记忆系统的渐进式分层记忆库（TypeScript）+ CLI 演示。

**Architecture:** 六个分层模块（llm / summary / compile / deep-memory / pinned / ticker）+ 两个基础设施模块（time / util）。LLM 通过 `LLMProvider` 接口注入，`FakeLLM` 保证离线演示与测试确定性；`MemoryTicker` 以 10 轮 / 会话结束 / 逻辑日切换三种触发方式驱动编译管线，产物全部为可读 Markdown + SQLite。

**Tech Stack:** TypeScript (strict, ESM)、Vitest、better-sqlite3（WAL + FTS5）、tsx（CLI 运行）。

---

## 文件结构总览

```
agent-memory/
├── package.json / tsconfig.json / vitest.config.ts / .gitignore / LICENSE
├── README.md
├── docs/
│   ├── architecture.md
│   ├── interview.md
│   └── superpowers/{specs,plans}/
├── src/
│   ├── index.ts
│   ├── llm/{types.ts, fake-llm.ts, openai-compatible.ts}
│   ├── summary/{rolling-summary-format.ts, session-summary.ts, prompts/rolling-summary.ts, prompts/fact-extraction.ts}
│   ├── compile/{compile.ts, compiled-memory-state.ts, compiled-memory-snapshot.ts, prompts/compile.ts}
│   ├── deep-memory/{fact-store.ts, deep-memory.ts, memory-search.ts}
│   ├── pinned/pinned-memory-store.ts
│   ├── ticker/memory-ticker.ts
│   ├── time/{logical-day.ts, time-context.ts}
│   └── util/{safe-fs.ts, pii-guard.ts}
├── cli/demo.ts
├── examples/conversations.json
└── test/
    ├── util/pii-guard.test.ts
    ├── time/logical-day.test.ts
    ├── time/time-context.test.ts
    ├── summary/rolling-summary-format.test.ts
    ├── summary/session-summary.test.ts
    ├── compile/compile.test.ts
    ├── deep-memory/fact-store.test.ts
    ├── deep-memory/memory-search.test.ts
    ├── ticker/memory-ticker.test.ts
    └── e2e/e2e-demo.test.ts
```

每个任务独立可提交，遵循 TDD：先写失败测试 → 运行确认失败 → 实现 → 运行确认通过 → 提交。

> 注意：`npm install` 需要网络，执行器在沙箱中应使用 `require_escalated` 请求批准。

---

## Task 1: 项目脚手架

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `LICENSE`（Apache-2.0 模板）

- [ ] **Step 1: 创建 package.json**

```json
{
  "name": "agent-memory",
  "version": "0.1.0",
  "description": "渐进式分层记忆系统（提取自 OpenHanako）",
  "type": "module",
  "license": "Apache-2.0",
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "demo": "tsx cli/demo.ts",
    "demo:real": "tsx cli/demo.ts --real"
  },
  "dependencies": {
    "better-sqlite3": "^11.7.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.11",
    "@types/node": "^22.10.0",
    "tsx": "^4.19.2",
    "typescript": "^5.7.2",
    "vitest": "^3.0.0"
  }
}
```

- [ ] **Step 2: 创建 tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "allowImportingTsExtensions": true,
    "noEmit": true,
    "strict": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "forceConsistentCasingInFileNames": true,
    "types": ["node"]
  },
  "include": ["src", "cli", "test", "examples", "vitest.config.ts"]
}
```

- [ ] **Step 3: 创建 vitest.config.ts**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
});
```

- [ ] **Step 4: 创建 LICENSE（Apache-2.0 全文，见 https://www.apache.org/licenses/LICENSE-2.0）**

- [ ] **Step 5: 安装依赖并验证基线**

Run: `npm install`（沙箱外，需批准）
Run: `npm run typecheck`
Expected: 退出码 0，无输出（无源码时为空编译）

- [ ] **Step 6: 提交**

```bash
git add package.json tsconfig.json vitest.config.ts LICENSE
git commit -m "chore: 项目脚手架（TS/ESM/Vitest）"
```

---

## Task 2: 基础设施——原子写与 PII 脱敏

**Files:**
- Test: `test/util/pii-guard.test.ts`
- Create: `src/util/safe-fs.ts`
- Create: `src/util/pii-guard.ts`

- [ ] **Step 1: 写失败测试 `test/util/pii-guard.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { scrubPII } from "../../src/util/pii-guard.ts";

describe("scrubPII", () => {
  it("redacts phone numbers", () => {
    const { cleaned, detected } = scrubPII("联系方式 13800138000 请查收");
    expect(cleaned).toContain("[phone]");
    expect(cleaned).not.toContain("13800138000");
    expect(detected).toContain("phone");
  });

  it("redacts emails", () => {
    const { cleaned, detected } = scrubPII("邮箱 a.b+tag@example.com 已注册");
    expect(cleaned).toContain("[email]");
    expect(cleaned).not.toContain("example.com");
    expect(detected).toContain("email");
  });

  it("redacts 18-digit id cards", () => {
    const { cleaned, detected } = scrubPII("身份证 110101199001011234");
    expect(cleaned).toContain("[id-card]");
    expect(detected).toContain("id-card");
  });

  it("returns empty detected list when clean", () => {
    const { cleaned, detected } = scrubPII("今天天气不错");
    expect(cleaned).toBe("今天天气不错");
    expect(detected).toEqual([]);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run test/util/pii-guard.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 `src/util/pii-guard.ts`**

```ts
const PATTERNS: Array<{ name: string; re: RegExp; replace: string }> = [
  { name: "phone", re: /\b1[3-9]\d{9}\b/g, replace: "[phone]" },
  { name: "email", re: /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, replace: "[email]" },
  { name: "id-card", re: /\b\d{17}[\dXx]\b/g, replace: "[id-card]" },
];

export function scrubPII(text: string): { cleaned: string; detected: string[] } {
  let cleaned = String(text ?? "");
  const detected = new Set<string>();
  for (const pattern of PATTERNS) {
    if (pattern.re.test(cleaned)) {
      detected.add(pattern.name);
      cleaned = cleaned.replace(pattern.re, pattern.replace);
    }
  }
  return { cleaned, detected: [...detected] };
}
```

- [ ] **Step 4: 实现 `src/util/safe-fs.ts`**

```ts
import fs from "node:fs";
import path from "node:path";

export function atomicWriteSync(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, content, "utf-8");
  fs.renameSync(tmp, filePath);
}

export function safeReadFile(filePath: string, fallback = ""): string {
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch (err: any) {
    if (err?.code === "ENOENT") return fallback;
    throw err;
  }
}
```

- [ ] **Step 5: 运行测试确认通过 + typecheck**

Run: `npx vitest run test/util/pii-guard.test.ts && npm run typecheck`
Expected: 4 passed；typecheck 退出码 0

- [ ] **Step 6: 提交**

```bash
git add src/util test/util
git commit -m "feat: 原子写与 PII 脱敏工具"
```

---

## Task 3: 时间——逻辑日与时间上下文

**Files:**
- Test: `test/time/logical-day.test.ts`
- Test: `test/time/time-context.test.ts`
- Create: `src/time/logical-day.ts`
- Create: `src/time/time-context.ts`

- [ ] **Step 1: 写失败测试 `test/time/logical-day.test.ts`**

```ts
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
```

- [ ] **Step 2: 写失败测试 `test/time/time-context.test.ts`**

```ts
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

  it("combines single source date with HH:MM from summary", () => {
    const context = buildFactTimeContext({
      summary: "用户在 14:30 讨论了记忆系统",
      source_time_range: { timezone: "Asia/Shanghai", localDates: ["2026-08-02"] },
    }, { timeZone: "Asia/Shanghai" });
    expect(normalizeFactTime("14:30", context)).toBe("2026-08-02T14:30");
  });

  it("returns null when time is absent from summary signals", () => {
    const context = buildFactTimeContext({
      summary: "用户讨论了记忆系统",
      source_time_range: { timezone: "Asia/Shanghai", localDates: ["2026-08-02"] },
    }, { timeZone: "Asia/Shanghai" });
    expect(normalizeFactTime("14:30", context)).toBeNull();
  });
});
```

- [ ] **Step 3: 运行测试确认失败**

Run: `npx vitest run test/time`
Expected: FAIL（模块不存在）

- [ ] **Step 4: 实现 `src/time/logical-day.ts`**

```ts
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
```

- [ ] **Step 5: 实现 `src/time/time-context.ts`**

```ts
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
```

- [ ] **Step 6: 运行测试确认通过 + typecheck**

Run: `npx vitest run test/time && npm run typecheck`
Expected: 7 passed；typecheck 退出码 0

- [ ] **Step 7: 提交**

```bash
git add src/time test/time
git commit -m "feat: 逻辑日与时间上下文"
```

---

## Task 4: LLM 接口与确定性 FakeLLM

**Files:**
- Test: `test/llm/fake-llm.test.ts`
- Create: `src/llm/types.ts`
- Create: `src/llm/fake-llm.ts`

- [ ] **Step 1: 写失败测试 `test/llm/fake-llm.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { FakeLLM } from "../../src/llm/fake-llm.ts";
import type { LLMInput } from "../../src/llm/types.ts";

const rollingInput: LLMInput = {
  system: "### Key Facts 与 ### Timeline",
  user: "## 新对话\n\n[2026-08-02 10:00] 用户：我喜欢极简风格\n[2026-08-02 10:05] 助手：已记录",
  maxTokens: 300,
};

describe("FakeLLM", () => {
  it("produces contract-shaped rolling summaries", async () => {
    const fake = new FakeLLM();
    const { text } = await fake.chat(rollingInput);
    expect(text).toMatch(/### Key Facts/);
    expect(text).toMatch(/### Timeline/);
    expect(text).toContain("极简风格");
  });

  it("extracts facts as JSON array", async () => {
    const fake = new FakeLLM();
    const { text } = await fake.chat({
      system: "你是记忆拆分器",
      user: "## 当前摘要\n\n用户喜欢极简风格",
      maxTokens: 1024,
    });
    const facts = JSON.parse(text);
    expect(Array.isArray(facts)).toBe(true);
    expect(facts[0].fact).toContain("极简风格");
    expect(typeof facts[0].tags).toBe("object");
  });

  it("allows handler override for deterministic tests", async () => {
    const fake = new FakeLLM({
      compileToday: () => "- 用户讨论了记忆系统",
    });
    const { text } = await fake.chat({
      system: "今日草稿",
      user: "anything",
      maxTokens: 200,
    });
    expect(text).toBe("- 用户讨论了记忆系统");
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run test/llm/fake-llm.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 `src/llm/types.ts`**

```ts
export interface LLMInput {
  system: string;
  user: string;
  maxTokens: number;
  temperature?: number;
}

export interface LLMOutput {
  text: string;
}

export interface LLMProvider {
  chat(input: LLMInput): Promise<LLMOutput>;
}
```

- [ ] **Step 4: 实现 `src/llm/fake-llm.ts`**

```ts
import type { LLMInput, LLMProvider } from "./types.ts";

type Operation =
  | "rollingSummary"
  | "compileToday"
  | "compileDaily"
  | "compileLongterm"
  | "compileEditableFacts"
  | "extractFacts";

export type FakeLLMHandlers = Partial<Record<Operation, (input: LLMInput) => string>>;

function isZhSystem(system: string): boolean {
  return /重要事实|事情经过|今日草稿|蒸馏|长期情况|记忆拆分器/.test(system);
}

function detectOperation(system: string): Operation {
  if (/(记忆拆分器|memory splitter)/.test(system)) return "extractFacts";
  if (/(今日草稿|today draft)/.test(system)) return "compileToday";
  if (/(蒸馏|Distill)/.test(system)) return "compileDaily";
  if (/(长期情况|long-term context)/.test(system)) return "compileLongterm";
  if (/(Key Facts|重要事实)/.test(system) && /(Timeline|事情经过)/.test(system)) return "rollingSummary";
  if (/(Facts|事实)/.test(system)) return "compileEditableFacts";
  return "rollingSummary";
}

function profileLines(text: string): string[] {
  const lines: string[] = [];
  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = raw.replace(/^-\s+/, "").trim();
    if (!line) continue;
    if (/(用户|喜欢|关注|身份|爱好|项目|user|like|focus|profile)/i.test(line)) lines.push(line);
  }
  return lines;
}

function timestampLines(text: string): string[] {
  const lines: string[] = [];
  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = raw.replace(/^-\s+/, "").trim();
    if (/\d{4}-\d{2}-\d{2}/.test(line)) lines.push(line);
  }
  return lines;
}

function bulletize(items: string[], zh: boolean, none: string): string {
  const list = items.slice(0, 5).map((item) => `- ${item}`);
  return list.length > 0 ? list.join("\n") : `- ${none}`;
}

const DEFAULT_HANDLERS: Record<Operation, (input: LLMInput) => string> = {
  rollingSummary: (input) => {
    const zh = isZhSystem(input.system);
    const facts = bulletize(profileLines(input.user), zh, zh ? "无" : "None");
    const timeline = bulletize(timestampLines(input.user), zh, zh ? "无" : "None");
    const factTitle = zh ? "重要事实" : "Key Facts";
    const timelineTitle = zh ? "事情经过" : "Timeline";
    return `### ${factTitle}\n\n${facts}\n\n### ${timelineTitle}\n\n${timeline}`;
  },
  compileToday: (input) => bulletize(timestampLines(input.user), isZhSystem(input.system), isZhSystem(input.system) ? "今日无重要事件" : "No significant events today"),
  compileDaily: (input) => {
    const facts = profileLines(input.user);
    return facts.length > 0 ? `这一天用户主要围绕：${facts[0]}。` : "今日无重要安排。";
  },
  compileLongterm: (input) => bulletize(profileLines(input.user), isZhSystem(input.system), isZhSystem(input.system) ? "暂无长期沉淀" : "No long-term context yet"),
  compileEditableFacts: (input) => bulletize(profileLines(input.user), isZhSystem(input.system), isZhSystem(input.system) ? "无" : "None"),
  extractFacts: (input) => {
    const facts = profileLines(input.user).map((fact) => ({
      fact,
      tags: ["user-profile"],
      time: null,
    }));
    return JSON.stringify(facts);
  },
};

export class FakeLLM implements LLMProvider {
  constructor(private handlers: FakeLLMHandlers = {}) {}

  async chat(input: LLMInput): Promise<{ text: string }> {
    const operation = detectOperation(input.system);
    const handler = this.handlers[operation] ?? DEFAULT_HANDLERS[operation];
    return { text: handler(input) };
  }
}
```

- [ ] **Step 5: 运行测试确认通过 + typecheck**

Run: `npx vitest run test/llm && npm run typecheck`
Expected: 3 passed；typecheck 退出码 0

- [ ] **Step 6: 提交**

```bash
git add src/llm test/llm
git commit -m "feat: LLMProvider 接口与确定性 FakeLLM"
```

---

## Task 5: 滚动摘要格式契约（单一来源）

**Files:**
- Test: `test/summary/rolling-summary-format.test.ts`
- Create: `src/summary/rolling-summary-format.ts`

- [ ] **Step 1: 写失败测试 `test/summary/rolling-summary-format.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import {
  buildRollingSummaryFormatRequirements,
  extractFactSection,
  extractMarkdownSection,
  getFactSectionTitle,
  hasFactSectionHeading,
  isEmptyFactSection,
  validateRollingSummaryFormat,
} from "../../src/summary/rolling-summary-format.ts";

describe("rolling-summary-format", () => {
  it("prompt requirements contain the exact zh titles", () => {
    const zh = buildRollingSummaryFormatRequirements("zh-CN");
    expect(zh).toContain("### 重要事实");
    expect(zh).toContain("### 事情经过");
    const en = buildRollingSummaryFormatRequirements("en-US");
    expect(en).toContain("### Key Facts");
    expect(en).toContain("### Timeline");
  });

  it("validates a well-formed summary", () => {
    const text = "### 重要事实\n\n- 用户喜欢极简风格\n\n### 事情经过\n\n- 2026-08-02 10:00 讨论记忆系统";
    expect(validateRollingSummaryFormat(text).ok).toBe(true);
  });

  it("rejects a summary missing the timeline heading", () => {
    const result = validateRollingSummaryFormat("### 重要事实\n\n- 用户喜欢极简风格");
    expect(result.ok).toBe(false);
    expect(result.issues.join()).toContain("timeline");
  });

  it("rejects an empty facts body", () => {
    const text = "### 重要事实\n\n### 事情经过\n\n- 2026-08-02 10:00 讨论记忆系统";
    expect(validateRollingSummaryFormat(text).ok).toBe(false);
  });

  it("extracts the facts section", () => {
    const text = "### 重要事实\n\n- 用户喜欢极简风格\n\n### 事情经过\n\n- 2026-08-02 10:00 讨论记忆系统";
    expect(extractFactSection(text)).toContain("极简风格");
    expect(extractMarkdownSection(text, ["事情经过"])).toContain("讨论记忆系统");
    expect(hasFactSectionHeading(text)).toBe(true);
    expect(isEmptyFactSection("- 无")).toBe(true);
    expect(getFactSectionTitle("en-US")).toBe("Key Facts");
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run test/summary/rolling-summary-format.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 `src/summary/rolling-summary-format.ts`**

```ts
export const FACT_SECTION_TITLES = ["重要事实", "Key Facts"];
export const TIMELINE_SECTION_TITLES = ["事情经过", "Timeline"];
export const MAX_ROLLING_SUMMARY_FORMAT_REPAIRS = 1;

function isZhLocale(locale: string): boolean {
  return String(locale || "").startsWith("zh");
}

export function getFactSectionTitle(locale = "zh-CN"): string {
  return isZhLocale(locale) ? FACT_SECTION_TITLES[0] : FACT_SECTION_TITLES[1];
}

export function getTimelineSectionTitle(locale = "zh-CN"): string {
  return isZhLocale(locale) ? TIMELINE_SECTION_TITLES[0] : TIMELINE_SECTION_TITLES[1];
}

export function buildRollingSummaryFormatRequirements(locale = "zh-CN"): string {
  if (!isZhLocale(locale)) {
    return `## Output Format
The final answer must contain exactly two third-level headings, with fixed text and order:
1. The first line must be \`### Key Facts\`
2. The second heading must be \`### Timeline\`
The body under both headings must use unordered lists. Each list item must start with \`- \`.
If a section has no content, output one list item: \`- None\`.
Do not output any preamble, conclusion, XML tags, or code fences outside those headings.`;
  }
  return `## 输出格式
最终答案必须只包含两个三级标题，标题文本和顺序固定：
1. 第一行必须是 \`### 重要事实\`
2. 第二个标题必须是 \`### 事情经过\`
两个标题下的正文都必须使用无序列表。列表项必须以 \`- \` 开头。
如果某一节没有内容，也要输出一个列表项：\`- 无\`。
标题之外不要输出前言、后记、XML 标签或代码块。`;
}

export function parseMarkdownHeading(line: string): { level: number; title: string } | null {
  const match = /^(#{1,6})[ \t]+(.+?)[ \t]*$/.exec(String(line || ""));
  if (!match) return null;
  return {
    level: match[1].length,
    title: match[2].replace(/[ \t]+#+[ \t]*$/, "").trim(),
  };
}

function normalizeHeadingTitle(title: string): string {
  return String(title || "").trim().toLowerCase();
}

export function extractMarkdownSection(markdown: string, titles: string[]): string {
  if (!markdown) return "";
  const wanted = new Set(titles.map(normalizeHeadingTitle));
  const lines = String(markdown).split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const heading = parseMarkdownHeading(lines[i]);
    if (!heading || !wanted.has(normalizeHeadingTitle(heading.title))) continue;
    const body: string[] = [];
    for (let j = i + 1; j < lines.length; j++) {
      const next = parseMarkdownHeading(lines[j]);
      if (next && next.level <= heading.level) break;
      body.push(lines[j]);
    }
    return body.join("\n").trim();
  }
  return "";
}

export function hasFactSectionHeading(markdown: string): boolean {
  if (!markdown) return false;
  const wanted = new Set(FACT_SECTION_TITLES.map(normalizeHeadingTitle));
  for (const line of String(markdown).split(/\r?\n/)) {
    const heading = parseMarkdownHeading(line);
    if (heading && wanted.has(normalizeHeadingTitle(heading.title))) return true;
  }
  return false;
}

export function extractFactSection(markdown: string): string {
  return extractMarkdownSection(markdown, FACT_SECTION_TITLES);
}

export function isEmptyFactSection(text: string): boolean {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return true;
  return lines.every((line) => {
    const item = line.replace(/^[-*+][ \t]+/, "").trim().toLowerCase();
    return item === "无" || item === "none";
  });
}

function findHeading(lines: string[], titles: string[]): { index: number; level: number } | null {
  const wanted = new Set(titles.map(normalizeHeadingTitle));
  for (let i = 0; i < lines.length; i++) {
    const heading = parseMarkdownHeading(lines[i]);
    if (heading && wanted.has(normalizeHeadingTitle(heading.title))) {
      return { index: i, level: heading.level };
    }
  }
  return null;
}

export function validateRollingSummaryFormat(text: string): { ok: boolean; issues: string[] } {
  const issues: string[] = [];
  const lines = String(text || "").split(/\r?\n/);
  const fact = findHeading(lines, FACT_SECTION_TITLES);
  const timeline = findHeading(lines, TIMELINE_SECTION_TITLES);
  if (!fact) issues.push('missing fact section heading ("### 重要事实" / "### Key Facts")');
  if (!timeline) issues.push('missing timeline section heading ("### 事情经过" / "### Timeline")');
  if (fact && timeline && timeline.index > fact.index && timeline.level > fact.level) {
    issues.push("timeline heading is nested deeper than the fact heading, so the fact section cannot be delimited");
  }
  if (fact) {
    const body = extractFactSection(text);
    if (!body) issues.push('fact section body is empty; write "- 无" / "- None" when there are no facts');
  }
  return { ok: issues.length === 0, issues };
}
```

- [ ] **Step 4: 运行测试确认通过 + typecheck**

Run: `npx vitest run test/summary/rolling-summary-format.test.ts && npm run typecheck`
Expected: 5 passed；typecheck 退出码 0

- [ ] **Step 5: 提交**

```bash
git add src/summary/rolling-summary-format.ts test/summary/rolling-summary-format.test.ts
git commit -m "feat: 滚动摘要格式契约单一来源"
```

---

## Task 6: 滚动摘要管理器

**Files:**
- Test: `test/summary/session-summary.test.ts`
- Create: `src/summary/prompts/rolling-summary.ts`
- Create: `src/summary/session-summary.ts`

- [ ] **Step 1: 写失败测试 `test/summary/session-summary.test.ts`**

```ts
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
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-memory-summary-"));
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
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run test/summary/session-summary.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 `src/summary/prompts/rolling-summary.ts`**

```ts
import {
  buildRollingSummaryFormatRequirements,
  getFactSectionTitle,
  getTimelineSectionTitle,
} from "../rolling-summary-format.ts";

export interface RollingSummaryPromptOptions {
  locale?: string;
  existingSummary?: string;
  conversationText?: string;
  factBudget?: number;
  timelineBudget?: number;
  memorySnapshot?: Record<string, string>;
}

export function buildRollingSummaryPrompt(opts: RollingSummaryPromptOptions = {}): { system: string; user: string } {
  const locale = opts.locale || "zh-CN";
  const isZh = locale.startsWith("zh");
  const factTitle = getFactSectionTitle(locale);
  const timelineTitle = getTimelineSectionTitle(locale);
  const snapshot = opts.memorySnapshot || {};
  const userName = snapshot.userName || (isZh ? "用户" : "the user");
  const existingMemory = snapshot.existingMemory || (isZh ? "（暂无已有长期记忆）" : "(No existing long-term memory)");
  const identity = snapshot.identityAndPersonality || (isZh ? "（未提供）" : "(Not provided)");
  const format = buildRollingSummaryFormatRequirements(locale);
  const hasPrev = Boolean(opts.existingSummary);

  const system = isZh
    ? `你正在整理自己刚刚经历的一段对话。你已拥有的身份与记忆如下，它们是背景而非新增事实。

## 你的身份与人格
${identity}

## 你已有的长期记忆
${existingMemory}

## 核心原则
记忆的职责是维护你对 ${userName} 的理解：优先记录用户是谁、喜欢什么、在意什么、最近关注的大主题。只记录"做了什么"，不记录回复的具体内容与即时想法。

${format}

## 内容要求
**${factTitle} 一节**：只记录用户画像信息（身份、性格、审美、兴趣、喜恶、长期关系、当前关注的大主题）。不抽取工作方式偏好、协作流程、工具偏好、工程规范、单次任务的格式与临时判断。拿不准一律不写。

**${timelineTitle} 一节**：按时间顺序记录本 session 发生了什么，每条带 YYYY-MM-DD HH:MM 时间戳；工作内容只保留到大主题层面（如"用户讨论了记忆系统"），不写子问题、方案、文件名、命令、测试等细节。

## 规则
1. 有已有摘要时合并新旧内容，同一主题以新信息为准，不重复。
2. 时间标注从消息时间戳提取（YYYY-MM-DD HH:MM）。
3. 只记录客观事实，不记录情绪与内心想法。
4. 宁短勿长：摘要长度与信息密度成正比。`
    : `You are reviewing a conversation you just experienced. Below is the identity and memory you already had; treat them as background, not new facts.

## Your Identity And Personality
${identity}

## Your Existing Long-Term Memory
${existingMemory}

## Core Principle
Memory's core job is to maintain your understanding of ${userName}: who they are, what they like, what they care about, and the broad themes they are currently focused on. Record only what was done, not the content of replies or transient thoughts.

${format}

## Content Requirements
**${factTitle} section**: only user-profile information (identity, personality, aesthetics, interests, likes/dislikes, long-term relationships, broad current themes). Do NOT extract work-style preferences, collaboration-process preferences, tool preferences, engineering rules, or one-off formats. When in doubt, skip.

**${timelineTitle} section**: chronological events of this session with YYYY-MM-DD HH:MM timestamps; work content stays at broad-theme level (e.g. "the user discussed memory systems"), no subproblems, proposals, filenames, commands, or tests.

## Rules
1. When an existing summary is present, merge old and new; newer info wins for the same topic; no duplicates.
2. Extract timestamps from message timestamps (YYYY-MM-DD HH:MM).
3. Only record objective facts, not moods or inner thoughts.
4. Prefer brevity: summary length proportional to actual information density.`;

  const prevLabel = isZh ? "## 已有摘要" : "## Existing Summary";
  const newLabel = isZh ? "## 新对话" : "## New Conversation";
  const budgetLabel = isZh ? "## 本次摘要预算" : "## This Run's Summary Budget";
  const budgetText = isZh
    ? `${factTitle} 最多 ${opts.factBudget ?? 120} 字。${timelineTitle} 最多 ${opts.timelineBudget ?? 280} 字。`
    : `${factTitle} max ${Math.round((opts.factBudget ?? 120) * 0.6)} words. ${timelineTitle} max ${Math.round((opts.timelineBudget ?? 280) * 0.6)} words.`;
  const user = [
    hasPrev ? `${prevLabel}\n\n${opts.existingSummary}` : "",
    `${newLabel}\n\n${opts.conversationText ?? ""}`,
    `${budgetLabel}\n\n${budgetText}`,
  ].filter(Boolean).join("\n\n");

  return { system, user };
}
```

- [ ] **Step 4: 实现 `src/summary/session-summary.ts`**

```ts
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
    const { totalBudget } = this._rollingSummaryBudget(turnCount);
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
      maxTokens: this._rollingSummaryBudget(turnCount).visibleMaxTokens,
    });
    let summary = this._validateAndRepair(text, turnCount, llm);
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
    let summary = this._validateAndRepair(text, turnCount, llm);
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

  private _validateAndRepair(text: string, turnCount: number, llm: LLMProvider): string {
    let summary = String(text || "").trim();
    let validation = summary ? validateRollingSummaryFormat(summary) : { ok: true, issues: [] as string[] };
    let repairsUsed = 0;
    while (!validation.ok && repairsUsed < MAX_ROLLING_SUMMARY_FORMAT_REPAIRS) {
      repairsUsed += 1;
      const { visibleMaxTokens } = this._rollingSummaryBudget(turnCount);
      const repair = awaitLLM(llm, buildRollingSummaryFormatRequirements("zh-CN"), buildRepairInput(validation.issues, summary), visibleMaxTokens);
      summary = repair.trim();
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

async function awaitLLM(llm: LLMProvider, system: string, user: string, maxTokens: number): Promise<string> {
  const { text } = await llm.chat({ system, user, maxTokens });
  return text;
}
```

- [ ] **Step 5: 运行测试确认通过 + typecheck**

Run: `npx vitest run test/summary && npm run typecheck`
Expected: 9 passed；typecheck 退出码 0

- [ ] **Step 6: 提交**

```bash
git add src/summary test/summary
git commit -m "feat: 滚动摘要管理器（格式校验/修复/脏追踪）"
```

---

## Task 7: 编译记忆状态与四段快照

**Files:**
- Test: `test/compile/compiled-memory-state.test.ts`
- Create: `src/compile/compiled-memory-state.ts`
- Create: `src/compile/compiled-memory-snapshot.ts`

- [ ] **Step 1: 写失败测试 `test/compile/compiled-memory-state.test.ts`**

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  clearCompiledMemoryArtifacts,
  normalizeCompiledSectionBody,
  readCompiledResetAt,
  stripThinkTagBlocks,
  writeCompiledResetMarker,
} from "../../src/compile/compiled-memory-state.ts";
import {
  COMPILED_MEMORY_BLOCKS,
  hasCompiledMemory,
  readCompiledMemorySnapshot,
  writeCompiledMemorySnapshot,
} from "../../src/compile/compiled-memory-snapshot.ts";

describe("compiled-memory-state", () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-memory-state-")); });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("normalizes section bodies: strips headings, trims blank runs", () => {
    expect(normalizeCompiledSectionBody("## 标题\n\n- a\n\n\n- b\n")).toBe("- a\n\n- b");
    expect(stripThinkTagBlocks("<thinking>思考</thinking>内容")).toBe("内容");
  });

  it("persists and reads the compiled reset marker", () => {
    const at = "2026-08-02T00:00:00.000Z";
    writeCompiledResetMarker(dir, at);
    expect(readCompiledResetAt(dir)).toBe(at);
  });

  it("clears compiled artifacts and fingerprints", () => {
    fs.writeFileSync(path.join(dir, "memory.md"), "内容");
    fs.writeFileSync(path.join(dir, "memory.md.fingerprint"), "fp");
    clearCompiledMemoryArtifacts(dir);
    expect(fs.readFileSync(path.join(dir, "memory.md"), "utf-8")).toBe("");
    expect(fs.existsSync(path.join(dir, "memory.md.fingerprint"))).toBe(false);
  });

  it("writes and reads the four-section snapshot", () => {
    const compiled = { facts: "- 用户喜欢极简风格", today: "- 今天讨论了记忆系统", week: "", longterm: "" };
    expect(hasCompiledMemory(compiled)).toBe(true);
    expect(writeCompiledMemorySnapshot(dir, compiled)).toBe(true);
    const snapshot = readCompiledMemorySnapshot(dir);
    expect(snapshot.facts).toContain("极简风格");
    expect(snapshot.today).toContain("记忆系统");
    expect(COMPILED_MEMORY_BLOCKS.map((b) => b.key)).toEqual(["facts", "today", "week", "longterm"]);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run test/compile/compiled-memory-state.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 `src/compile/compiled-memory-state.ts`**

```ts
import fs from "node:fs";
import path from "node:path";
import { atomicWriteSync } from "../util/safe-fs.ts";

const COMPILED_FILES = ["memory.md", "facts.md", "today.md", "week.md", "longterm.md"];

export function resetMarkerPath(memoryDir: string): string {
  return path.join(memoryDir, "reset.json");
}

export function readCompiledResetAt(memoryDir: string): string | null {
  try {
    const raw = JSON.parse(fs.readFileSync(resetMarkerPath(memoryDir), "utf-8"));
    const value = raw?.compiledResetAt;
    if (!value || Number.isNaN(Date.parse(value))) return null;
    return value;
  } catch {
    return null;
  }
}

export function writeCompiledResetMarker(memoryDir: string, resetAt = new Date().toISOString()): string {
  if (!resetAt || Number.isNaN(Date.parse(resetAt))) {
    throw new Error("compiledResetAt must be an ISO timestamp");
  }
  fs.mkdirSync(memoryDir, { recursive: true });
  atomicWriteSync(
    resetMarkerPath(memoryDir),
    JSON.stringify({ compiledResetAt: resetAt, updatedAt: new Date().toISOString() }, null, 2) + "\n",
  );
  return resetAt;
}

export function clearCompiledMemoryArtifacts(memoryDir: string): void {
  fs.mkdirSync(memoryDir, { recursive: true });
  for (const name of COMPILED_FILES) {
    const filePath = path.join(memoryDir, name);
    atomicWriteSync(filePath, "");
    removeIfExists(`${filePath}.fingerprint`);
  }
}

export function stripThinkTagBlocks(value: string): string {
  return String(value || "")
    .replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>\s*/gi, "")
    .replace(/^\s*<think(?:ing)?>[\s\S]*$/i, "")
    .replace(/<\/think(?:ing)?>\s*/gi, "");
}

function parseStringArray(raw: string): string[] | null {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === "string")) return null;
    return parsed.filter((item) => item.trim());
  } catch {
    return null;
  }
}

export function normalizeCompiledSectionBody(value: string): string {
  const raw = stripThinkTagBlocks(String(value || "")).trim();
  if (!raw) return "";
  const parsedArray = parseStringArray(raw);
  const text = parsedArray ? parsedArray.map((item) => `- ${item.trim()}`).join("\n") : raw;
  return text
    .split(/\r?\n/)
    .filter((line) => !/^#{1,6}\s+\S/.test(line.trim()))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function normalizeCompiledLLMResult(value: string): string {
  const normalized = normalizeCompiledSectionBody(value);
  const text = String(value || "");
  if (!normalized && /^\s*<think(?:ing)?>/i.test(text) && !/<\/think(?:ing)?>/i.test(text)) {
    throw new Error("compiled memory returned an unterminated thinking block");
  }
  return normalized;
}

function removeIfExists(filePath: string): void {
  try {
    fs.unlinkSync(filePath);
  } catch (err: any) {
    if (err?.code !== "ENOENT") throw err;
  }
}
```

- [ ] **Step 4: 实现 `src/compile/compiled-memory-snapshot.ts`**

```ts
import fs from "node:fs";
import path from "node:path";
import { atomicWriteSync, safeReadFile } from "../util/safe-fs.ts";
import { normalizeCompiledSectionBody } from "./compiled-memory-state.ts";

export const COMPILED_MEMORY_BLOCKS = [
  { key: "facts", fileName: "facts.md", label: "重要事实" },
  { key: "today", fileName: "today.md", label: "今天" },
  { key: "week", fileName: "week.md", label: "本周早些时候" },
  { key: "longterm", fileName: "longterm.md", label: "长期情况" },
];

export function emptyCompiledMemory(): Record<string, string> {
  return Object.fromEntries(COMPILED_MEMORY_BLOCKS.map(({ key }) => [key, ""]));
}

export function normalizeCompiledMemory(value: Record<string, unknown> = {}): Record<string, string> {
  const source = value && typeof value === "object" ? value : {};
  return Object.fromEntries(COMPILED_MEMORY_BLOCKS.map(({ key }) => [
    key,
    normalizeCompiledSectionBody(typeof source[key] === "string" ? (source[key] as string) : ""),
  ]));
}

export function hasCompiledMemory(compiled: Record<string, unknown>): boolean {
  return Object.values(normalizeCompiledMemory(compiled)).some(Boolean);
}

export function readCompiledMemorySnapshot(memoryDir: string): Record<string, string> {
  return normalizeCompiledMemory(Object.fromEntries(
    COMPILED_MEMORY_BLOCKS.map(({ key, fileName }) => [key, safeReadFile(path.join(memoryDir, fileName), "")]),
  ));
}

export function writeCompiledMemorySnapshot(memoryDir: string, compiled: Record<string, string>): boolean {
  const normalized = normalizeCompiledMemory(compiled);
  if (!hasCompiledMemory(normalized)) return false;
  fs.mkdirSync(memoryDir, { recursive: true });
  for (const { key, fileName } of COMPILED_MEMORY_BLOCKS) {
    atomicWriteSync(path.join(memoryDir, fileName), normalized[key] || "");
  }
  return true;
}
```

- [ ] **Step 5: 运行测试确认通过 + typecheck**

Run: `npx vitest run test/compile/compiled-memory-state.test.ts && npm run typecheck`
Expected: 4 passed；typecheck 退出码 0

- [ ] **Step 6: 提交**

```bash
git add src/compile test/compile
git commit -m "feat: 编译记忆状态与四段快照"
```

---

## Task 8: 编译管线（传送带核心）

**Files:**
- Test: `test/compile/compile.test.ts`
- Create: `src/compile/prompts/compile.ts`
- Create: `src/compile/compile.ts`

- [ ] **Step 1: 写失败测试 `test/compile/compile.test.ts`**

```ts
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
    await summaryManager.rollingSummary(
      "s1",
      [{ role: "user", content: "用户喜欢极简风格", timestamp: `${today}T10:00:00+08:00` }],
      fake,
      { locale: "zh-CN", timeZone: "Asia/Shanghai" },
    );
    await compileEditableFacts(summaryManager, factsMd, counting, { locale: "zh-CN" });
    expect(counting.calls).toBe(1);
    expect(fs.readFileSync(factsMd, "utf-8")).toContain("极简风格");
    await compileEditableFacts(summaryManager, factsMd, counting, { locale: "zh-CN" });
    expect(counting.calls).toBe(1);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run test/compile/compile.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 `src/compile/prompts/compile.ts`（紧凑版系统提示词）**

```ts
export function buildCompileTodayPrompt(locale = "zh-CN"): string {
  return locale.startsWith("zh")
    ? "你会收到「上一版今日草稿」和「新增或修订的时间线条目（delta）」，据此更新出一份新的今日草稿。保留已沉淀内容；delta 中标「取代先前相关记述」的条目用于更新对应旧内容；同一主题的多次往返合并为一条；每条保留粗略时间锚点；工作内容只保留大主题层面；输出 3-5 条、每条 1-2 句、不超过 300 字；不要输出 Markdown 标题。"
    : "You will receive the previous today draft and new or revised timeline entries (delta). Update the draft: keep settled content by default; delta items marked \"supersedes prior mention\" update the related old content; merge multiple back-and-forths on the same topic into one event; keep a coarse time anchor per item; work content stays at broad-theme level; output 3-5 items, 1-2 sentences each, max 180 words; no Markdown headings.";
}

export function buildCompileDailyPrompt(locale = "zh-CN"): string {
  return locale.startsWith("zh")
    ? "你会收到这一天的 timeline 条目或最终版「今日草稿」，把它蒸馏成两三句话的简短日记条目。同一主题的多次往返合并为一条；保留这一天的时间感；只保留大主题层面的工作内容；不超过 60 字；不要输出日期标题和 Markdown 标题。"
    : "You will receive that day's timeline entries or the final today draft. Distill it into a short two-to-three sentence diary entry: merge repeated back-and-forths, preserve the day's sense of time, keep work at broad-theme level, max 30 words, no date heading and no Markdown headings.";
}

export function buildCompileLongtermPrompt(locale = "zh-CN"): string {
  return locale.startsWith("zh")
    ? "综合「上一份长期情况」和「新沉淀内容」，重写一份新的长期情况，必须控制在 400 字以内。只保留一年后回看仍能理解用户这个人的内容：身份、性格、审美、兴趣、喜恶、长期关系、持续关注方向。去掉单次任务、工作方式偏好、工具习惯、具体产出、某周某天的细节。不追加、要合并抽象；不要输出 Markdown 标题。"
    : "Synthesize the previous long-term context and newly settled content into one new long-term context, max 240 words. Keep only what would still help understand the user a year from now: identity, personality, aesthetics, interests, likes/dislikes, long-term relationships, persistent focus directions. Remove one-off tasks, work-style preferences, tool habits, specific outputs, week-level details. Do not append; merge and abstract; no Markdown headings.";
}

export function buildCompileEditableFactsPrompt(locale = "zh-CN"): string {
  return locale.startsWith("zh")
    ? "综合「当前可信 Facts」和「新增候选 Facts」，重写一份新的重要事实，控制在 200 字以内。只保留稳定的、跨时间有效的用户画像事实（身份、性格、审美、兴趣、喜恶、长期关系、长期关注方向）。新候选与当前事实冲突时以新为准；不追加；不要保留工作方式、协作流程、工具偏好、执行细节；不要输出 Markdown 标题。"
    : "Synthesize the current trusted facts and new candidate facts into one new Key Facts section, max 120 words. Keep only stable, time-persistent user-profile facts. New candidate facts correct current facts on conflict. Do not append; do not keep work-style, collaboration-process, tool preferences, or execution details; no Markdown headings.";
}
```

- [ ] **Step 4: 实现 `src/compile/compile.ts`**

```ts
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { LLMProvider } from "../llm/types.ts";
import { atomicWriteSync, safeReadFile } from "../util/safe-fs.ts";
import { normalizeCompiledLLMResult, normalizeCompiledSectionBody, stripThinkTagBlocks } from "./compiled-memory-state.ts";
import {
  FACT_SECTION_TITLES,
  TIMELINE_SECTION_TITLES,
  extractFactSection,
  extractMarkdownSection,
  hasFactSectionHeading,
  isEmptyFactSection,
} from "../summary/rolling-summary-format.ts";
import { getLogicalDay, shiftLogicalDate } from "../time/logical-day.ts";
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

function formatTimelineEventsForCompile(events: Array<Record<string, any>>, opts: { since?: string; includeRevisionMarker?: boolean } = {}): string {
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
  opts: { since?: string; statePath?: string; locale?: string; timeZone?: string } = {},
): Promise<"compiled" | "skipped"> {
  const memoryDir = path.dirname(outputPath);
  fs.mkdirSync(memoryDir, { recursive: true });
  const statePath = opts.statePath || todayStatePath(memoryDir);
  const logicalDate = getLogicalDay().logicalDate;
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
  if (!state.lastCompiledSummaryUpdatedAt && latest) {
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
  atomicWriteSync(memoryMdPath, buildCompiledMemoryMarkdown({ facts, today, week, longterm, locale: opts.locale }));
}
```

- [ ] **Step 5: 运行测试确认通过 + typecheck**

Run: `npx vitest run test/compile && npm run typecheck`
Expected: 12 passed；typecheck 退出码 0

- [ ] **Step 6: 提交**

```bash
git add src/compile test/compile
git commit -m "feat: 编译管线（today/daily/week/longterm/facts/assemble）"
```

---

## Task 9: 深度记忆事实库（SQLite + FTS5）

**Files:**
- Test: `test/deep-memory/fact-store.test.ts`
- Create: `src/deep-memory/fact-store.ts`

- [ ] **Step 1: 写失败测试 `test/deep-memory/fact-store.test.ts`**

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { FactStore } from "../../src/deep-memory/fact-store.ts";

describe("FactStore", () => {
  let dir: string;
  let store: FactStore;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-memory-facts-"));
    store = new FactStore(path.join(dir, "facts.db"));
    store.addBatch([
      { fact: "用户喜欢极简风格", tags: ["user-profile", "极简"], time: "2026-08-02T10:00", session_id: "s1" },
      { fact: "用户最近在关注记忆系统", tags: ["记忆系统", "近况"], time: "2026-08-03T09:00", session_id: "s1" },
      { fact: "用户是软件工程师", tags: ["user-profile", "职业"], time: "2026-08-01T08:00", session_id: "s2" },
    ]);
  });

  afterEach(() => { store.close(); fs.rmSync(dir, { recursive: true, force: true }); });

  it("finds facts by tag", () => {
    const hits = store.searchByTags(["user-profile"], undefined, 10);
    expect(hits.length).toBeGreaterThanOrEqual(2);
    expect(hits[0].matchCount).toBeGreaterThan(0);
  });

  it("finds Chinese facts by full-text search", () => {
    const hits = store.searchFullText("极简", 10);
    expect(hits.some((h) => h.fact.includes("极简"))).toBe(true);
  });

  it("falls back to LIKE for CJK queries FTS cannot parse", () => {
    const hits = store.searchFullText("记忆系统", 10);
    expect(hits.length).toBeGreaterThan(0);
  });

  it("replaces facts by session", () => {
    store.replaceBySession("s1", [{ fact: "用户改关注视频剪辑", tags: ["近况"], time: null, session_id: "s1" }]);
    const s1 = store.getBySession("s1");
    expect(s1.length).toBe(1);
    expect(s1[0].fact).toContain("视频剪辑");
  });

  it("deletes facts by session", () => {
    store.deleteBySession("s1");
    expect(store.getBySession("s1")).toEqual([]);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run test/deep-memory/fact-store.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 `src/deep-memory/fact-store.ts`**

```ts
import { createRequire } from "node:module";
import { scrubPII } from "../util/pii-guard.ts";

const require = createRequire(import.meta.url);
let BetterSqliteDatabase: any = null;

export function loadBetterSqliteDatabase(): any {
  if (!BetterSqliteDatabase) {
    const mod = require("better-sqlite3");
    BetterSqliteDatabase = mod?.default || mod;
  }
  return BetterSqliteDatabase;
}

const SCHEMA_VERSION = 2;
const CJK_RUN_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+/gu;

function normalizeSearchText(text: string): string {
  return String(text || "").normalize("NFKC").trim();
}

function parseTags(rawTags: unknown): string[] {
  try {
    const tags = Array.isArray(rawTags) ? rawTags : JSON.parse(String(rawTags || "[]"));
    return Array.isArray(tags) ? tags.filter((tag) => typeof tag === "string") : [];
  } catch {
    return [];
  }
}

function cjkNgrams(text: string): string[] {
  const tokens: string[] = [];
  CJK_RUN_RE.lastIndex = 0;
  for (const match of normalizeSearchText(text).matchAll(CJK_RUN_RE)) {
    const chars = Array.from(match[0]);
    for (const size of [2, 3]) {
      if (chars.length < size) continue;
      for (let i = 0; i <= chars.length - size; i++) {
        tokens.push(chars.slice(i, i + size).join(""));
      }
    }
  }
  return tokens;
}

function uniqueTokens(tokens: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const token of tokens) {
    const normalized = normalizeSearchText(token);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

export function buildFactSearchText(fact: string, tags: string[] = []): string {
  const base = [fact, ...tags].map(normalizeSearchText).filter(Boolean).join(" ");
  return uniqueTokens([base, ...cjkNgrams(base)]).join(" ");
}

function buildFtsQuery(query: string): string {
  const normalized = normalizeSearchText(query);
  if (!normalized) return "";
  const lexicalTokens = normalized.split(/\s+/);
  return uniqueTokens([...lexicalTokens, ...cjkNgrams(normalized)])
    .map((w) => `"${w.replace(/"/g, '""')}"`)
    .join(" OR ");
}

function hasCjk(text: string): boolean {
  CJK_RUN_RE.lastIndex = 0;
  return CJK_RUN_RE.test(normalizeSearchText(text));
}

export class FactStore {
  declare _stmts: Record<string, any>;
  declare _tagSearchCache: Map<string, any>;
  declare db: any;

  constructor(dbPath: string, opts: { Database?: any } = {}) {
    const Database = opts.Database || loadBetterSqliteDatabase();
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");
    this.db.pragma("cache_size = -16000");
    this.db.pragma("temp_store = MEMORY");
    this.db.pragma("mmap_size = 30000000");
    this._initSchema();
    this._migrate();
    this._createFtsTriggers();
    this._prepareStatements();
    this._tagSearchCache = new Map();
  }

  _initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS facts (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        fact       TEXT NOT NULL,
        search_text TEXT NOT NULL DEFAULT '',
        tags       TEXT NOT NULL DEFAULT '[]',
        time       TEXT,
        session_id TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_facts_time ON facts(time);
      CREATE INDEX IF NOT EXISTS idx_facts_session ON facts(session_id);
    `);
    try {
      this.db.exec(`
        CREATE VIRTUAL TABLE facts_fts USING fts5(
          fact,
          search_text,
          content=facts,
          content_rowid=id,
          tokenize='unicode61'
        );
      `);
    } catch {
      // table already exists
    }
  }

  _createFtsTriggers(): void {
    this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS facts_ai AFTER INSERT ON facts BEGIN
        INSERT INTO facts_fts(rowid, fact, search_text) VALUES (new.id, new.fact, new.search_text);
      END;
      CREATE TRIGGER IF NOT EXISTS facts_ad AFTER DELETE ON facts BEGIN
        INSERT INTO facts_fts(facts_fts, rowid, fact, search_text) VALUES ('delete', old.id, old.fact, old.search_text);
      END;
      CREATE TRIGGER IF NOT EXISTS facts_au AFTER UPDATE ON facts BEGIN
        INSERT INTO facts_fts(facts_fts, rowid, fact, search_text) VALUES ('delete', old.id, old.fact, old.search_text);
        INSERT INTO facts_fts(rowid, fact, search_text) VALUES (new.id, new.fact, new.search_text);
      END;
    `);
  }

  _migrate(): void {
    const current = this.db.pragma("user_version", { simple: true }) as number;
    if (current >= SCHEMA_VERSION) return;
    this.db.transaction(() => {
      let v = current;
      while (v < SCHEMA_VERSION) {
        if (v === 0) {
          const rows = this.db.prepare("SELECT id, fact, tags FROM facts").all();
          const update = this.db.prepare("UPDATE facts SET search_text = ? WHERE id = ?");
          for (const row of rows) {
            update.run(buildFactSearchText(row.fact, parseTags(row.tags)), row.id);
          }
          this.db.exec("DROP TRIGGER IF EXISTS facts_ai; DROP TRIGGER IF EXISTS facts_ad; DROP TRIGGER IF EXISTS facts_au; DROP TABLE IF EXISTS facts_fts;");
          this._initSchema();
          this._createFtsTriggers();
          this.db.exec("INSERT INTO facts_fts(facts_fts) VALUES ('rebuild')");
        }
        v += 1;
      }
      this.db.pragma(`user_version = ${SCHEMA_VERSION}`);
    })();
  }

  _prepareStatements(): void {
    this._stmts = {
      insert: this.db.prepare(`
        INSERT INTO facts (fact, search_text, tags, time, session_id, created_at)
        VALUES (@fact, @searchText, @tags, @time, @sessionId, @createdAt)
      `),
      getAll: this.db.prepare("SELECT * FROM facts ORDER BY time DESC"),
      getBySession: this.db.prepare("SELECT * FROM facts WHERE session_id = ? ORDER BY time DESC"),
      deleteBySession: this.db.prepare("DELETE FROM facts WHERE session_id = ?"),
      count: this.db.prepare("SELECT COUNT(*) as cnt FROM facts"),
      deleteById: this.db.prepare("DELETE FROM facts WHERE id = ?"),
      deleteAll: this.db.prepare("DELETE FROM facts"),
      ftsSearch: this.db.prepare(`
        SELECT f.*, rank
        FROM facts_fts fts
        JOIN facts f ON f.id = fts.rowid
        WHERE facts_fts MATCH ?
        ORDER BY rank
        LIMIT ?
      `),
    };
  }

  add(entry: { fact: string; tags?: string[]; time?: string | null; session_id?: string }): { id: number } {
    const { cleaned } = scrubPII(entry.fact);
    const now = new Date().toISOString();
    const result = this._stmts.insert.run({
      fact: cleaned,
      searchText: buildFactSearchText(cleaned, entry.tags || []),
      tags: JSON.stringify(entry.tags || []),
      time: entry.time || null,
      sessionId: entry.session_id || null,
      createdAt: now,
    });
    return { id: Number(result.lastInsertRowid) };
  }

  addBatch(entries: Array<{ fact: string; tags?: string[]; time?: string | null; session_id?: string }>): number {
    const run = this.db.transaction(() => {
      for (const entry of entries) this.add(entry);
    });
    run();
    return entries.length;
  }

  replaceBySession(sessionId: string, entries: Array<{ fact: string; tags?: string[]; time?: string | null; session_id?: string }>): number {
    const stableSessionId = String(sessionId || "").trim();
    if (!stableSessionId) throw new Error("replaceBySession requires sessionId");
    const run = this.db.transaction(() => {
      this._stmts.deleteBySession.run(stableSessionId);
      for (const entry of entries) {
        if (typeof entry?.fact !== "string" || !entry.fact.trim()) {
          throw new Error("replacement fact must be a non-empty string");
        }
        this.add({ ...entry, session_id: stableSessionId });
      }
    });
    run();
    return entries.length;
  }

  searchByTags(queryTags: string[], dateRange?: { from?: string; to?: string }, limit = 20): any[] {
    if (!queryTags || queryTags.length === 0) return [];
    const stmt = this._getTagSearchStmt(queryTags.length, dateRange);
    const params: Record<string, any> = { limit };
    for (let i = 0; i < queryTags.length; i++) params[`tag${i}`] = queryTags[i];
    if (dateRange?.from) params.dateFrom = dateRange.from;
    if (dateRange?.to) params.dateTo = dateRange.to;
    return stmt.all(params).map((row: any) => this._rowToFact(row));
  }

  _getTagSearchStmt(tagCount: number, dateRange?: { from?: string; to?: string }): any {
    const dateKey = (dateRange?.from ? 1 : 0) | (dateRange?.to ? 2 : 0);
    const cacheKey = `${tagCount}:${dateKey}`;
    let stmt = this._tagSearchCache.get(cacheKey);
    if (stmt) return stmt;
    const placeholders = Array.from({ length: tagCount }, (_, i) => `@tag${i}`).join(", ");
    let dateWhere = "";
    if (dateKey & 1) dateWhere += " AND f.time >= @dateFrom";
    if (dateKey & 2) dateWhere += " AND f.time <= @dateTo";
    const sql = `
      SELECT f.*, COUNT(DISTINCT je.value) as matchCount
      FROM facts f, json_each(f.tags) je
      WHERE je.value IN (${placeholders})${dateWhere}
      GROUP BY f.id
      ORDER BY matchCount DESC, f.time DESC
      LIMIT @limit
    `;
    stmt = this.db.prepare(sql);
    this._tagSearchCache.set(cacheKey, stmt);
    return stmt;
  }

  searchFullText(query: string, limit = 20): any[] {
    if (!query || !query.trim()) return [];
    try {
      const ftsQuery = buildFtsQuery(query);
      if (!ftsQuery) return [];
      const rows = this._stmts.ftsSearch.all(ftsQuery, limit);
      if (rows.length === 0 && hasCjk(query)) return this._likeFallback(query, limit);
      return rows.map((row: any) => this._rowToFact(row));
    } catch {
      return this._likeFallback(query, limit);
    }
  }

  _likeFallback(query: string, limit: number): any[] {
    const rows = this.db
      .prepare("SELECT * FROM facts WHERE fact LIKE '%' || ? || '%' ORDER BY time DESC LIMIT ?")
      .all(query, limit);
    return rows.map((row: any) => this._rowToFact(row));
  }

  getAll(): any[] {
    return this._stmts.getAll.all().map((row: any) => this._rowToFact(row));
  }

  getBySession(sessionId: string): any[] {
    return this._stmts.getBySession.all(sessionId).map((row: any) => this._rowToFact(row));
  }

  deleteBySession(sessionId: string): number {
    const normalized = String(sessionId || "").trim();
    if (!normalized) throw new Error("fact invalidation requires sessionId");
    return this._stmts.deleteBySession.run(normalized).changes;
  }

  get size(): number {
    return this._stmts.count.get().cnt;
  }

  delete(id: number): boolean {
    return this._stmts.deleteById.run(id).changes > 0;
  }

  clearAll(): void {
    this.db.transaction(() => {
      this._stmts.deleteAll.run();
      this.db.exec("INSERT INTO facts_fts(facts_fts) VALUES ('rebuild')");
    })();
  }

  exportAll(): any[] {
    return this.getAll();
  }

  importAll(entries: Array<{ fact: string; tags?: string[]; time?: string | null; session_id?: string }>): void {
    const run = this.db.transaction(() => {
      for (const entry of entries) {
        this.add({ fact: entry.fact, tags: entry.tags || [], time: entry.time || null, session_id: entry.session_id || null });
      }
    });
    run();
  }

  close(): void {
    if (this.db?.open) this.db.close();
  }

  _rowToFact(row: any): any {
    return {
      id: row.id,
      fact: row.fact,
      tags: parseTags(row.tags),
      time: row.time,
      session_id: row.session_id,
      created_at: row.created_at,
      matchCount: row.matchCount ?? undefined,
    };
  }
}
```

- [ ] **Step 4: 运行测试确认通过 + typecheck**

Run: `npx vitest run test/deep-memory/fact-store.test.ts && npm run typecheck`
Expected: 5 passed；typecheck 退出码 0

- [ ] **Step 5: 提交**

```bash
git add src/deep-memory/fact-store.ts test/deep-memory/fact-store.test.ts
git commit -m "feat: SQLite+FTS5 事实库（标签/CJK 全文检索）"
```

---

## Task 10: 深度记忆——脏会话事实提取

**Files:**
- Test: `test/deep-memory/deep-memory.test.ts`
- Create: `src/deep-memory/prompts/fact-extraction.ts`
- Create: `src/deep-memory/deep-memory.ts`

- [ ] **Step 1: 写失败测试 `test/deep-memory/deep-memory.test.ts`**

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SessionSummaryManager } from "../../src/summary/session-summary.ts";
import { FakeLLM } from "../../src/llm/fake-llm.ts";
import { FactStore } from "../../src/deep-memory/fact-store.ts";
import { processDirtySessions } from "../../src/deep-memory/deep-memory.ts";

describe("processDirtySessions", () => {
  let dir: string;
  let manager: SessionSummaryManager;
  let factStore: FactStore;
  const fake = new FakeLLM();

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-memory-deep-"));
    manager = new SessionSummaryManager(path.join(dir, "summaries"));
    factStore = new FactStore(path.join(dir, "facts.db"));
  });

  afterEach(() => {
    factStore.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("extracts facts from dirty sessions and marks processed", async () => {
    await manager.rollingSummary("s1", [
      { role: "user", content: "用户喜欢极简风格", timestamp: "2026-08-02T10:00:00+08:00" },
    ], fake, { locale: "zh-CN", timeZone: "Asia/Shanghai" });
    const { processed, factsAdded } = await processDirtySessions(manager, factStore, fake, {
      timeZone: "Asia/Shanghai",
    });
    expect(processed).toBe(1);
    expect(factsAdded).toBeGreaterThan(0);
    expect(manager.getDirtySessions().length).toBe(0);
    expect(factStore.size).toBeGreaterThan(0);
  });

  it("replaces session facts when factReplacementRequired", async () => {
    await manager.rollingSummary("s1", [
      { role: "user", content: "用户喜欢极简风格", timestamp: "2026-08-02T10:00:00+08:00" },
    ], fake, { locale: "zh-CN", timeZone: "Asia/Shanghai" });
    await processDirtySessions(manager, factStore, fake, { timeZone: "Asia/Shanghai" });
    await manager.replaceSessionSummary("s1", [
      { role: "user", content: "用户改关注视频剪辑", timestamp: "2026-08-03T09:00:00+08:00" },
    ], fake, { locale: "zh-CN", timeZone: "Asia/Shanghai" });
    await processDirtySessions(manager, factStore, fake, { timeZone: "Asia/Shanghai" });
    const facts = factStore.getBySession("s1");
    expect(facts.some((f) => f.fact.includes("视频剪辑"))).toBe(true);
    expect(facts.some((f) => f.fact.includes("极简风格"))).toBe(false);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run test/deep-memory/deep-memory.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 `src/deep-memory/prompts/fact-extraction.ts`**

```ts
export function buildFactExtractionPrompt({ locale = "zh-CN", hasPrevious = false } = {}): string {
  const isZh = String(locale || "").startsWith("zh");
  if (isZh) {
    const diffInstruction = hasPrevious
      ? "你会收到两部分输入：上次快照与当前摘要。找出当前摘要相对上次快照新增或变化的内容，拆分成独立元事实；已存在于上次快照的内容不要重复提取。"
      : "将以下摘要内容拆分成独立元事实。";
    return `你是记忆拆分器。${diffInstruction}

## 规则
1. 只提取关于用户画像和粗略当前状态的客观事实。用户画像包括身份、性格特质、审美、兴趣、喜恶、长期关系、长期关注方向；粗略当前状态包括用户最近关注的领域/项目/大主题。
2. 不提取工作方式偏好、协作流程偏好、工具偏好、项目工程规则、文件名、命令、测试、发布等执行细节。描述"以后遇到类似任务应该怎么做"的事实应进入经验库或技能，不进记忆事实。
3. 每条事实必须原子化（一条只记一件事）。
4. 标签用于后续检索，选择有辨识度的关键词，每条 2-5 个。
5. time 字段从摘要中的时间标注和时间上下文提取，格式 YYYY-MM-DDTHH:MM；只使用摘要正文或时间上下文明确出现的日期；摘要只有 HH:MM 且时间上下文只有单一本地日期时合并；跨多日且只有 HH:MM 时填 null；无法确定时填 null。
6. 不提取助手内心活动，只提取客观事实和事件。
7. 没有值得提取的新内容时返回空数组 []。

## 输出格式
严格 JSON 数组，不要 markdown 代码块：
[{"fact": "用户最近在关注记忆系统", "tags": ["记忆系统", "近况"], "time": null}]`;
  }
  const diffInstruction = hasPrevious
    ? "You will receive two inputs: the previous snapshot and the current summary. Find content that is new or changed in the current summary and split it into independent atomic facts; do not re-extract content already present in the previous snapshot."
    : "Split the following summary content into independent atomic facts.";
  return `You are a memory splitter. ${diffInstruction}

## Rules
1. Extract only objective facts about the user profile and coarse current state: identity, personality traits, aesthetics, interests, likes/dislikes, long-term relationships, long-term focus directions; coarse current state includes the broad domain/project/theme the user is recently focused on.
2. Do not extract work-style preferences, collaboration-process preferences, tool preferences, engineering rules, filenames, commands, tests, releases, or other execution details.
3. Each fact must be atomic (one fact per entry).
4. Tags are for later retrieval; choose 2-5 distinctive keywords.
5. The time field uses YYYY-MM-DDTHH:MM format from the summary and Time Context; use only dates explicitly present; combine HH:MM with a single local date when unambiguous; use null when spanning multiple dates or when unknown.
6. Do not extract the assistant's inner thoughts.
7. Return an empty array [] when there is nothing new.

## Output Format
Strict JSON array, no markdown code blocks:
[{"fact": "The user has recently been focused on memory systems", "tags": ["memory-systems", "current-state"], "time": null}]`;
}
```

- [ ] **Step 4: 实现 `src/deep-memory/deep-memory.ts`**

```ts
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
    .getDirtySessions({ since: opts.since || null })
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
    } catch (err: any) {
      cleanExpiredFailCounts();
      const prev = _failCounts.get(session.session_id);
      const count = (prev?.count || 0) + 1;
      _failCounts.set(session.session_id, { count, lastUpdated: Date.now() });
      if (count >= MAX_RETRIES && session.factReplacementRequired !== true) {
        summaryManager.markProcessedIfCurrent(session.session_id, expectedRevision);
        _failCounts.delete(session.session_id);
      } else if (count >= MAX_RETRIES) {
        // replacement stays dirty; retried next daily pass
      } else {
        throw err;
      }
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
```

- [ ] **Step 5: 运行测试确认通过 + typecheck**

Run: `npx vitest run test/deep-memory/deep-memory.test.ts && npm run typecheck`
Expected: 2 passed；typecheck 退出码 0

- [ ] **Step 6: 提交**

```bash
git add src/deep-memory test/deep-memory
git commit -m "feat: 深度记忆脏会话事实提取"
```

---

## Task 11: search_memory 检索

**Files:**
- Test: `test/deep-memory/memory-search.test.ts`
- Create: `src/deep-memory/memory-search.ts`

- [ ] **Step 1: 写失败测试 `test/deep-memory/memory-search.test.ts`**

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { FactStore } from "../../src/deep-memory/fact-store.ts";
import { createMemorySearch } from "../../src/deep-memory/memory-search.ts";

describe("createMemorySearch", () => {
  let dir: string;
  let store: FactStore;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-memory-search-"));
    store = new FactStore(path.join(dir, "facts.db"));
    store.addBatch([
      { fact: "用户喜欢极简风格", tags: ["user-profile", "极简"], time: "2026-08-02T10:00", session_id: "s1" },
      { fact: "用户最近在关注记忆系统", tags: ["记忆系统", "近况"], time: "2026-08-03T09:00", session_id: "s1" },
    ]);
  });

  afterEach(() => {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("prioritizes tag hits", async () => {
    const search = createMemorySearch(store);
    const { results } = await search({ tags: ["user-profile"] });
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].source).toBe("tag");
  });

  it("falls back to full-text when tag hits are insufficient", async () => {
    const search = createMemorySearch(store);
    const { results } = await search({ query: "极简" });
    expect(results.some((r) => r.fact.includes("极简"))).toBe(true);
  });

  it("applies date filters", async () => {
    const search = createMemorySearch(store);
    const { results } = await search({ query: "用户", date_from: "2026-08-03", date_to: "2026-08-03" });
    expect(results.every((r) => (r.time ?? "") >= "2026-08-03" && (r.time ?? "") <= "2026-08-03T23:59")).toBe(true);
  });

  it("returns empty text when nothing matches", async () => {
    const search = createMemorySearch(store);
    const { results, text } = await search({ query: "不存在的关键词xyz" });
    expect(results.length).toBe(0);
    expect(text).toContain("没有");
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run test/deep-memory/memory-search.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 `src/deep-memory/memory-search.ts`**

```ts
import type { FactStore } from "./fact-store.ts";

export interface MemorySearchParams {
  query?: string;
  tags?: string[];
  date_from?: string;
  date_to?: string;
  limit?: number;
}

export interface MemorySearchHit {
  id: number;
  fact: string;
  tags: string[];
  time: string | null;
  session_id: string | null;
  source: "tag" | "fts";
  matchCount?: number;
}

export interface MemorySearchResult {
  results: MemorySearchHit[];
  text: string;
}

export function createMemorySearch(factStore: FactStore): (params: MemorySearchParams) => Promise<MemorySearchResult> {
  return async function searchMemory(params: MemorySearchParams): Promise<MemorySearchResult> {
    if (factStore.size === 0) {
      return { results: [], text: "记忆库为空，暂无事实。" };
    }
    const dateRange: { from?: string; to?: string } = {};
    if (params.date_from) dateRange.from = params.date_from;
    if (params.date_to) dateRange.to = `${params.date_to}T23:59`;

    const results: MemorySearchHit[] = [];
    const seenIds = new Set<number>();

    if (params.tags && params.tags.length > 0) {
      const tagResults = factStore.searchByTags(params.tags, Object.keys(dateRange).length > 0 ? dateRange : undefined, 15);
      for (const r of tagResults) {
        if (seenIds.has(r.id)) continue;
        seenIds.add(r.id);
        results.push({ ...r, source: "tag" });
      }
    }

    if (results.length < 3 && params.query) {
      const ftsResults = factStore.searchFullText(params.query, 10);
      for (const r of ftsResults) {
        if (seenIds.has(r.id)) continue;
        seenIds.add(r.id);
        results.push({ ...r, source: "fts" });
      }
    }

    if (dateRange.from || dateRange.to) {
      for (let i = results.length - 1; i >= 0; i--) {
        const r = results[i];
        if (!r.time) continue;
        if (dateRange.from && r.time < dateRange.from) results.splice(i, 1);
        else if (dateRange.to && r.time > dateRange.to) results.splice(i, 1);
      }
    }

    if (results.length === 0) {
      return { results: [], text: "没有找到相关记忆。" };
    }
    const lines = results.map((r, i) => {
      const tagsStr = r.tags.length > 0 ? ` (${r.tags.join(", ")})` : "";
      const timeStr = r.time ? ` — ${r.time}` : "";
      return `${i + 1}. ${r.fact}${tagsStr}${timeStr}`;
    });
    return { results, text: lines.join("\n") };
  };
}
```

- [ ] **Step 4: 运行测试确认通过 + typecheck**

Run: `npx vitest run test/deep-memory/memory-search.test.ts && npm run typecheck`
Expected: 4 passed；typecheck 退出码 0

- [ ] **Step 5: 提交**

```bash
git add src/deep-memory/memory-search.ts test/deep-memory/memory-search.test.ts
git commit -m "feat: search_memory 标签优先+全文兜底检索"
```

---

## Task 12: 置顶记忆（pinned.md 双写）

**Files:**
- Test: `test/pinned/pinned-memory-store.test.ts`
- Create: `src/pinned/pinned-memory-store.ts`

- [ ] **Step 1: 写失败测试 `test/pinned/pinned-memory-store.test.ts`**

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  addPinnedMemoryItem,
  readPinnedMemoryItems,
  removePinnedMemoryItems,
  replacePinnedMemoryItems,
} from "../../src/pinned/pinned-memory-store.ts";

describe("pinned-memory-store", () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-memory-pinned-")); });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("adds and reads items with dual-file persistence", () => {
    const { item } = addPinnedMemoryItem(dir, "记住：用户叫玛丽");
    expect(item?.content).toBe("记住：用户叫玛丽");
    const items = readPinnedMemoryItems(dir);
    expect(items.map((i) => i.content)).toContain("记住：用户叫玛丽");
    expect(fs.existsSync(path.join(dir, "pinned.md"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "pinned-memory.json"))).toBe(true);
  });

  it("dedupes identical content", () => {
    addPinnedMemoryItem(dir, "内容A");
    const { alreadyExists } = addPinnedMemoryItem(dir, "内容A");
    expect(alreadyExists).toBe(true);
    expect(readPinnedMemoryItems(dir).length).toBe(1);
  });

  it("removes by keyword and by id", () => {
    const { item } = addPinnedMemoryItem(dir, "待删除内容");
    const byKeyword = removePinnedMemoryItems(dir, { keyword: "待删除" });
    expect(byKeyword.removed.length).toBe(1);
    const { item: item2 } = addPinnedMemoryItem(dir, "另一条");
    const byId = removePinnedMemoryItems(dir, { id: item2!.id });
    expect(byId.removed.length).toBe(1);
    expect(readPinnedMemoryItems(dir).length).toBe(0);
  });

  it("replaces all items", () => {
    replacePinnedMemoryItems(dir, ["新1", "新2"]);
    expect(readPinnedMemoryItems(dir).length).toBe(2);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run test/pinned/pinned-memory-store.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 `src/pinned/pinned-memory-store.ts`**

```ts
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { atomicWriteSync } from "../util/safe-fs.ts";

const STORE_FILE = "pinned-memory.json";
const MARKDOWN_FILE = "pinned.md";
const SCHEMA_VERSION = 1;

export interface PinnedMemoryItem {
  id: string;
  content: string;
  createdAt?: string;
}

function pinnedPath(agentDir: string): string {
  return path.join(agentDir, MARKDOWN_FILE);
}

function storePath(agentDir: string): string {
  return path.join(agentDir, STORE_FILE);
}

function normalizeContent(value: unknown): string {
  return String(value ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
}

function normalizeId(value: unknown): string {
  return String(value ?? "").trim();
}

function makeId(content: string, index: number | null = null): string {
  const suffix = index === null
    ? crypto.randomUUID()
    : crypto.createHash("sha256").update(`${index}\0${content}`).digest("hex").slice(0, 20);
  return `pin_${suffix}`;
}

function normalizeItem(raw: any, index: number): PinnedMemoryItem | null {
  const content = normalizeContent(raw?.content);
  if (!content) return null;
  const id = normalizeId(raw?.id) || makeId(content, index);
  const createdAt = typeof raw?.createdAt === "string" && raw.createdAt.trim() ? raw.createdAt : null;
  return createdAt ? { id, content, createdAt } : { id, content };
}

function serializeItems(items: PinnedMemoryItem[]): { version: number; items: PinnedMemoryItem[] } {
  return {
    version: SCHEMA_VERSION,
    items: items.map((item, index) => {
      const normalized = normalizeItem(item, index);
      if (!normalized) throw new Error("Pinned memory item content must be a non-empty string");
      return normalized;
    }),
  };
}

export function renderPinnedMarkdown(items: PinnedMemoryItem[]): string {
  const lines = items.flatMap((item) => {
    const contentLines = normalizeContent(item.content).split("\n");
    return contentLines.map((line, index) => (index === 0 ? `- ${line}` : `  ${line}`));
  });
  return lines.length > 0 ? `${lines.join("\n")}\n` : "";
}

function parseLegacyPinnedMarkdown(content: string): PinnedMemoryItem[] {
  const text = String(content ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = text.endsWith("\n") ? text.slice(0, -1).split("\n") : text.split("\n");
  const rawItems: string[] = [];
  let current: string | null = null;
  for (const line of lines) {
    const bullet = line.match(/^-\s(.*)$/);
    if (bullet) {
      if (current !== null) rawItems.push(current);
      current = bullet[1];
      continue;
    }
    if (current === null) {
      if (line.trim()) current = line;
      continue;
    }
    current += `\n${line.replace(/^ {2}/, "")}`;
  }
  if (current !== null) rawItems.push(current);
  return rawItems
    .map((content, index) => normalizeItem({ id: makeId(content, index), content }, index))
    .filter((item): item is PinnedMemoryItem => Boolean(item));
}

function readMarkdownIfExists(agentDir: string): string {
  try {
    return fs.readFileSync(pinnedPath(agentDir), "utf-8");
  } catch (err: any) {
    if (err?.code === "ENOENT") return "";
    throw err;
  }
}

function readStoreItems(agentDir: string): PinnedMemoryItem[] {
  const raw = fs.readFileSync(storePath(agentDir), "utf-8");
  const parsed = JSON.parse(raw);
  if (!parsed || parsed.version !== SCHEMA_VERSION || !Array.isArray(parsed.items)) {
    throw new Error(`Invalid pinned memory store schema in ${storePath(agentDir)}`);
  }
  return serializeItems(parsed.items).items;
}

function shouldPreferMarkdown(agentDir: string): boolean {
  try {
    const markdownStat = fs.statSync(pinnedPath(agentDir));
    const storeStat = fs.statSync(storePath(agentDir));
    return markdownStat.mtimeMs > storeStat.mtimeMs + 1;
  } catch {
    return false;
  }
}

export function writePinnedMemoryItems(agentDir: string, items: PinnedMemoryItem[]): PinnedMemoryItem[] {
  const data = serializeItems(items);
  fs.mkdirSync(agentDir, { recursive: true });
  atomicWriteSync(pinnedPath(agentDir), renderPinnedMarkdown(data.items));
  atomicWriteSync(storePath(agentDir), `${JSON.stringify(data, null, 2)}\n`);
  return data.items;
}

export function readPinnedMemoryItems(agentDir: string): PinnedMemoryItem[] {
  let items: PinnedMemoryItem[];
  if (fs.existsSync(storePath(agentDir)) && !shouldPreferMarkdown(agentDir)) {
    items = readStoreItems(agentDir);
  } else {
    items = parseLegacyPinnedMarkdown(readMarkdownIfExists(agentDir));
  }
  return writePinnedMemoryItems(agentDir, items);
}

export function addPinnedMemoryItem(agentDir: string, content: string): {
  item: PinnedMemoryItem | null;
  items: PinnedMemoryItem[];
  alreadyExists: boolean;
} {
  const normalized = normalizeContent(content);
  if (!normalized) throw new Error("Pinned memory content must be a non-empty string");
  const items = readPinnedMemoryItems(agentDir);
  if (items.some((item) => item.content === normalized)) {
    return { item: null, items, alreadyExists: true };
  }
  const item: PinnedMemoryItem = { id: makeId(normalized), content: normalized, createdAt: new Date().toISOString() };
  const nextItems = writePinnedMemoryItems(agentDir, [...items, item]);
  return { item: nextItems[nextItems.length - 1], items: nextItems, alreadyExists: false };
}

export function removePinnedMemoryItems(agentDir: string, opts: { id?: string; keyword?: string } = {}): {
  removed: PinnedMemoryItem[];
  items: PinnedMemoryItem[];
} {
  const normalizedId = normalizeId(opts.id);
  const normalizedKeyword = normalizeContent(opts.keyword).toLowerCase();
  if (!normalizedId && !normalizedKeyword) {
    throw new Error("Either id or keyword must be provided");
  }
  const items = readPinnedMemoryItems(agentDir);
  const removed: PinnedMemoryItem[] = [];
  const remaining: PinnedMemoryItem[] = [];
  for (const item of items) {
    const matchesId = normalizedId && item.id === normalizedId;
    const matchesKeyword = normalizedKeyword && item.content.toLowerCase().includes(normalizedKeyword);
    if (matchesId || matchesKeyword) removed.push(item);
    else remaining.push(item);
  }
  if (removed.length > 0) writePinnedMemoryItems(agentDir, remaining);
  return { removed, items: remaining };
}

export function replacePinnedMemoryItems(agentDir: string, contents: string[]): PinnedMemoryItem[] {
  const items = contents
    .map((content) => normalizeContent(content))
    .filter(Boolean)
    .map((content) => ({ id: makeId(content), content, createdAt: new Date().toISOString() }));
  return writePinnedMemoryItems(agentDir, items);
}
```

- [ ] **Step 4: 运行测试确认通过 + typecheck**

Run: `npx vitest run test/pinned && npm run typecheck`
Expected: 4 passed；typecheck 退出码 0

- [ ] **Step 5: 提交**

```bash
git add src/pinned test/pinned
git commit -m "feat: 置顶记忆 markdown+JSON 双写"
```

---

## Task 13: MemoryTicker 调度器

**Files:**
- Test: `test/ticker/memory-ticker.test.ts`
- Create: `src/ticker/memory-ticker.ts`

- [ ] **Step 1: 写失败测试 `test/ticker/memory-ticker.test.ts`**

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SessionSummaryManager } from "../../src/summary/session-summary.ts";
import { FakeLLM } from "../../src/llm/fake-llm.ts";
import { FactStore } from "../../src/deep-memory/fact-store.ts";
import { createMemoryTicker, type MemoryTickerOptions } from "../../src/ticker/memory-ticker.ts";
import { createLogicalDayClock } from "../../src/time/logical-day.ts";

describe("createMemoryTicker", () => {
  let dir: string;
  let memoryDir: string;
  let summaryManager: SessionSummaryManager;
  let factStore: FactStore;
  let sessionPath: string;
  let messagesByPath: Record<string, Array<Record<string, any>>>;
  const fake = new FakeLLM();
  const clock = createLogicalDayClock(() => new Date(2026, 7, 5, 10, 0));

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-memory-ticker-"));
    memoryDir = path.join(dir, "memory");
    summaryManager = new SessionSummaryManager(path.join(memoryDir, "summaries"));
    factStore = new FactStore(path.join(dir, "facts.db"));
    sessionPath = path.join(dir, "s1.jsonl");
    messagesByPath = {
      [sessionPath]: [
        { role: "user", content: "用户喜欢极简风格", timestamp: "2026-08-04T10:00:00+08:00" },
      ],
    };
  });

  afterEach(() => {
    factStore.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function makeTicker(overrides: Partial<MemoryTickerOptions> = {}) {
    return createMemoryTicker({
      summaryManager,
      factStore,
      getLLM: () => fake,
      memoryDir,
      todayMdPath: path.join(memoryDir, "today.md"),
      weekMdPath: path.join(memoryDir, "week.md"),
      longtermMdPath: path.join(memoryDir, "longterm.md"),
      factsMdPath: path.join(memoryDir, "facts.md"),
      memoryMdPath: path.join(memoryDir, "memory.md"),
      clock,
      timeZone: "Asia/Shanghai",
      locale: "zh-CN",
      getSessionMessages: (p) => messagesByPath[p] || [],
      ...overrides,
    });
  }

  it("triggers a rolling summary at the 10th turn", async () => {
    const ticker = makeTicker();
    for (let i = 0; i < 10; i++) await ticker.notifyTurn(sessionPath);
    expect(summaryManager.getSummary("s1")?.summary).toMatch(/### 重要事实/);
    ticker.stop();
  });

  it("runs the full daily pipeline and produces memory.md", async () => {
    const ticker = makeTicker();
    await ticker.notifySessionEnd(sessionPath);
    await ticker.triggerDaily();
    expect(fs.existsSync(path.join(memoryDir, "daily", "2026-08-04.md"))).toBe(true);
    expect(fs.readFileSync(path.join(memoryDir, "facts.md"), "utf-8")).toContain("极简风格");
    expect(fs.readFileSync(path.join(memoryDir, "memory.md"), "utf-8")).toContain("## 重要事实");
    expect(factStore.size).toBeGreaterThan(0);
    ticker.stop();
  });

  it("daily job is idempotent across repeated triggers", async () => {
    const ticker = makeTicker();
    await ticker.notifySessionEnd(sessionPath);
    await ticker.triggerDaily();
    const firstMemory = fs.readFileSync(path.join(memoryDir, "memory.md"), "utf-8");
    await ticker.triggerDaily();
    expect(fs.readFileSync(path.join(memoryDir, "memory.md"), "utf-8")).toBe(firstMemory);
    ticker.stop();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run test/ticker/memory-ticker.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 `src/ticker/memory-ticker.ts`**

```ts
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
    _timer = setInterval(_checkDailyJob, 60 * 60 * 1000);
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
```

- [ ] **Step 4: 运行测试确认通过 + typecheck**

Run: `npx vitest run test/ticker && npm run typecheck`
Expected: 3 passed；typecheck 退出码 0

- [ ] **Step 5: 提交**

```bash
git add src/ticker test/ticker
git commit -m "feat: MemoryTicker 调度器（10轮/结束/每日+断点续跑）"
```

---

## Task 14: OpenAI 兼容 Provider 与公共 API 出口

**Files:**
- Test: `test/index.test.ts`
- Create: `src/llm/openai-compatible.ts`
- Create: `src/index.ts`

- [ ] **Step 1: 写测试 `test/index.test.ts`（公共 API 可导入）**

```ts
import { describe, expect, it } from "vitest";
import {
  createMemoryTicker,
  createMemorySearch,
  createLogicalDayClock,
  FactStore,
  FakeLLM,
  OpenAICompatibleProvider,
  SessionSummaryManager,
  assemble,
  compileToday,
} from "../src/index.ts";

describe("public API", () => {
  it("exposes the core classes and functions", () => {
    expect(typeof SessionSummaryManager).toBe("function");
    expect(typeof FactStore).toBe("function");
    expect(typeof FakeLLM).toBe("function");
    expect(typeof OpenAICompatibleProvider).toBe("function");
    expect(typeof createMemoryTicker).toBe("function");
    expect(typeof createMemorySearch).toBe("function");
    expect(typeof createLogicalDayClock).toBe("function");
    expect(typeof assemble).toBe("function");
    expect(typeof compileToday).toBe("function");
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run test/index.test.ts`
Expected: FAIL（index 不存在）

- [ ] **Step 3: 实现 `src/llm/openai-compatible.ts`**

```ts
import type { LLMInput, LLMProvider } from "./types.ts";

export interface OpenAICompatibleOptions {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}

export class OpenAICompatibleProvider implements LLMProvider {
  constructor(private opts: OpenAICompatibleOptions = {}) {}

  async chat(input: LLMInput): Promise<{ text: string }> {
    const apiKey = this.opts.apiKey || process.env.LLM_API_KEY || "";
    const baseUrl = (this.opts.baseUrl || process.env.LLM_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
    const model = this.opts.model || process.env.LLM_MODEL || "gpt-4o-mini";
    if (!apiKey) throw new Error("LLM_API_KEY is required for OpenAICompatibleProvider");
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: input.system },
          { role: "user", content: input.user },
        ],
        temperature: input.temperature ?? 0.3,
        max_tokens: input.maxTokens,
      }),
    });
    if (!res.ok) {
      throw new Error(`LLM request failed: ${res.status} ${await res.text()}`);
    }
    const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
    const text = data?.choices?.[0]?.message?.content;
    if (typeof text !== "string") throw new Error("LLM response missing content");
    return { text };
  }
}
```

- [ ] **Step 4: 实现 `src/index.ts`**

```ts
export { type LLMInput, type LLMOutput, type LLMProvider } from "./llm/types.ts";
export { FakeLLM, type FakeLLMHandlers } from "./llm/fake-llm.ts";
export { OpenAICompatibleProvider, type OpenAICompatibleOptions } from "./llm/openai-compatible.ts";
export {
  type SummaryRecord,
  type RollingSummaryResult,
  SessionSummaryManager,
  sessionSummaryRevision,
} from "./summary/session-summary.ts";
export {
  buildRollingSummaryFormatRequirements,
  extractFactSection,
  getFactSectionTitle,
  getTimelineSectionTitle,
  hasFactSectionHeading,
  isEmptyFactSection,
  validateRollingSummaryFormat,
} from "./summary/rolling-summary-format.ts";
export {
  assemble,
  assembleWeekFromDaily,
  compileDaily,
  compileEditableFacts,
  compileLongterm,
  compileToday,
  rollDailyWindow,
} from "./compile/compile.ts";
export {
  clearCompiledMemoryArtifacts,
  normalizeCompiledSectionBody,
  readCompiledResetAt,
  writeCompiledResetMarker,
} from "./compile/compiled-memory-state.ts";
export {
  COMPILED_MEMORY_BLOCKS,
  hasCompiledMemory,
  readCompiledMemorySnapshot,
  writeCompiledMemorySnapshot,
} from "./compile/compiled-memory-snapshot.ts";
export { FactStore } from "./deep-memory/fact-store.ts";
export { processDirtySessions } from "./deep-memory/deep-memory.ts";
export { createMemorySearch, type MemorySearchHit, type MemorySearchParams, type MemorySearchResult } from "./deep-memory/memory-search.ts";
export {
  addPinnedMemoryItem,
  readPinnedMemoryItems,
  removePinnedMemoryItems,
  replacePinnedMemoryItems,
  type PinnedMemoryItem,
} from "./pinned/pinned-memory-store.ts";
export { createMemoryTicker, TURNS_PER_SUMMARY, type MemoryTicker, type MemoryTickerOptions } from "./ticker/memory-ticker.ts";
export {
  DAY_BOUNDARY_HOUR,
  createLogicalDayClock,
  getLogicalDay,
  shiftLogicalDate,
  type LogicalDayResult,
  type MemoryClock,
} from "./time/logical-day.ts";
export { buildFactTimeContext, normalizeFactTime, resolveMemoryTimeZone } from "./time/time-context.ts";
export { atomicWriteSync, safeReadFile } from "./util/safe-fs.ts";
export { scrubPII } from "./util/pii-guard.ts";
```


- [ ] **Step 5: 运行测试确认通过 + typecheck**

Run: `npx vitest run test/index.test.ts && npm run typecheck`
Expected: 1 passed；typecheck 退出码 0

- [ ] **Step 6: 提交**

```bash
git add src/index.ts src/llm/openai-compatible.ts test/index.test.ts
git commit -m "feat: OpenAI 兼容 Provider 与公共 API 出口"
```

---

## Task 15: 示例数据与 CLI 演示

**Files:**
- Create: `examples/conversations.json`
- Create: `cli/demo.ts`
- Test: `test/e2e/e2e-demo.test.ts`

- [ ] **Step 1: 创建 `examples/conversations.json`**

```json
{
  "sessions": [
    {
      "id": "2026-08-02-morning",
      "messages": [
        { "role": "user", "content": "我是玛丽，一名产品设计师，喜欢极简风格。", "timestamp": "2026-08-02T09:30:00+08:00" },
        { "role": "assistant", "content": "好的玛丽，我记住了。", "timestamp": "2026-08-02T09:31:00+08:00" },
        { "role": "user", "content": "最近我在研究 AI Agent 的记忆系统，准备做一个面试项目。", "timestamp": "2026-08-02T09:35:00+08:00" },
        { "role": "assistant", "content": "记忆系统是很好的切入点，我可以帮你梳理。", "timestamp": "2026-08-02T09:36:00+08:00" }
      ]
    },
    {
      "id": "2026-08-03-afternoon",
      "messages": [
        { "role": "user", "content": "今天我们把记忆分层方案定了：滚动摘要 + 编译传送带。", "timestamp": "2026-08-03T14:00:00+08:00" },
        { "role": "assistant", "content": "方案清晰，可以开始实现了。", "timestamp": "2026-08-03T14:05:00+08:00" },
        { "role": "user", "content": "我喜欢用 TypeScript，测试要覆盖核心契约。", "timestamp": "2026-08-03T14:10:00+08:00" }
      ]
    },
    {
      "id": "2026-08-04-evening",
      "messages": [
        { "role": "user", "content": "对了，我下个月要去上海参加一个 AI 大会。", "timestamp": "2026-08-04T19:00:00+08:00" },
        { "role": "assistant", "content": "好的，到时候可以关注一下 Agent 相关的议题。", "timestamp": "2026-08-04T19:02:00+08:00" }
      ]
    }
  ]
}
```

- [ ] **Step 2: 写 e2e 测试 `test/e2e/e2e-demo.test.ts`（完整流水线）**

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SessionSummaryManager } from "../../src/summary/session-summary.ts";
import { FakeLLM } from "../../src/llm/fake-llm.ts";
import { FactStore } from "../../src/deep-memory/fact-store.ts";
import { createMemoryTicker } from "../../src/ticker/memory-ticker.ts";
import { createMemorySearch } from "../../src/deep-memory/memory-search.ts";
import { createLogicalDayClock } from "../../src/time/logical-day.ts";
import conversations from "../../examples/conversations.json" with { type: "json" };

describe("e2e demo pipeline", () => {
  let dir: string;
  let memoryDir: string;
  let summaryManager: SessionSummaryManager;
  let factStore: FactStore;
  const fake = new FakeLLM();
  const clock = createLogicalDayClock(() => new Date(2026, 7, 5, 10, 0));

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-memory-e2e-"));
    memoryDir = path.join(dir, "memory");
    summaryManager = new SessionSummaryManager(path.join(memoryDir, "summaries"));
    factStore = new FactStore(path.join(dir, "facts.db"));
  });

  afterEach(() => {
    factStore.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("feeds sessions, advances days, and searches memories", async () => {
    const ticker = createMemoryTicker({
      summaryManager,
      factStore,
      getLLM: () => fake,
      memoryDir,
      todayMdPath: path.join(memoryDir, "today.md"),
      weekMdPath: path.join(memoryDir, "week.md"),
      longtermMdPath: path.join(memoryDir, "longterm.md"),
      factsMdPath: path.join(memoryDir, "facts.md"),
      memoryMdPath: path.join(memoryDir, "memory.md"),
      clock,
      timeZone: "Asia/Shanghai",
      locale: "zh-CN",
      getSessionMessages: (p) => {
        const id = path.basename(p).replace(/\.jsonl$/, "");
        return conversations.sessions.find((s) => s.id === id)?.messages || [];
      },
    });

    for (const session of conversations.sessions) {
      await ticker.notifySessionEnd(path.join(dir, `${session.id}.jsonl`));
    }
    await ticker.triggerDaily();

    expect(summaryManager.getAllSummaries().length).toBe(3);
    const memoryMd = fs.readFileSync(path.join(memoryDir, "memory.md"), "utf-8");
    expect(memoryMd).toContain("## 重要事实");
    expect(memoryMd).toContain("## 今天");
    expect(factStore.size).toBeGreaterThan(0);

    const search = createMemorySearch(factStore);
    const tagHits = await search({ tags: ["user-profile"] });
    expect(tagHits.results.length).toBeGreaterThan(0);
    const textHits = await search({ query: "记忆系统" });
    expect(textHits.results.length).toBeGreaterThan(0);
    ticker.stop();
  });
});
```

- [ ] **Step 3: 实现 `cli/demo.ts`**

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { SessionSummaryManager } from "../src/summary/session-summary.ts";
import { FactStore } from "../src/deep-memory/fact-store.ts";
import { createMemoryTicker } from "../src/ticker/memory-ticker.ts";
import { createMemorySearch } from "../src/deep-memory/memory-search.ts";
import { FakeLLM } from "../src/llm/fake-llm.ts";
import { OpenAICompatibleProvider } from "../src/llm/openai-compatible.ts";
import type { LLMProvider } from "../src/llm/types.ts";
import { createLogicalDayClock, shiftLogicalDate } from "../src/time/logical-day.ts";

const require = createRequire(import.meta.url);
const conversations = require("../examples/conversations.json") as {
  sessions: Array<{ id: string; messages: Array<Record<string, any>> }>;
};

function banner(title: string): void {
  console.log(`\n${"=".repeat(70)}\n${title}\n${"=".repeat(70)}`);
}

function step(title: string, content: string): void {
  console.log(`\n--- ${title} ---\n${content}`);
}

async function main(): Promise<void> {
  const useReal = process.argv.includes("--real");
  const baseDir = process.env.DEMO_DIR || fs.mkdtempSync(path.join(os.tmpdir(), "agent-memory-demo-"));
  const memoryDir = path.join(baseDir, "memory");
  fs.mkdirSync(memoryDir, { recursive: true });

  const llm: LLMProvider = useReal ? new OpenAICompatibleProvider() : new FakeLLM();
  const clock = createLogicalDayClock(() => new Date(2026, 7, 5, 10, 0));
  const summaryManager = new SessionSummaryManager(path.join(memoryDir, "summaries"));
  const factStore = new FactStore(path.join(baseDir, "facts.db"));

  console.log(`LLM: ${useReal ? "OpenAI 兼容（环境变量 LLM_API_KEY/LLM_BASE_URL/LLM_MODEL）" : "FakeLLM（确定性，离线）"}`);
  console.log(`演示目录: ${baseDir}`);

  const ticker = createMemoryTicker({
    summaryManager,
    factStore,
    getLLM: () => llm,
    memoryDir,
    todayMdPath: path.join(memoryDir, "today.md"),
    weekMdPath: path.join(memoryDir, "week.md"),
    longtermMdPath: path.join(memoryDir, "longterm.md"),
    factsMdPath: path.join(memoryDir, "facts.md"),
    memoryMdPath: path.join(memoryDir, "memory.md"),
    clock,
    timeZone: "Asia/Shanghai",
    locale: "zh-CN",
    getSessionMessages: (p) => {
      const id = path.basename(p).replace(/\.jsonl$/, "");
      return conversations.sessions.find((s) => s.id === id)?.messages || [];
    },
  });

  banner("第 1 步：投喂 3 段会话（每段触发滚动摘要）");
  for (const session of conversations.sessions) {
    const sessionPath = path.join(baseDir, `${session.id}.jsonl`);
    await ticker.notifySessionEnd(sessionPath);
    const summary = summaryManager.getSummary(session.id)?.summary || "";
    step(`会话 ${session.id} 的滚动摘要`, summary);
  }

  banner("第 2 步：展示今日草稿 today.md");
  step("today.md", fs.readFileSync(path.join(memoryDir, "today.md"), "utf-8"));

  banner("第 3 步：推进逻辑日，触发每日任务（日记/周/长期/事实/深度记忆）");
  await ticker.triggerDaily();
  const dailyDir = path.join(memoryDir, "daily");
  for (const file of fs.readdirSync(dailyDir).filter((f) => f.endsWith(".md"))) {
    step(`daily/${file}`, fs.readFileSync(path.join(dailyDir, file), "utf-8"));
  }
  step("week.md", fs.readFileSync(path.join(memoryDir, "week.md"), "utf-8"));
  step("longterm.md", fs.readFileSync(path.join(memoryDir, "longterm.md"), "utf-8"));
  step("facts.md", fs.readFileSync(path.join(memoryDir, "facts.md"), "utf-8"));

  banner("第 4 步：最终拼装 memory.md（注入 Agent 上下文的产物）");
  console.log(fs.readFileSync(path.join(memoryDir, "memory.md"), "utf-8"));

  banner("第 5 步：search_memory 检索演示");
  const search = createMemorySearch(factStore);
  step("标签检索 tags=[user-profile]", (await search({ tags: ["user-profile"] })).text);
  step("全文检索 query=记忆系统", (await search({ query: "记忆系统" })).text);

  factStore.close();
  console.log(`\n演示完成。产物目录: ${baseDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 4: 运行测试确认通过 + typecheck + 手动跑 demo**

Run: `npx vitest run test/e2e && npm run typecheck`
Expected: 1 passed；typecheck 退出码 0
Run: `npm run demo`
Expected: 打印 5 步完整流水线，退出码 0

- [ ] **Step 5: 提交**

```bash
git add examples cli test/e2e
git commit -m "feat: 示例会话与 CLI 演示（含 e2e 测试）"
```

---

## Task 16: 文档（README / architecture / interview）

**Files:**
- Create: `README.md`
- Create: `docs/architecture.md`
- Create: `docs/interview.md`

- [ ] **Step 1: 编写 `README.md`**

必须包含：
1. 项目名与一句话定位；顶部出处声明（OpenHanako，Apache-2.0，作者 liliMozi，仓库链接）。
2. 快速开始：`npm install`、`npm run demo`（FakeLLM 离线）、`npm run demo:real`（环境变量说明）、`npm test`、`npm run typecheck`。
3. 架构总览：六层简表 + 指向 `docs/architecture.md`。
4. 目录结构。
5. 许可证（Apache-2.0）。

- [ ] **Step 2: 编写 `docs/architecture.md`**

必须包含：
1. 逻辑框架图（mermaid 传送带图，与设计规格第 5 节一致）。
2. 六层说明表（原始/摘要/编译/事实/深度/置顶）。
3. 关键机制逐条讲解：格式契约、水印增量、指纹去重、脏会话、确定性拼装、PII 脱敏、可注入时钟、断点续跑。
4. 数据流示例：用 examples 会话走一遍产物示例。

- [ ] **Step 3: 编写 `docs/interview.md`**

必须包含：
1. 项目亮点三段式（背景→方案→收益）。
2. 高频追问与答案（至少 10 条）：
   - 为什么不用单一 RAG？→ 近期精确远期抽象的时间维度压缩 + 可检索事实库互补
   - 上下文窗口有限如何控制？→ memory.md ≤2000 token 常驻 + search_memory 按需
   - 成本怎么控制？→ 水印增量、指纹去重、确定性拼装零 LLM
   - LLM 输出不可靠怎么办？→ 格式契约 + 写前校验 + 格式修复器 + 失败保留旧产物
   - 记忆与项目文档的边界？→ 用户画像 vs 工程规范分离
   - 如何保证一致性？→ 脏追踪 + revision 校验 + 原子写
   - 如何演示？→ 现场脚本（demo 5 步）
   - 与原项目的差异？→ 独立实现、去掉外围、简化分支游标、可注入时钟
   - 扩展方向？→ 向量检索可选、跨 Agent 记忆共享、遗忘机制调优
   - 遇到过什么坑？→ CJK FTS 检索退化、格式契约失配、日期歧义
3. 现场演示脚本（5 步，与 CLI 对应）。

- [ ] **Step 4: 提交**

```bash
git add README.md docs/architecture.md docs/interview.md
git commit -m "docs: README 与架构/面试文档"
```

---

## Task 17: 全量验证与收尾

- [ ] **Step 1: 全量测试 + 类型检查**

Run: `npm run typecheck`
Expected: 退出码 0
Run: `npm test`
Expected: 全部 passed（约 45+ 用例）

- [ ] **Step 2: 离线 Demo 冒烟**

Run: `npm run demo`
Expected: 5 步输出完整、退出码 0

- [ ] **Step 3: 检查产物目录无临时文件**

Run: `git status --porcelain`
Expected: 干净（或仅未跟踪的 demo 输出目录）

- [ ] **Step 4: 最终提交**

```bash
git add -A
git commit -m "chore: 全量验证通过，agent-memory v0.1.0"
```

- [ ] **Step 5: 交付说明**

在最终回复中给出：仓库路径、`npm run demo` 使用方法、`docs/interview.md` 位置、架构文档位置、测试结果摘要。
