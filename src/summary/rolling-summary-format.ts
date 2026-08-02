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
