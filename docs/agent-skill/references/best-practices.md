# Skill 指令写法最佳实践

> 译编自 https://agentskills.io/skill-creation/best-practices（调研于 2026-11-13）。主文档见 [`../../agent-skill规范.md`](../../agent-skill规范.md)。

---

## 1. 从真实专长出发

让 LLM 在没有任何领域输入的情况下「凭空生成一个 skill」，产出的必然是空泛流程（"适当处理错误"、"遵循认证最佳实践"）。有价值的 skill 建立在真实专长之上，领域上下文必须喂进去。

三条可行路径：

1. **从一次真实任务中提取**：与 agent 合作完成一个真任务，沿途提供上下文、纠正与偏好，然后把可复用模式抽出来。重点关注：
   - 哪些步骤奏效了（通往成功的动作序列）
   - 你做了哪些纠正（"用 X 库不用 Y"、"检查 Z 这个边界情况"）
   - 输入输出长什么样
   - 你提供了哪些 agent 本来不知道的项目事实、约定或约束
2. **从既有项目素材合成**：把团队真实的运行手册、事故报告、代码评审意见、issue、版本历史（尤其是补丁与修复）喂给 LLM 合成。这比喂一篇"数据工程最佳实践"泛文强得多 —— 因为它包含真实 schema、失败模式与恢复流程。
3. **用真实执行反复打磨**：第一版几乎总要改。对真实任务跑一遍，**把所有结果（不只失败案例）**喂回创作过程：什么触发了误报？漏了什么？哪些内容可以删？

> 读 agent 的执行轨迹，而不只是最终输出。轨迹里浪费时间通常意味着：指令太模糊（试了好几种才找到对的）、指令与当前任务无关（agent 照做不误）、或者给了太多并列选项却没有默认。

---

## 2. 上下文花在该花的地方

skill 一旦激活，SKILL.md 全文就与对话历史、系统上下文、其他已激活 skill 一起挤在同一个上下文窗口里。

**判据：对每一段内容问一句「没有这条，agent 会做错吗？」** 答案是否，就删掉。不确定就测。如果 agent 本来就能干完整个任务，这个 skill 可能根本没在创造价值。

反例（agent 本来就懂，属于浪费）：

```markdown
## 提取 PDF 文本

PDF（便携式文档格式）是一种常见文件格式，包含文本、图片等内容。
要提取 PDF 文本，你需要用一个库。推荐 pdfplumber，因为它能处理大多数情况。
```

正例（agent 不知道的专有选择）：

```markdown
## 提取 PDF 文本

用 pdfplumber 做文本提取。扫描件回退到 pdf2image + pytesseract。

```python
import pdfplumber

with pdfplumber.open("file.pdf") as pdf:
    text = pdf.pages[0].extract_text()
```
```

---

## 3. 划定一个内聚单元

一个 skill 该覆盖什么，如同函数该做什么 —— 应当是**一个能与其他 skill 组合的内聚工作单元**。

- 划得太窄：一个任务要激活多个 skill，带来开销与指令冲突。
- 划得太宽：难以精确激活。

例：「查询数据库并格式化结果」是一个内聚单元；「查询数据库 + 数据库运维管理」多半是试图做太多事。

---

## 4. 适度详细，而非穷尽

**过度全面的 skill 可能弊大于利**：agent 难以提取真正相关的信息，还可能因为执行了不适用的指令而走上歧路。简洁的步骤式指引配一个可运行示例，通常胜过穷尽式文档。

当你发现自己在覆盖每一个边界情况时，问一句：**大部分是不是交给 agent 自己的判断更好？**

---

## 5. 大 skill 用渐进披露拆开

官方建议 SKILL.md 控制在 500 行 / 5000 token 以内，只放每次运行都要用到的核心指令。确实需要更多内容时，把细节移到 `references/` 或类似目录。

关键在于**告诉 agent 什么时候该读哪个文件**：

- ✅「如果 API 返回非 200 状态码，读取 `references/api-errors.md`」
- ❌「更多细节见 references/」

前者让 agent 按需加载上下文，这正是渐进披露的设计意图。

---

## 6. 按脆弱度校准控制强度

不是每个部分都需要同等的强制程度。把指令的具体程度与任务的脆弱程度匹配。

**任务容许多种做法时给自由度** —— 对灵活部分，说明「为什么」往往比死命令更有效；理解意图的 agent 能做出更好的上下文相关判断。例如代码审查流程：

```markdown
## 代码审查流程

1. 检查所有数据库查询是否有 SQL 注入风险（使用参数化查询）
2. 验证每个端点的认证检查
3. 排查并发代码路径中的竞态条件
4. 确认错误信息不泄露内部细节
```

**操作脆弱、一致性重要、顺序必须固定时给硬约束**：

```markdown
## 数据库迁移

严格按以下顺序执行：

```bash
python scripts/migrate.py --verify --backup
```

不要修改命令，也不要添加其他参数。
```

多数 skill 是两者混合 —— **逐部分独立校准**。

---

## 7. 给默认解，不给菜单

```markdown
<!-- 太多选项 -->
你可以用 pypdf、pdfplumber、PyMuPDF 或 pdf2image……

<!-- 明确的默认 + 逃生口 -->
用 pdfplumber 做文本提取：

```python
import pdfplumber
```

需要 OCR 的扫描件，改用 pdf2image + pytesseract。
```

---

## 8. 用流程代替声明

skill 应教 agent **如何处理一类问题**，而不是某个具体实例该产出什么。

```markdown
<!-- 具体答案：只对这一次任务有用 -->
把 `orders` 表与 `customers` 表按 `customer_id` 连接，
过滤 `region = 'EMEA'`，并对 `amount` 列求和。

<!-- 可复用方法：适用于任何分析型查询 -->
1. 从 `references/schema.yaml` 读取 schema，找到相关表
2. 按 `_id` 外键约定连接表
3. 把用户请求中的过滤条件转成 WHERE 子句
4. 按需聚合数值列，输出为 markdown 表格
```

这不排斥具体细节 —— 输出格式模板、约束（如"绝不输出 PII"）、工具专属指令都很有价值。要点是**做法可泛化**，而非只有细节是具体的。

---

## 9. 常见指令模式

### 9.1 Gotchas 小节

很多 skill 里价值最高的内容是一份 gotchas 清单 —— 那些**违背合理假设**的环境专属事实。它不是泛泛建议（"适当处理错误"），而是 agent 不被告知就会犯的具体错：

```markdown
## Gotchas

- `users` 表使用软删除。查询必须带 `WHERE deleted_at IS NULL`，否则会包含已停用账号。
- 用户 ID 在数据库里叫 `user_id`，在认证服务里叫 `uid`，在计费 API 里叫 `accountId` —— 三者指同一个值。
- `/health` 只要 web 服务器还活着就返回 200，即使数据库连接已断。检查完整健康状态要用 `/ready`。
```

**位置**：放在 SKILL.md 里，agent 遇到情况前就会读到。单独放参考文件也行，但前提是**你告诉了 agent 什么时候该读它**；对于非显然的问题，agent 可能识别不出触发条件。

**用法**：每次你不得不纠正 agent 的错误，就把那条纠正追加到 gotchas。这是改进 skill 最直接的方式。

### 9.2 输出格式模板

需要 agent 按固定格式产出时，给模板比散文描述可靠得多 —— agent 对具体结构模式匹配得很好。

```markdown
## 报告结构

使用下面的模板，按具体分析调整小节：

```markdown
# [分析标题]

## 执行摘要
[一段话概括关键发现]

## 关键发现
- 发现 1，附支撑数据
- 发现 2，附支撑数据

## 建议
1. 具体可执行的建议
2. 具体可执行的建议
```
```

短模板可直接写在 SKILL.md 里；长模板或只在特定场景才用的模板，放 `assets/` 并从正文引用。

### 9.3 多步流程清单

显式清单帮助 agent 跟踪进度、避免跳步 —— 尤其当步骤之间有依赖或校验关卡时。

```markdown
## 表单处理流程

进度：
- [ ] 步骤 1：分析表单（运行 `scripts/analyze_form.py`）
- [ ] 步骤 2：创建字段映射（编辑 `fields.json`）
- [ ] 步骤 3：校验映射（运行 `scripts/validate_fields.py`）
- [ ] 步骤 4：填充表单（运行 `scripts/fill_form.py`）
- [ ] 步骤 5：验证输出（运行 `scripts/verify_output.py`）
```

### 9.4 验证循环

指示 agent 在推进前自查：**干活 → 跑校验器 → 修问题 → 重复直到通过**。

```markdown
## 编辑流程

1. 完成编辑
2. 运行校验：`python scripts/validate.py output/`
3. 若校验失败：
   - 阅读错误信息
   - 修复问题
   - 重新运行校验
4. 只有校验通过才继续
```

参考文档本身也可以充当"校验器" —— 让 agent 在定稿前对着它逐条核对。

### 9.5 Plan-Validate-Execute

批量或破坏性操作，先让 agent 生成结构化的中间计划，拿它与事实来源校验，再执行：

```markdown
## PDF 表单填写

1. 提取表单字段：`python scripts/analyze_form.py input.pdf` → `form_fields.json`
   （列出每个字段名、类型、是否必填）
2. 创建 `field_values.json`，把每个字段名映射到目标值
3. 校验：`python scripts/validate_fields.py form_fields.json field_values.json`
   （检查字段名存在、类型兼容、必填项未缺失）
4. 校验失败则修订 `field_values.json` 并重新校验
5. 填充表单：`python scripts/fill_form.py input.pdf field_values.json output.pdf`
```

**关键在第 3 步**：一个把计划（`field_values.json`）与事实来源（`form_fields.json`）对照检查的校验脚本。像 `Field 'signature_date' not found — available fields: customer_name, order_total, signature_date_signed` 这样的错误信息，足以让 agent 自行纠正。

### 9.6 该脚本化时脚本化

迭代 skill 时，比较不同测试用例下 agent 的执行轨迹。如果发现 agent 每次都在自己重新实现同一段逻辑 —— 画图、解析某种格式、校验输出 —— 这就是信号：**把这段逻辑写成经过测试的脚本，放进 `scripts/`**。

脚本接口设计细节见 [`scripts-and-resources.md`](scripts-and-resources.md)。
