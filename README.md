# Fullstack LangGraph Agent

一个基于 Next.js 16、LangGraph、MCP 和流式聊天 UI 的实验性 Agent 项目。

这个项目的目标不是只做一个“会聊天的页面”，而是把一条完整的 Agent Runtime 路径搭起来：

- 模型推理
- 工具调用
- Human-in-the-loop 确认
- LangGraph checkpoint 恢复
- MCP 工具扩展
- 审计日志

当前已经接入了本地工具、Filesystem MCP、GitHub MCP 和 Browser MCP，并保留了旧的手写 Runtime 作为对照实现。

## Features

- `LangGraph Runtime`
  - 显式节点流转：`model -> tools -> model -> done`
  - `MemorySaver` checkpoint
  - `thread_id = sessionId`
- `Human-in-the-loop`
  - 高风险工具执行前中断
  - 前端确认卡片
  - 确认/拒绝后 resume graph
- `Tool Registry`
  - 统一注册本地工具和 MCP 工具
  - Runtime 只关心 `executeTool(name, args)`
- `Filesystem MCP`
  - 读文件、列目录、搜索目录
  - 写文件、删文件前确认
  - workspace root 限制
  - `../` 越权拦截
- `GitHub MCP`
  - repo 搜索
  - 读取 repo 文件 / 目录
  - issues 查询
  - create issue 前确认
- `Browser MCP`
  - 打开网页
  - 读取正文
  - 抓取链接
  - 截图
  - click / type / submit 前确认
  - 内网、本地文件、危险域名拦截
- `Audit Log`
  - 记录工具名称、风险等级、权限、参数、执行结果

## Project Structure

```text
src/
  app/
    api/chat/route.ts              # 聊天 API，支持 LangGraph 开关与确认恢复
    page.tsx                       # 聊天页面入口
  components/chat/                 # 聊天 UI、工具卡片、确认按钮
  lib/
    agent/                         # 手写 Runtime、LangGraph Runtime、节点逻辑
    graph/                         # StateGraph 草稿与状态定义
    mcp/                           # MCP client + filesystem/github/browser servers
    tools/                         # Tool Registry、权限/风险策略、本地工具
    audit/log.ts                   # 工具审计日志
    chat/session-store.ts          # 本地 session store
    stream/sse.ts                  # NDJSON / SSE 编码
  types/chat.ts                    # 前后端共享聊天事件类型
```

## Runtime Architecture

当前项目里同时保留了两条 Runtime：

1. `src/lib/agent/runtime.ts`
   - 旧的手写 Runtime
   - 便于和 LangGraph 方案做对照

2. `src/lib/agent/langgraphRuntime.ts`
   - 新的 LangGraph Runtime
   - 使用 `StateGraph`、checkpoint 和 interrupt

LangGraph 的主图定义在：

- `src/lib/graph/runtime.ts`
- `src/lib/graph/state.ts`

核心状态流转是：

```text
START
  -> callModelNode
  -> if has toolCalls
       executeToolsNode
       -> if step < maxSteps
            callModelNode
          else
            END
     else
       END
```

## Tool Architecture

项目的工具链路是：

```text
Agent Runtime
  -> Tool Registry
  -> MCP Client
  -> MCP Server
  -> Real Capability
```

其中：

- 本地工具直接在 `src/lib/tools/` 下实现
- MCP 工具通过 `src/lib/mcp/client.ts` 聚合
- Runtime 不感知工具来源，只按统一格式执行

### Local Tools

- `get_weather`
- `write_demo_file`

### Filesystem MCP Tools

- `fs_read_text`
- `fs_list_dir`
- `fs_search_files`
- `fs_write_text`
- `fs_delete_file`

### GitHub MCP Tools

- `github_search_repo`
- `github_read_file`
- `github_list_issues`
- `github_create_issue`

### Browser MCP Tools

- `browser_open_url`
- `browser_get_text`
- `browser_get_links`
- `browser_screenshot`
- `browser_click`
- `browser_type`
- `browser_submit`

## Permission Model

工具权限模型定义在 `src/lib/tools/types.ts`：

- `read`
- `write`
- `delete`
- `execute`

风险等级：

- `safe`
- `confirm_required`
- `dangerous`

默认策略：

- 读操作：`safe`
- 写入 GitHub / 文件：`confirm_required`
- 浏览器点击、输入、提交：`confirm_required`
- 删除文件：`dangerous`

浏览器工具还支持动态升级风险：

- 如果参数中包含 `login`、`password`、`payment`、`delete` 等敏感关键词
- 会自动提升为 `dangerous`

## Safety Controls

### Filesystem

- 仅允许访问 workspace root
- 禁止绝对路径
- 禁止 `../` 越权访问
- 禁止访问 `.env` 等敏感文件

### Browser

- 仅允许 `http` / `https`
- 禁止 `file://`
- 禁止访问 localhost / 内网地址
- 支持 domain allowlist / blocklist
- 请求超时限制
- 文本长度和链接数量限制

### Human-in-the-loop

需要确认的工具不会直接执行，而是：

1. Runtime 发送 interrupt
2. 前端显示确认卡片
3. 用户允许/拒绝
4. Graph resume

## Checkpoint & Session

- 使用 `MemorySaver` 作为 LangGraph checkpointer
- `sessionId` 同时作为 `thread_id`
- 刷新页面后可以从 checkpoint 恢复对话
- 当前是内存 checkpoint，进程重启后会丢失

## Audit Log

工具审计日志输出到：

` .demo-output/audit/tool-activity.log `

日志内容包括：

- `toolName`
- `toolCallId`
- `source`
- `riskLevel`
- `permissions`
- `args`
- `outcome`
- `detail`

## Environment Variables

建议在 `.env.local` 中配置：

```bash
OPENAI_API_KEY=...
DEEPSEEK_API_KEY=...
GITHUB_TOKEN=...
```

Browser MCP 可选配置：

```bash
BROWSER_EXECUTABLE_PATH=/Applications/Google Chrome.app/Contents/MacOS/Google Chrome
BROWSER_TIMEOUT_MS=10000
BROWSER_MAX_TEXT_CHARS=20000
BROWSER_MAX_LINK_COUNT=200
BROWSER_DOMAIN_ALLOWLIST=
BROWSER_DOMAIN_BLOCKLIST=localhost,127.0.0.1,0.0.0.0,::1,.local
```

GitHub MCP 可选配置：

```bash
GITHUB_DEFAULT_REPO=owner/repo
GITHUB_API_BASE_URL=https://api.github.com
```

## Getting Started

安装依赖：

```bash
pnpm install
```

启动开发环境：

```bash
pnpm dev
```

打开：

[http://localhost:3000](http://localhost:3000)

## Browser Support Notes

Browser MCP 当前优先使用：

- `Playwright + 本机 Google Chrome`

这是为了避免首次安装时 Chromium 下载过慢的问题。  
如果你想让 Playwright 使用自己的浏览器，也可以手动执行：

```bash
pnpm exec playwright install chromium
```

## How To Verify

### 1. 基础聊天

在页面中输入：

```text
介绍一下你自己
```

预期：

- 返回流式文本
- 对话会写入 session

### 2. Filesystem MCP

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

### 3. GitHub MCP

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
- create issue 前弹确认卡片

### 4. Browser MCP

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

- 分别调用 `browser_open_url`、`browser_get_text`、`browser_get_links`、`browser_screenshot`

交互验证：

```text
点击搜索框
```

```text
输入 hello
```

```text
提交表单
```

预期：

- `click / type / submit` 先确认再执行

## API Notes

聊天接口：

- `GET /api/chat?sessionId=...&useLangGraph=true`
- `POST /api/chat`

请求体支持：

- `sessionId`
- `messages`
- `useLangGraph`
- `confirmation`

当 `useLangGraph === true` 时，路由会走：

- `runLangGraphRuntime`
- `resumeLangGraphRuntime`

否则走旧的手写 Runtime。

## Current Limitations

- checkpoint 目前是内存版，不是持久化数据库
- Browser MCP 目前使用单页面 session，不是多 tab / 多 profile
- GitHub 写操作依赖有效的 `GITHUB_TOKEN`
- Browser 工具当前使用 CSS selector 作为交互定位方式

## Next Steps

后续比较自然的演进方向：

- 将 checkpoint 持久化到 SQLite / Postgres / Redis
- 为 Browser MCP 增加 DOM snapshot / element picker
- 为 GitHub MCP 增加 PR / comment / commit 查询能力
- 将 Browser 和 GitHub 的权限策略做成可配置规则
- 增加自动化测试与回归验证脚本
