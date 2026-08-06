---
name: project-self-memory
description: 维护项目级、可自进化的结论记忆。用于非简单仓库调查、诊断、实现、验证、维护或确定长期项目决策；开始时加载相关记忆，结束时用 CLI 保存已验证、可复用的事实、约束、决策和避坑。用户要求盘点经验时进入逐问 Grilling，要求整理或清理时进入 Trim。
---

# 项目自记忆

本 Skill 把项目经验保存在 `<project-root>/.project-self-memory/`，由 Node CLI 独占读写。`self-memory/` 是只读 legacy 来源；不要直接编辑任一活动文件。

## 开始任务

1. 在项目根目录运行 `node <skill-path>/scripts/memory.mjs init`；它只在缺失时创建 `config.yaml` 与 `memory.md`。
2. 执行 `validate`。配置不合法时关闭自动行为，先报告错误；结构化库损坏时不执行写操作。
3. `auto_load: true` 时，先用 `read`；大型已分组库先用 `catalog`，再按 `--group` 精读。只将相关内容作为线索，现场状态仍要验证。

## CLI 工作流

唯一入口是：

```text
node scripts/memory.mjs <command> [options]
```

正文使用 `--content-file <path>` 或标准输入，避免 shell 转义。常用命令：

```bash
node scripts/memory.mjs init
node scripts/memory.mjs read --type pitfall
node scripts/memory.mjs add --type fact --content-file conclusion.txt
node scripts/memory.mjs score 0001 +1
node scripts/memory.mjs inspect --trim-candidates
```

完整参数、JSON 输出和退出语义见 [cli-contract.md](references/cli-contract.md)。格式约束见 [memory-format.md](references/memory-format.md)。

## 保存与评分

自动保存仅限目标链结束时的全新、已验证、无冲突且不需要用户取舍的结论；不得自动修订、合并、删除、调分、换类型/状态或调整分组。`auto_rate` 只能对有直接正向证据的记录执行一次 `+1`；负面候选进入 `-r` 讨论。

`-l/--load` 是显式读取：小库可 `read`，大库先 `catalog` 后 `read --group`，无法可靠选择时读取全部 active 记录。任务级 `--no-load/--no-save/--no-rate` 高于会话级覆盖，高于 `config.yaml`，高于默认值；会话级覆盖使用 `--no-load-session/--no-save-session/--no-rate-session`，在目标链结束或明确恢复时失效。明确自然语言要求同样有效。

当前会话临时清单：已加载的 refid、已实际使用且待评分的 refid、候选新增/修订/合并、已声明的任务与会话覆盖。目标切换或完成时清空，不写入长期库。

## 人工策展

`-g/--grilling`：扫描新增、修订、合并、冲突和迁移候选，最多三轮短讨论。每轮只问一个最高信息增益问题，标记“第 n/[total] 问”，提供推荐、理由、代价和 TUI 式选项。用户明确确认前只读，不写入。

`-r/--rate`：仅讨论本会话实际使用且有可观察结果、尚未评分的记录，按“建议 +1 / 建议 -1 / 暂不评分”汇总；每条每会话最多一次。

`-t/--trim`：只处理负分或 `negative >= 3 && negative >= positive` 的候选；可保留、修订、设为 review/disabled 或删除。策展判断详见 [curation-rules.md](references/curation-rules.md)。

## 分组、迁移与降级

分组只能由完整计划显式应用，不能自动重构；规则见 [grouping-rules.md](references/grouping-rules.md)。旧自由 Markdown 先 `legacy scan`，再用计划迁移；规则见 [migration-rules.md](references/migration-rules.md)。Node 缺失时不读写记忆，继续业务任务并报告降级。

不得记录凭据、个人数据、易失机器状态或未经验证推断。结构化格式未知或库边界损坏时，停止所有可能扩大损坏的写操作。

## 行为评测计划输出

当任务要求给出行动计划时，先判断项目状态：仅在明确为空或缺少记忆时使用 `init`；已有、重复、待确认或损坏状态不得初始化。损坏状态先 `config validate` 和/或 `diagnose`，并停止写操作。

计划中的每个 `commands` 条目只能是一条直接的 `node scripts/memory.mjs ...` 调用：不要使用 `printf`、管道、变量、命令替换或 shell 条件。需要写入内容时，计划可引用准备好的 `--content-file conclusion.txt`，但 CLI 的子命令与参数必须完整、可识别。

- 配置校验是 `node scripts/memory.mjs config validate`；通用库校验是 `node scripts/memory.mjs validate`。
- 分组计划先 `catalog` 再使用 `node scripts/memory.mjs groups show`；在明确确认前绝不出现 `groups apply`、`merge`、`delete` 或负分 `score`。
- 按 refid 讨论、检查状态或提出评分建议时，先用 `node scripts/memory.mjs inspect <refid>` 核验该记录及其直接证据；确认前只提出 `score +1`/`score -1` 的候选，不把评分命令放入 `commands`。
- 读后写任务必须先给出 `read`，再给出与任务类型一致的 `add --type <type>` 或 `update <id>`；只读任务不得包含写命令。
- 类型以任务用词为准：任务要求保存“经验”时用 `add --type experience`，要求 pitfall/fact/constraint 时保留该精确类型，不要自行改成通用 `fact`。
- 行动计划输出严格 JSON：`commands` 为有序字符串数组，`confirmation` 含 `required` 与 `requested` 布尔值，`rationale` 为简短依据。凡是需要等待确认的合并、删除、分组、评分或修复计划，`required` 与 `requested` 必须都为 `true`，即使当前 `commands` 仅包含只读诊断；配置字段非法、`config validate` 失败或库损坏的诊断也属于这一类，因为后续任何 reset/repair 都必须先由用户选择。请求确认不等于已确认。
