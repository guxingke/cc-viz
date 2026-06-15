# CLAUDE.md — Project Instructions

> 本文件是给 AI 编码助手的项目级约束。仅描述**这个仓库**的特殊规则，通用工作流以全局 CLAUDE.md 为准。

## 项目速览

- **类型**：纯本地 Web 工具，可视化 Claude Code / Codex / Kimi 的历史 session。
- **入口**：`server.ts`（Bun.serve）+ `src/app.tsx`（React）。
- **数据源**：只读 `~/.claude/projects/**/*.jsonl`、`~/.codex/sessions/**/*.jsonl` 与 `~/.kimi-code/sessions/` 下的 `wire.jsonl`。
- 技术栈、目录结构、模块职责见 `docs/`。需要业务/格式知识时直接读对应文档，**不要凭印象写**。

## 必读文档（按需）

| 你要改 | 先读 |
|---|---|
| Parser / 类型 / JSONL 字段处理 | `docs/data-format.md` |
| `server.ts`、路由、鉴权、扫描、缓存、搜索、定价 | `docs/backend.md` |
| `src/views/*`、`src/components/*`、hooks、样式 | `docs/frontend.md` |
| 环境变量、运行命令、错误边界 | `docs/configuration.md` |
| 不知道在哪 | `docs/architecture.md` 顶图 |

## 硬约束（不可违反）

1. **不写 `~/.claude/`、`~/.codex/` 或 `~/.kimi-code/` 下任何文件**。这些目录全程只读，包括子目录、子文件。
2. **不要部署、不要 `git push`、不要改 git 远程**。
3. **不引入新的构建工具**（Vite / Webpack / Next / Nuxt / tsx / ts-node 等）。前端由 Bun 直接打包，样式由独立 `@tailwindcss/cli` 编译，这是有意为之。
4. **依赖最小**：`package.json` 没列的库，没有不可替代的理由不要加。改动需求若能用现有依赖完成，优先复用。
5. **不引入 UI 组件库**（shadcn、Radix、MUI 等）。Tailwind 原子类直接写。
6. **不要把 token / Cookie / 鉴权逻辑改成"默认关闭"**。默认开启是安全基线；`CC_VIZ_NO_AUTH` 已经是用户的逃生口。

## 编码工作流

### 改 parser / 类型前
1. 先跑 `bun scripts/inspect.ts` 抽样看真实 JSONL，确认字段名与 `docs/data-format.md` 一致。
2. 若有出入：**先告诉用户**，等确认再改 spec / 类型，不要自己猜测改字段。
3. parser 必须对未知字段宽容（`unknown` 兜底），不要因为缺字段抛错。

### 改完代码后
- 立刻跑 `bun run typecheck`，单文件改动也跑。
- 不要批量改完再一起 typecheck —— 出错时定位成本高。

### 改视图前
- 长列表（Timeline、消息流）保持 `@tanstack/react-virtual` 虚拟滚动，不要换成普通 `map`。
- 暗色模式靠 `<html class="dark">`，不要改成媒体查询；不要在组件里硬编码颜色。
- 新增格式化逻辑前看 `src/lib/format.ts` 是否已有同款。

### 改 API / 路由前
- 所有 `/api/*` 必须经过 `isAuthorized` 校验（除 `/api/_auth/login`、`/api/_auth/check`）。
- 所有 API 响应带 `Cache-Control: no-store`。
- 新增写操作 API：**先和用户确认**。本工具默认是只读的，加任何写动作（包括清缓存、删 session）都属于扩大权责。

## 常见陷阱

- **`SessionSummary.totalTokens` 是对象**（`TokenUsage`），`ProjectSummary.totalTokens` 才是聚合数字。求和需用 `sumTokens` helper。
- **`tree` 可为 `null`**（空 session）。访问前要判空。
- **`EntryType` 是开放 union**（`(string & {})`），switch 必须有 default 分支。
- **Sub-agent 文件**位于 `<project>/<parent-session-uuid>/subagents/*.jsonl`；扫描已处理，但相关逻辑改动需测试 sub-agent 场景。
- **Tailwind 产物 `src/styles.built.css` 在 `.gitignore`**，由启动时编译；不要手改，不要提交。

## 文档同步

- 修改了结构性内容（新增模块 / 删除模块 / 改变数据流 / 新增环境变量 / 改鉴权策略）：**同步更新 `docs/` 对应章节**。
- 修改了启动流程或环境变量：**同步更新 `README.md` Quickstart 和 `docs/configuration.md`**。
- 改完别忘了 `bun run typecheck`。

## 验收基线

完成一项改动前自查：

- [ ] `bun run typecheck` 通过
- [ ] 没有写入 `~/.claude/` / `~/.codex/` / `~/.kimi-code/`
- [ ] 没有引入新依赖（如有，已和用户确认）
- [ ] 涉及的 `docs/` 章节已同步
- [ ] API 改动经过 `isAuthorized` 校验，且未引入新写操作
