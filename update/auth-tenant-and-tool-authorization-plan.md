# 认证、租户隔离与统一逐工具授权改造方案

## 1. 文档目标

本文用于指导项目优先完成以下两项企业级改造：

1. 认证与租户隔离
2. 统一逐工具授权

改造完成后，任何会话、运行记录、消息、Checkpoint、审计日志和工具操作都必须属于明确的用户与租户；任何非安全工具都必须在展示实际工具名称、真实参数和风险信息后，由有权限的用户单独批准，不能再用“批准执行计划”代替具体工具授权。

本文只定义实施步骤和验收标准，不要求一次性完成 UI、计费、SSO、RBAC 管理后台等外围能力。

---

## 2. 当前问题与改造边界

### 2.1 当前问题

- `/api/chat` 没有认证，调用方可以枚举、读取和删除任意会话。
- `Session.userId` 虽然存在，但查询和写入没有按用户过滤，也没有租户概念。
- `sessionId`、`runId`、`proposalId` 都由客户端直接提交，服务端没有校验其归属关系。
- LangGraph Runtime 有逐工具确认，但 Manual Runtime 和 Multi-Agent Runtime 会绕过该流程。
- Multi-Agent 当前的计划审批无法替代逐工具审批，因为具体工具名称和参数是在计划批准后才生成。
- 工具授权结果没有绑定用户、租户、工具参数摘要、过期时间和幂等键。
- 恢复请求只携带批准或拒绝，没有证明其对应哪一个待审批动作。

### 2.2 本轮改造范围

包含：

- 登录态识别和服务端认证上下文。
- Tenant、TenantMember 及资源归属模型。
- `/api/chat` 所有读写操作的租户隔离。
- Patch Proposal、Checkpoint、Agent Run、Trace、Tool Call 等资源的归属校验。
- 一套由所有 Runtime 复用的工具策略与审批服务。
- 安全工具自动执行；其他工具逐次审批。
- 审批记录持久化、过期、幂等、防重放和审计。
- 单元测试、集成测试和关键 E2E 测试。

暂不包含：

- 企业 SSO/SAML 的完整接入，可先使用成熟认证库的账号登录或可信身份代理。
- 复杂的自定义角色管理后台。
- 跨租户共享会话。
- 工具调用计费系统。

---

## 3. 目标架构

```text
Authenticated Request
  -> Auth Context
     -> userId
     -> tenantId
     -> membership / role
  -> Tenant-scoped Application Service
     -> Session
     -> Message
     -> AgentRun / Trace / Checkpoint
     -> PatchProposal
  -> Runtime
     -> Unified Tool Authorization Gateway
        -> Policy Evaluation
        -> safe: execute
        -> confirm_required / dangerous: persist pending approval and interrupt
        -> approved: verify ownership + args hash + expiry, then execute once
        -> rejected / expired: record result and do not execute
```

核心约束：

- API Route 不直接按裸 `id` 查询业务资源。
- Repository/Service 方法必须显式接收 `tenantId`。
- Runtime 不允许直接调用 `executeTool`。
- 所有工具执行都必须经过统一的 `ToolAuthorizationGateway`。
- 审批必须绑定 `tenantId + userId + sessionId + runId + toolCallId + toolName + argsHash`。

---

## 4. 第一部分：认证与租户隔离

## 4.1 确定认证方案

### 方案结论

本项目确定采用以下方案：

- 认证库：使用 **Better Auth 稳定版**，通过其官方 Prisma Adapter 复用现有 Prisma Client。
- 登录方式：阶段 A 启用 Better Auth 内置的 Email/Password 登录，关闭公开注册，由初始化脚本创建首个管理员及测试账号；密码哈希、校验、重置令牌等全部交给认证库，不自行实现密码学逻辑。
- Session 策略：使用**数据库 Session + 浏览器不透明 Session Cookie**，不使用携带 `tenantId`、`role` 的长期 JWT。
- 企业身份源：后续接入 OIDC/企业 SSO 时继续由 Better Auth 统一生成本地 `User` 和数据库 Session；`requireAuthContext` 及业务层授权契约不变。
- 服务端鉴权：Route Handler、Server Action 和数据访问层均调用统一的 `requireAuthContext`；Next.js `proxy.ts` 只用于未登录跳转等乐观检查，不能作为安全边界。

选择数据库 Session 的原因：

1. 本项目已有 Prisma 数据库，增加认证表的成本低。
2. 用户离职、租户成员被移除、角色变更、密码重置或管理员强制登出后，可以立即撤销登录态。
3. `tenantId` 和 `role` 不固化在 JWT 中，避免权限变更后旧 Token 在过期前继续生效。
4. Agent 可以执行文件、Git 和外部系统操作，服务端可撤销的登录态比长期自包含 JWT 更适合当前风险等级。

Auth.js、可信身份代理和网关 JWT 本轮不作为默认实现。若部署环境以后强制使用企业身份代理，必须通过独立适配器把已经验证的身份转换为相同的本地 `userId`，且只允许来自受信反向代理的声明；不能因为请求中出现 `x-user-id`、`x-tenant-id` 或 `Authorization` Header 就自动信任。

### 认证数据模型约定

现有 Prisma `Session` 表表示聊天会话，不能被认证库占用。Better Auth 的核心模型统一使用以下名称：

- `User`：复用现有用户表，并补齐 Better Auth 需要的 `emailVerified`、`image` 等字段。
- `AuthSession`：认证登录态，与业务 `Session` 明确区分。
- `AuthAccount`：密码凭据或后续 OIDC/OAuth 账号绑定。
- `AuthVerification`：邮箱验证、密码重置等一次性凭据。

现有 `User.email`、`User.name` 为可空字段；接入认证前必须完成数据回填并按照 Better Auth 生成的稳定版 Prisma Schema 调整字段约束。密码只能存在于认证库管理的凭据字段中，不能增加到 `User`、`TenantMember` 或业务 `Session`。

认证库生成的 Schema 只能作为迁移输入：先审查生成结果，再使用项目现有的 Prisma migration 流程提交迁移，不能在生产启动时自动改表。Better Auth、Prisma Adapter 及其传递依赖必须锁定稳定版本，不使用 beta、rc 或浮动版本。

### Session 与 Cookie 策略

- Session 以数据库记录为准，Cookie 只保存高熵、不透明的 Session Token。
- 生产环境 Cookie 必须设置 `HttpOnly`、`Secure`、`SameSite=Lax`、`Path=/`，并使用 `__Host-` 前缀；本地 HTTP 开发环境可关闭 `Secure`，但不得沿用到生产配置。
- Session 有效期设为 24 小时，至少每 1 小时滚动刷新一次；密码重置、账号禁用和管理员撤销必须使已有 Session 失效。
- 首期关闭 Session Cookie Cache，保证每个受保护请求都能验证数据库 Session；后续只有在具备明确的撤销延迟上限和对应测试后才能开启短时缓存。
- 保持认证库的 CSRF、Origin 和 Host 校验开启。所有使用 Cookie 认证的状态变更接口只接受同源请求。
- 浏览器业务接口不接受自定义 Bearer Token 作为 Cookie 的替代品。未来如果需要 CLI 或服务到服务调用，应单独设计可撤销、可限定 scope 的 API 凭据。
- 日志只记录认证结果、内部用户 ID、请求 ID 和失败原因码，不记录 Session Token、完整 Cookie、密码、OAuth Token 或重置令牌。

### 当前租户的确定方式

认证 Session 只证明用户身份，不直接授予任何租户权限。当前租户通过名为 `active_tenant` 的 `HttpOnly` Cookie 选择，但该 Cookie 只是租户定位信息，不是授权凭据；服务端每次都必须使用 `userId + tenantId` 查询 `TenantMember`。

租户解析规则：

1. Session 无效或用户不存在：返回 `401 UNAUTHENTICATED`。
2. `active_tenant` 指向有效的当前用户成员关系：使用该成员关系中的 `tenantId` 和 `role`。
3. 未设置 `active_tenant` 且用户只有一个有效成员关系：允许使用该租户作为当前请求的默认租户；登录完成页随后写入 Cookie。
4. 未设置 `active_tenant` 且用户属于多个租户：返回 `409 TENANT_SELECTION_REQUIRED`，由前端展示租户选择器。
5. 用户没有任何有效成员关系：返回 `403 NO_TENANT_MEMBERSHIP`。
6. Cookie 指向不存在、已停用或用户不再属于的租户：返回 `403 INVALID_TENANT_MEMBERSHIP` 并清除该 Cookie。

新增 `POST /api/auth/tenant` 作为唯一租户切换入口。请求体只接受 `{ tenantId: string }`，服务端先用当前已认证的 `userId` 查询 `TenantMember`，验证成功后才设置 `active_tenant` Cookie；客户端直接修改 Cookie、Header 或请求体不能建立成员关系。接口成功返回 `204`，无成员关系返回 `403`。

服务端应提供统一入口：

```ts
type AuthContext = {
  userId: string;
  tenantId: string;
  role: "owner" | "admin" | "member" | "viewer";
};

async function requireAuthContext(request: Request): Promise<AuthContext>;
```

`requireAuthContext` 的固定执行顺序为：

1. 调用 Better Auth 的服务端 API，根据 `request.headers` 验证数据库 Session。
2. 只从已验证 Session 读取 `userId`，忽略客户端提交的 `userId`。
3. 按上述规则解析 `active_tenant`。
4. 使用 Prisma 查询 `TenantMember`，从数据库记录读取 `tenantId` 和 `role`。
5. 返回不可变的 `AuthContext`，供 Route Handler、Application Service、Runtime 和审计模块向下传递。

额外要求：

- 不信任客户端提交的 `userId` 和 `tenantId`。
- 不把客户端提交的 `role`、Session 对象或前端隐藏按钮作为授权依据。
- `tenantId` 只能来自通过成员关系校验的 `active_tenant` Cookie 或唯一成员关系回退结果。
- 切换租户时必须验证当前用户确实是该租户成员。
- 每个请求都从数据库读取成员角色；最多只能做请求内缓存，不能跨请求缓存 `TenantMember.role`。
- 未认证请求返回 `401`；已认证但缺少操作权限返回 `403`；按 ID 查询的业务资源不存在或不属于当前租户时统一返回 `404`，减少资源枚举。
- `proxy.ts` 即使判断存在 Session Cookie，受保护的 Route Handler 仍必须执行 `requireAuthContext`。

建议的代码边界：

```text
src/lib/auth/server.ts                 # Better Auth 服务端配置
src/lib/auth/context.ts                # requireAuthContext
src/lib/auth/errors.ts                 # 401/403/409 错误类型
src/app/api/auth/[...all]/route.ts     # Better Auth Handler
src/app/api/auth/tenant/route.ts       # 当前租户切换
src/proxy.ts                           # 仅做乐观重定向
```

### 验收标准

- 未登录访问 `/api/chat` 的所有 GET/POST 分支均返回 `401`。
- 伪造、过期或已撤销的 Session Cookie 均返回 `401`。
- 修改 Cookie、Header 或请求体中的 `userId`/`tenantId` 不能冒充其他用户或租户。
- 已登录但不属于目标租户的用户无法切换到该租户。
- 用户被移出租户或角色被降级后，下一个请求立即使用新的成员状态。
- 多租户用户未选择当前租户时返回 `409 TENANT_SELECTION_REQUIRED`，不能随机进入某一租户。
- 认证 Cookie 满足生产安全属性，跨站状态变更请求被拒绝。
- `proxy.ts` 被绕过时，Route Handler 仍然拒绝未认证请求。
- 服务端日志能记录认证失败原因，但不能记录 Token、Cookie 原文或密钥。

## 4.2 扩展 Prisma 数据模型

建议新增或调整以下模型：

```prisma
model Tenant {
  id          String         @id @default(cuid())
  name        String
  createdAt   DateTime       @default(now())
  updatedAt   DateTime       @updatedAt
  memberships TenantMember[]
  sessions    Session[]
}

model TenantMember {
  id        String   @id @default(cuid())
  tenantId  String
  userId    String
  role      String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  tenant    Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([tenantId, userId])
  @@index([userId, tenantId])
}
```

需要直接增加 `tenantId` 的核心模型至少包括：

- `Session`
- `ProjectMemory`
- `AuditLog`
- `AgentRun`
- `AgentStep`
- `InterruptEvent`
- `ErrorLog`
- `ModelCall`
- `ToolCall`
- `Checkpoint`
- 后续持久化的 `PatchProposal`
- 后续新增的 `ToolApproval`

对于通过 `Session` 可以推导租户的表，仍建议保留 `tenantId`，便于强制过滤、审计、索引和数据生命周期管理。所有关系写入时必须验证租户一致。

建议索引：

```prisma
@@index([tenantId, createdAt])
@@index([tenantId, sessionId, createdAt])
@@unique([tenantId, id])
```

实际索引应根据模型字段调整，避免只依赖全局唯一 ID 进行业务查询。

### 数据迁移步骤

1. 新增 `Tenant`、`TenantMember`，新增可空的 `tenantId` 字段。
2. 为现有数据创建一个默认租户和默认管理员用户。
3. 回填所有现有资源的 `tenantId` 和必要的 `userId`。
4. 执行孤儿数据检查和跨租户关系一致性检查。
5. 将必要的 `tenantId` 改为非空。
6. 添加外键、唯一约束和组合索引。
7. 在预生产环境使用生产数据量级的副本验证迁移耗时和锁表影响。

### 验收标准

- 所有现有业务数据均有有效 `tenantId`，不存在空租户和孤儿关系。
- 同一个 Session 下的 Message、Run、ToolCall、Checkpoint 等记录租户完全一致。
- 数据库迁移可以从空库完整执行，也可以从当前数据库版本平滑升级。
- 回滚脚本或回滚方案经过预生产演练。
- Prisma schema、迁移文件和实际数据库结构一致。

## 4.3 建立租户作用域的数据访问层

禁止在 Route 和 Runtime 中散落以下形式：

```ts
prisma.session.findUnique({ where: { id: sessionId } });
```

改为租户作用域 Service/Repository：

```ts
getSession(auth: AuthContext, sessionId: string)
listSessions(auth: AuthContext)
deleteSession(auth: AuthContext, sessionId: string)
getRunTrace(auth: AuthContext, runId: string)
getPatchProposal(auth: AuthContext, proposalId: string)
```

查询应至少包含 `tenantId`，需要用户级私有资源时同时包含 `userId`。创建子资源前先加载父资源并验证租户归属，不能直接相信客户端提交的父级 ID。

建议增加统一辅助函数：

```ts
async function requireTenantSession(
  auth: AuthContext,
  sessionId: string
): Promise<Session>;
```

### 需要逐项改造的入口

- 会话列表
- 会话消息读取
- 会话删除
- Agent Context 构建
- Session 消息持久化
- LangGraph 和 Multi-Agent Checkpoint 读取、写入、恢复
- Run 列表和 Trace 读取
- ToolCall、AuditLog、InterruptEvent 写入
- Patch Proposal 创建、查看、批准和拒绝
- Project Memory 索引和检索
- Browser Session ID 生成与隔离

### 验收标准

- 代码扫描不存在从 API 参数直接按裸资源 ID 查询或修改数据的路径。
- 租户 A 的用户无法读取、修改、删除或恢复租户 B 的任何资源。
- 即使攻击者知道另一个租户的完整 `sessionId`、`runId` 或 `proposalId`，也只能得到 `404` 或 `403`。
- `includeSessions` 只返回当前租户允许当前用户查看的会话。
- Trace、AuditLog 和错误堆栈不会跨租户返回。
- Patch Proposal 的批准者必须与 Proposal 属于同一租户，并具有允许写代码的角色。

## 4.4 API 输入校验与权限矩阵

使用 Zod 为 `/api/chat` 的各类操作建立判别联合，不再从任意 `body` 中手工读取字段。

建议将单一万能接口逐步拆分为：

```text
GET    /api/sessions
POST   /api/sessions
GET    /api/sessions/:sessionId/messages
DELETE /api/sessions/:sessionId
POST   /api/sessions/:sessionId/runs
GET    /api/sessions/:sessionId/runs
GET    /api/runs/:runId/trace
POST   /api/tool-approvals/:approvalId/decision
POST   /api/patch-proposals/:proposalId/decision
```

最小角色矩阵：

| 操作 | owner/admin | member | viewer |
|---|---:|---:|---:|
| 查看会话和 Trace | 是 | 是 | 是 |
| 发起 Agent Run | 是 | 是 | 否 |
| 批准只读外部操作 | 是 | 是 | 否 |
| 批准写入、执行操作 | 是 | 按策略 | 否 |
| 批准 dangerous 操作 | 是 | 否 | 否 |
| 删除会话 | 是 | 按资源所有权 | 否 |

### 验收标准

- 非法 JSON 返回 `400`，不会留下状态为 `running` 的空 Run。
- 超长输入、超多消息和异常嵌套对象会在模型调用前被拒绝。
- 所有状态变更接口同时执行认证、租户归属和角色检查。
- 客户端提交的 `role: "assistant"` 消息不能直接污染服务端会话历史。

---

## 5. 第二部分：统一逐工具授权

## 5.1 建立唯一工具执行入口

新增统一服务，例如：

```text
src/lib/tools/authorization/
  policy.ts
  gateway.ts
  approval-store.ts
  types.ts
```

所有 Runtime 只能调用：

```ts
authorizeAndExecuteTool({
  auth,
  sessionId,
  runId,
  stepId,
  toolCallId,
  toolName,
  args,
});
```

禁止以下模块直接调用底层 `executeTool`：

- Manual Runtime
- LangGraph Runtime
- Multi-Agent Runtime
- 子任务并行执行器
- API Route

底层 `executeTool` 应保持内部可见，或通过模块边界确保只有 Gateway 可以导入。

### 验收标准

- 全仓库搜索 `executeTool(`，除 Gateway 和底层测试外不存在其他业务调用点。
- 三套 Runtime 对同一个工具和同一组参数得到完全一致的授权结果。
- 并行子任务不能绕过 Gateway。
- Patch、Git、MCP、本地工具都走同一入口。

## 5.2 统一策略判定

策略输入至少包含：

```ts
type ToolPolicyInput = {
  auth: AuthContext;
  toolName: string;
  args: Record<string, unknown>;
  source: "local" | "mcp";
  permissions: Array<"read" | "write" | "delete" | "execute">;
  sessionId: string;
  projectId?: string;
};
```

策略输出：

```ts
type ToolPolicyDecision =
  | { action: "allow"; riskLevel: "safe"; reason: string }
  | {
      action: "require_approval";
      riskLevel: "confirm_required" | "dangerous";
      reason: string;
      requiredRole: "member" | "admin";
    }
  | { action: "deny"; riskLevel: "dangerous"; reason: string };
```

建议默认规则：

- 未注册工具：拒绝。
- 无权限元数据的工具：拒绝，不能默认为 `safe`。
- 本地只读、租户内只读：可自动执行。
- 外部网页读取：按域名策略决定自动执行或确认。
- 文件写入、Git branch/commit、运行项目命令、浏览器 click/type/submit：逐次确认。
- 文件删除、Git push、创建 Issue/PR、敏感域名交互：逐次确认，并要求 admin 或更高角色。
- 凭据、支付、登录、2FA、生产环境、跨租户资源相关操作：默认拒绝或要求更高等级的专门审批。

风险不能只根据工具名称前缀判断，还要验证参数，例如目标路径、URL、Git remote、分支、仓库、命令类型和数据敏感等级。

### 验收标准

- 未知工具和缺少风险声明的工具默认拒绝。
- `fs_write_text` 和 `fs_delete_file` 无论由哪个 Runtime 调用都不会自动执行。
- `git_push_branch` 的审批界面能显示 remote、branch 和目标仓库。
- Browser 工具风险能够根据实际 URL、域名、selector 和输入文本升级。
- 策略单元测试覆盖每个已注册工具和关键参数变体。

## 5.3 持久化待审批动作

建议新增 `ToolApproval`：

```prisma
model ToolApproval {
  id             String   @id @default(cuid())
  tenantId       String
  sessionId      String
  runId          String
  stepId         String?
  toolCallId     String
  toolName       String
  argsJson       String
  argsHash       String
  riskLevel      String
  permissions    String
  status         String
  requestedBy    String?
  decidedBy      String?
  decisionReason String?
  expiresAt      DateTime
  decidedAt      DateTime?
  executedAt     DateTime?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  @@unique([tenantId, toolCallId])
  @@index([tenantId, sessionId, status])
  @@index([tenantId, expiresAt])
}
```

状态机：

```text
pending -> approved -> executing -> executed
pending -> rejected
pending -> expired
approved/executing -> failed
```

要求：

- `argsHash` 使用规范化 JSON 后的加密哈希。
- 审批时重新计算哈希，参数发生任何变化都必须创建新审批。
- 审批必须有 TTL，建议 10～30 分钟。
- 同一审批只能消费一次。
- 状态转换使用数据库事务或条件更新，例如只允许 `pending -> approved`。
- 不能通过重新发送相同 HTTP 请求重复执行已经消费的工具。

### 验收标准

- 修改待审批参数中的任意字段后，旧批准无法继续执行。
- 过期审批不能恢复 Runtime。
- 重复点击批准只会执行一次工具。
- 两个并发批准请求只有一个能成功推进状态。
- 被拒绝的审批不能再次批准；需要重新生成工具调用。
- 服务重启或请求切换实例后仍能读取并处理待审批动作。

## 5.4 改造中断与恢复协议

前端确认事件必须携带服务端生成的 `approvalId`，不能只依赖 `sessionId`：

```ts
type ToolApprovalRequest = {
  approvalId: string;
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  argsHash: string;
  riskLevel: "confirm_required" | "dangerous";
  permissions: string[];
  message: string;
  expiresAt: string;
};
```

审批接口请求：

```ts
type ApprovalDecisionRequest = {
  decision: "approved" | "rejected";
  reason?: string;
};
```

服务端必须从数据库加载审批记录并验证：

1. 当前用户已认证。
2. 当前用户属于审批记录的租户。
3. 用户角色允许批准该风险级别。
4. 审批仍为 `pending`。
5. 审批未过期。
6. Session、Run、ToolCall 归属关系一致。
7. 当前 Runtime Checkpoint 正在等待同一个 `approvalId`。
8. 实际工具参数哈希与审批记录一致。

### 验收标准

- 仅提交 `{ decision: "approved" }` 而没有有效 `approvalId` 时无法恢复。
- 使用租户 B 的用户批准租户 A 的审批时返回 `404` 或 `403`。
- 使用审批 A 恢复 Run B 时失败。
- 前端能显示准确的工具、风险、权限、参数摘要和过期时间。
- dangerous 操作必须提供二次视觉警告，并明确显示不可逆影响。

## 5.5 分别改造三套 Runtime

### Manual Runtime

- 在工具节点调用 Gateway。
- Gateway 返回 `require_approval` 时，Manual Runtime 需要持久化运行状态并结束当前流。
- 恢复时从持久化状态继续，而不是重新让模型生成工具参数。

### LangGraph Runtime

- 保留 `interrupt`，但中断负载改为 `approvalId`。
- 恢复前先由审批服务验证和消费批准结果。
- Checkpointer 换为可共享持久化实现，不能只依赖进程内 `MemorySaver`。

### Multi-Agent Runtime

- 计划审批与工具审批分离。
- `executeAgentTask` 和并行子任务中的每一次工具调用都经过 Gateway。
- 任意一个子任务需要审批时，明确冻结对应子任务，不允许其他分支借用这次批准。
- 审批后只恢复关联分支；不得重新规划并生成不同参数后复用旧批准。

### 验收标准

- Manual、LangGraph、Multi-Agent 三种模式通过相同的授权契约测试。
- 计划审批通过后，具体写入或删除工具仍会单独请求审批。
- Multi-Agent 并行执行时，一个工具的批准不能批准同一批次的其他工具。
- Runtime 重启后可以继续等待中的审批。
- 恢复执行不会重复发送已经执行成功的工具调用。

## 5.6 审计要求

每次策略判定和状态变化至少记录：

- tenantId
- sessionId
- runId
- toolCallId
- approvalId
- toolName
- riskLevel
- permissions
- argsHash
- decision
- requestedBy / decidedBy
- 时间戳和延迟
- 执行结果状态

敏感字段需要脱敏：

- Token、Cookie、Authorization Header
- 密码、OTP、2FA、银行卡信息
- `.env` 内容和密钥
- 工具结果中的凭据和个人信息

### 验收标准

- 可以从一次工具执行追溯到请求者、批准者、审批内容和最终结果。
- 审计记录不能被普通 member 修改或删除。
- 审计日志中搜索常见密钥格式不会发现明文凭据。
- 删除会话后的数据保留行为符合明确的数据保留策略，而不是依赖偶然的外键行为。

---

## 6. 测试计划

## 6.1 单元测试

必须覆盖：

- `requireAuthContext`
- 租户成员与角色判断
- 所有租户作用域 Repository
- 工具策略矩阵
- 参数规范化与 `argsHash`
- 审批状态机
- 审批 TTL
- 幂等与并发状态更新
- 敏感信息脱敏

## 6.2 集成测试

至少准备：

- Tenant A：owner、member、viewer
- Tenant B：owner
- 两个租户各自的 Session、Run、ToolCall、PatchProposal

关键用例：

1. A 不能列出、读取、删除 B 的会话。
2. A 不能查询 B 的 Run Trace。
3. A 不能批准 B 的 ToolApproval 或 PatchProposal。
4. viewer 不能启动 Run 或批准工具。
5. member 不能批准 dangerous 操作。
6. 安全读取工具自动执行。
7. 写入、执行和删除工具全部中断等待审批。
8. 审批过期、重复审批和参数被篡改时均不执行。
9. 三种 Runtime 得到一致结果。
10. 服务重启后审批仍可恢复。

## 6.3 E2E 测试

至少覆盖：

- 登录、切换租户、会话列表隔离。
- 创建会话并发起普通聊天。
- Agent 发起写文件操作，UI 展示真实参数，用户批准后只执行一次。
- 用户拒绝工具后，Agent 收到拒绝结果并安全结束或重新规划。
- 管理员批准 dangerous 操作。
- member 尝试批准 dangerous 操作并被拒绝。
- 两个浏览器用户并行操作不同租户，不发生状态串线。

---

## 7. 推荐实施顺序

### 阶段 A：建立安全地基

1. 接入认证并实现 `requireAuthContext`。
2. 新增 Tenant/TenantMember。
3. 回填现有数据并建立组合索引。
4. 建立 tenant-scoped Repository。
5. 封锁匿名 `/api/chat` 和所有裸 ID 查询。

完成阶段 A 后，先进行一次租户越权专项测试。

### 阶段 B：统一工具策略

1. 定义统一 Policy 输入输出。
2. 实现 Gateway。
3. 让三套 Runtime 停止直接调用 `executeTool`。
4. 为全部已注册工具补齐风险和权限元数据。
5. 未知工具默认拒绝。

### 阶段 C：持久化审批

1. 新增 `ToolApproval`。
2. 实现状态机、TTL、参数哈希和幂等消费。
3. 改造前端确认协议。
4. 改造三个 Runtime 的中断和恢复。
5. 将 Checkpoint 替换为共享持久化实现。

### 阶段 D：验证与上线

1. 完成单元、集成和 E2E 测试。
2. 执行越权、重放、并发和参数篡改测试。
3. 灰度期间记录旧流程与新 Gateway 的策略差异，但不允许旧流程实际执行高风险工具。
4. 移除旧授权分支和兼容开关。
5. 配置告警：跨租户访问拒绝、重复审批、过期审批、dangerous 工具调用异常增长。

---

## 8. 最终验收清单

满足以下全部条件才可认为两项改造完成：

- [ ] 所有 API 都要求认证。
- [ ] 所有业务资源都有明确 tenant 归属。
- [ ] 所有读写查询都经过租户作用域数据访问层。
- [ ] 已通过跨租户 IDOR 自动化测试。
- [ ] viewer、member、admin、owner 的权限边界有测试覆盖。
- [ ] 三套 Runtime 不再直接调用底层工具执行函数。
- [ ] 所有工具调用统一经过 Policy 和 Gateway。
- [ ] 未注册或缺少权限元数据的工具默认拒绝。
- [ ] 所有非安全工具均展示具体名称和真实参数后逐次审批。
- [ ] 计划审批不能替代工具审批。
- [ ] 审批绑定租户、用户、Session、Run、ToolCall 和参数哈希。
- [ ] 审批有 TTL、幂等、防重放和并发保护。
- [ ] 服务重启或横向扩容不导致待审批状态丢失。
- [ ] Patch Proposal 也执行相同的租户归属和审批人权限校验。
- [ ] 审计记录可追溯请求者、批准者、参数摘要和执行结果。
- [ ] 日志和审计数据中不存在明文 Token、Cookie、密码或密钥。
- [ ] 单元测试、集成测试、E2E 测试全部通过。
- [ ] CI 将 lint、typecheck、test、build 和 Prisma migration check 设为合并门禁。

---

## 9. 建议的完成定义（Definition of Done）

代码实现完成并不等于交付完成。最终 DoD 为：

1. 新数据库迁移在空库、当前开发库和预生产副本上均成功。
2. 所有旧数据完成租户回填，无孤儿数据。
3. 所有 Runtime 通过统一授权契约测试。
4. 安全测试无法复现跨租户读取、删除、审批、恢复和 Patch 应用。
5. 重放同一审批不会造成重复执行。
6. 审批后篡改参数不会执行。
7. 生产环境关闭旧的匿名和绕过授权路径。
8. 监控、告警、回滚方案和运维说明已经准备完成。
