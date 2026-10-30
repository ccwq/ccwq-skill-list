# git-up ez-fast 模式的参数契约

Label: wayfinder:map

## Destination

定清 ez-fast 模式的参数契约：语法、组合矩阵、脚本行为、结果契约、文档同步面与测试口径。本图只出决策与规格，实现另起一轮。

## Notes

- 使用本地 Markdown tracker；后续按 `docs/agents/issue-tracker.md` 查询、认领和推进。
- 讨论使用 grilling、domain-modeling。既有词汇：文件级模式 / 语义模式 / 快车道 / ez-fast 模式，四者不重叠。
- 用户已定：终点是决策加规格、实现另起一轮；`-z` 拆分粒度只按文件；快车道与 ez-fast 正交；脚本层强制拒绝语义计划；错误码复用 `invalid_plan`。
- 参数名 `-z` / `--ez-fast`，中文名「ez-fast 模式」。短参数是长参数的简写，长参数是权威名称。
- 本图不写实现代码，也不改 `skills/git-up/` 下任何文件。

## Decisions so far

- [ez-fast 的参数语法与组合矩阵](issues/01-ez-fast-parameter-contract.md)：`-z` 与 `--ez-fast` 等价；单独使用等于 `-p`；允许 `-p`/`-c`/`-pc`/`-s`，拒绝 `-d`/`--modify`/`-i`；修饰符 `-P`、`-l` 照常可用。
- [ez-fast 的拆分粒度与提交数量](issues/02-ez-fast-split-granularity.md)：只按文件区分，沿用文件级拆分规则；`depends_on` 保留；`-z` 与 `-pc` 组合时快车道命中则单提交，否则回退文件级拆分。
- [ez-fast 放宽哪些检查条件](issues/03-ez-fast-check-relaxation.md)：只放宽规划质量级条件（文件数上限、跨模块），文件数无上限；Git 级条件一条不绕。
- [ez-fast 规则的脚本层强制点](issues/04-ez-fast-script-enforcement.md)：`commit_plan.mjs` 新增独立 `--ez-fast` flag，与 `--fast-path` 正交；收到语义计划返回 `invalid_plan`，不新增错误码。
- [ez-fast 的结果契约与抑制拆分提示](issues/05-ez-fast-result-contract.md)：计划新增步骤级可选字段 `suppressed_split`；结果顶层新增 `semantic_split_disabled` 与 `suppressed_split`；`-zp` 回显完整 YAML，`-zc` 只给 JSON 摘要。
- [ez-fast 与快车道的关系](issues/06-ez-fast-fast-path-interaction.md)：两者正交，快车道不脱离 `-pc/-pcP` 限制；快车道判定在 ez-fast 下放宽文件数与跨模块。

## Not yet specified

- ez-fast 下 Agent 如何判别并声明 `suppressed_split`。判据、误报成本与是否值得额外一次工具调用均未定。见 [工单 07](issues/07-suppressed-split-detection.md)。未决前该字段允许为空。
- ez-fast 术语是否写入根 `CONTEXT.md`。该文件当前只承载 project-self-memory 域的术语，上一张图的先例是不写入。
- ez-fast 在 `references/` 下是否独立成文，还是并入 `references/semantic-commit.md`。取决于文档同步面的划分，见 [工单 09](issues/09-doc-sync-surface.md)。

## Out of scope

- ez-fast 的实现代码。本图只出契约与规格。
- 自动 JSON/YAML 语义分解。规格明确列为 v1 之后的增强，归 Agent 层。
- 其余 7 个 skill 的 Python→Node.js 迁移，约 5200 行。
- `skills-lock.json` 的 git-up 哈希。该文件上次同步是 2026-08-11，git-up 此后已改动，属既有状态，仓库无工具校验。
- 推送分支到 `origin`。
- 补齐模式变更的提交能力。mode 只存在于 index，`content` 模式不提供 mode 参数。
