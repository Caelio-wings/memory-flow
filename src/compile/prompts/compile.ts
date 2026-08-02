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
