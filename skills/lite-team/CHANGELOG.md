# Changelog

## 1.1.0

- 修正文档脚本调用为 `python3`（脚本需 Python 3，部分系统 `python` 仍是 Python 2）。
- 新增 `add` 子命令：自动生成 `id`、追加消息，并在脚本层守住 7 条上限与 500 字 `summary` 软约束。
- SKILL.md/README 同步推荐用 `add` 写入，并补充 `summary` 长度软约束。
- 新增 `references/roles/` 内置角色人设（产品 / 开发 / 测试），并与 BBS 机制咬合：每个角色明确读哪些消息、用何种 `type` 写给谁、边界外如何交接，继承未验证不宣称完成、`summary` 软约束、详情转 topic 文件等约束。SKILL.md 切换角色时按需读取对应文件。
- skill 由 `light-bbs-collab` 重命名为 `lite-team`，description 改为中文；BBS 协作板文件由 `docs/bbs/bbs.md` 改名为 `docs/bbs/lite-team-bbs.md`，全仓引用同步更新。

## 1.0.0

- 初始版本：手动角色、按需 BBS、拟归档确认、9 条历史裁剪。
