import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  clearCompiledMemoryArtifacts,
  normalizeCompiledSectionBody,
  readCompiledResetAt,
  stripThinkTagBlocks,
  writeCompiledResetMarker,
} from "../../src/compile/compiled-memory-state.ts";
import {
  COMPILED_MEMORY_BLOCKS,
  hasCompiledMemory,
  readCompiledMemorySnapshot,
  writeCompiledMemorySnapshot,
} from "../../src/compile/compiled-memory-snapshot.ts";

describe("compiled-memory-state", () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-memory-state-")); });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("normalizes section bodies: strips headings, trims blank runs", () => {
    expect(normalizeCompiledSectionBody("## 标题\n\n- a\n\n\n- b\n")).toBe("- a\n\n- b");
    expect(stripThinkTagBlocks("<thinking>思考</thinking>内容")).toBe("内容");
  });

  it("persists and reads the compiled reset marker", () => {
    const at = "2026-08-02T00:00:00.000Z";
    writeCompiledResetMarker(dir, at);
    expect(readCompiledResetAt(dir)).toBe(at);
  });

  it("clears compiled artifacts and fingerprints", () => {
    fs.writeFileSync(path.join(dir, "memory.md"), "内容");
    fs.writeFileSync(path.join(dir, "memory.md.fingerprint"), "fp");
    clearCompiledMemoryArtifacts(dir);
    expect(fs.readFileSync(path.join(dir, "memory.md"), "utf-8")).toBe("");
    expect(fs.existsSync(path.join(dir, "memory.md.fingerprint"))).toBe(false);
  });

  it("writes and reads the four-section snapshot", () => {
    const compiled = { facts: "- 用户喜欢极简风格", today: "- 今天讨论了记忆系统", week: "", longterm: "" };
    expect(hasCompiledMemory(compiled)).toBe(true);
    expect(writeCompiledMemorySnapshot(dir, compiled)).toBe(true);
    const snapshot = readCompiledMemorySnapshot(dir);
    expect(snapshot.facts).toContain("极简风格");
    expect(snapshot.today).toContain("记忆系统");
    expect(COMPILED_MEMORY_BLOCKS.map((b) => b.key)).toEqual(["facts", "today", "week", "longterm"]);
  });
});
