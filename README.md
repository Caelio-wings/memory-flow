# agent-memory

渐进式分层记忆系统——为 LLM Agent 设计的**"按天滚动记忆传送带"**。

> 本项目基于开源项目 [OpenHanako](https://github.com/liliMozi/openhanako)（HanaAgent，Apache-2.0，作者 liliMozi）的记忆子系统独立移植实现：去除外围应用层，保留滚动摘要、编译管线、深度记忆事实库、置顶记忆与调度器的全部核心机制。接口与 SQL 结构为功能等价实现，许可证沿用 Apache-2.0。

## 核心思想

会话消息先由 LLM 压缩为每会话的滚动摘要（固定格式契约：`### 重要事实/Key Facts` + `### 事情经过/Timeline`）；摘要按天蒸馏成日记，日记滚出 6 天窗口后折叠进长期记忆；最终四段拼装成一份常驻上下文的 `memory.md`。另有一条深度记忆支线，把摘要中的用户画像拆成带标签的元事实存入 SQLite（FTS5），供 Agent 用 `search_memory` 按需检索。

**近期精确、远期抽象**——时间维度的渐进压缩 + 可检索事实库互补，而不是单一 RAG。

## 快速开始

需要 Node.js ≥ 22.5（内置 `node:sqlite`，零原生依赖）。

```bash
npm install          # 或 pnpm install
npm run demo         # FakeLLM 离线演示，无需 API key
npm run demo:real    # 接任意 OpenAI 兼容端点（见下）
npm test             # 55 个测试
npm run typecheck    # 类型检查
```

`demo:real` 使用环境变量：

| 变量 | 说明 | 默认 |
|---|---|---|
| `LLM_API_KEY` | API Key | 必填 |
| `LLM_BASE_URL` | OpenAI 兼容 base URL | `https://api.openai.com/v1` |
| `LLM_MODEL` | 模型名 | `gpt-4o-mini` |

## 架构总览

| 层 | 载体 | 职责 |
|---|---|---|
| 原始层 | 会话消息 | 完整记录，不进入上下文 |
| 摘要层 | `summaries/{session}.json` | 每会话滚动摘要，格式契约校验+修复 |
| 编译层 | `today.md` → `daily/{date}.md` → `week.md` → `longterm.md` | 时间维度渐进压缩 |
| 事实层 | `facts.md` | 用户画像级稳定事实，常驻上下文 |
| 深度记忆层 | `facts.db`（SQLite+FTS5） | 元事实+标签，`search_memory` 按需检索 |
| 置顶层 | `pinned.md` + `pinned-memory.json` | 用户显式要求记住的内容 |

调度器（`MemoryTicker`）以三种方式触发：每 10 轮对话、会话结束、逻辑日切换（每日任务带断点续跑）。详细说明见 [docs/architecture.md](docs/architecture.md)。

## 目录结构

```
src/
├── llm/          # LLMProvider 接口 + OpenAI 兼容 + FakeLLM（离线演示）
├── summary/      # 滚动摘要：格式契约、SessionSummaryManager
├── compile/      # 编译管线：today/daily/week/longterm/facts/assemble
├── deep-memory/  # SQLite+FTS5 事实库、事实提取、search_memory
├── pinned/       # 置顶记忆双写
├── ticker/       # MemoryTicker 调度器
├── time/         # 逻辑日（可注入时钟）、时间上下文
└── util/         # 原子写、PII 脱敏
cli/demo.ts       # 面试演示 CLI
docs/             # 架构文档、面试讲稿、设计规格与实施计划
test/             # Vitest 测试（格式契约/水位/指纹/检索/调度/e2e）
```

## 许可

Apache-2.0。参见 [LICENSE](LICENSE)。
