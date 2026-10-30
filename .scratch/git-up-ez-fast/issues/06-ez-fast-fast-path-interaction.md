# ez-fast 与快车道的关系

Status: resolved
Type: grilling
Parent: ../map.md
Blocked by: none

## Question

快车道目前写死「只属于 `-pc/-pcP`」。ez-fast 引入后，快车道是否脱离这个限制？两者是替代关系还是正交关系？

## Answer

### 正交，不脱离

ez-fast 改的是**拆分粒度**（只按文件），快车道改的是**汇报形态**（单次聚合只读检查、单提交、紧凑汇报不回显完整 YAML）。两者优化的维度不同，合并会造出一个四不像的概念。

快车道仍然只属于 `-pc`/`-pcP`。`-zp` 不走快车道。

### 两个独立 flag

`commit_plan.mjs` 的 `--ez-fast` 与 `--fast-path` 是两个独立开关。

- `--fast-path`：单提交、不回显完整 YAML。
- `--ez-fast`：禁用语义拆分、放宽规划质量级检查。

两者可以同时传。`-zpc` 场景下快车道命中则单提交，否则回退文件级拆分。

### ez-fast 对快车道判定的放宽

ez-fast 上下文中，快车道判定放宽规划质量级条件（见 [工单 03](03-ez-fast-check-relaxation.md)）：文件数上限失效、跨模块不再回退、语义拆分条件不再作为回退原因。

Git 级条件不变：已有暂存内容、冲突、Git 操作进行中、嵌套 Git 边界、目录联接、二进制与超大文件、风险路径，任一条成立仍然回退。

### 与文件级拆分规则的关系

快车道未命中时，回退目标是文件级拆分规则（按类型/模块/依赖拆分），不是单提交。

### 对实现的影响

- SKILL.md 的快车道章节要加一句交叉说明：ez-fast 上下文下放宽规划质量级条件，Git 级条件不变。
- `inspect_fast_path.mjs` 需要识别 ez-fast 上下文，见 [工单 08](08-script-surface-and-tests.md)。
- ez-fast 与快车道都命中时，汇报形态按快车道（紧凑），拆分粒度按 ez-fast（文件级）。

## Evidence

- 快车道归属限制：`skills/git-up/SKILL.md` 第 77 行「快车道只属于 `-pc/-pcP`；`-p` 始终输出完整 YAML，`-s/-sP` 保持既有委派契约」。
- 快车道执行路径：`skills/git-up/SKILL.md` 第 81 行「快车道在内存生成单步 YAML，调用 `commit_plan.mjs commit --fast-path`；不向用户回显完整 YAML」。
- 检查器回退条件：`skills/git-up/scripts/inspect_fast_path.mjs` 第 164-171 行。
- 本轮用户确认：快车道不脱离、保持正交；`-z + -pc` 快车道命中则单提交否则文件级拆分；放宽文件数与跨模块。
