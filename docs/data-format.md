# Data Format

## 文件位置

Claude Code:

```
~/.claude/projects/<encoded-cwd>/<session-uuid>.jsonl
~/.claude/projects/<encoded-cwd>/<parent-session-uuid>/subagents/agent-XXX.jsonl
```

- `<encoded-cwd>` 是 Claude Code 内部把 `/` 替换为 `-` 的项目目录名。**不依赖该编码反解 cwd**，而是从 JSONL 内容的 `cwd` 字段读取；无字段时再退化为字符串替换（见 `src/server/routes.ts#decodeProjectId`）。
- **Sub-agent 文件**：扫描时遇到子目录会进入 `<dir>/subagents/`，把其中的 `*.jsonl` 作为独立 session 收录，并在 `SessionFile.parentSessionId` 上记录父 session UUID。每个 `agent-XXX.jsonl` 旁边可能有 `agent-XXX.meta.json`（含 `{ agentType, description }`），用于把父 session 中 `Task`/`Agent` tool_use（含 `subagent_type` + `description`）关联到具体子代理文件——见后端 `listSubagentMetas` / `SessionDetail.subagentLinks`。

Codex:

```
~/.codex/sessions/YYYY/MM/DD/rollout-<timestamp>-<session-uuid>.jsonl
```

- Codex session 按日期分层存放。扫描时递归收集 `*.jsonl`，从 `session_meta.payload.id` 取 session UUID，从 `session_meta.payload.cwd` 或 `turn_context.payload.cwd` 取 cwd。
- 为避免与 Claude session id 碰撞，Codex session id 在本工具内使用 `codex:<uuid>`，project id 使用 `codex:<encoded-cwd>`。

## Entry 类型（宽容设计）

类型定义在 `src/lib/types.ts`。原则：**未知字段一律保留，必填项几乎全为可选**，避免格式微变就解析失败。

```ts
export type EntryType =
  | 'user' | 'assistant'
  | 'system' | 'summary'
  | 'session_meta' | 'turn_context'
  | 'permission-mode' | 'file-history-snapshot'
  | 'attachment' | 'last-prompt'
  | (string & {});                  // 未知类型保留为 string

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: unknown; is_error?: boolean }
  | { type: 'thinking'; thinking: string; signature?: string }
  | { type: string; [key: string]: unknown };   // 兜底

export type RawEntry = {
  uuid?: string;
  parentUuid?: string | null;
  sessionId?: string;
  timestamp?: string;
  type: EntryType;
  cwd?: string;
  version?: string;
  gitBranch?: string;
  isSidechain?: boolean;
  message?: {
    id?: string;
    role?: 'user' | 'assistant';
    model?: string;
    content?: ContentBlock[] | string;
    usage?: TokenUsage;
    stop_reason?: string;
    [k: string]: unknown;
  };
  toolUseResult?: unknown;          // 部分版本把工具结果放在外层
  summary?: string;
  leafUuid?: string;
  [k: string]: unknown;
};
```

`TokenUsage` 四个标准字段全部 optional：

- `input_tokens`
- `output_tokens`
- `cache_creation_input_tokens`
- `cache_read_input_tokens`

### 踩坑：同 `message.id` 被拆成多条 entry

Claude Code 把**一次 assistant API 响应里的多个 content block**（thinking / text / 多个 tool_use）拆成**多条独立的 JSONL entry**，但**每条 entry 都复制了完整的 `message.usage`**。例如某次响应含 1 个 thinking + 1 个 text + 3 个 tool_use，就会写入 5 条 assistant entry，`message.id` 相同，`usage` 完全相同。

**直接 `for entry in assistant` 累加 token / cost 会按 block 数放大**（抽样实测 1.2× ~ 3.0×，tool_use 越多放大越严重）。

约定：parser 在排序后扫一遍，把每个 `message.id` 的**首条** assistant entry 标记为 `isFirstOfMessage = true`，后续重复标 `false`；无 `message.id` 的视为 true。下游所有 usage 聚合（`totalTokens` / `totalCostUsd` / `TokenChart` 时间序列 / `MessageBubble` 显示）**只在 `isFirstOfMessage` 为 true 时计入**。

## 解析规则（`src/server/parser.ts`）

- **跳过空行与解析失败行**，分别计入 `skippedLines` / `parseErrors`，不抛错。
- **保留集**：
  - 会话类型 `user | assistant`
  - 元数据类型 `system | summary | ai-title | agent-name | permission-mode | file-history-snapshot | attachment | last-prompt | queue-operation`
  - 其余类型整条丢弃。
- **排序**：按 `timestamp` 升序。
- **Title 解析顺序**：
  1. 首个 `type === 'ai-title'` 的 `aiTitle` 字段
  2. 首个 `type === 'summary'` 的 `summary` 字段
  3. 首条 user 消息内首个 text block，截断到 80 字 + `…`
  4. 兜底 `'Untitled session'`
- **统计**：
  - 仅 assistant 的 `usage` 计入 token 与成本，且**按 `message.id` 去重**（见上文"踩坑"段；标记位 `isFirstOfMessage`）
  - `toolCallCount` 计 assistant content 中 `tool_use` 块数量
  - 任意带 `isSidechain` 的 entry 触发 `hasSubagents = true`
- **主模型**：assistant 消息 `model` 字段出现次数最多者。
- **Tree**：从所有带 `uuid` 的 entry 构建 `parentUuid → children` 树；根为第一个父不在集合内的节点；空 session 返回 `null`。
- **Tool call 配对**：`pairToolCalls(entries)` 把 assistant 中的 `tool_use` 与后续 user 中的 `tool_result` 按 `id`/`tool_use_id` 配对，附带 `is_error` 与外层 `toolUseResult`。前端在 `src/lib/toolCalls.ts` 有同名实现（视图需要时复用）。

### Codex 归一化

Codex JSONL 使用外层 `{ timestamp, type, payload }`，parser 会先归一化到共享 `RawEntry`：

- `response_item.payload.type === "message"` → `user` / `assistant`，`input_text` / `output_text` 转为 `text` block。
- `function_call` / `custom_tool_call` / `local_shell_call` → assistant `tool_use`。
- `function_call_output` / `custom_tool_call_output` / `local_shell_call_output` → user `tool_result`。
- `reasoning` → assistant `thinking`。
- `event_msg.task_complete` → `system` 的 `turn_duration`。
- `event_msg.token_count` → 不可见的 assistant usage entry，用于 token 图表；`priced: false`，避免把 Anthropic 默认价格套到 Codex / OpenAI 模型上。

Codex 的 `event_msg.user_message` / `event_msg.agent_message` 与 `response_item.message` 重复，当前跳过，避免 Timeline 重复显示。

## 共享类型契约

服务端 / 客户端复用（`src/lib/types.ts`）：

```ts
ProjectSummary { id, source, cwd, sessionCount, totalTokens, totalCostUsd, lastActiveAt }
SessionSummary { id, projectId, source, cwd, title, startedAt, endedAt,
                 messageCount, toolCallCount, totalTokens, totalCostUsd,
                 model, hasSubagents }
SessionDetail = SessionSummary & { entries: ParsedEntry[], tree: TreeNode | null }
ParsedEntry   = RawEntry & { recognized: boolean, isFirstOfMessage?: boolean }
TreeNode      { uuid, parentUuid, children, isSidechain }
```

注意：

- `totalTokens` 在 `SessionSummary` 上是 `TokenUsage` 对象，不是单一数字；在 `ProjectSummary` 上才是聚合数字。
- `tree` 在空 session 下为 `null`。
- `EntryType` 用 `(string & {})` 保留未识别枚举值，避免在 union 上写死后阻塞编译。
