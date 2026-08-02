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
