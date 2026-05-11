# Frontend

## 入口与 Shell（`src/app.tsx`）

层级：`BrowserRouter` → `AuthGate` → `Shell` → `Routes`。

- **Shell**：固定头部（"Claude Viz" 标题 + `ThemeToggle`）+ 滚动主体。
- **AuthGate**：
  - 状态：`checking | authed | unauthed`。
  - 首次挂载：若 URL 携带 `?token=…` 则先 `POST /api/_auth/login`（成功后从 URL 清除 token），否则直接 `GET /api/_auth/check`。
  - 通过 `setUnauthorizedHandler` 注册全局 401 回调；任何 API 401 都会把状态打回 `unauthed`，渲染 `TokenPrompt`。
- 路由：`/` → `SessionList`；`/sessions/:id` → `SessionDetail`；其余 → 404 文案。

## SessionList（`src/views/SessionList.tsx`）

- **左侧栏**：项目列表（"All projects" + 每个项目）。
  - 每项展示 `shortenCwd(cwd)`，副行 `count · tokens · cost · lastActiveAt(相对时间)`。
  - 选中状态用左侧蓝色边线 + 浅蓝背景；通过 URL `?project=<id>` 持久化。
- **右侧**：
  - 顶部 sticky 工具栏：搜索输入框（回车提交，URL 写入 `?q=`；空查询清掉参数）。
  - 有 `?q=` 时渲染 `SearchResults`（调 `/api/search`），列表项含命中数 + 高亮 snippet。
  - 否则渲染会话表格：`Title / Started(相对) / Msgs / Tools / Tokens / Cost / Model`，行点击进入 `/sessions/:id`。
- `ModelBadge`：根据 model 名包含 `opus|sonnet|haiku` 三色 + 默认灰色，全部 `font-mono`。

## SessionDetail（`src/views/SessionDetail.tsx`）

- 顶部信息条：标题、cwd、startedAt（绝对时间）、`messageCount · toolCallCount · tokens · cost` 一行 `font-mono`、model。
- Tabs：`timeline / tools / tokens / tree`，通过 URL `?tab=` 切换；默认 `timeline`。
- 主体根据 tab 渲染对应视图组件，传入 `detail: SessionDetail`。

## Timeline（`src/views/Timeline.tsx`）

- 主体为虚拟滚动的消息流（`@tanstack/react-virtual`）。
- 每条消息：相对时间、模型 badge（assistant 才有）、内容、usage 小字。
- `thinking` 块默认折叠、灰色斜体。
- `tool_use` 块嵌入消息内，复用 `ToolCallCard` 折叠展示。
- 顶部工具条：跳转顶部 / 底部 / 下一个工具调用 / 下一个 sub-agent 分支。

## ToolCalls（`src/views/ToolCalls.tsx`）

- 扁平列出 `pairToolCallsClient(entries)` 的所有调用对。
- 每条展示：序号、工具名、参数摘要、状态（success / error）、耗时（`result.userTimestamp − assistantTimestamp`）。
- 类型化展示：
  - **Edit / MultiEdit / Write** → `DiffViewer`（Write 的 before 为空）
  - **Read** → 文件路径 + 行数
  - **Bash** → 命令 + 输出（>20 行折叠）
  - **Grep / Glob** → pattern + 命中数
  - **Task** → 高亮，并链到对应 sub-agent
  - **WebFetch / WebSearch** → URL / query + 摘要
  - 其它 → JSON `<pre>` + 语法高亮
- 顶部过滤器：按工具名筛选 / 仅显示错误 / 排序方式。

## TokenChart（`src/views/TokenChart.tsx`）

基于 Recharts，三视图：

1. 累计 token 折线图：x = 消息序号，y = 累计 input / output / cache_creation / cache_read。
2. 单条消息堆叠柱状图：input + output + cache，hover 显示摘要。
3. 累计成本折线（按 `pricing.ts` 计算）。

顶部 summary 卡片：总 input / 总 output / 缓存命中率 `cache_read / (cache_read + input)` / 总成本。

## AgentTree（`src/views/AgentTree.tsx`）

- React Flow + `dagre` 自动布局。
- 节点类型：
  - **主线消息**：圆角矩形，显示消息前 50 字
  - **Task 调用**：菱形，高亮色，显示 description
  - **Sub-agent**：连到对应 Task，显示子分支消息数与最终结果
- 边：`parentUuid → uuid`。
- 点击节点：右侧 drawer 显示完整内容，并提供"跳到 Timeline 该位置"按钮。

## Hooks 与公共组件

- `useFetch(fetcher, deps)`：返回 `{ data, error, loading, refetch }`；用 `tick` ref 抢占旧请求，避免 race。
- `useDarkMode()`：三态 `light | dark | system`；写入 `localStorage[cc-viz:theme]`；监听系统主题。仅在 `<html>` 上切 `dark` class（与 Tailwind v4 `@custom-variant dark (&:where(.dark, .dark *))` 对齐）。
- `EmptyState` 模块同时导出 `EmptyState / ErrorBox / Spinner` 三个简单组件。
- `ThemeToggle`：在 Shell 头部，循环切换主题。
- `TokenPrompt`：当未鉴权时渲染，提交后调 `api.authLogin` 拿 Cookie。

## 样式约定

- Tailwind v4，`src/styles.css` 用 `@import "tailwindcss";` + `@custom-variant dark (&:where(.dark, .dark *));`。
- 暗色模式靠 `<html class="dark">` 切换，**不是**媒体查询，方便用户在三态间手动选择。
- 配色：中性灰 + 强调色 `blue-500/600`；模型 badge 紫 / 蓝 / 绿三色映射。
- 代码使用 `font-mono`，其余系统字体。
- 不引入额外 UI 组件库。
