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
