# 文件访问与构建沙箱改造方案

## 1. 文档目标

本文用于指导项目完成“文件访问沙箱”和“Next.js 构建制品隔离”改造，解决以下风险：

- Filesystem MCP 可以通过路径规范化差异绕过敏感文件限制。
- 只使用 `path.resolve` 做字符串范围判断，无法阻止符号链接逃逸。
- 本地 Code Agent 与 Filesystem MCP 各自维护路径规则，安全策略容易漂移。
- MCP 子进程继承完整 `process.env`，违反最小权限原则。
- Next.js Output File Tracing 将整个项目纳入 `/api/chat` 的部署清单。
- `.env`、SQLite 数据库、审计日志和浏览器截图可能进入构建制品。
- 运行时工作区和 Web 应用源码目录是同一个目录，无法提供租户级、任务级隔离。

改造完成后，需要同时满足两个目标：

1. Agent 的文件操作只能发生在服务端分配的明确工作区中，不能读取或修改工作区外部、敏感文件或运行时内部文件。
2. Next.js 生产制品只能包含应用运行所需文件，不能包含密钥、业务数据库、日志、截图、临时备份或完整项目工作区。

---

## 2. 当前风险基线

### 2.1 路径检查顺序不安全

当前 Filesystem MCP 先检查原始字符串是否等于 `.env`，再调用 `path.resolve`。因此下列路径可能绕过精确字符串黑名单：

```text
./.env
foo/../.env
config/../.env.local
```

敏感文件判断必须基于规范化后的工作区相对路径，不能基于原始输入。

### 2.2 符号链接逃逸

当前检查可以证明字符串解析结果位于工作区，但不能证明文件系统最终访问目标位于工作区。例如：

```text
workspace/link-to-outside -> /Users/example/.ssh
fs_read_text("link-to-outside/id_rsa")
```

`readFile`、`writeFile` 和 `rm` 会跟随符号链接，因此需要 `realpath`、`lstat`、无跟随打开模式以及操作系统隔离共同防护。

### 2.3 构建追踪包含运行期数据

当前生产构建的 `/api/chat` NFT 清单已经追踪到：

- `.env`
- `dev.db`
- `prisma/dev.db`
- `.demo-output/audit/tool-activity.log`
- `.demo-output/browser/*.png`
- 源代码、迁移文件及其他项目文件

根因不是单一配置错误，而是 API Route 的导入链包含基于 `process.cwd()` 的动态文件系统访问。Next.js 无法静态确定访问范围，只能保守地追踪整个项目。

### 2.4 Git 中存在运行数据库

当前 `dev.db` 和 `prisma/dev.db` 仍被 Git 跟踪。即使修复 Next.js 构建配置，这些文件仍可能进入仓库克隆、代码扫描缓存、CI 制品和备份系统。

---

## 3. 目标架构

推荐的最终架构：

```text
Next.js Web / Control Plane
  -> authenticated job request
  -> task queue / agent service API
  -> isolated Agent Worker
     -> per-tenant / per-run workspace mount
     -> unified FileSandbox service
     -> Filesystem MCP
     -> Code Agent tools
     -> audit output outside application source tree
```

核心边界：

- Next.js 应用不把自身源码目录当作可写工作区。
- 每个租户或每次 Run 获得独立的工作区根目录。
- Web 进程不直接持有 GitHub Token、模型密钥之外的无关凭据；MCP 子进程只获得自身需要的环境变量。
- 文件沙箱的应用层检查是第一层防护，容器、独立用户、只读根文件系统和挂载边界是第二层防护。
- 构建追踪排除规则是交付防线，不能替代运行时文件隔离。

如果暂时不能拆分 Agent Worker，可以先在单进程中完成统一 FileSandbox、环境变量最小化和构建追踪门禁，但必须把“独立 Worker”列为生产上线前的架构要求。

---

## 4. 第一部分：统一文件沙箱

### 4.1 建立唯一的 FileSandbox 模块

建议增加目录：

```text
src/lib/file-sandbox/
  config.ts
  path-policy.ts
  operations.ts
  errors.ts
  types.ts
```

所有文件操作必须通过统一接口：

```ts
type FileSandboxContext = {
  tenantId: string;
  runId: string;
  workspaceRoot: string;
  access: "read" | "write" | "delete";
};

resolveForRead(context, inputPath)
resolveForWrite(context, inputPath)
readText(context, inputPath)
writeText(context, inputPath, content)
deleteFile(context, inputPath)
listDirectory(context, inputPath)
searchFiles(context, options)
```

以下模块不再自行拼接或校验工具输入路径：

- `src/lib/mcp/filesystem-server.mjs`
- `src/lib/code-agent/workspace.ts`
- `src/lib/code-agent/read.ts`
- `src/lib/code-agent/search.ts`
- `src/lib/code-agent/proposals.ts`
- `src/lib/project-memory/chunking.ts`
- 任何新增的文件、补丁、Git 工具

如果 MCP Server 必须保持 `.mjs` 运行，可将核心策略实现为无框架依赖的共享 `.mjs` 模块，再提供 TypeScript 类型包装；不能复制两套规则。

#### 验收标准

- 全仓库只有一个生产级路径策略实现。
- 所有来自用户、模型、MCP 或数据库的路径在文件操作前经过 FileSandbox。
- 代码扫描不再出现工具直接对不可信路径调用 `readFile`、`writeFile`、`rm` 或 `readdir`。
- Code Agent 和 Filesystem MCP 对相同路径返回相同允许或拒绝结果。

### 4.2 固定并验证工作区根目录

不要直接把 `process.cwd()` 作为业务工作区。改为由可信配置或任务调度器传入绝对路径：

```text
AGENT_WORKSPACE_BASE=/var/lib/agent-workspaces
workspaceRoot=/var/lib/agent-workspaces/{tenantId}/{runId}
```

要求：

1. `workspaceRoot` 必须是绝对路径。
2. 服务启动时对根目录执行 `realpath`，得到不可变的 canonical root。
3. 根目录不能是 `/`、用户 Home、项目根目录、`.git` 或其他宽泛目录。
4. 租户 ID、Run ID 只能作为经过严格格式校验的单个目录名，不能包含路径分隔符。
5. 目录由服务端创建，客户端不能提交或覆盖 `workspaceRoot`。
6. 浏览器截图、审计日志、Checkpoint 和数据库不能保存在工作区内部。

#### 验收标准

- 缺少 `AGENT_WORKSPACE_BASE` 的生产进程启动失败，而不是回退到 `process.cwd()`。
- 请求体、模型参数或 MCP 参数无法改变工作区根目录。
- Tenant A/Run A 无法读取 Tenant A/Run B 或 Tenant B 的工作区。
- 工作区路径在日志中使用逻辑 ID 或相对路径，避免泄露主机绝对路径。

### 4.3 正确规范化输入路径

统一处理顺序：

1. 验证输入类型和长度。
2. 拒绝空字符串、NUL、控制字符和绝对路径。
3. 将 Windows 分隔符统一为 `/`，但必须同时测试跨平台行为。
4. 使用 `path.resolve(canonicalRoot, input)` 得到候选路径。
5. 使用 `path.relative(canonicalRoot, candidate)` 得到规范化相对路径。
6. 拒绝空相对路径用于文件读写删除；目录列表是否允许 `.` 由接口单独定义。
7. 拒绝 `..` 逃逸、绝对 relative 结果及所有禁止段。
8. 基于规范化相对路径执行敏感文件策略。
9. 根据读、写、删除操作执行真实文件系统验证。

路径范围判断必须使用 `path.relative`，不要只使用字符串 `startsWith`。

#### 验收标准

以下输入全部被拒绝：

```text
../secret
../../.env
./.env
foo/../.env
/etc/passwd
C:\Windows\System32\drivers\etc\hosts
foo\..\..\secret
path-with-NUL\0.txt
```

- 正常的 `src/app/page.tsx` 可以按授权读取。
- 输入经过 URL 解码、JSON 解析或 Unicode 表示变化后仍不能绕过规则。
- 拒绝结果使用稳定错误码，例如 `PATH_OUTSIDE_WORKSPACE`、`SENSITIVE_PATH`，不返回主机真实路径。

### 4.4 防止符号链接与 TOCTOU

#### 读取现有文件

1. 对 canonical root 执行 `realpath`。
2. 对目标执行 `lstat`，拒绝目标本身为符号链接。
3. 对目标执行 `realpath`，再次通过 `path.relative` 验证真实目标位于 canonical root。
4. 检查目标为普通文件，不允许设备、FIFO、Socket 或目录冒充文件。
5. 使用支持无跟随语义的方式打开文件；在支持的平台使用 `O_NOFOLLOW`。
6. 打开后通过文件描述符 `fstat` 再次验证类型和大小，再读取内容。

#### 创建或覆盖文件

1. 找到最近存在的父目录。
2. 对父目录执行 `realpath` 并确认位于 canonical root。
3. 逐级拒绝符号链接目录。
4. 对已有目标执行 `lstat`，拒绝符号链接和非普通文件。
5. 在同一父目录创建临时文件，写入并 `fsync` 后使用原子 `rename` 替换。
6. 在平台支持时使用 `O_NOFOLLOW`、`O_CREAT`、`O_EXCL` 等标志缩小竞态窗口。
7. 重要写入保留内容哈希或版本号，防止覆盖审批后已变化的文件。

应用层无法完全消除所有文件系统竞态，因此生产环境还必须使用独立挂载和低权限用户限制攻击结果。

#### 验收标准

- 工作区内指向 `/etc`、Home、项目 `.env` 或其他租户目录的符号链接无法读取、写入或删除。
- 符号链接位于任意父级目录时同样被拒绝。
- 指向工作区内部的符号链接默认也拒绝，除非未来有明确业务需求和专项设计。
- 替换文件过程中失败不会留下半写入的目标文件。
- 并发改变符号链接目标的压力测试不能突破工作区边界。

### 4.5 敏感路径采用规范化后的策略

建议默认拒绝：

```text
.git/**
.next/**
node_modules/**
.demo-output/**
coverage/**
dist/**
build/**
.pnpm-store/**
**/.env
**/.env.*
**/*.pem
**/*.key
**/*.p12
**/*.pfx
**/*credentials*
**/*secret*
**/*.db
**/*.sqlite
**/*.sqlite3
```

`.env.example` 是否允许读取应作为显式例外，而不是因为黑名单没有覆盖而偶然允许。建议只读允许 `.env.example`，禁止写入和删除。

写入策略应比读取更严格：

- 只允许明确的项目文件扩展名。
- 禁止修改 `.gitignore`、锁文件、CI 配置和部署脚本，除非工具策略和逐工具审批明确允许。
- 删除操作只允许普通文件，禁止递归删除目录。
- 对单文件大小、单次总写入量和文件数量设置上限。

#### 验收标准

- `.env`、`.env.local`、子目录内的 `.env.production` 均无法读取。
- SQLite 数据库、审计日志、截图和私钥文件无法通过文件工具读取。
- `fs_search_files` 不会扫描禁止目录，也不会将敏感文件名返回给模型。
- 读取、写入、删除分别拥有独立的允许策略和测试。

### 4.6 限制文件搜索与资源消耗

当前递归搜索需要增加：

- 最大目录深度。
- 最大扫描文件数。
- 最大单文件读取字节数。
- 最大累计读取字节数。
- 最大结果数。
- 超时和取消信号。
- 文本文件扩展名或 MIME allowlist。
- 二进制检测。
- 循环和符号链接检测。

目录遍历应在进入目录前应用禁止段策略，不要在收集全部文件后再过滤。

#### 验收标准

- 对大型目录搜索不会无界占用 CPU、内存和文件描述符。
- 达到限制时返回可识别的截断信息，而不是静默返回不完整结果。
- `node_modules`、`.git`、`.next`、`.demo-output` 和数据库目录不会被读取。
- 客户端取消 Run 后，搜索可以及时停止。

---

## 5. 第二部分：MCP 进程沙箱

### 5.1 环境变量最小化

当前 `StdioClientTransport` 将 `...process.env` 传给所有 MCP Server，应改为每个 Server 的显式 allowlist。

建议：

```text
filesystem:
  PATH
  NODE_ENV
  MCP_WORKSPACE_ROOT
  MCP_MAX_*

github:
  PATH
  NODE_ENV
  GITHUB_TOKEN
  GITHUB_DEFAULT_REPO
  GITHUB_API_BASE_URL

browser:
  PATH
  NODE_ENV
  BROWSER_EXECUTABLE_PATH
  BROWSER_DOMAIN_ALLOWLIST
  BROWSER_DOMAIN_BLOCKLIST
  BROWSER_MAX_*
```

Filesystem MCP 不应获得模型 API Key、GitHub Token、数据库 URL、认证密钥或 Cookie 加密密钥。

#### 验收标准

- 自动化测试读取各 MCP 子进程环境变量名称，确认只包含 allowlist。
- Filesystem MCP 中不存在 `OPENAI_API_KEY`、`DEEPSEEK_API_KEY`、`GITHUB_TOKEN`、`DATABASE_URL` 等变量。
- 缺失必要变量时对应 MCP Server 明确失败，不能回退到宽泛默认目录。

### 5.2 固定 MCP Server 入口

避免用 `path.join(process.cwd(), "src/lib/mcp", entrypoint)` 动态定位生产入口。可采用：

- 相对于当前模块 `import.meta.url` 的静态入口；或
- 构建阶段生成的固定 Worker/MCP 入口目录；或
- 独立部署的 Agent Worker 镜像。

Next.js Route 不应动态扫描整个 `src/lib/mcp` 或项目根目录。

#### 验收标准

- 生产环境从固定、只读、受版本控制的路径启动 MCP Server。
- 修改进程工作目录不会改变 MCP Server 入口或业务工作区。
- NFT 清单只包含明确需要的 MCP Server 文件，不包含整个项目。

### 5.3 操作系统级隔离

生产 Worker 至少应具备：

- 非 root 用户。
- 只读根文件系统。
- 每个租户或 Run 的独立可写挂载。
- 禁止挂载 Docker Socket、宿主机 Home、SSH 目录和云凭据目录。
- 限制进程数、CPU、内存、文件描述符、磁盘和执行时间。
- 仅允许必要的网络出口。
- 禁止跨租户共享浏览器 Context 和临时目录。
- Worker 退出后清理临时工作区，保留数据按合规策略进入受控存储。

#### 验收标准

- 即使应用层路径策略被临时绕过，Worker 仍无法读取宿主机或其他租户数据。
- 容器安全扫描确认没有 root、特权模式或危险挂载。
- 工作区磁盘和 inode 配额生效。

---

## 6. 第三部分：Next.js 构建追踪修复

### 6.1 先消除动态根目录访问

优先修复导入链，而不是只添加排除规则：

1. API Route 不再导入把 `process.cwd()` 当作业务工作区的模块。
2. 将 Agent 文件操作迁移到独立 Worker，或至少使用部署时挂载的 `AGENT_WORKSPACE_BASE`。
3. MCP Server 入口改为静态可追踪路径。
4. 数据库、日志、截图和备份移出项目目录。
5. 动态文件访问必须静态限制在明确子目录；必要时按 Next.js 当前文档和构建警告使用精确的 Turbopack ignore 注释，但不能用它隐藏真正的运行依赖。

#### 验收标准

- `pnpm build` 不再出现“whole project was traced unintentionally”警告。
- `/api/chat` 或拆分后的 API Route NFT 清单不再列出整个源码树。
- 生产运行仍能找到所有真正需要的模块，不出现因过度排除导致的 `MODULE_NOT_FOUND`。

### 6.2 配置精确的 Output File Tracing 规则

根据当前 Next.js 16 项目内文档：

- `outputFileTracingExcludes` 和 `outputFileTracingIncludes` 的键是路由 glob。
- 文件模式相对于包含 `next.config.ts` 的项目根目录。
- 模式应尽量窄，避免在根目录使用 `**/*`。
- 规则只影响产生 Server Trace 的 Node.js 路由，不影响静态页面和 Edge Runtime。

可在修复导入链后增加防御性配置，示意如下：

```ts
const nextConfig: NextConfig = {
  outputFileTracingExcludes: {
    "/api/*": [
      ".env*",
      "**/*.db",
      "**/*.sqlite",
      "**/*.sqlite3",
      ".demo-output/**/*",
      ".git/**/*",
      ".pnpm-store/**/*",
      "update/**/*",
    ],
  },
};
```

注意：

- 示例必须根据最终路由和运行需求调整。
- 排除 Prisma 运行真正需要的 engine 或 schema 会导致生产失败。
- 如果仍在 Next.js 进程中启动 MCP，应使用精确 `outputFileTracingIncludes` 只包含所需入口和运行资产。
- 不要依赖排除规则来保护运行时仍可访问的敏感文件。

#### 验收标准

- 每个 Server Route 的 NFT 清单经过自动扫描。
- 清单不包含 `.env*`、数据库、日志、截图、备份、Git 元数据或用户工作区。
- 清单包含 Prisma、MCP 或其他运行期真正必需的资产。
- Standalone 模式和当前实际部署模式均完成启动烟雾测试。

### 6.3 清理源码树中的运行期数据

需要处理：

- `dev.db`
- `prisma/dev.db`
- `.demo-output/**`
- 浏览器截图
- 审计日志
- 迁移演练数据库备份
- 本地 pnpm store

建议步骤：

1. 备份需要保留的本地开发数据。
2. 使用 `git rm --cached` 停止跟踪数据库，但不要误删开发者唯一副本。
3. 在 `.gitignore` 增加数据库、日志、截图、临时工作区和本地 store 规则。
4. 增加 `.dockerignore`，避免 Docker build context 上传敏感文件。
5. 如果使用其他部署平台，增加对应 ignore 文件或制品白名单。
6. 将审计日志迁移到受控日志服务，将截图迁移到带租户前缀和访问控制的对象存储。
7. 检查 Git 历史和历史制品；如曾包含有效密钥或用户数据，应按事件响应流程清理并轮换密钥。

#### 验收标准

- `git ls-files` 不再返回任何开发数据库、日志、截图或备份。
- Docker/部署上下文不包含上述文件。
- 本地开发仍能通过初始化命令创建空数据库。
- CI 从全新 checkout 可以执行迁移并启动应用，不依赖提交的 `dev.db`。

### 6.4 增加构建制品安全扫描

建议新增脚本，例如：

```text
scripts/check-build-artifacts.mjs
```

扫描范围：

- `.next/server/**/*.nft.json`
- `.next/next-server.js.nft.json`
- `.next/standalone/**`（启用时）
- Docker 镜像文件列表（CI 中）

拒绝模式至少包括：

```text
.env
.env.*
*.db
*.sqlite*
.demo-output/
.git/
*.pem
*.key
*credentials*
*secret*
tool-activity.log
screenshot-*.png
```

扫描脚本只输出违规路径，不能读取或打印文件内容。

在 `package.json` 增加类似命令：

```json
{
  "scripts": {
    "build:secure": "next build && node scripts/check-build-artifacts.mjs"
  }
}
```

#### 验收标准

- 人为把测试用 `.env.fixture` 或 `test.db` 加入 Trace 时，CI 必须失败。
- 正常构建时扫描通过。
- 扫描失败日志不包含密钥或数据库内容。
- `build:secure` 被设为合并和发布门禁，不能只由开发者手动执行。

---

## 7. 测试计划

### 7.1 路径策略单元测试

必须覆盖：

- 正常相对路径。
- `.`、`..` 和多层 traversal。
- 正斜杠与反斜杠。
- 绝对路径和 Windows 盘符。
- NUL、控制字符、超长路径。
- `.env` 各种表示形式和子目录变体。
- 禁止目录和敏感扩展名。
- 读、写、删除策略差异。
- 文件大小和数量限制。
- 稳定错误码及不泄露绝对路径。

### 7.2 文件系统集成测试

在临时目录中构造：

```text
sandbox/
  allowed.txt
  nested/
  link-outside -> outside/
  nested/link-outside -> outside/
outside/
  secret.txt
```

验证：

1. 可读取 `allowed.txt`。
2. 不能读取、覆盖或删除 `outside/secret.txt`。
3. 不能通过任何符号链接访问 outside。
4. 并发替换符号链接不能突破边界。
5. 原子写失败后原文件保持完整。
6. 搜索不进入禁止目录。
7. 文件过大、结果过多和超时行为符合预期。

测试必须使用 `mkdtemp` 创建隔离目录，结束后安全清理明确路径。

### 7.3 MCP 契约测试

对 `fs_read_text`、`fs_list_dir`、`fs_search_files`、`fs_write_text`、`fs_delete_file` 分别验证：

- 与 FileSandbox 使用相同策略。
- 错误不会包含宿主机路径。
- 写入和删除仍经过统一逐工具授权。
- MCP 子进程环境变量符合 allowlist。
- Server 重启不会改变 workspace root。

### 7.4 构建与部署测试

CI 流程至少包括：

1. 全新 checkout。
2. 安装依赖和生成 Prisma Client。
3. `lint`。
4. `typecheck`。
5. 文件沙箱测试。
6. MCP 契约测试。
7. `next build`。
8. NFT/standalone 制品扫描。
9. 使用生产启动方式执行烟雾测试。
10. 验证应用可以访问外置工作区，但不能访问源码树敏感文件。

---

## 8. 推荐实施顺序

### 阶段 A：先封堵直接漏洞

1. 建立共享 FileSandbox。
2. 修复规范化后再判断敏感路径。
3. 增加 `realpath`、`lstat` 和符号链接拒绝。
4. 让 Code Agent 与 Filesystem MCP 使用同一实现。
5. 为读取、搜索、写入、删除增加限制和安全测试。

### 阶段 B：收紧进程权限

1. MCP 子进程改用环境变量 allowlist。
2. 工作区改为服务端分配的租户/Run 目录。
3. 日志、截图和数据库移出项目目录。
4. 引入低权限 Worker、只读根文件系统和独立挂载。

### 阶段 C：修复构建追踪

1. 消除 API Route 导入链中的动态项目根目录访问。
2. 固定 MCP 入口。
3. 增加精确的 Trace includes/excludes。
4. 停止 Git 跟踪数据库和运行期数据。
5. 增加 Docker/部署 ignore 规则。

### 阶段 D：建立持续门禁

1. 增加路径逃逸和符号链接攻击测试。
2. 增加 MCP 环境变量测试。
3. 增加 NFT/standalone 制品扫描。
4. 将安全构建加入 CI 和发布流程。
5. 在预生产执行跨租户工作区隔离和容器逃逸边界验证。

---

## 9. 最终验收清单

- [ ] 所有文件工具统一经过 FileSandbox。
- [ ] 不再使用 `process.cwd()` 作为生产业务工作区的隐式回退。
- [ ] 工作区由服务端按 tenant/run 分配，客户端不能覆盖。
- [ ] 路径规范化后再执行敏感文件判断。
- [ ] `./.env`、`foo/../.env` 等变体全部被拒绝。
- [ ] 读取、写入、删除和搜索均不能通过符号链接逃逸。
- [ ] 非普通文件、超大文件和超量搜索被安全拒绝或截断。
- [ ] 搜索不会进入 `.git`、`.next`、`node_modules`、`.demo-output` 等目录。
- [ ] Filesystem MCP 不继承模型密钥、GitHub Token、数据库 URL 等无关环境变量。
- [ ] MCP Server 入口和工作区不依赖可变的进程当前目录。
- [ ] Web/Worker 以非 root、只读根文件系统和受控挂载运行。
- [ ] `dev.db`、`prisma/dev.db`、日志、截图和备份不再被 Git 跟踪。
- [ ] 构建和部署上下文排除所有运行期敏感文件。
- [ ] `next build` 不再报告整个项目被意外追踪。
- [ ] 所有 NFT 清单均不包含 `.env*`、数据库、日志、截图、备份或 Git 元数据。
- [ ] 生产启动烟雾测试证明必要运行资产没有被错误排除。
- [ ] 文件沙箱、MCP 契约和构建制品扫描全部进入 CI 门禁。

---

## 10. 完成定义（Definition of Done）

只有同时满足以下条件，才能认为“修复文件/构建沙箱”完成：

1. 单元测试和集成测试无法复现路径 traversal、敏感文件绕过和符号链接逃逸。
2. Tenant A/Run A 无法访问其他租户、其他 Run 或宿主机文件。
3. 所有文件操作拥有统一策略、资源限制和结构化审计记录。
4. MCP 子进程符合最小环境变量和最小文件权限原则。
5. Next.js 构建无全项目追踪警告。
6. NFT、Standalone、Docker 或实际发布制品均通过敏感文件扫描。
7. 新环境可以从空数据库和空工作区启动，不依赖仓库中的运行数据。
8. 生产 Worker 具备操作系统级隔离，即使应用层校验失效也不能突破挂载边界。
9. 安全构建和沙箱测试是强制 CI 门禁，失败时不能合并或发布。
10. 回滚方案、工作区清理策略、日志和截图保留策略已完成预生产演练。

