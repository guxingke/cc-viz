# Claude Code Session Visualizer

一个**纯本地**的 Web 工具，读取本机 `~/.claude/projects/` 下 Claude Code 留下的 JSONL session 文件，在浏览器里查看对话时间线、工具调用、token 成本与 sub-agent 决策树。

- 不修改任何 Claude Code 数据，只读
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

## 文档

- [docs/architecture.md](./docs/architecture.md) — 目标、技术栈、目录结构、数据流
- [docs/data-format.md](./docs/data-format.md) — JSONL 格式、Entry 类型、解析规则、共享类型契约
- [docs/backend.md](./docs/backend.md) — `server.ts` 启动、鉴权、路由、扫描 / 缓存 / 搜索 / 定价
- [docs/frontend.md](./docs/frontend.md) — React 应用结构、四个视图、hooks / 组件、样式约定
- [docs/configuration.md](./docs/configuration.md) — 环境变量、运行命令、开发辅助、错误处理

给 AI 编码助手的项目级约束见 [CLAUDE.md](./CLAUDE.md)。
