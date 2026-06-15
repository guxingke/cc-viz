# Configuration & Operations

## 运行命令

```bash
bun install
bun run dev        # bun --hot server.ts（开启 Tailwind watch）
bun run start      # bun server.ts
bun run typecheck  # tsc --noEmit
```

默认监听 `http://localhost:3456`；启动后不自动打开浏览器，需要时设置 `CC_VIZ_OPEN=1` 启用。

启动日志同时会探测主网卡 LAN 地址（macOS / Linux 解析默认路由出口网卡）并打印一行 `LAN: http://<ip>:3456`；该地址用于"分享给同局域网的人"场景 —— 浏览器若通过 LAN IP 打开页面，分享对话框复制出的链接 origin 自动就是 LAN IP，无需额外配置。`CC_VIZ_OPEN=1` 自动打开的也是 LAN URL（若拿到）。

## 环境变量

| 变量 | 默认 | 作用 |
|---|---|---|
| `PORT` | `3456` | 监听端口 |
| `CC_VIZ_TOKEN` | 启动时随机生成 | 鉴权 token；不设置则每次启动变动 |
| `CC_VIZ_NO_AUTH` | unset | 设为 `1` 完全关闭鉴权 |
| `CC_VIZ_DB` | `$HOME/.config/cc-viz/db.sqlite` | SQLite 状态库路径；分享链接持久化于此 |
| `CC_VIZ_OPEN` | unset | 设为任意非空值则启动时自动打开浏览器 |
| `NO_CSS_WATCH` | unset | 设为任意非空值则跳过 Tailwind `--watch` 子进程 |

启动日志会打印带 token 的访问 URL；首次访问把 token 换成 Cookie 后即可去掉 query。
如需固定 token，参照日志提示导出环境变量：

```bash
export CC_VIZ_TOKEN=<your-token>
```

## 开发辅助

- **`scripts/inspect.ts`**：开发期工具，抽样查看一份真实 JSONL，用于核对 parser 字段映射。**修改 parser 前先跑一次。**
- **`bun run typecheck`** 必须通过；CI 暂未配置。
- 单文件改动尽量在保存后立刻 `bun run typecheck` 验证一次。

## 错误处理边界

- JSONL 单行解析失败：累计到 `parseErrors`，不阻塞其余行（目前未暴露到 UI，仅 console 友好）。
- 文件读取失败：API 返回 404；前端 `useFetch` 把错误传给 `ErrorBox`。
- `~/.claude/projects/` 与 `~/.codex/sessions/` 都不存在：`listProjects()` 返回空数组；UI 表现为 `EmptyState`。
- API 抛错：`handleApi` 兜底 500 + `console.error`。
- 401：API 统一返回；`api.ts` 调全局 unauthorized handler，把 UI 切到登录态。

## 状态存储

唯一的可写状态库是 `$HOME/.config/cc-viz/db.sqlite`（首次启动自动 `mkdir -p`，WAL 模式）。当前只放 `shares` 表（分享链接），未来如有其他元数据按表分增即可。

`~/.claude/` 与 `~/.codex/` 全程只读，未被该数据库引用，也不会被写入。

## 缓存语义

- 内存 `Map<absPath, { mtimeMs, parsed }>`，按 mtime 校验。
- 进程退出即清空，不持久化。
- 没有手动清缓存的 API；如需强刷，重启进程或修改文件触发 mtime 变化。
