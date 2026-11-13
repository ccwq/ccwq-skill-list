# `description` 写法与触发验评

> 译编自 https://agentskills.io/skill-creation/optimizing-descriptions（调研于 2026-11-13）。主文档见 [`../../agent-skill规范.md`](../../agent-skill规范.md)。

---

## 1. 触发机制决定了 description 的责任

Agent 用渐进披露管理上下文：启动时只加载每个 skill 的 `name` 与 `description`，足够判断"这个 skill 会不会相关"；当用户任务与某个 description 匹配时，才把该 skill 的 SKILL.md 全文读进上下文并执行。

**这意味着 description 承担了全部触发责任。** description 没讲清何时该用，agent 就不会想到它。

一个重要细节：agent 通常只在任务**超出它自身能力**（需要它不知道的知识或手段）时才会去查 skill。一个"把这个 PDF 读一下"这种简单一步请求，即使 description 完全匹配也可能不触发 PDF skill，因为 agent 用基础工具就能干。**真正吃紧的是涉及专门知识的任务** —— 陌生 API、领域专属流程、少见格式 —— 这时 description 写得好坏直接决定成败。

---

## 2. 写好 description 的五条原则

1. **用命令式句式**。把 description 写成对 agent 的指令：「Use this skill when…」而不是「This skill does…」。agent 在决定是否行动，告诉它何时行动。
2. **写用户意图，不写内部实现**。描述用户想达成什么，而不是 skill 内部怎么实现 —— agent 是拿用户说的话去匹配的。
3. **宁可"强势"一点**。显式列出 skill 适用的场景，**包括用户不会明说领域名的情况**：「even if they don't explicitly mention 'CSV' or 'analysis'」。
4. **保持简洁**。几句话到一小段通常就够 —— 长到能覆盖范围，短到不给 agent 上下文添负担。硬上限 1024 字符。
5. **关键词要具体**。写领域词、动作词、常见说法。

改造前后对比：

```yaml
# Before
description: Process CSV files.

# After
description: >
  Analyze CSV and tabular data files — compute summary statistics,
  add derived columns, generate charts, and clean messy data. Use this
  skill when the user has a CSV, TSV, or Excel file and wants to
  explore, transform, or visualize the data, even if they don't
  explicitly mention "CSV" or "analysis."
```

改造后的版本：能力更具体（统计、派生列、图表、清洗），适用面更宽（CSV/TSV/Excel，即使用户不点名）。

---

## 3. 设计触发用例

要验证 description，得准备一组标注了"该不该触发"的真实感用户提示。

`eval_queries.json`：

```json
[
  { "query": "I've got a spreadsheet in ~/data/q4_results.xlsx with revenue in col C and expenses in col D — can you add a profit margin column and highlight anything under 10%?", "should_trigger": true },
  { "query": "whats the quickest way to convert this json file to yaml", "should_trigger": false }
]
```

**规模**：约 20 条 —— 8–10 条该触发、8–10 条不该触发。

### 3.1 该触发的用例

沿几个轴变换：

| 轴 | 变化方式 |
|----|----------|
| 措辞 | 正式 / 口语 / 带错别字或缩写 |
| 明确度 | 直接点名领域（"analyze this CSV"）vs 只描述需求（"我老板想要一张这个数据文件的图"） |
| 细节量 | 简短提示 vs 带文件路径、列名、前情的长消息 |
| 复杂度 | 单步任务 vs 多步工作流 —— 后者测试"技能相关性被埋在大流程里"时 agent 能否辨别 |

**最有价值的是"不明显相关"的那类**：skill 确实帮得上，但单看 query 连不上。这类才真正检验 description 措辞 —— 如果 query 已经把你的 skill 动作原样说出来，任何合理 description 都能触发。

### 3.2 不该触发的用例

最有价值的是**近似命中（near-miss）**：与 skill 共享关键词或概念，但实际需要的是另一件事。

对 CSV 分析 skill 而言，弱负例（测不出东西）：

- "Write a fibonacci function" —— 明显无关
- "What's the weather today?" —— 无关键词重叠，太容易

强负例：

- "I need to update the formulas in my Excel budget spreadsheet" —— 共享 "spreadsheet"、"data" 概念，但要的是 Excel 编辑，不是 CSV 分析
- "can you write a python script that reads a csv and uploads each row to our postgres database" —— 涉及 CSV，但任务是数据库 ETL，不是分析

### 3.3 真实感

真实用户提示包含通用测试句缺失的上下文：

- 文件路径（`~/Downloads/report_final_v2.xlsx`）
- 个人情境（"我经理让我…"）
- 具体细节（列名、公司名、数据值）
- 口语、缩写、偶尔的错别字

---

## 4. 跑触发验评

基本做法：把每条 query 交给装了 skill 的 agent，观察它是否调用了该 skill。前提是 skill 已注册且可被发现 —— 各客户端机制不同（skills 目录、配置文件、CLI 参数）。

多数客户端提供某种可观测性（执行日志、工具调用历史、verbose 输出），用来确认本次运行咨询了哪些 skill。**判据**：agent 加载了该 skill 的 SKILL.md = 触发；没加载 = 未触发。

一条 query「通过」的条件：

- `should_trigger: true` 且 skill 被调用；或
- `should_trigger: false` 且 skill 未被调用

### 4.1 多次运行

模型行为不确定 —— 同一 query 这次触发下次不触发。每条 query 跑多次（起步 3 次），算**触发率** = 触发次数 / 总次数。

- 该触发的 query：触发率 **> 0.5** 记通过（0.5 是合理默认阈值）
- 不该触发的 query：触发率 **< 0.5** 记通过

20 条 × 3 次 = 60 次调用，需要脚本化。通用骨架（把 `claude` 调用与检测逻辑换成你的客户端）：

```bash
#!/bin/bash
QUERIES_FILE="${1:?Usage: $0 <queries.json>}"
SKILL_NAME="my-skill"
RUNS=3

# 返回 0 表示 skill 被调用
check_triggered() {
  local query="$1"
  claude -p "$query" --output-format json 2>/dev/null \
    | jq -e --arg skill "$SKILL_NAME" \
      'any(.messages[].content[]; .type == "tool_use" and .name == "Skill" and .input.skill == $skill)' \
      > /dev/null 2>&1
}

count=$(jq length "$QUERIES_FILE")
for i in $(seq 0 $((count - 1))); do
  query=$(jq -r ".[$i].query" "$QUERIES_FILE")
  should_trigger=$(jq -r ".[$i].should_trigger" "$QUERIES_FILE")
  triggers=0

  for run in $(seq 1 $RUNS); do
    check_triggered "$query" && triggers=$((triggers + 1))
  done

  jq -n \
    --arg query "$query" \
    --argjson should_trigger "$should_trigger" \
    --argjson triggers "$triggers" \
    --argjson runs "$RUNS" \
    '{query: $query, should_trigger: $should_trigger, triggers: $triggers, runs: $runs, trigger_rate: ($triggers / $runs)}'
done | jq -s '.'
```

客户端支持时，可在结果确定后提前结束单次运行（agent 要么consulted了 skill，要么直接开工了）—— 能显著降低整套评测的时间与成本。

### 4.2 train / validation 切分，防过拟合

拿全部 query 去优化 description，会得到一个只对这批措辞有效、对新措辞失效的 description。

- **train 集（约 60%）**：用来定位失败、驱动改进
- **validation 集（约 40%）**：留作只用一次，检查改进是否泛化

两个集合都要保持"该触发 / 不该触发"的合理比例，不能把正例全塞进一边。随机打乱后**固定划分**，跨轮次保持不变，才能做同口径比较。也可以直接拆成 `train_queries.json` 与 `validation_queries.json` 两份分别跑。

### 4.3 优化循环

1. 在 train 与 validation 两集上评估当前 description。train 结果指导改进，validation 结果告诉你改动是否泛化。
2. 找出 train 集里的失败：该触发的没触发？不该触发的触发了？
3. **只用 train 集失败指导改动** —— 无论是自己改还是让 LLM 改，都不要把 validation 结果喂进过程。
4. 改 description，目标是泛化：
   - 该触发的失败 → description 可能太窄 → 放宽范围或补充适用场景
   - 不该触发的误触发 → description 可能太宽 → 补充「不做什么」，或说清与相邻能力的边界
   - **不要把失败 query 里的具体关键词抄进 description** —— 那是过拟合。要找它们代表的那一类概念
   - 几轮仍卡住时，改用**结构上不同**的写法（换框架、换句式），而不是继续微调
   - 始终检查 description 没超过 1024 字符 —— 优化过程中它最容易膨胀
5. 重复 1–4，直到 train 集全过或不再有明显提升。
6. **按 validation 通过率挑选最佳版本** —— 最佳版本不一定是最后一个，后面几轮可能已经过拟合。通常 5 轮足够；若无提升，问题多半在用例本身（太难/太简单/标注有误），而不在 description。

---

## 5. 落地应用

选定最佳 description 后：

1. 更新 SKILL.md 的 `description` 字段。
2. 确认不超过 1024 字符。
3. 手动试几条提示做快速自检。
4. 更严谨的做法：**另写 5–10 条全新 query**（含正例与负例）跑一遍评测脚本 —— 这些 query 从未参与优化过程，能诚实反映泛化情况。

### 本仓库建议

- 每个 skill 的 `evals/trigger-queries.json` 存放本 skill 的触发用例，格式对齐上面的 `eval_queries.json`（数组，元素为 `{ "query", "should_trigger" }`）。
- `node scripts/validate-skill.mjs` 会校验该文件的 JSON 合法性，并要求正例、负例都存在。
- 已建立触发用例的 skill（各 12 条，正负各 6）：

  `advise-motion-effects`、`chatgpt-web-skill`、`deep-investigation`、`engineering-method-selector`、`gemin-mirror`、`joint-debugging`、`npm-license-declaration`、`pro-grilling`、`skill-to-prompt`、`tool-evaluator`、`tutor-man`

  这批 skill 的 `description` 都只描述了「做什么」、缺少「何时用」的触发语境。建立用例的目的正是**先有基线，再改描述**：改写后用同一批用例对比触发率，避免凭感觉调整。
- 官方建议规模为约 20 条（8–10 正 + 8–10 负）。当前 12 条是首批基线，后续按需扩充，重点补两类：
  1. 隐式点名（用户只描述需求、不提工具名）的正例
  2. 与其它已装 skill 边界重叠的 near-miss 负例
- 仓库内已有 `skill-doctor` skill 可扫描 skill 之间的名称遮蔽、触发碰撞、语义重叠等冲突类问题；它与本文的**单 skill 触发验评**互补：前者查 skill 之间，后者查 skill 与用户输入之间。
