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
