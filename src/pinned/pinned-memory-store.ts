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
