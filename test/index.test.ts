import { describe, expect, it } from "vitest";
import {
  createMemoryTicker,
  createMemorySearch,
  createLogicalDayClock,
  FactStore,
  FakeLLM,
  OpenAICompatibleProvider,
  SessionSummaryManager,
  assemble,
  compileToday,
} from "../src/index.ts";

describe("public API", () => {
  it("exposes the core classes and functions", () => {
    expect(typeof SessionSummaryManager).toBe("function");
    expect(typeof FactStore).toBe("function");
    expect(typeof FakeLLM).toBe("function");
    expect(typeof OpenAICompatibleProvider).toBe("function");
    expect(typeof createMemoryTicker).toBe("function");
    expect(typeof createMemorySearch).toBe("function");
    expect(typeof createLogicalDayClock).toBe("function");
    expect(typeof assemble).toBe("function");
    expect(typeof compileToday).toBe("function");
  });
});
