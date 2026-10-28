# Changelog

All notable changes to this skill will be documented in this file.

## [1.1.0] - 2026-10-28

### Changed / 变更
- `verify` 从纯子串匹配改为结构解析：六个必需段落必须成对、顺序固定、内容非空；`<skill>` 元素必须配对；模式行必须在概要区且取值合法。代码围栏内的同名文本不再被当成标签。
- 空段落判定不把围栏标记行算作内容；围栏里的正文算内容。
- 校验前把 CRLF 行尾归一化为 LF，并接受 `\r?\n` 收尾的校验和 footer。归一化发生时在 stderr 提示一行。原先的 `Missing v2 checksum footer` 误导性报错不再出现。
- `references/ste-description.md` 用 `<!-- ste-policy:start -->` / `<!-- ste-policy:end -->` 显式圈定规范正文，脚本只取标记之间的内容。标记缺失时报明确错误，不再依赖「文件恰好三段」的结构。
- 错误信息带路径，并区分「manifest 读不到」「输出目录不存在」「输出文件已存在」「manifest JSON 非法」。
- `build` 只在 manifest 硬校验不通过时拒绝产出。产出文件的结构自检改为警告：manifest 合法但内容会破坏文件结构时，仍写出文件并提示 `verify` 会拒绝它。
- 交接文件的产出格式与 manifest 输入契约不变。既有交接文件仍能通过校验。

### Added / 新增
- 新增 `check` 子命令，对 manifest 做语义体检：技能列表为空、被模式丢弃的约束正文、声明范围与正文长度不符、源文件修改时间晚于采集时间、正文疑似未脱敏凭据。只警告不阻断。
- `build` 在渲染前自动执行语义体检，警告打到 stderr，文件照常产出，退出码仍为 `0`。
- 退出码统一：`0` 成功无警告，`2` 成功但有警告，`1` 失败。`verify` 与 `check` 有警告时退出 `2`。
- 新增 `test-space/handoff-portable/run_tests.py` 离线回归测试，含本次收紧前的交接文件兼容性样本。

### Fixed / 修复
- 文档首句不再引用仓库中不存在的 `handoff` Skill，改为声明不依赖任何其他 Skill，并补充与 `lite-team` 的边界区分。
- 文档补充「整个技能目录必须完整部署」的约束：`scripts/portable.py` 按自身位置查找规范文件。

## [1.0.0] - 2026-10-28

### Added / 新增
- 初始版本：从 `skill-zips/handoff-portable.zip` 原样纳入。
- 双模式交接：`portable` 提炼与任务主干相关的技能约束、全局规则与项目规则并内嵌必要资料；`skill name` 只列技能名。
- 交接文件布局：`# 任务概要` + `<skill>` / `<全局约束>` / `<项目约束>` / `<任务情况>` / `<任务资料>` / `<描述规范>` / `<接收要求>` 混合标签。
- 内嵌 STE 描述规范正文，供接收方在后续回复中沿用。
- 附 `scripts/portable.py`：`build` 生成单个 Markdown，`verify` 校验结构与意外改动；接收方无需运行脚本。
- 附 `references/package-format.md`（JSON 输入契约与单文件布局）、`references/ste-description.md`（STE 描述规范正文）、`agents/openai.yaml` 与 `assets/icon.svg`。
