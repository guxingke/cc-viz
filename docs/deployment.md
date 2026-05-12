# Deployment（本机常驻服务）

本项目定位是**纯本地工具**，"部署"= 让它在本机以后台 daemon 方式常驻，可选给同局域网的人访问。**不要**把它推到公网或多用户服务器。

服务管理走你的 [svcctl](https://github.com/.../svcctl)（macOS launchd 封装）；与开发副本隔离的发布通过 `bun run release` 一键完成。

## 路径布局

| 用途 | 路径 |
|---|---|
| 开发副本 | `/Users/gxk/toy/ai/cc-viz/`（你日常编辑） |
| 运行副本 | `~/.local/share/cc-viz/`（`release.sh` 同步过去，daemon 跑这份） |
| 状态库 | `~/.config/cc-viz/db.sqlite`（shares 持久化，开发 / 运行共享） |
| 日志 | `~/Library/Logs/cc-viz.log`（svcctl 写） |
| svcctl 配置 | `~/.config/svcctl/services.yaml` |

开发副本和运行副本完全隔离：你在 `bun run dev` 改代码、切分支、跑 tailwind watch，都不会影响常驻服务。只有显式跑 `bun run release` 才会推送到运行副本并重启 daemon。

## 一次性安装

### 1. 固定鉴权 token

```bash
export CC_VIZ_TOKEN=$(openssl rand -hex 16)
# 记下来，svcctl 配置和日常访问 URL 都要用
```

### 2. 在 svcctl 加服务条目

编辑 `~/.config/svcctl/services.yaml`，追加：

```yaml
services:
  cc-viz:
    command: /Users/gxk/.bun/bin/bun run /Users/gxk/.local/share/cc-viz/server.ts
    user: gxk                # 关键：以你的身份跑，避免 root 写错位
    keep_alive: true
    run_at_load: true
    log: /Users/gxk/Library/Logs/cc-viz.log
    env:
      HOME: /Users/gxk       # node:os.homedir() 才能找到 ~/.claude/projects
      CC_VIZ_TOKEN: <粘贴上一步的 token>
      NO_CSS_WATCH: "1"      # daemon 里不要跑 tailwind watch 子进程
```

> `user:` 字段是 svcctl 必须 ≥ 支持 UserName 的版本（plist 会写 `<key>UserName</key>`）。不填则以 root 运行，会让 `homedir()` 返回 `/var/root`，扫不到 session 数据。

### 3. 首次发布 + 注册服务

```bash
# 在开发副本目录执行
bun run release                # rsync → ~/.local/share/cc-viz/ + bun install + 构建 CSS
sudo svcctl sync               # 写 plist → /Library/LaunchDaemons + bootstrap
```

### 4. 验证

```bash
svcctl status                  # 应看到 cc-viz running
tail -f ~/Library/Logs/cc-viz.log
# 日志里会打印 LAN: http://192.168.x.x:3456 (use this when sharing)
```

打开 `http://<LAN IP>:3456/?token=<CC_VIZ_TOKEN>` 验证。从 LAN IP 进入页面后，session 详情页的 **Share** 复制出的链接 origin 自动是 LAN IP。

## 日常升级

```bash
# 在开发副本里改代码 / 拉取更新 / 切回 main 分支后：
bun run typecheck              # 改动后先跑这个
bun run release                # 同步 + 重启
```

`release.sh` 末尾会调 `svcctl restart cc-viz`，几秒内生效。

## 查日志 / 排障

```bash
svcctl logs cc-viz             # tail -f
svcctl status                  # loaded / running / last exit code
svcctl restart cc-viz          # 仅重启，不重新发布
```

常见错位：

- **页面空 / 无 sessions**：检查 `env.HOME` 是否设了。`homedir()` 默认读 `process.env.HOME`；root 跑时是 `/var/root`。
- **db.sqlite 权限错误**：曾经以 root 跑过一次，`~/.config/cc-viz/db.sqlite` owner 变 root；`sudo chown gxk:staff ~/.config/cc-viz/db.sqlite`。
- **share 链接还是 localhost**：你是从 `http://localhost:3456` 进入页面创建的，换成 LAN URL 再创建。

## 卸载

```bash
# 从 services.yaml 删 cc-viz 条目，然后
sudo svcctl clean              # 自动 bootout + rm plist
rm -rf ~/.local/share/cc-viz   # 删运行副本
# 状态库可保留（重新安装时分享链接还在），也可手动删 ~/.config/cc-viz/
```
