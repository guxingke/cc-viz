# Backend

## 入口（`server.ts`）

启动流程：

1. `loadToken()` 读取 `CC_VIZ_TOKEN`；缺省则生成一次性 base64url(24B) token（重启失效）。
2. 检测 `node_modules/.bin/tailwindcss` 是否存在：
   - 同步跑一次 `tailwindcss -i src/styles.css -o src/styles.built.css`，保证首请求有样式。
   - 除非 `NO_CSS_WATCH=1`，再起一个 `--watch` 子进程；进程退出由 SIGINT / SIGTERM 收敛。
3. `Bun.serve` 监听 `process.env.PORT || 3456`，路由：
   - `'/'` → 打包后的 `src/index.html`
   - `'/sessions/:id'` → 同上（让客户端路由刷新可用）
   - `'/api/*'` → `handleApi(req)`
4. 控制台打印访问 URL；若鉴权启用则附 `?token=…`，并提示如何固定 token。
5. 除非 `NO_OPEN=1`，自动调用平台 opener（macOS `open` / Win `start` / Linux `xdg-open`）打开浏览器。

## 鉴权（`src/server/auth.ts`）

- **默认开启**。可用 `CC_VIZ_NO_AUTH=1` 完全关闭。
- token 来源优先级（`extractRequestToken`）：
  1. `Authorization: Bearer …`
  2. `Cookie: cc_viz_auth=…`
  3. `?token=…`
- 用 `timingSafeEqual` 做定值比较。
- `POST /api/_auth/login`：body `{ token }`，成功返回 `Set-Cookie: cc_viz_auth=…; HttpOnly; SameSite=Lax; Max-Age=30d`。
- `GET /api/_auth/check`：返回 200 / 401。
- 401 一律 `{ "error": "unauthorized" }`。

## 路由表（`src/server/routes.ts`）

| Method | Path | 说明 |
|---|---|---|
| GET  | `/` | 客户端入口 |
| GET  | `/sessions/:id` | 客户端入口（同上，做刷新回退） |
| POST | `/api/_auth/login` | 用 token 换 Cookie |
| GET  | `/api/_auth/check` | 是否已登录 |
| GET  | `/api/projects` | 项目摘要列表，按 `lastActiveAt` 降序 |
| GET  | `/api/sessions` | 全部 session 摘要（跨项目），按 `startedAt` 降序 |
| GET  | `/api/sessions/:id` | 单 session 完整解析结果 |
| GET  | `/api/sessions/:id/raw` | 原始 JSONL 文本 |
| GET  | `/api/search?q=…` | 跨 session 文本搜索 |
| GET  | `/api/_share?sessionId=…` | 列指定 session 的分享链接（主 token） |
| POST | `/api/_share` | 创建分享链接（主 token），body `{ sessionId, label?, ttl? }` |
| DELETE | `/api/_share/:token` | 撤销分享链接（主 token） |
| GET  | `/api/share/:token/session` | 只读获取分享绑定的 session（分享 token，跳过主鉴权） |

- 除登录两条之外的接口在分发前统一 `isAuthorized()` 校验；未通过返回 401。
- 未匹配的 `/api/*` 返回 404。
- 所有 API 响应都带 `Cache-Control: no-store`。

## 扫描（`src/server/scanner.ts`）

- `PROJECTS_ROOT = ~/.claude/projects`；`projectsRootExists()` 用于空状态判断。
- `listProjects()` 列一层目录；每个项目目录里再列 `*.jsonl` 与 `<uuid>/subagents/*.jsonl`，并记录 `mtimeMs` / `size`。
- `findSessionById(id)` 线性扫描所有项目找匹配 session 文件。
- `listSubagentMetas(parentId)` 读取 `<parent>/subagents/agent-XXX.meta.json` 旁挂文件，返回 `[{ sessionId, agentType, description, mtimeMs }]`（按 mtime 升序）。`getSessionDetail` 用它配合父 session 中的 `Task`/`Agent` tool_use 的 `(subagent_type, description)` 字段建立 `subagentLinks: { toolUseId → subagentSessionId }`，附在 `SessionDetail` 上返回；share 端点**不**附带（子代理不在分享范围内）。

## 分享（`src/server/shares.ts` + `src/server/db.ts`）

- 状态库：`bun:sqlite`，默认路径 `$HOME/.config/cc-viz/db.sqlite`，可用 `CC_VIZ_DB` 覆盖。WAL 模式；`PRAGMA user_version` 做迁移。
- 表结构：

  ```sql
  CREATE TABLE shares (
    token       TEXT PRIMARY KEY,
    session_id  TEXT NOT NULL,
    label       TEXT,
    created_at  TEXT NOT NULL,
    expires_at  TEXT       -- NULL = 永久
  );
  CREATE INDEX idx_shares_session_id ON shares(session_id);
  ```

- token 用 `randomBytes(24).toString('base64url')`，查找时 `timingSafeEqual` 定值比较。
- TTL：`'1d' | '7d' | null`，过期判定在每次请求时做（惰性失效，不需要 GC）。
- 撤销 = 物理 `DELETE`。
- 分享端点 `/api/share/:token/session` 不走 `isAuthorized`，自己用 `resolveActiveShare(token)` 校验：token 存在 + 未过期 + 绑定到的 sessionId 必须匹配实际加载的 session（路由内部由 share 决定 sessionId，不接受外部传入）。

## 缓存（`src/server/cache.ts`）

- 单例 `Map<absPath, { mtimeMs, result }>`；`getParsedSession()` 每次 stat 比对 mtime，命中即返。
- 不持久化、不预热；进程退出即丢失。
- 提供 `invalidateCache(path?)` 与 `cacheSize()`（目前未在 API 暴露）。

## 搜索（`src/server/search.ts`）

- 输入小写 trim 后空字串直接返回 `[]`。
- 遍历所有 session（复用 `getParsedSession`），对每个 user/assistant 的 `text` 与 `thinking` 块做 `indexOf` 计数，记录第一处命中的上下文 `…前40字 + 命中 + 后80字…`。
- 排序按 `matchCount` 降序，最多返回 100 条。
- 返回类型 `SearchHit { sessionId, projectId, title, cwd, snippet, matchCount }`。

## 定价（`src/lib/pricing.ts`；`src/server/pricing.ts` 直接转发）

```ts
PRICING = {
  'claude-opus-4-7'   | 'claude-opus-4-6'   | 'claude-opus-4'   : { 15, 75, 18.75, 1.5 },
  'claude-sonnet-4-6' | 'claude-sonnet-4'                       : {  3, 15,  3.75, 0.3 },
  'claude-haiku-4-5'  | 'claude-haiku-4'                        : {  1,  5,  1.25, 0.1 },
  default                                                       : {  3, 15,  3.75, 0.3 },
}
```

`resolvePricing(model)` 先精确匹配，再剥掉末尾 `[xxx]`（如 `[1m]`）与 `-YYYYMMDD` 日期后缀再匹配；都不中走 `default` 并标记 `known: false`。

`calcCost(model, usage)` 单位 USD per 1M token，把 input / output / cache_write / cache_read 各自相乘后求和。
