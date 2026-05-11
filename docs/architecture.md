# Architecture

## 项目目标

一个**纯本地**的 Web 工具，用于查看与回顾 Claude Code 的历史 session。读取本机 `~/.claude/projects/` 下的 JSONL 文件，解析后通过浏览器展示：

- 项目维度的 session 聚合视图（数量、token、成本、最近活跃）
- 单个 session 的 Timeline / Tool calls / Tokens / Agent tree 四个视图
- 跨 session 的全文搜索

## 非目标（明确排除）

- 不监听进行中的 session（仅静态回放，按文件 mtime 失效后重读）
- 不内置多用户体系，但**提供单 session 只读分享链接**（独立 token、可选 TTL、可撤销）
- 不写入或修改任何 Claude Code 的原始数据（`~/.claude/` 全程只读）
- 不引入额外 UI 框架（如 shadcn）和重型构建工具（Vite / Webpack / Next 等）

> 分享功能引入了一处可写状态库：`$HOME/.config/cc-viz/db.sqlite`（可用 `CC_VIZ_DB` 覆盖）。除此之外没有其他持久化。

## 技术栈

| 层 | 选型 | 备注 |
|---|---|---|
| Runtime | **Bun** (>= 1.1) | 内置 `Bun.serve` + HTML import 打包 |
| 后端 | `Bun.serve` + HTML import | 单进程，前端由 Bun 直接打包 |
| 前端 | React 18 + TypeScript | 纯 CSR，无 SSR |
| 样式 | Tailwind CSS **v4**（`@tailwindcss/cli`） | 由 `server.ts` 启动时编译产物 `src/styles.built.css`，并以 `--watch` 子进程做 HMR |
| 路由 | `react-router-dom` v6 | 客户端路由；`/sessions/:id` 在服务端回退到 `index.html` |
| 图表 | Recharts | TokenChart |
| 图结构 | React Flow (`@xyflow/react`) + `dagre` | AgentTree 布局 |
| Diff | `react-diff-viewer-continued` | Edit / Write 工具 |
| 虚拟滚动 | `@tanstack/react-virtual` | Timeline 长列表 |

依赖列表以 `package.json` 为准。

## 目录结构

```
cc-viz/
├── package.json
├── tsconfig.json
├── server.ts                       # Bun.serve 入口；负责 Tailwind 编译、鉴权、路由
├── README.md
├── CLAUDE.md                       # 给 AI 编码助手的项目级约束
├── docs/                           # 本目录
├── scripts/
│   └── inspect.ts                  # 开发用：抽样查看 JSONL
├── src/
│   ├── index.html                  # HTML 入口，仅承载 <div id="root"> 与 app.tsx
│   ├── app.tsx                     # React 根：BrowserRouter + AuthGate + Shell
│   ├── styles.css                  # Tailwind 入口（v4 语法，含 dark class 自定义 variant）
│   ├── styles.built.css            # 编译产物（.gitignore，运行时生成）
│   ├── server/
│   │   ├── auth.ts                 # token 生成、Cookie/Bearer 解析、定值比较
│   │   ├── cache.ts                # 按 absPath + mtime 内存缓存
│   │   ├── db.ts                   # bun:sqlite 打开 + 迁移（CC_VIZ_DB / 默认 $HOME/.config/cc-viz/db.sqlite）
│   │   ├── parser.ts               # JSONL → SessionDetail + ToolCallPair 配对
│   │   ├── pricing.ts              # 转发至 lib/pricing
│   │   ├── routes.ts               # /api/* 路由分发
│   │   ├── scanner.ts              # 扫描 ~/.claude/projects/ 及 sub-agent 子目录
│   │   ├── search.ts               # 跨 session 文本搜索
│   │   └── shares.ts               # 单 session 只读分享链接：CRUD + token 校验 + TTL
│   ├── lib/
│   │   ├── api.ts                  # 前端 fetch 封装 + 401 回调
│   │   ├── format.ts               # token / cost / duration / cwd 格式化
│   │   ├── pricing.ts              # 模型定价表 + calcCost
│   │   ├── toolCalls.ts            # 前端版 tool_use / tool_result 配对
│   │   └── types.ts                # 跨端共享类型
│   ├── hooks/
│   │   ├── useDarkMode.ts          # light / dark / system
│   │   └── useFetch.ts             # 简单 fetch + race-guard
│   ├── components/
│   │   ├── CodeBlock.tsx
│   │   ├── DiffViewer.tsx
│   │   ├── EmptyState.tsx          # 兼带 ErrorBox / Spinner
│   │   ├── MessageBubble.tsx
│   │   ├── ThemeToggle.tsx
│   │   ├── TokenPrompt.tsx         # 鉴权登录界面
│   │   └── ToolCallCard.tsx
│   └── views/
│       ├── SessionList.tsx
│       ├── SessionDetail.tsx       # tab 切换容器
│       ├── Timeline.tsx
│       ├── ToolCalls.tsx
│       ├── TokenChart.tsx
│       └── AgentTree.tsx
```

没有 `tailwind.config.js`、`bunfig.toml` — Tailwind v4 无需配置文件，启动命令直接由 `package.json scripts` 提供。

## 数据流概览

```
~/.claude/projects/<encoded-cwd>/*.jsonl
        │
        ▼
  scanner.ts ── 列项目 / session 文件 + sub-agent 子目录
        │
        ▼
  cache.ts ──── 按 mtime 命中，未命中则
        │
        ▼
  parser.ts ── JSONL → SessionDetail（含 entries + tree + 统计）
        │
        ▼
  routes.ts ── /api/{projects, sessions, sessions/:id, search} → JSON
        │
        ▼
   前端 useFetch → views/* 渲染
```

详细说明：

- 数据格式与解析规则：[data-format.md](./data-format.md)
- 后端各模块：[backend.md](./backend.md)
- 前端各视图：[frontend.md](./frontend.md)
- 运行 / 配置：[configuration.md](./configuration.md)
