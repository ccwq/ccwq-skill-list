# Changelog

## 1.1.3

- 文档去伪命令外观：`SKILL.md` 与 README 中 `/role`、`/bbs`、`/done` 等斜杠写法不再作为主推调用方式。它们本质是「对话内简写」而非注册 slash 命令或 skill 参数，旧写法易让人误以为要用 `--role/-r` 之类的 flag 调用。现以自然语言话术为主（如“切换到测试角色”“假设你是测试”“任务结束，帮我归档”），极简词 `role / bbs / done` 作可选简写，并补充了简单使用实例；偶尔打出的 `/role` 仍被识别（向后兼容）。
- 根 README 的 lite-team 段删除「快捷命令」表，改为自然语言话术块 + 一行简写注；脚本命令表（真 CLI flag）保留。

## 1.1.2

- 将 `SKILL.md` 与内置角色人设中的脚本示例从 `python3 scripts/bbs.py ...` 调整为 `python3 <skill目录>/scripts/bbs.py ...`，避免安装到项目级或个人级 skill 目录后，Agent 误以为项目根目录存在 `scripts/bbs.py`。

## 1.1.1

- 修正 `bbs.py init` 在顶层 `--help` 中仍显示旧路径 `docs/bbs/bbs.md` 的问题，统一为 `docs/bbs/lite-team-bbs.md`。
- `bbs.py init` 改为读取 `assets/bbs.template.md` 作为唯一初始化模板来源，避免脚本内联模板与资源文件双份维护。
- 初始化模板按字节读写，避免 Windows 文本换行转换导致生成文件与模板文件不一致。

## 1.1.0

- 修正文档脚本调用为 `python3`（脚本需 Python 3，部分系统 `python` 仍是 Python 2）。
- 新增 `add` 子命令：自动生成 `id`、追加消息，并在脚本层守住 7 条上限与 500 字 `summary` 软约束。
- SKILL.md/README 同步推荐用 `add` 写入，并补充 `summary` 长度软约束。
- 新增 `references/roles/` 内置角色人设（产品 / 开发 / 测试），并与 BBS 机制咬合：每个角色明确读哪些消息、用何种 `type` 写给谁、边界外如何交接，继承未验证不宣称完成、`summary` 软约束、详情转 topic 文件等约束。SKILL.md 切换角色时按需读取对应文件。
- skill 由 `light-bbs-collab` 重命名为 `lite-team`，description 改为中文；BBS 协作板文件由 `docs/bbs/bbs.md` 改名为 `docs/bbs/lite-team-bbs.md`，全仓引用同步更新。

## 1.0.0

- 初始版本：手动角色、按需 BBS、拟归档确认、9 条历史裁剪。
