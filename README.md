# Claude / Codex Session Visualizer

一个**纯本地**的 Web 工具，读取本机 Claude Code 与 Codex 留下的 JSONL session 文件，在浏览器里查看对话时间线、工具调用、token 与决策树。

- 数据源：Claude Code `~/.claude/projects/`，Codex `~/.codex/sessions/`
- 不修改任何 Claude Code / Codex 数据，只读
- 不联网、不上传，单进程跑在 `localhost`
- 默认开启 token 鉴权（loopback 上也不裸奔）

## Quickstart

```bash
bun install
bun run dev
```

启动后会自动打开浏览器（默认 `http://localhost:3456`）。
控制台会打印带 token 的访问 URL，首次访问后 token 换成 Cookie，地址栏即可去掉 query。

固定 token（推荐）：

```bash
export CC_VIZ_TOKEN=<your-token>
```

完全关掉鉴权（仅本机信任时使用）：

```bash
CC_VIZ_NO_AUTH=1 bun run dev
```

## 分享单个 session

在 session 详情页点 **Share** 按钮，可创建一个独立 token 的只读链接（可选 1d / 7d / 永久 TTL），可以随时撤销。分享链接形如 `http://<host>:<port>/share/<token>`，不携带主鉴权 token；分享态严格只读，仅能访问绑定的那一个 session。

> ⚠️ 分享链接的 host 来自你打开页面时的浏览器地址栏 origin。若要发给同局域网的人，请**用启动日志里那行 `LAN: http://<ip>:3456` 的地址打开页面**再创建分享，否则复制出的链接会是 `localhost`。

共享链接状态保存在本机 SQLite，默认位置 `$HOME/.config/cc-viz/db.sqlite`（可用 `CC_VIZ_DB` 覆盖）。

## 常驻运行

要把它做成本机后台 daemon（开机自启、崩溃重启、与开发副本隔离），见 [docs/deployment.md](./docs/deployment.md)。一句话流程：`bun run release` 把当前代码同步到 `~/.local/share/cc-viz/`，由 [svcctl](https://github.com/.../svcctl) 托管的 launchd daemon 加载这份运行副本。

## 文档

- [docs/architecture.md](./docs/architecture.md) — 目标、技术栈、目录结构、数据流
- [docs/data-format.md](./docs/data-format.md) — JSONL 格式、Entry 类型、解析规则、共享类型契约
- [docs/backend.md](./docs/backend.md) — `server.ts` 启动、鉴权、路由、扫描 / 缓存 / 搜索 / 定价
- [docs/frontend.md](./docs/frontend.md) — React 应用结构、四个视图、hooks / 组件、样式约定
- [docs/configuration.md](./docs/configuration.md) — 环境变量、运行命令、开发辅助、错误处理
- [docs/deployment.md](./docs/deployment.md) — 本机常驻服务（svcctl + 发布副本）

给 AI 编码助手的项目级约束见 [CLAUDE.md](./CLAUDE.md)。
