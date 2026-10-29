# Issue 跟踪：本地 Markdown

本仓库的 issue 和 spec 以 markdown 文件形式存于 `.scratch/`。

## 约定

- 每个功能一个目录：`.scratch/<feature-slug>/`
- spec 文件：`.scratch/<feature-slug>/spec.md`
- 实现 issue 一票一个文件：`.scratch/<feature-slug>/issues/<NN>-<slug>.md`，从 `01` 开始编号，禁止合并成单个 tickets 文件
- Triage 状态记录在每个 issue 文件靠近顶部的 `Status:` 行（角色字符串见 `triage-labels.md`）
- 评论与沟通历史追加到文件底部 `## Comments` 标题下

## 当 skill 要求 "publish to the issue tracker"

在 `.scratch/<feature-slug>/` 下新建文件（必要时创建目录）。

## 当 skill 要求 "fetch the relevant ticket"

读取所引用路径的文件。用户通常会直接给出路径或 issue 编号。

## Wayfinding 操作

供 `/wayfinder` 使用。map 是一个文件，每个 ticket 对应一个 child 文件。

- **Map**：`.scratch/<effort>/map.md`（Notes / Decisions-so-far / Fog 正文）
- **Child ticket**：`.scratch/<effort>/issues/NN-<slug>.md`，从 `01` 开始编号，正文是待回答的问题。`Type:` 行记录类型（`research` / `prototype` / `grilling` / `task`）；`Status:` 行记录 `claimed` / `resolved`
- **Blocking（阻塞）**：靠近顶部的 `Blocked by: NN, NN` 行。所列文件全部为 `resolved` 时，该 ticket 才解除阻塞
- **Frontier（前沿）**：扫描 `.scratch/<effort>/issues/`，找出开放、无阻塞、未认领的文件；编号最小者优先
- **Claim（认领）**：设置 `Status: claimed` 并保存，然后才能开始工作
- **Resolve（解决）**：在 `## Answer` 标题下追加答案，设置 `Status: resolved`，然后在 `map.md` 的 Decisions-so-far 中追加上下文指针（gist + 链接）
