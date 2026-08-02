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
  if (/(蒸馏|Distill)/.test(system)) return "compileDaily";
  if (/(今日草稿|today draft)/.test(system)) return "compileToday";
  if (/(长期情况|long-term context)/.test(system)) return "compileLongterm";
  if (/(Key Facts|重要事实)/.test(system) && /(Timeline|事情经过)/.test(system)) return "rollingSummary";
  if (/(Facts|事实)/.test(system)) return "compileEditableFacts";
  return "rollingSummary";
}

function profileLines(text: string): string[] {
  const lines: string[] = [];
  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = stripSpeechPrefix(raw).replace(/^-\s+/, "").trim();
    if (!line) continue;
    if (/(用户|喜欢|关注|身份|爱好|项目|user|like|focus|profile)/i.test(line)) lines.push(line);
  }
  return lines;
}

function timestampLines(text: string): string[] {
  const lines: string[] = [];
  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = stripSpeechPrefix(raw).replace(/^-\s+/, "").trim();
    if (/\d{4}-\d{2}-\d{2}/.test(line)) lines.push(line);
  }
  return lines;
}

function stripSpeechPrefix(line: string): string {
  return String(line || "")
    .replace(/^\[\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}\]\s*(用户|助手|User|Assistant)[：:]\s*/, "")
    .trim();
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
  compileToday: (input) => {
    const zh = isZhSystem(input.system);
    const items = timestampLines(input.user).map((line) => line.replace(/^\d{4}-\d{2}-\d{2}\s*[-–—:：]?\s*/, ""));
    return bulletize(items, zh, zh ? "今日无重要事件" : "No significant events today");
  },
  compileDaily: (input) => {
    const facts = profileLines(input.user).map((line) => line.replace(/^\d{4}-\d{2}-\d{2}\s*/, ""));
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
