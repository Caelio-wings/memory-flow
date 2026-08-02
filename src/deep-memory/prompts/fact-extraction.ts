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
