# Issue tracker: Local Markdown

本仓库的工单与规格以 Markdown 文件保存在 `.scratch/`，不使用远端 Issues。

## 文件约定

- 每个功能一个目录：`.scratch/<feature-slug>/`。
- 规格文件：`.scratch/<feature-slug>/spec.md`。
- 实施工单：`.scratch/<feature-slug>/issues/<NN>-<slug>.md`，
  从 `01` 开始编号，每个工单独立一个文件，不合并为单个 tickets 文件。
- 工单顶部通过 `Status:` 行记录 triage 状态；
  角色名称见 `triage-labels.md`。
- 评论与讨论追加在文件底部的 `## Comments` 下，保留历史记录。

## 当 skill 要求“发布到 issue tracker”

规格写入对应的 `spec.md`，工单写入对应的 `issues/` 目录。
按需创建目录；不得覆盖已有工单。

## 当 skill 要求“获取相关 ticket”

读取用户指定路径的文件。若仅提供编号，在当前功能目录下解析；
跨功能存在同号工单且无法确定目标时，先澄清。

## Wayfinding operations

供 `/wayfinder` 使用，map 与每个子工单分别保存为文件。

- Map：`.scratch/<effort>/map.md`，
  包含 Notes / Decisions-so-far / Fog。
- 子工单：`.scratch/<effort>/issues/<NN>-<slug>.md`，
  从 `01` 编号，正文记录待解决的问题。
- `Type:` 记录 research / prototype / grilling / task。
- Wayfinding 工单使用 `Status: open` / `claimed` / `resolved`
  表示执行状态；如同时需要 triage，使用独立的 `Triage:` 行记录五种角色，
  不用执行状态覆盖 triage 分类。
- 依赖：顶部使用 `Blocked by: NN, NN`；
  所有被依赖工单均为 resolved 时才解除阻塞。
- Frontier：按编号选择首个 open、无未解决依赖且未被认领的工单。
- Claim：开始工作前先写入 `Status: claimed` 并保存。
- Resolve：在 `## Answer` 下追加答案，设为 `Status: resolved`，
  再将摘要与相对链接追加到 map 的 Decisions-so-far。
