# 第三方提示词来源

本文记录 [我的提示词](my-prompts.md) 的第三方取材与许可说明。来源核对以本地安装文件、安装元数据和用户提供的 ZIP 为依据；未联网核验当前上游、作者身份或材料完整性。仅提炼规则，未导入为仓库正式 Skill，未执行来源包脚本。

## 来源索引

| 条目 | 来源与取材位置 | 版本与许可证据 |
| --- | --- | --- |
| `ste` | [dualface/ste-zh](https://github.com/dualface/ste-zh)；本地安装目录的 README 安装命令及 LICENSE | 本地 LICENSE：MIT，Copyright (c) 2026 dualface；无发布版号，变更记录日期 2026-10-11。按 ASD-STE100 原则改写，不是官方中文标准。 |
| `wayfinder` | [mattpocock/skills](https://github.com/mattpocock/skills)；安装锁文件记录 `skills/engineering/wayfinder/SKILL.md` | 本地已读材料未声明版本或许可；未从仓库名推断作者与许可。 |
| `grilling` | [mattpocock/skills](https://github.com/mattpocock/skills)；安装锁文件记录 `skills/productivity/grilling/SKILL.md` | 本地已读材料未声明版本或许可；未从仓库名推断作者与许可。 |
| `humanizer-zh` | [op7418/Humanizer-zh](https://github.com/op7418/Humanizer-zh)；本地 README 安装命令、SKILL、CHANGELOG 与 LICENSE | 修订日期 2026-09-23，无此安装材料的发布版号；本地 LICENSE：MIT，Copyright (c) 2026 歸藏。 |
| `infocard-q-style`（待补全） | 用户提供 `infocard-styles.zip` 中 `infocard-q-style/SKILL.md` 与必要 references；包内未注明上游 URL | frontmatter 声明 author: Hermes Agent、version: 1.0.0、license: MIT；包内未附完整许可文本及版权声明，未核验上游。 |
| `infocard-white-purple-style` | 用户提供 `infocard-styles.zip` 中 `infocard-white-purple-style/SKILL.md`；包内未注明上游 URL | frontmatter 声明 author: Hermes Agent、version: 1.0.0、license: MIT；包内未附完整许可文本及版权声明，未核验上游。 |
| `infocard-bigwhite-style` | 用户提供 `infocard-bigwhite-style.zip` 中同名目录的 SKILL 与创建笔记；包内未注明上游 URL | frontmatter 声明 author: Hermes Agent、version: 1.0.0、license: MIT；包内未附完整许可文本及版权声明，未核验上游。 |
| `writing-for-agents` | 用户提供 `writing-for-agents.zip` 中的 SKILL、SKILL-MECHANICS 与 agents 元数据 | 包内未注明上游 URL、作者、版本或许可；未凭名称猜测。 |

`humanizer-zh` 本地材料还列有 [blader/humanizer v3.0.0](https://github.com/blader/humanizer/blob/v3.0.0/SKILL.md)、[Humanizer-zh PR #39](https://github.com/op7418/Humanizer-zh/pull/39)、[stop-slop](https://github.com/hardikpandya/stop-slop) 和 [Wikipedia: Signs of AI writing](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing)。这些是材料声明的参考来源，不代表本次独立核验了各自作者、当前内容或许可。

## ZIP 核对摘要

以下 SHA-256 标识本次实际读取的用户文件；不是上游发布签名，也不证明来源真实性。

| 压缩包 | SHA-256 |
| --- | --- |
| `infocard-styles.zip` | `78a9b6db0876daa1ef524704c657f78c8ec85b6d3ab8e7bec249566268581313` |
| `infocard-bigwhite-style.zip` | `5e3d6116aa1f3b6e41b34a9daf79ec9fc18ad7c15c101c0a2976d0defcbd0343` |
| `writing-for-agents.zip` | `3da5eabf90fae4490bc4ac4c704c802bdcb8be58397f446fa42419b130f61579` |

## 缺件与使用边界

- Q 风格所有生成依赖 `any2card/references/q-style-html-generation-guide.md`；完整版另依赖 `docs/20260604-revfactory-harness-q-style.html` 的精确骨架。所给包及本次定点检查未找到两者，故列为待补全，不交付成功的执行标签块，也不自行补造模板。
- 白紫、大白信息卡保留实际页面制作、渲染及验收能力要求；转换文本不代表已生成或验证画面。大白的公众号迁移支线还引用包内未附资料，本次只提炼通用主题主干，不声称覆盖该支线。
- Wayfinder 与 Grilling 的原流程包含独立代理、技能调用或持久工单能力。用户可传递、保存文字材料，但文本交换不保证并发认领、依赖视图、研究分支或推送能力；缺少必需能力时须明报。
- 未知许可不等于获得开源许可。再次发布或分发前，应取得并核对适用的完整许可及版权声明；仓库根 MIT 许可不自动覆盖这些第三方原始材料。

## 已知 MIT 声明

以下保留本地已提供的两份完整许可。二者各适用于对应来源材料，不代替其他条目的许可。

### ste

```text
MIT License

Copyright (c) 2026 dualface

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### humanizer-zh

```text
MIT License

Copyright (c) 2026 歸藏

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
