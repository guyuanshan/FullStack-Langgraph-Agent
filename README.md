# Fullstack LangGraph Agent

一个面向“开发任务执行”的全栈 Agent 实验项目。  
它不是只做聊天 UI，而是把多 Agent Runtime、MCP 工具系统、Human-in-the-loop、安全策略、长期记忆、项目级 RAG、代码补丁工作流和可观测性串成一条完整链路。

当前项目已经具备这些核心能力：

- 多 Agent 协作：`Planner -> Executor -> Reviewer -> Finalizer`
- LangGraph Runtime 与旧手写 Runtime 并存
- Filesystem / GitHub / Browser MCP 接入
- 高风险工具确认与恢复执行
- Prisma + SQLite 持久化
- Conversation Summary Memory
- Project Memory / RAG
- Code Agent Patch Proposal / 审批写入
- Agent Observability / Trace System

## Tech Stack

- `Next.js 16`
- `React 19`
- `TypeScript 5`
- `LangGraph`
- `Prisma`
- `SQLite`
- `MCP SDK`
- `Playwright`
- `OpenAI SDK`
- `Zod`

## What This Project Does

这套系统的目标是把一个 Agent 从“会回答问题”推进到“能理解项目、调用工具、生成补丁、经确认后执行，并且整个过程可追踪、可恢复”。

核心能力包括：

- 聊天式任务输入
- 多轮上下文与摘要记忆
- 项目级知识检索
- 工具调用与风险分级
- 中断确认与恢复执行
- 多 Agent 拆解复杂任务
- 代码补丁预览与审批
- 浏览器 / GitHub / 文件系统能力接入
- 执行链路 Trace、错误复盘与成本估算

## Architecture

整体结构可以理解成：

```text
UI
  -> Chat Route
  -> Runtime Selector
     -> Manual Runtime
     -> LangGraph Runtime
     -> Multi-Agent Runtime
  -> Tool Registry
     -> Local Tools
     -> MCP Client
        -> Filesystem MCP
        -> GitHub MCP
        -> Browser MCP
  -> Persistence
     -> Prisma
     -> SQLite
  -> Memory
     -> Conversation Summary
     -> Project Memory / RAG
  -> Observability
     -> AgentRun / AgentStep / ModelCall / ToolCall / InterruptEvent / ErrorLog
```

## Runtime Layers

项目里目前有 3 套执行路径：

### 1. Manual Runtime

文件：

- [src/lib/agent/runtime.ts](/Users/sweet_77/Developer/AI_demo_test/fullstack-langgraph-agent/src/lib/agent/runtime.ts)

特点：

- 手写递归推进
- 用于和 LangGraph 路径对照
- 保留最直接的 `model -> tools -> done` 逻辑

### 2. LangGraph Runtime

文件：

- [src/lib/agent/langgraphRuntime.ts](/Users/sweet_77/Developer/AI_demo_test/fullstack-langgraph-agent/src/lib/agent/langgraphRuntime.ts)
- [src/lib/graph/runtime.ts](/Users/sweet_77/Developer/AI_demo_test/fullstack-langgraph-agent/src/lib/graph/runtime.ts)
- [src/lib/graph/state.ts](/Users/sweet_77/Developer/AI_demo_test/fullstack-langgraph-agent/src/lib/graph/state.ts)

特点：

- 显式状态图
- 节点流转：`model -> tools -> model -> done`
- `interrupt / resume`
- `MemorySaver` checkpoint
- 会话线程以 `thread_id = sessionId` 区分

### 3. Multi-Agent Runtime

文件：

- [src/lib/multi-agent/runtime.ts](/Users/sweet_77/Developer/AI_demo_test/fullstack-langgraph-agent/src/lib/multi-agent/runtime.ts)
- [src/lib/multi-agent/router.ts](/Users/sweet_77/Developer/AI_demo_test/fullstack-langgraph-agent/src/lib/multi-agent/router.ts)
- [src/lib/multi-agent/prompts.ts](/Users/sweet_77/Developer/AI_demo_test/fullstack-langgraph-agent/src/lib/multi-agent/prompts.ts)
- [src/lib/multi-agent/state.ts](/Users/sweet_77/Developer/AI_demo_test/fullstack-langgraph-agent/src/lib/multi-agent/state.ts)

当前多 Agent 流程：

```text
planner
  -> executor
  -> reviewer
  -> finalizer
```

支持：

- 任务分类与路由
- 计划生成
- 子任务拆解
- 并行子任务执行
- reviewer 复核
- 最终回答流式输出

当前前端默认已经开启多 Agent。

## Tool System

工具体系统一经过 Tool Registry，Runtime 只关心：

```ts
executeTool(name, args)
```

对应目录：

- [src/lib/tools](/Users/sweet_77/Developer/AI_demo_test/fullstack-langgraph-agent/src/lib/tools)
- [src/lib/mcp/client.ts](/Users/sweet_77/Developer/AI_demo_test/fullstack-langgraph-agent/src/lib/mcp/client.ts)

### Local Tools

- `get_weather`
- `write_demo_file`
- `project_index_summary`
- `project_search`
- `project_read_files`
- `code_propose_patch`
- `run_project_checks`
- `git_status_summary`
- `git_create_branch`
- `git_commit_changes`
- `git_push_branch`
- `git_prepare_pr_summary`
- `project_memory_index`
- `project_memory_search`
- `project_memory_refresh`

### Filesystem MCP

Server：

- [src/lib/mcp/filesystem-server.mjs](/Users/sweet_77/Developer/AI_demo_test/fullstack-langgraph-agent/src/lib/mcp/filesystem-server.mjs)

Tools：

- `fs_read_text`
- `fs_list_dir`
- `fs_search_files`
- `fs_write_text`
- `fs_delete_file`

### GitHub MCP

Server：

- [src/lib/mcp/github-server.mjs](/Users/sweet_77/Developer/AI_demo_test/fullstack-langgraph-agent/src/lib/mcp/github-server.mjs)

Tools：

- `github_search_repo`
- `github_read_file`
- `github_list_issues`
- `github_create_issue`
- `github_create_pr`

### Browser MCP

Server：

- [src/lib/mcp/browser-server.mjs](/Users/sweet_77/Developer/AI_demo_test/fullstack-langgraph-agent/src/lib/mcp/browser-server.mjs)

Tools：

- `browser_open_url`
- `browser_get_text`
- `browser_get_links`
- `browser_screenshot`
- `browser_click`
- `browser_type`
- `browser_submit`
- `browser_reset_session`
- `browser_close_session`

## Permission Model & Safety

权限模型定义在：

- [src/lib/tools/types.ts](/Users/sweet_77/Developer/AI_demo_test/fullstack-langgraph-agent/src/lib/tools/types.ts)
- [src/lib/tools/policy.ts](/Users/sweet_77/Developer/AI_demo_test/fullstack-langgraph-agent/src/lib/tools/policy.ts)

权限类型：

- `read`
- `write`
- `delete`
- `execute`

风险等级：

- `safe`
- `confirm_required`
- `dangerous`

默认策略：

- 读文件 / 读网页 / 查 GitHub：`safe`
- 写文件 / 创建 issue / 浏览器 click/type/submit：`confirm_required`
- 删除文件 / 敏感浏览器动作：`dangerous`

### Filesystem Sandboxing

- 只允许访问项目 workspace
- 禁止绝对路径
- 禁止 `../` 越权
- 禁止访问 `.env` 等敏感文件

### Browser Sandboxing

- 只允许 `http / https`
- 禁止 `file://`
- 禁止 `localhost / 127.0.0.1 / 内网地址`
- 支持 allowlist / blocklist
- 支持 timeout / max text length / max redirects / screenshot size 限制

### Human-in-the-loop

高风险操作执行前会：

1. 中断 graph
2. 前端显示确认卡片
3. 用户允许或拒绝
4. 后端 resume graph

## Persistence

数据库层使用：

- `Prisma + SQLite`

当前模型包括：

- `User`
- `Session`
- `Message`
- `ToolCall`
- `Checkpoint`
- `AuditLog`
- `AgentTrace`
- `AgentRun`
- `AgentStep`
- `ModelCall`
- `InterruptEvent`
- `ErrorLog`
- `ProjectMemory`

对应 schema：

- [prisma/schema.prisma](/Users/sweet_77/Developer/AI_demo_test/fullstack-langgraph-agent/prisma/schema.prisma)

## Conversation Memory

聊天级长期记忆已经接入：

- `Session.summary`
- `Message.archived`
- 超过阈值后自动总结旧消息
- 上下文只加载 `summary + recent messages`

相关文件：

- [src/lib/chat/summary-store.ts](/Users/sweet_77/Developer/AI_demo_test/fullstack-langgraph-agent/src/lib/chat/summary-store.ts)
- [src/lib/chat/summarizer.ts](/Users/sweet_77/Developer/AI_demo_test/fullstack-langgraph-agent/src/lib/chat/summarizer.ts)
- [src/lib/chat/context.ts](/Users/sweet_77/Developer/AI_demo_test/fullstack-langgraph-agent/src/lib/chat/context.ts)

目标：

- 长对话不再无限增长
- 降低 token 消耗
- 降低内存占用

## Project Memory / RAG

项目级长期记忆已经接入：

- 项目结构记忆
- 技术栈记忆
- 架构决策记忆
- bug 修复记忆
- patch / 项目知识索引

相关目录：

- [src/lib/project-memory](/Users/sweet_77/Developer/AI_demo_test/fullstack-langgraph-agent/src/lib/project-memory)

当前支持：

- 文件扫描与 chunking
- `local / openai / gemini` embedding provider
- SQLite 存储
- cosine similarity 检索
- patch 后 memory refresh

Gemini 代理也已经支持，例如：

```bash
GEMINI_PROXY_URL=http://127.0.0.1:7890
```

## Code Agent Workflow

项目已经支持代码执行型 Agent 的完整主线：

1. 项目索引
2. 代码搜索
3. 文件读取与 compact context
4. patch proposal
5. 前端 diff preview
6. 用户审批写入
7. lint / typecheck / tests
8. git / GitHub 联动

相关目录：

- [src/lib/code-agent](/Users/sweet_77/Developer/AI_demo_test/fullstack-langgraph-agent/src/lib/code-agent)
- [src/lib/tools/code-agent.ts](/Users/sweet_77/Developer/AI_demo_test/fullstack-langgraph-agent/src/lib/tools/code-agent.ts)

## Observability / Trace

这版已经不是黑盒了。

当前已接入：

- `runId`
- `AgentRun`
- `AgentStep`
- `ModelCall`
- `ToolCall`
- `InterruptEvent`
- `ErrorLog`

后端查询：

- `GET /api/chat?sessionId=...&includeRuns=true`
- `GET /api/chat?runId=...&includeTrace=true`

前端现状：

- 右侧只显示“当前运行中的 Agent”
- 显示当前 runId、run 状态、active agent 和实时状态文本

说明：

- Trace 明细接口已经可用
- 前端现在刻意做成轻量版，不再把全部 trace 细节都塞进侧栏

## Project Structure

```text
src/
  app/api/chat/route.ts            # 聊天 API、runtime 选择、resume、trace 查询
  components/chat/                 # 聊天 UI、工具卡片、当前 agent 面板
  lib/
    agent/                         # 手写 runtime、langgraph runtime、节点逻辑
    multi-agent/                   # planner/executor/reviewer/finalizer 多 Agent runtime
    graph/                         # LangGraph 单 Agent 状态图
    tools/                         # Tool Registry、本地工具、风险/权限策略
    mcp/                           # filesystem/github/browser MCP client + server
    code-agent/                    # patch、git、project checks、代码工作流
    chat/                          # session store、summary memory、context 组装
    project-memory/                # 项目级 RAG / embedding / retrieval
    observability/                 # run/step/model/tool/interrupt/error 查询与落库
    audit/                         # 文件级工具审计日志
  types/chat.ts                    # 前后端共享流事件定义
prisma/
  schema.prisma                    # Prisma schema
```

## Environment Variables

建议配置在 `.env.local`：

```bash
DATABASE_URL=file:/绝对路径到/prisma/dev.db
DEEPSEEK_API_KEY=...
OPENAI_API_KEY=...
GEMINI_API_KEY=...
GITHUB_TOKEN=...
```

Browser 相关：

```bash
BROWSER_EXECUTABLE_PATH=/Applications/Google Chrome.app/Contents/MacOS/Google Chrome
BROWSER_TIMEOUT_MS=10000
BROWSER_MAX_TEXT_CHARS=20000
BROWSER_MAX_LINK_COUNT=200
BROWSER_DOMAIN_ALLOWLIST=
BROWSER_DOMAIN_BLOCKLIST=localhost,127.0.0.1,0.0.0.0,::1,.local
```

GitHub 相关：

```bash
GITHUB_DEFAULT_REPO=owner/repo
GITHUB_API_BASE_URL=https://api.github.com
```

Gemini 代理示例：

```bash
GEMINI_PROXY_URL=http://127.0.0.1:7890
```

## Getting Started

安装依赖：

```bash
pnpm install
```

生成 Prisma Client：

```bash
pnpm db:generate
```

执行数据库迁移：

```bash
pnpm db:migrate
```

启动开发环境：

```bash
pnpm dev
```

打开：

[http://localhost:3000](http://localhost:3000)

## How To Verify

### 1. 基础聊天

输入：

```text
你好，我是 Alice，请介绍一下你自己
```

预期：

- assistant 最终回答是流式输出
- 右侧能看到当前运行 agent
- 简单任务默认不会触发 plan 审批

### 2. Weather / Tool Calling

输入：

```text
帮我查一下南京天气
```

预期：

- 触发工具调用
- 最终回答是流式输出
- 不会重复出现两份相同回复

### 3. Filesystem MCP

输入：

```text
读取 package.json
```

```text
在 src 目录里搜索 ChatWindow
```

```text
写一个文件到 .demo-output/hello.txt，内容是 hello
```

预期：

- 前两条直接执行
- 写文件前弹确认卡片

### 4. GitHub MCP

输入：

```text
帮我看 vercel/next.js 的目录结构
```

```text
总结一下 microsoft/TypeScript 最近 3 个 open issues
```

```text
帮我在 owner/repo 创建一个 issue，标题是 MCP test
```

预期：

- 前两条直接执行
- create issue 前确认

### 5. Browser MCP

输入：

```text
打开 https://example.com 并读取正文
```

```text
提取 https://example.com 的所有链接
```

```text
打开 https://example.com 并截一张图
```

预期：

- 可调用 `browser_open_url / browser_get_text / browser_get_links / browser_screenshot`

### 6. Multi-Agent

输入：

```text
帮我分析这个项目结构，并总结技术栈
```

预期：

- planner / executor / reviewer / finalizer 会依次工作
- 右侧显示当前运行 agent
- 最终回答在 finalizer 阶段流式生成

### 7. Code Agent

输入：

```text
帮我找到 weather tool 在哪里
```

```text
帮我修改 ToolCallCard 的 UI，但先给我 patch 预览
```

```text
帮我运行 typecheck
```

预期：

- 可定位文件
- 可生成 patch proposal
- 可运行检查命令

## Current Limitations

- LangGraph checkpoint 目前仍以 `MemorySaver` 为主，不是真正数据库级 checkpointer
- Trace 明细前端目前是轻量展示，不是完整 timeline 面板
- Model token / cost 目前优先记录估算值，不是 provider 精确账单值
- Browser 交互当前仍以 CSS selector 为主，不是视觉定位 / DOM snapshot picker
- 多 Agent 内部所有节点还不是全部 token 级流式，当前重点是最终回答和 executor 体验流式化

## Future Directions

- 把 checkpoint 真正切到数据库 saver
- 为 Trace 做完整时间线面板和 replay UI
- 接入更精确的 token / cost 统计
- 为 Browser MCP 增加 DOM snapshot / element picker
- 增加自动化回归测试
- 继续提升多 Agent 的并行与路由质量
