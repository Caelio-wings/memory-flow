import { DatabaseSync } from "node:sqlite";
import { scrubPII } from "../util/pii-guard.ts";

const SCHEMA_VERSION = 2;
const CJK_RUN_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+/gu;

function normalizeSearchText(text: string): string {
  return String(text || "").normalize("NFKC").trim();
}

function parseTags(rawTags: unknown): string[] {
  try {
    const tags = Array.isArray(rawTags) ? rawTags : JSON.parse(String(rawTags || "[]"));
    return Array.isArray(tags) ? tags.filter((tag) => typeof tag === "string") : [];
  } catch {
    return [];
  }
}

function cjkNgrams(text: string): string[] {
  const tokens: string[] = [];
  CJK_RUN_RE.lastIndex = 0;
  for (const match of normalizeSearchText(text).matchAll(CJK_RUN_RE)) {
    const chars = Array.from(match[0]);
    for (const size of [2, 3]) {
      if (chars.length < size) continue;
      for (let i = 0; i <= chars.length - size; i++) {
        tokens.push(chars.slice(i, i + size).join(""));
      }
    }
  }
  return tokens;
}

function uniqueTokens(tokens: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const token of tokens) {
    const normalized = normalizeSearchText(token);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

export function buildFactSearchText(fact: string, tags: string[] = []): string {
  const base = [fact, ...tags].map(normalizeSearchText).filter(Boolean).join(" ");
  return uniqueTokens([base, ...cjkNgrams(base)]).join(" ");
}

function buildFtsQuery(query: string): string {
  const normalized = normalizeSearchText(query);
  if (!normalized) return "";
  const lexicalTokens = normalized.split(/\s+/);
  return uniqueTokens([...lexicalTokens, ...cjkNgrams(normalized)])
    .map((w) => `"${w.replace(/"/g, '""')}"`)
    .join(" OR ");
}

function hasCjk(text: string): boolean {
  CJK_RUN_RE.lastIndex = 0;
  return CJK_RUN_RE.test(normalizeSearchText(text));
}

export class FactStore {
  declare _stmts: Record<string, any>;
  declare _tagSearchCache: Map<string, any>;
  declare db: DatabaseSync;

  constructor(dbPath: string) {
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA synchronous = NORMAL");
    this.db.exec("PRAGMA cache_size = -16000");
    this.db.exec("PRAGMA temp_store = MEMORY");
    this.db.exec("PRAGMA mmap_size = 30000000");
    this._initSchema();
    this._migrate();
    this._createFtsTriggers();
    this._prepareStatements();
    this._tagSearchCache = new Map();
  }

  _initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS facts (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        fact       TEXT NOT NULL,
        search_text TEXT NOT NULL DEFAULT '',
        tags       TEXT NOT NULL DEFAULT '[]',
        time       TEXT,
        session_id TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_facts_time ON facts(time);
      CREATE INDEX IF NOT EXISTS idx_facts_session ON facts(session_id);
    `);
    try {
      this.db.exec(`
        CREATE VIRTUAL TABLE facts_fts USING fts5(
          fact,
          search_text,
          content=facts,
          content_rowid=id,
          tokenize='unicode61'
        );
      `);
    } catch {
      // table already exists
    }
  }

  _createFtsTriggers(): void {
    this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS facts_ai AFTER INSERT ON facts BEGIN
        INSERT INTO facts_fts(rowid, fact, search_text) VALUES (new.id, new.fact, new.search_text);
      END;
      CREATE TRIGGER IF NOT EXISTS facts_ad AFTER DELETE ON facts BEGIN
        INSERT INTO facts_fts(facts_fts, rowid, fact, search_text) VALUES ('delete', old.id, old.fact, old.search_text);
      END;
      CREATE TRIGGER IF NOT EXISTS facts_au AFTER UPDATE ON facts BEGIN
        INSERT INTO facts_fts(facts_fts, rowid, fact, search_text) VALUES ('delete', old.id, old.fact, old.search_text);
        INSERT INTO facts_fts(rowid, fact, search_text) VALUES (new.id, new.fact, new.search_text);
      END;
    `);
  }

  _migrate(): void {
    const row = this.db.prepare("PRAGMA user_version").get() as { user_version: number } | undefined;
    let current = row?.user_version ?? 0;
    if (current >= SCHEMA_VERSION) return;
    this._transaction(() => {
      let v = current;
      while (v < SCHEMA_VERSION) {
        if (v === 0) {
          const rows = this.db.prepare("SELECT id, fact, tags FROM facts").all() as Array<Record<string, any>>;
          const update = this.db.prepare("UPDATE facts SET search_text = ? WHERE id = ?");
          for (const r of rows) update.run(buildFactSearchText(r.fact, parseTags(r.tags)), r.id);
          this.db.exec(
            "DROP TRIGGER IF EXISTS facts_ai; DROP TRIGGER IF EXISTS facts_ad; DROP TRIGGER IF EXISTS facts_au; DROP TABLE IF EXISTS facts_fts;",
          );
          this.db.exec(
            "CREATE VIRTUAL TABLE facts_fts USING fts5(fact, search_text, content=facts, content_rowid=id, tokenize='unicode61')",
          );
          this._createFtsTriggers();
          this.db.exec("INSERT INTO facts_fts(facts_fts) VALUES ('rebuild')");
        }
        v += 1;
      }
      this.db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    });
  }

  _prepareStatements(): void {
    this._stmts = {
      insert: this.db.prepare(`
        INSERT INTO facts (fact, search_text, tags, time, session_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `),
      getAll: this.db.prepare("SELECT * FROM facts ORDER BY time DESC"),
      getBySession: this.db.prepare("SELECT * FROM facts WHERE session_id = ? ORDER BY time DESC"),
      deleteBySession: this.db.prepare("DELETE FROM facts WHERE session_id = ?"),
      count: this.db.prepare("SELECT COUNT(*) as cnt FROM facts"),
      deleteById: this.db.prepare("DELETE FROM facts WHERE id = ?"),
      deleteAll: this.db.prepare("DELETE FROM facts"),
      ftsSearch: this.db.prepare(`
        SELECT f.*, rank
        FROM facts_fts fts
        JOIN facts f ON f.id = fts.rowid
        WHERE facts_fts MATCH ?
        ORDER BY rank
        LIMIT ?
      `),
    };
  }

  _transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  add(entry: { fact: string; tags?: string[]; time?: string | null; session_id?: string }): { id: number } {
    const { cleaned } = scrubPII(entry.fact);
    const now = new Date().toISOString();
    const result = this._stmts.insert.run(
      cleaned,
      buildFactSearchText(cleaned, entry.tags || []),
      JSON.stringify(entry.tags || []),
      entry.time || null,
      entry.session_id || null,
      now,
    );
    return { id: Number(result.lastInsertRowid) };
  }

  addBatch(entries: Array<{ fact: string; tags?: string[]; time?: string | null; session_id?: string }>): number {
    return this._transaction(() => {
      for (const entry of entries) this.add(entry);
      return entries.length;
    });
  }

  replaceBySession(sessionId: string, entries: Array<{ fact: string; tags?: string[]; time?: string | null; session_id?: string }>): number {
    const stableSessionId = String(sessionId || "").trim();
    if (!stableSessionId) throw new Error("replaceBySession requires sessionId");
    return this._transaction(() => {
      this._stmts.deleteBySession.run(stableSessionId);
      for (const entry of entries) {
        if (typeof entry?.fact !== "string" || !entry.fact.trim()) {
          throw new Error("replacement fact must be a non-empty string");
        }
        this.add({ ...entry, session_id: stableSessionId });
      }
      return entries.length;
    });
  }

  searchByTags(queryTags: string[], dateRange?: { from?: string; to?: string }, limit = 20): any[] {
    if (!queryTags || queryTags.length === 0) return [];
    const stmt = this._getTagSearchStmt(queryTags.length, dateRange);
    const params: any[] = [...queryTags];
    if (dateRange?.from) params.push(dateRange.from);
    if (dateRange?.to) params.push(dateRange.to);
    params.push(limit);
    return stmt.all(...params).map((row: any) => this._rowToFact(row));
  }

  _getTagSearchStmt(tagCount: number, dateRange?: { from?: string; to?: string }): any {
    const dateKey = (dateRange?.from ? 1 : 0) | (dateRange?.to ? 2 : 0);
    const cacheKey = `${tagCount}:${dateKey}`;
    let stmt = this._tagSearchCache.get(cacheKey);
    if (stmt) return stmt;
    const placeholders = Array.from({ length: tagCount }, () => "?").join(", ");
    let dateWhere = "";
    if (dateKey & 1) dateWhere += " AND f.time >= ?";
    if (dateKey & 2) dateWhere += " AND f.time <= ?";
    const sql = `
      SELECT f.*, COUNT(DISTINCT je.value) as matchCount
      FROM facts f, json_each(f.tags) je
      WHERE je.value IN (${placeholders})${dateWhere}
      GROUP BY f.id
      ORDER BY matchCount DESC, f.time DESC
      LIMIT ?
    `;
    stmt = this.db.prepare(sql);
    this._tagSearchCache.set(cacheKey, stmt);
    return stmt;
  }

  searchFullText(query: string, limit = 20): any[] {
    if (!query || !query.trim()) return [];
    try {
      const ftsQuery = buildFtsQuery(query);
      if (!ftsQuery) return [];
      const rows = this._stmts.ftsSearch.all(ftsQuery, limit);
      if (rows.length === 0 && hasCjk(query)) return this._likeFallback(query, limit);
      return rows.map((row: any) => this._rowToFact(row));
    } catch {
      return this._likeFallback(query, limit);
    }
  }

  _likeFallback(query: string, limit: number): any[] {
    const stmt = this.db.prepare("SELECT * FROM facts WHERE fact LIKE '%' || ? || '%' ORDER BY time DESC LIMIT ?");
    return stmt.all(query, limit).map((row: any) => this._rowToFact(row));
  }

  getAll(): any[] {
    return this._stmts.getAll.all().map((row: any) => this._rowToFact(row));
  }

  getBySession(sessionId: string): any[] {
    return this._stmts.getBySession.all(sessionId).map((row: any) => this._rowToFact(row));
  }

  deleteBySession(sessionId: string): number {
    const normalized = String(sessionId || "").trim();
    if (!normalized) throw new Error("fact invalidation requires sessionId");
    return this._stmts.deleteBySession.run(normalized).changes;
  }

  get size(): number {
    return this._stmts.count.get().cnt;
  }

  delete(id: number): boolean {
    return this._stmts.deleteById.run(id).changes > 0;
  }

  clearAll(): void {
    this._transaction(() => {
      this._stmts.deleteAll.run();
      this.db.exec("INSERT INTO facts_fts(facts_fts) VALUES ('rebuild')");
    });
  }

  exportAll(): any[] {
    return this.getAll();
  }

  importAll(entries: Array<{ fact: string; tags?: string[]; time?: string | null; session_id?: string }>): void {
    this._transaction(() => {
      for (const entry of entries) {
        this.add({ fact: entry.fact, tags: entry.tags || [], time: entry.time || null, session_id: entry.session_id });
      }
    });
  }

  close(): void {
    this.db.close();
  }

  _rowToFact(row: any): any {
    return {
      id: row.id,
      fact: row.fact,
      tags: parseTags(row.tags),
      time: row.time,
      session_id: row.session_id,
      created_at: row.created_at,
      matchCount: row.matchCount ?? undefined,
    };
  }
}
