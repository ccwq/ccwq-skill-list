# 格式与脚本接口

## JSON 输入

下面是虚构格式示例，不代表真实状态。`mode` 缺省为 `portable`；另一合法值为 `skill name`。

```json
{
  "schema": "handoff-portable/v2",
  "summary": "任务目标、交付要求、当前检查点和授权边界。",
  "captured_at": "2026-10-27T12:00:00+08:00",
  "coverage": "检查范围、正文来源、加载历史是否完整。",
  "skills": [
    {
      "name": "skill-foo",
      "source": "来源位置、加载证据；版本无法核对时明确说明",
      "status": "当前适用；或条件适用、已覆盖、未确认",
      "constraints": "与任务主干相关的精炼约束，包含必要条件和例外。"
    }
  ],
  "global_rules": "全局规则的精炼版本，含来源及适用范围；没有证据时明确未确认。",
  "project_rules": "项目规则的精炼版本，含来源及适用范围。",
  "state": {
    "progress": "工作状态和最后检查点。",
    "history": "关键决策及理由、失败尝试、用户纠正、未解决问题。",
    "verification": "检查方法、检查时间或范围、结果、覆盖范围；未验证项及原因。",
    "gaps": "缺失、影响和取得资料的方法；无已知缺失时说明检查范围。",
    "next_action": "建议的下一步；接收方等待用户指示。"
  },
  "materials": [
    {
      "name": "接续必要的文件",
      "source": "原路径或文档位置，仅作来源",
      "scope": "完整正文或摘录范围；省略部分与影响",
      "language": "text",
      "text": "审查和脱敏后的必要正文"
    }
  ]
}
```

`portable` 模式下，每个技能必须有 `constraints`、`source`、`status`。技能约束是精炼版本，不是原文副本。来源引用中的任务相关约束合并到对应技能，注明来源。`skill name` 模式仅要求技能 `name`，即使输入含约束也不输出正文。

全局和项目规则在两个模式下均精炼保留。两模式均保留任务状态与关键历史。两个模式均对所有 `materials` 内嵌必要正文。二进制不放进 `materials`；在 `state.gaps` 写补充清单。无相关技能或资料时使用空列表并如实说明。

## 单文件布局

使用 Markdown 标题、XML 风格标签和代码围栏混合组织；不要求严格 XML 解析：

```md
# 任务概要

目标、交付要求、当前检查点、授权。

<skill name="skill-foo">
来源与适用状态。
任务相关的精炼约束。
</skill>

<全局约束>
精炼规则、来源和范围。
</全局约束>

<项目约束>
精炼规则、来源和范围。
</项目约束>

<任务情况>
STE 描述：进度、关键历史、验证、缺失、建议的下一步。
</任务情况>

<任务资料>
必要文本；代码使用 Markdown 代码块。
</任务资料>

<描述规范>
STE 描述规范正文。
</描述规范>

<接收要求>
复述理解后等待用户指示。
</接收要求>
```

`skill name` 模式技能写成 `<skill name="skill-foo" />`。必要文本不只写本机路径。多个技能使用多个标签。代码围栏长度随正文调整；代码正文原样保存。

## 脚本

```bash
python3 <skill-dir>/scripts/portable.py build <manifest.json> --output <HANDOFF.md>
python3 <skill-dir>/scripts/portable.py verify <HANDOFF.md>
python3 <skill-dir>/scripts/portable.py check <manifest.json>
```

`build` 渲染交接文件；`verify` 解析已生成文件的结构；`check` 对 manifest 做语义体检，`build` 在渲染前自动调用它。

退出码：`0` 成功且无警告；`2` 成功但有警告，需要人眼判断；`1` 失败（结构错误、输入错误、I/O 错误）。`build` 有警告仍退出 `0`，文件照常产出；`verify` 与 `check` 有警告退出 `2`。警告行走 stderr，前缀 `WARN: `；失败行前缀 `FAILED: `。

`build` 只在 manifest 硬校验不通过时拒绝产出（退出 `1`）。产出文件的结构自检只发警告：manifest 合法但内容会破坏文件结构时，`build` 仍写出文件并提示 `verify` 会拒绝它，由 `verify` 决定是否放行。

`verify` 按行解析结构：六个必需段落必须成对、顺序固定、内容非空（围栏标记行不算内容，围栏里的正文算），`<skill>` 元素必须配对，模式行必须在概要区且取值合法。代码围栏内的同名文本不算标签。CRLF 行尾在校验前归一化。

`references/ste-description.md` 用 `<!-- ste-policy:start -->` 与 `<!-- ste-policy:end -->` 圈定规范正文，脚本只取标记之间的内容。改说明段不会污染交接文件，删掉标记会直接报错。

脚本拒绝覆盖已有文件。输入 JSON 只用于导出端，不随交接文件提供。脚本不在 Markdown 重复内嵌 JSON，减少普通聊天窗口负担。末尾 SHA-256 仅检测意外改动，不证明真实性、精炼准确性或来源完整性。接收方无需执行脚本；没有执行检查时不得声称校验通过。

此版本使用 v2 输入与输出；v1 完整快照清单不适用，脚本会拒绝旧版输入。手工生成文件时遵循布局；没有自动校验值也可以阅读，明确自动检查未执行。
