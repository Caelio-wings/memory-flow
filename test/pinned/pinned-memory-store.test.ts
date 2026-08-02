import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  addPinnedMemoryItem,
  readPinnedMemoryItems,
  removePinnedMemoryItems,
  replacePinnedMemoryItems,
} from "../../src/pinned/pinned-memory-store.ts";

describe("pinned-memory-store", () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-memory-pinned-")); });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("adds and reads items with dual-file persistence", () => {
    const { item } = addPinnedMemoryItem(dir, "记住：用户叫玛丽");
    expect(item?.content).toBe("记住：用户叫玛丽");
    const items = readPinnedMemoryItems(dir);
    expect(items.map((i) => i.content)).toContain("记住：用户叫玛丽");
    expect(fs.existsSync(path.join(dir, "pinned.md"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "pinned-memory.json"))).toBe(true);
  });

  it("dedupes identical content", () => {
    addPinnedMemoryItem(dir, "内容A");
    const { alreadyExists } = addPinnedMemoryItem(dir, "内容A");
    expect(alreadyExists).toBe(true);
    expect(readPinnedMemoryItems(dir).length).toBe(1);
  });

  it("removes by keyword and by id", () => {
    addPinnedMemoryItem(dir, "待删除内容");
    const byKeyword = removePinnedMemoryItems(dir, { keyword: "待删除" });
    expect(byKeyword.removed.length).toBe(1);
    const { item: item2 } = addPinnedMemoryItem(dir, "另一条");
    const byId = removePinnedMemoryItems(dir, { id: item2!.id });
    expect(byId.removed.length).toBe(1);
    expect(readPinnedMemoryItems(dir).length).toBe(0);
  });

  it("replaces all items", () => {
    replacePinnedMemoryItems(dir, ["新1", "新2"]);
    expect(readPinnedMemoryItems(dir).length).toBe(2);
  });
});
