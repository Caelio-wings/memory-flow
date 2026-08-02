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
