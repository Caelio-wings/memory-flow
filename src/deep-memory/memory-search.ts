import type { FactStore } from "./fact-store.ts";

export interface MemorySearchParams {
  query?: string;
  tags?: string[];
  date_from?: string;
  date_to?: string;
  limit?: number;
}

export interface MemorySearchHit {
  id: number;
  fact: string;
  tags: string[];
  time: string | null;
  session_id: string | null;
  source: "tag" | "fts";
  matchCount?: number;
}

export interface MemorySearchResult {
  results: MemorySearchHit[];
  text: string;
}

export function createMemorySearch(factStore: FactStore): (params: MemorySearchParams) => Promise<MemorySearchResult> {
  return async function searchMemory(params: MemorySearchParams): Promise<MemorySearchResult> {
    if (factStore.size === 0) {
      return { results: [], text: "记忆库为空，暂无事实。" };
    }
    const dateRange: { from?: string; to?: string } = {};
    if (params.date_from) dateRange.from = params.date_from;
    if (params.date_to) dateRange.to = `${params.date_to}T23:59`;

    const results: MemorySearchHit[] = [];
    const seenIds = new Set<number>();

    if (params.tags && params.tags.length > 0) {
      const tagResults = factStore.searchByTags(params.tags, Object.keys(dateRange).length > 0 ? dateRange : undefined, 15);
      for (const r of tagResults) {
        if (seenIds.has(r.id)) continue;
        seenIds.add(r.id);
        results.push({ ...r, source: "tag" });
      }
    }

    if (results.length < 3 && params.query) {
      const ftsResults = factStore.searchFullText(params.query, 10);
      for (const r of ftsResults) {
        if (seenIds.has(r.id)) continue;
        seenIds.add(r.id);
        results.push({ ...r, source: "fts" });
      }
    }

    if (dateRange.from || dateRange.to) {
      for (let i = results.length - 1; i >= 0; i--) {
        const r = results[i];
        if (!r.time) continue;
        if (dateRange.from && r.time < dateRange.from) results.splice(i, 1);
        else if (dateRange.to && r.time > dateRange.to) results.splice(i, 1);
      }
    }

    if (results.length === 0) {
      return { results: [], text: "没有找到相关记忆。" };
    }
    const lines = results.map((r, i) => {
      const tagsStr = r.tags.length > 0 ? ` (${r.tags.join(", ")})` : "";
      const timeStr = r.time ? ` — ${r.time}` : "";
      return `${i + 1}. ${r.fact}${tagsStr}${timeStr}`;
    });
    return { results, text: lines.join("\n") };
  };
}
