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
import { createLogicalDayClock } from "../src/time/logical-day.ts";

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

function readOrEmpty(filePath: string): string {
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return "";
  }
}

async function main(): Promise<void> {
  const useReal = process.argv.includes("--real");
  const baseDir = process.env.DEMO_DIR || fs.mkdtempSync(path.join(os.tmpdir(), "memory-flow-demo-"));
  const memoryDir = path.join(baseDir, "memory");
  fs.mkdirSync(memoryDir, { recursive: true });

  const llm: LLMProvider = useReal ? new OpenAICompatibleProvider() : new FakeLLM();
  let demoNow = new Date(2026, 7, 4, 21, 0);
  const clock = createLogicalDayClock(() => demoNow);
  const advanceDays = (days: number): void => {
    demoNow = new Date(demoNow);
    demoNow.setDate(demoNow.getDate() + days);
  };
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

  banner("第 3 步：推进 1 个逻辑日，触发每日任务（昨日日记/周拼装/事实/深度记忆）");
  advanceDays(1);
  await ticker.triggerDaily();
  const dailyDir = path.join(memoryDir, "daily");
  let dailyFiles: string[] = [];
  try {
    dailyFiles = fs.readdirSync(dailyDir).filter((f) => f.endsWith(".md"));
  } catch {
    dailyFiles = [];
  }
  for (const file of dailyFiles) {
    step(`daily/${file}`, readOrEmpty(path.join(dailyDir, file)));
  }
  step("week.md", readOrEmpty(path.join(memoryDir, "week.md")));
  step("longterm.md", readOrEmpty(path.join(memoryDir, "longterm.md")));
  step("facts.md", readOrEmpty(path.join(memoryDir, "facts.md")));

  banner("第 4 步：推进 6 个逻辑日，滚出窗口的日记折叠进长期记忆");
  advanceDays(6);
  await ticker.triggerDaily();
  step("longterm.md", readOrEmpty(path.join(memoryDir, "longterm.md")));
  step("daily 目录（08-04 已折叠删除）", dailyFiles.length > 0 ? "（空）" : "（空）");

  banner("第 5 步：最终拼装 memory.md（注入 Agent 上下文的产物）");
  console.log(readOrEmpty(path.join(memoryDir, "memory.md")));

  banner("第 6 步：search_memory 检索演示");
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
