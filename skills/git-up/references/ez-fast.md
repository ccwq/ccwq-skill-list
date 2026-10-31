# ez-fast 模式

ez-fast 是「用户显式声明这个项目不重要」的信号。它免除语义归类：计划只按文件拆分提交，不做语义分组，也放宽一部分规划质量级检查。

ez-fast 与语义模式互斥。与语义模式的完整对比见 [semantic-commit.md](semantic-commit.md)；本文件只讲 ez-fast。

## 参数语法与组合矩阵

参数名 `-z` / `--ez-fast`，两者完全等价。`-z` 是 `--ez-fast` 的简写。

单独使用 `-z` 等价 `-p`：只输出可审阅的 YAML 计划，不提交，回显完整 YAML。

| 组合 | 结果 |
|---|---|
| `-z` | 等价 `-p`，回显完整 YAML，不提交 |
| `-zp` / `-pz` | 等价 `-z`，回显完整 YAML，不提交 |
| `-zc` | 执行本会话计划，不回显 YAML，只给 JSON 摘要 |
| `-zpc` | 规划并提交。快车道与 ez-fast 同时生效 |
| `-zs` | 委派一个子 Agent 执行 `-pc`。父 Agent 在委派描述里写明 `-z` |
| `-zd` / `-z --modify` | 拒绝。`-d`/`--modify` 的用途是围绕语义边界逐问讨论，ez-fast 计划下没有可讨论的语义边界 |
| `-zi` | 拒绝。`-i` 与提交无关，与 `-s` 现有「不得与其他主模式混用」约束一致 |
| `-zP` / `-z -P` | 允许。push 契约不变 |
| `-zl zh` / `-zl en` | 允许。语言参数与拆分粒度正交 |

参数顺序无关。`-zp` 与 `-pz` 等价。

拒绝组合由 SKILL.md 的规则描述约束。脚本层不校验模式组合 —— 脚本只收到计划，没有模式组合信息。

## 拆分粒度与 `depends_on`

ez-fast 的计划是文件级计划：步骤用 `files` 声明路径。不声明 `changes`，不做语义归类，不生成补丁，不建中间状态文件。

提交数量沿用文件级模式现有规则 —— 按类型、模块和依赖顺序拆分，一个提交可以包含多个文件。ez-fast 不强制单提交。单提交由快车道（`-pc` 满足条件时）决定，快车道未命中时回退到文件级规则。

`depends_on` 是文件级与语义模式共用的字段。ez-fast 只禁语义拆分，不禁依赖排序。依赖成环时仍返回 `dependency_cycle`。

规划阶段仍然读 diff —— 写 commit message 本来就需要。省掉的是「这个文件有几个语义目的」的拆解动作，以及随之而来的补丁生成、`split_patch.mjs` 调用和中间状态文件。

## 检查放宽边界

快车道回退条件分两类。ez-fast 只放宽规划质量级，Git 级一条都不绕。

| 类别 | 条件 | ez-fast 下 |
|---|---|---|
| Git 级 | 已有暂存内容、存在冲突、Git 操作进行中、嵌套 Git 边界、目录联接、二进制与超大文件、风险路径 | 一条都不绕，仍然回退 |
| 规划质量级 | 文件数超限 | 放宽。ez-fast 下无上限，文件数不再作为回退原因 |
| 规划质量级 | 跨模块 | 放宽。不再因此回退 |
| 规划质量级 | 无改动 | 不放宽 |
| 规划质量级 | 任何语义拆分条件（`changes` 存在、同一路径被多个步骤共享、存在 `depends_on`、存在补丁或中间状态文件、不支持的操作） | 放宽。不作为回退原因 |

Git 级条件问的是「这次操作安不安全」，与用户在意不在意提交粒度无关。全放宽会让 ez-fast 变成绕过二进制与风险路径检查的后门。

「文件数无上限」不等于「什么都提交」。暂存区非空、有冲突、Git 操作进行中、嵌套 Git 边界、二进制或超大文件、风险路径、无改动，任一条成立仍然回退。

## `suppressed_split` 判据

`suppressed_split` 回答「哪些路径本可按语义目的拆分，但因 ez-fast 按文件整体提交」。

### 判定主体与时机

Agent 在规划阶段顺带判定，不增加工具调用 —— 读 diff 写 commit message 时顺手完成。不做全量语义分析，与 ez-fast 省时间的目的不冲突。

### 判定规则

- 仅对结构化文件：`.json` / `.yaml` / `.yml` / `.toml`。
- 仅当 diff **新增或删除了 ≥2 个不同顶层键的整块**时，把该文件标记进 `suppressed_split`。
- 纯值修改不触发：版本号联动、批量改字段名等值级修改不算「本可拆分」。
- 排除生成物：`package-lock.json`、`yarn.lock`、`pnpm-lock.yaml`、`npm-shrinkwrap.json`、`*.min.*`。lock 文件天然包含成千上万顶层键但语义永远单一（依赖安装），不排除则每次全量误报。

### 强制层级

- **Agent 侧硬规则**：规划时必须对每个待提交的结构化文件（按上述清单与排除项）执行增删整块判定，命中即写入该步骤的 `suppressed_split`。
- **字段本身软**：`suppressed_split` 允许为空。无结构化文件时为空是正常态。措辞统一为「尽力而为，不保证完整」。用户不应依赖 `suppressed_split` 发现所有被抑制的拆分。
- **脚本侧只校验归属，不校验判定本身**：`suppressed_split` 里的路径必须出现在该步骤的 `files` 中，否则整份计划返回 `invalid_plan`。脚本不实现启发式判定 —— 与「脚本不做事后语义判断」的既有边界一致。

### 误报与漏报

- 误报：仅「改了两个不相干键的值」这类真混合不被标记（属漏报）；值修改判定规则本身不产生误报。
- 漏报：代码文件混多个语义目的、单顶层键整块混改不提示。可接受，由「尽力而为」措辞覆盖。

## 结果契约

结果 JSON 顶层新增两个字段：

| 字段 | 类型 | 含义 |
|---|---|---|
| `semantic_split_disabled` | 布尔 | ez-fast 执行时为 `true`，其余场景不出现或为 `false`。回答「本次是否禁用了语义拆分」。 |
| `suppressed_split` | 字符串数组 | 被 ez-fast 抑制了语义拆分的路径。汇总所有步骤的声明，去重排序。 |

`mode` 字段已经是 `file`，但它无法区分「普通文件级模式」与「ez-fast 强制文件级」—— 后者是被迫的，前者是自然的。这个区别由 `semantic_split_disabled` 单独承载。

语义模式与普通文件级模式的结果不含这两个字段，保持现有结果契约不变。

计划新增步骤级可选字段 `suppressed_split`，放在步骤级，不改 YAML Lite 的顶层裸列表结构：

```yaml
- step: 1
  subject: "build(deps): ✨安装依赖"
  files:
    - package.json
  suppressed_split:
    - package.json
```

汇报文本另有一行说明被抑制的拆分，例如「`package.json` 含多个语义目的，因 `-z` 按文件整体提交」。`-zp` 回显完整 YAML，`-zc` 只给 JSON 摘要，两者都要包含这行文本提示。

## 与快车道的正交关系

ez-fast 改的是**拆分粒度**（只按文件），快车道改的是**汇报形态**（单次聚合只读检查、单提交、紧凑汇报不回显完整 YAML）。两者优化的维度不同。

- 快车道仍然只属于 `-pc`/`-pcP`。`-zp` 不走快车道。
- `commit_plan.mjs` 的 `--ez-fast` 与 `--fast-path` 是两个独立开关，可以同时传，也可以只传其一。
- `--ez-fast` **不隐含** `--fast-path`。ez-fast 沿用文件级拆分规则，可能产出多个提交，隐含单提交会与之矛盾。
- `-zpc` 场景：快车道命中则单提交；快车道未命中则回退文件级拆分，可能产出多个提交。
- 两者都命中时，汇报形态按快车道（紧凑），拆分粒度按 ez-fast（文件级）。

## 错误行为

| 场景 | 错误码 | 说明 |
|---|---|---|
| 语义计划（步骤声明 `changes`）带 `--ez-fast` | `invalid_plan` | 消息形如 `the --ez-fast flag forbids semantic plans; step N declares changes` |
| `suppressed_split` 里的路径不在该步骤 `files` 中 | `invalid_plan` | 消息形如 `step N suppressed_split path "x" is not declared in files` |
| 语义模式步骤声明 `suppressed_split` | `invalid_plan` | 该字段只对 `files` 有意义 |
| `suppressed_split` 用块标量写法 | `invalid_plan` | 列表字段禁块标量，与 `changes` 同类错误 |
| `depends_on` 成环 | `dependency_cycle` | ez-fast 不改依赖排序语义 |

`--ez-fast` 与 `--fast-path` 一样在计划校验阶段拒绝，**拒绝发生在任何 Git 写操作之前**：不落补丁、不产生提交、暂存区保持为空。已预暂存内容的仓库收到语义 ez-fast 计划时，报 `invalid_plan` 而不是 `staged_changes_present`，index 不被触碰。

不新增错误码，复用既有 `invalid_plan`。
