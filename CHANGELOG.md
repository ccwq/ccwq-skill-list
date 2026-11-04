# Skill 演进日志

面向安装和使用本仓库 Skill 的人，记录各 Skill 何时加入本仓库，以及此后影响调用方式、行为边界、结果或安装的变化。安装方法与当前参数见 [README](README.md)。

## 记录规则与历史范围

- 首版检查了截至 2026-11-03 [9eca6a6](https://github.com/ccwq/ccwq-skill-list/commit/9eca6a6) 的全部 **230 个 HEAD 可达提交**，起点为 2026-04-08 [690e2b4](https://github.com/ccwq/ccwq-skill-list/commit/690e2b4)。覆盖旧根目录、历史路径、合并分支与当前 `skills/`，不是只扫描现有目录。
- 日期采用 Git 提交的作者日期（`%as`），仅用于追溯，不据此推断合入主分支、发布、上架、安装生效或上游创建时间。导入文档中的旧日期和版本不是本仓库的引入证据；仓库没有 Git tag，也没有据此编造统一发布版本。
- 按 Skill **首次引入本仓库的顺序**编排，同一引入提交中的 Skill 按名称排列；各章中的事件按演进顺序排列。一个用户可理解的事件可以合并实现、文档和验证提交，不逐条复制提交日志。
- 只筛选有用户影响的变化。纯测试、产物刷新和内部重构不逐 Skill 列出；影响安装或跨平台分发的变化归入[仓库共用变化](#仓库共用变化)。原有 Skill 级 `CHANGELOG.md` 保持独立，不由本文件替代。
- **人工维护**：新 Skill 追加二级章节并补索引；已有 Skill 的重要变化追加到对应章节，保留真实日期和提交链接。更名或移除必须有历史证据；没有用户可见变化时，不为凑条目写“更新”。

## Skill 索引

以下 33 个 Skill 在本次历史终点均存在；未发现已移除的独立 Skill 或 Skill 名称更名。路径迁移和本地副本清理另有记录，不等同于移除。

| 首次引入 | Skill 演进记录 |
|---|---|
| 2026-04-08 | [git-up](#git-up) |
| 2026-04-15 | [software-license-checker](#software-license-checker) |
| 2026-04-16 | [git-history-cleaner](#git-history-cleaner) |
| 2026-04-20 | [nano-prompt](#nano-prompt) |
| 2026-05-29 | [ffmpeg-video-processing](#ffmpeg-video-processing) |
| 2026-06-25 | [rd-mode](#rd-mode) |
| 2026-06-25 | [lite-team](#lite-team) |
| 2026-06-30 | [codex-windows-hooks-fix](#codex-windows-hooks-fix) |
| 2026-07-08 | [ntl-script-descriptions](#ntl-script-descriptions) |
| 2026-07-20 | [gemin-mirror](#gemin-mirror) |
| 2026-07-20 | [npm-license-declaration](#npm-license-declaration) |
| 2026-07-23 | [debug-instrumentation](#debug-instrumentation) |
| 2026-07-29 | [project-self-memory](#project-self-memory) |
| 2026-07-30 | [pro-grilling](#pro-grilling) |
| 2026-07-30 | [aria-filedown](#aria-filedown) |
| 2026-07-31 | [chatgpt-web-skill](#chatgpt-web-skill) |
| 2026-08-04 | [subagent-router](#subagent-router) |
| 2026-08-05 | [dockerhub-mirror](#dockerhub-mirror) |
| 2026-08-06 | [joint-debugging](#joint-debugging) |
| 2026-08-11 | [deep-investigation](#deep-investigation) |
| 2026-08-11 | [tool-evaluator](#tool-evaluator) |
| 2026-08-12 | [agent-human-debug](#agent-human-debug) |
| 2026-08-12 | [tutor-man](#tutor-man) |
| 2026-08-13 | [website-state-sync-agent](#website-state-sync-agent) |
| 2026-08-19 | [network-debug](#network-debug) |
| 2026-08-25 | [engineering-method-selector](#engineering-method-selector) |
| 2026-08-25 | [progressive-doc](#progressive-doc) |
| 2026-09-30 | [bash-completion](#bash-completion) |
| 2026-10-08 | [claude-proj-skill-linker](#claude-proj-skill-linker) |
| 2026-10-15 | [wechat-headlines](#wechat-headlines) |
| 2026-10-28 | [handoff-portable](#handoff-portable) |
| 2026-11-03 | [skill-to-prompt](#skill-to-prompt) |
| 2026-11-03 | [advise-motion-effects](#advise-motion-effects) |

另见[仓库共用变化](#仓库共用变化)，包含安装入口、手动触发标记、路径迁移与 ZIP 分发变化。

## git-up

当前说明：[README](skills/git-up/README.md)。

### 首次引入

- **2026-04-08**：随仓库初始化加入。最初支持分析 diff、生成提交信息、输出 YAML 提交计划、讨论或修改计划，以及执行提交；无参数默认只生成 commit message。当时尚无后来加入的 `.gitignore` 维护、子 Agent 委派或语义补丁执行器。[690e2b4](https://github.com/ccwq/ccwq-skill-list/commit/690e2b4)

### 重要调整

- **2026-04-14**：调整提交信息模板，细化 subject、body 和 foot 的书写格式。[5b381cd](https://github.com/ccwq/ccwq-skill-list/commit/5b381cd)
- **2026-06-17**：规划时增加未跟踪文件关联分析：读取 `git status -u`，检查 staged 变更中的 import、require、模板或配置路径引用，将存在逻辑关联的未跟踪文件纳入对应提交步骤，并在正文说明新增文件，避免关联文件漏交。[aa8c031](https://github.com/ccwq/ccwq-skill-list/commit/aa8c031)
- **2026-06-25**：批量提交改由内置脚本消费每步 message 与文件清单，支持失败后续跑；随后将 YAML 计划、当前计划指针和工作区快照落盘，提交前拒绝过期计划，并补上 `-p/-c` 短参数及末行无换行文件清单兼容。这是一段短期的磁盘计划工件方案，下一条记录了其后续替换。[9934bde](https://github.com/ccwq/ccwq-skill-list/commit/9934bde) · [0ac69f5](https://github.com/ccwq/ccwq-skill-list/commit/0ac69f5) · [f82f865](https://github.com/ccwq/ccwq-skill-list/commit/f82f865) · [41527db](https://github.com/ccwq/ccwq-skill-list/commit/41527db)
- **2026-06-26**：移除上述磁盘工件和 `commit.sh` 流程，改为在同一会话中保留 YAML 计划、直接用 shell 执行；加入 `-pc` 一步规划并提交，明确跳过讨论与修改复核。规划先看文件清单与统计，必要时才读具体 diff。[7f06c8e](https://github.com/ccwq/ccwq-skill-list/commit/7f06c8e)
- **2026-06-30**：不再限定 POSIX shell，可按现场使用 CMD、PowerShell 等执行整份提交计划；仍只暂存计划中的显式路径。[e5d20f8](https://github.com/ccwq/ccwq-skill-list/commit/e5d20f8)
- **2026-07-08**：引入 Python YAML Lite 执行入口，一次调用完成整份计划；执行前拒绝已有 staged 内容、跳过空步骤、返回已完成与跳过步骤，减少逐步 shell 调用。[bb3e793](https://github.com/ccwq/ccwq-skill-list/commit/bb3e793)
- **2026-07-09**：补充围绕提交边界的轻量逐问讨论，明确 `-pc` 是显式免二次确认模式；增加中文/英文输出选择，以及成功提交后才推送的 `-P`、`-cP`、`-pcP`，不自动配置 upstream。[98b619c](https://github.com/ccwq/ccwq-skill-list/commit/98b619c) · [431ade6](https://github.com/ccwq/ccwq-skill-list/commit/431ade6) · [cad199e](https://github.com/ccwq/ccwq-skill-list/commit/cad199e)
- **2026-07-17**：增加 `.gitignore` 维护入口，按技术栈增补高置信度可再生文件规则；默认不加入 `.env`，清理先预览，只处理管理区块内的重复规则。[f2da312](https://github.com/ccwq/ccwq-skill-list/commit/f2da312)
- **2026-07-30**：修复 PowerShell 生成的 UTF-8 BOM 导致计划解析失败的问题。[4661684](https://github.com/ccwq/ccwq-skill-list/commit/4661684)
- **2026-08-04**：增加 `-s/-sP`，将规划与提交完整委派给一个子 Agent。自然语言约束成为硬提交边界，父 Agent 不重复调查或接管 Git 操作，只汇总实际结果。[ed8f439](https://github.com/ccwq/ccwq-skill-list/commit/ed8f439)
- **2026-08-11**：修复 Windows PowerShell 直接管道传输计划时中文和 emoji 可能变成 `?` 的问题，要求这类计划先写成 UTF-8 文件，再用 `--plan-file` 读取。[f75ae99](https://github.com/ccwq/ccwq-skill-list/commit/f75ae99)
- **2026-09-01**：加入 `-pc/-pcP` 自适应快车道：仅当 Git 硬条件通过、改动确为一个语义目的且只需一个 commit 时，省去完整 YAML 回显；否则给出回退原因并走通常规划。只规划的 `-p` 仍输出完整计划。[cc6045f](https://github.com/ccwq/ccwq-skill-list/commit/cc6045f) · [539f289](https://github.com/ccwq/ccwq-skill-list/commit/539f289)
- **2026-10-30**：增加语义拆分提交，同一文件可通过不同补丁进入多个 commit；以 `depends_on` 指定依赖顺序，并在最终检查 HEAD 是否与目标快照一致。执行入口迁移到 Node.js `.mjs`，移除 Git-up 的 Python 实现，原 Python 脚本路径不再可用。[8de5461](https://github.com/ccwq/ccwq-skill-list/commit/8de5461) · [2333fe0](https://github.com/ccwq/ccwq-skill-list/commit/2333fe0) · [ec2e9a9](https://github.com/ccwq/ccwq-skill-list/commit/ec2e9a9)
- **2026-10-30**：完善上述执行安全边界：不支持的文件模式变更在暂存前拒绝；文件级计划也按依赖排序并做最终一致性检查；结果回显每步 `reason`。路径枚举不再让计划外删除藏进重命名，YAML 支持 `|-`、`|+`，错误列表缩进显式失败，不静默降级。[4ff5ab7](https://github.com/ccwq/ccwq-skill-list/commit/4ff5ab7) · [d6f94b3](https://github.com/ccwq/ccwq-skill-list/commit/d6f94b3) · [cd1a324](https://github.com/ccwq/ccwq-skill-list/commit/cd1a324) · [9326a23](https://github.com/ccwq/ccwq-skill-list/commit/9326a23) · [4f9507b](https://github.com/ccwq/ccwq-skill-list/commit/4f9507b) · [b1dbf5f](https://github.com/ccwq/ccwq-skill-list/commit/b1dbf5f)
- **2026-10-31**：引入显式 `-z/--ez-fast` 文件级轻量模式，不做同文件语义补丁拆分，放宽文件数和跨模块等规划质量检查，但不绕过 Git 级安全检查；增加 `suppressed_split` 尽力而为提示，不保证发现所有被抑制的拆分。后续默认模式迁移见下一条模式调整。[34aa45a](https://github.com/ccwq/ccwq-skill-list/commit/34aa45a) · [a6b8d58](https://github.com/ccwq/ccwq-skill-list/commit/a6b8d58) · [8954279](https://github.com/ccwq/ccwq-skill-list/commit/8954279) · [777f4e2](https://github.com/ccwq/ccwq-skill-list/commit/777f4e2)
- **2026-11-03**：聚合规划所需的文件清单、diff 统计、分支与近期提交标题，减少重复 Git 往返；使用已加载 Skill 的基目录定位脚本，目标仓库由 `--cwd` 指定。[dac1aa7](https://github.com/ccwq/ccwq-skill-list/commit/dac1aa7) · [a172bd5](https://github.com/ccwq/ccwq-skill-list/commit/a172bd5)
- **2026-11-03**：模式路由调整为 **默认轻量文件级规划**；`-z` 留作兼容，语义深拆改为显式 `-d/--deep`。**`-d` 不再表示讨论，也不授权提交**；逐问审查改用 `-g/--grilling`，旧 `--discuss` 保留别名。计划深度随会话继承，已有 deep 计划不得静默降级；无参数仍只生成一条 commit message。[a172bd5](https://github.com/ccwq/ccwq-skill-list/commit/a172bd5)

## software-license-checker

当前说明：[README](skills/software-license-checker/README.md)。

### 首次引入

- **2026-04-15**：加入企业内部使用场景的软件许可证与授权风险评估，输出偏保守的法务预警；明确不覆盖 SaaS 对外服务、OEM、转售或产品分发，也不替代法律意见。[492cc9e](https://github.com/ccwq/ccwq-skill-list/commit/492cc9e)

### 重要调整

- **2026-04-15**：增加面向业务和采购的大白话结论，直接说明能否使用、前提和主要风险；扩展商业授权、订阅、试用、席位、计费与购买路径整理，默认采用中国团队采购视角。[b27173e](https://github.com/ccwq/ccwq-skill-list/commit/b27173e) · [3f8dcea](https://github.com/ccwq/ccwq-skill-list/commit/3f8dcea)

## git-history-cleaner

当前说明：[SKILL](skills/git-history-cleaner/SKILL.md)。

### 首次引入

- **2026-04-16**：加入按路径或 glob 清理 Git 历史中的文件与目录的能力，支持只分析预览、交互确认和自动模式；改写前备份 `.git`，完成后提示推送与协作影响。[6b04224](https://github.com/ccwq/ccwq-skill-list/commit/6b04224)

## nano-prompt

当前说明：[SKILL](skills/nano-prompt/SKILL.md)。

### 首次引入

- **2026-04-20**：以根目录 `nano-prompt/SKILL.md` 加入，基于 Nano Banana Pro 的 20 条提示技巧，将文本或图像需求组织为中文 key、最多三层的 YAML 图像提示词。它生成提示词，不等同于直接生成图像。[294f65d](https://github.com/ccwq/ccwq-skill-list/commit/294f65d)

### 路径迁移与说明修正

- **2026-04-20**：整个 Skill 从根目录迁入 `skills/nano-prompt/`，Git 将定义文件识别为 100% 相同的重命名；名称和能力没有因此改变，不是删除后另建 Skill。[fb2c46a](https://github.com/ccwq/ccwq-skill-list/commit/fb2c46a)
- **2026-10-15**：修复 YAML 示例代码围栏及技巧指南链接，便于正确阅读和复制输出模板。[c648e55](https://github.com/ccwq/ccwq-skill-list/commit/c648e55)

## ffmpeg-video-processing

当前说明：[SKILL](skills/ffmpeg-video-processing/SKILL.md)。

### 首次引入

- **2026-05-29**：加入 ffmpeg/ffprobe 音视频处理流程，先检查媒体，再按目标体积或质量选择压缩方案；覆盖转码、裁剪、缩放、拼接、音频抽取、字幕和水印等。缺少二进制时先询问路径或下载授权，不静默安装。[2e41a96](https://github.com/ccwq/ccwq-skill-list/commit/2e41a96)

## rd-mode

当前说明：[README](skills/rd-mode/README.md)。

### 首次引入

- **2026-06-25**：加入 host/server 远程开发协作规则：Agent 在无桌面 server 读写代码，把应用执行、构建、测试和桌面操作交给 host；支持首次使用或 `--init` 问答式生成配置，通过 `abc` 统一操作 host 浏览器。[afa6e34](https://github.com/ccwq/ccwq-skill-list/commit/afa6e34)

### 安装入口调整

- **2026-09-30**：补齐 marketplace 条目并加入主 Skill 分组。这是安装发现入口补齐，不是此时才引入 rd-mode。[d09191f](https://github.com/ccwq/ccwq-skill-list/commit/d09191f)

## lite-team

当前说明：[README](skills/lite-team/README.md)。

### 首次引入

- **2026-06-25**：加入基于 `docs/bbs/lite-team-bbs.md` 协作板的手动多角色交接，提供产品、开发和测试角色边界；仅在需要交接或明确调用时创建、读取协作板，不做自动多 Agent 编排。[40945b7](https://github.com/ccwq/ccwq-skill-list/commit/40945b7)

### 重要调整

- **2026-06-25**：修正脚本定位方式，使 Skill 不必以其自身目录作为工作目录也能调用，避免安装到不同位置后找不到 `bbs.py`。[0976568](https://github.com/ccwq/ccwq-skill-list/commit/0976568)

## codex-windows-hooks-fix

当前说明：[README](skills/codex-windows-hooks-fix/README.md)。

### 首次引入

- **2026-06-30**：加入 Windows Codex hooks 排障，覆盖入口命令、PowerShell 包装器、路径展开和 stdout JSON schema；强调以真实 hook runner 验证，而非仅证明脚本可单独运行，不把其他宿主的同名 hook schema 直接套用。[4c4c368](https://github.com/ccwq/ccwq-skill-list/commit/4c4c368)

## ntl-script-descriptions

当前说明：[SKILL](skills/ntl-script-descriptions/SKILL.md)。

### 首次引入

- **2026-07-08**：加入 `package.json` scripts 中文说明维护，将用途写入 `ntl.descriptions`，让 Node Task List 展示可理解的任务说明；默认不额外扩写 README，也不凭空创建 Node 项目。[11d6aea](https://github.com/ccwq/ccwq-skill-list/commit/11d6aea)

## gemin-mirror

当前说明：[README](skills/gemin-mirror/README.md)。

### 首次引入

- **2026-07-20**：纳入 Gemini 镜像站浏览器操作 Skill，已有账号探针、账号切换和会话删除流程；要求用户手动调用、复用已打开的标签页，并在授权范围内执行。[5c8f9ca](https://github.com/ccwq/ccwq-skill-list/commit/5c8f9ca)

### 重要调整

- **2026-07-20**：收敛为 Gemini/兼容镜像站的多账号会话探针与安全删除；删除前核对允许 origin、登录状态、唯一活动账号和原生计数。当前账号优先 API runner，DOM 仅作用户明确选择的回退；多账号逐一切换核验，刷新后计数仍为零才判成功，审计只保留脱敏证据。[b382a0f](https://github.com/ccwq/ccwq-skill-list/commit/b382a0f)

## npm-license-declaration

当前说明：[SKILL](skills/npm-license-declaration/SKILL.md)。

### 首次引入

- **2026-07-20**：加入前端 npm 第三方许可证声明生成器，按 `dependencies` 与 `devDependencies` 的直接依赖重建 `docs/npm-license-declaration.md`，不遍历传递依赖；元数据采用 npm latest，缺失与查询失败如实标记，结果是风险提示而非法务意见。[78c4fdd](https://github.com/ccwq/ccwq-skill-list/commit/78c4fdd)

## debug-instrumentation

当前说明：[SKILL](skills/debug-instrumentation/SKILL.md)。

### 首次引入

- **2026-07-23**：加入假设驱动的调试埋点闭环，以统一可搜索 token 标识每批日志，串起埋点、采集、归因和清理；遇到历史批次先让用户决定沿用或处理，清理需确认，不把预期日志当真实运行证据。[e621bad](https://github.com/ccwq/ccwq-skill-list/commit/e621bad)

## project-self-memory

当前说明：[README](skills/project-self-memory/README.md)。

### 首次引入

- **2026-07-29**：加入项目级结论记忆，初始活动文件为 `self-memory/memory.md`，保存已验证事实、长期决策和避坑；当时要求项目级安装位置，并支持显式记忆请求，尚不是后来的 Node CLI、cache 或查看器方案。[7fcc8bf](https://github.com/ccwq/ccwq-skill-list/commit/7fcc8bf)

### 重要调整

- **2026-07-29**：补充 `.claude/skills` 项目级安装支持，新增逐问 Grilling 经验盘点；讨论完成并得到明确确认前不写入记忆。[5b14bec](https://github.com/ccwq/ccwq-skill-list/commit/5b14bec)
- **2026-07-31**：Grilling 结束确认统一为明确回复 `ok`，不再使用“已达成共同理解”作为固定结束口令。[6750ca3](https://github.com/ccwq/ccwq-skill-list/commit/6750ca3)
- **2026-08-02**：加入记忆 Trim 整理能力，围绕已有结论讨论保留、修订、合并或删除，区别于新增经验盘点；同日并行分支中的重复变化按一个演进事件记录。[ab71e18](https://github.com/ccwq/ccwq-skill-list/commit/ab71e18) · [e203573](https://github.com/ccwq/ccwq-skill-list/commit/e203573)
- **2026-08-05**：活动存储迁到 `.project-self-memory/`，由 Node CLI 独占读写；旧 `self-memory/` 变为只读 legacy 来源。引入结构化记录、评分、人工策展、分组和显式迁移流程；Node 缺失或结构损坏时停止相关写入并降级，不直接手改活动文件。[2d5d87c](https://github.com/ccwq/ccwq-skill-list/commit/2d5d87c)
- **2026-08-11**：补全宿主自动加载、保存与评分的证据闭环，提供可运行的 `MemorySession` 参考适配器及审计结果；明确参考适配器不代表某个生产宿主已经完成接入。[e87b488](https://github.com/ccwq/ccwq-skill-list/commit/e87b488)
- **2026-10-20**：人工讨论改用自适应轮次预算，允许证据充分时提前结束、出现冲突时扩展；区分讨论共识与具体写入授权，避免把固定轮数或一句确认当成无限授权。[f38a884](https://github.com/ccwq/ccwq-skill-list/commit/f38a884)
- **2026-10-22**：加入本机紧凑查看器，可浏览和修改正文、类型与状态；仅监听回环地址，写入与 CLI 共用锁、备份、原子替换和乐观并发保护。[98db08a](https://github.com/ccwq/ccwq-skill-list/commit/98db08a)
- **2026-10-23**：修复查看器部署后的路径推导，默认自动打开系统浏览器，并提供禁止自动打开的选项。[2d675ec](https://github.com/ccwq/ccwq-skill-list/commit/2d675ec)
- **2026-10-23**：新增紧凑单行表达契约、首次非空召回用量提醒和可选派生多标签；保留旧多行记录及 legacy 分组兼容。随后修正标签行为：标签用于显式筛选和只读观测，不参与检索 rank 排序。[dea0759](https://github.com/ccwq/ccwq-skill-list/commit/dea0759) · [073a9a3](https://github.com/ccwq/ccwq-skill-list/commit/073a9a3)
- **2026-10-23**：改变自动保存/评分语义：**自动流程只暂存 cache，不再直接写记忆库或评分账本**；`-c/--cache-write` 按候选逐条征得写入或丢弃选择，可中断后继续。既有配置字段名不变，但含义改为自动暂存；修订、删除和评分也可以作为候选暂存。[77a0188](https://github.com/ccwq/ccwq-skill-list/commit/77a0188) · [0cb6dcc](https://github.com/ccwq/ccwq-skill-list/commit/0cb6dcc)
- **2026-10-24**：同步上述暂存语义和脚本路径说明，明确 Skill 自身位置与被操作项目根目录不同，避免从当前工作目录误找 CLI。[b04785f](https://github.com/ccwq/ccwq-skill-list/commit/b04785f)
- **2026-10-26**：增加 `-a` 显式暂存入口，细化任务收尾时机与提示词宿主行为：最终答复前只暂存本次任务已验证的新增结论，报告候选 ID，并说明尚未落库；连用 `-a -c` 时先暂存、再逐条确认。[5426028](https://github.com/ccwq/ccwq-skill-list/commit/5426028)
- **2026-10-27**：查看器加入暂存区面板及配套服务路由，可以查看、编辑并入、丢弃和清理候选；这是 cache 入库流程的可视化入口，不取消写入安全校验。[5c24779](https://github.com/ccwq/ccwq-skill-list/commit/5c24779) · [48d854c](https://github.com/ccwq/ccwq-skill-list/commit/48d854c) · [c65f7f7](https://github.com/ccwq/ccwq-skill-list/commit/c65f7f7)

## pro-grilling

当前说明：[SKILL](skills/pro-grilling/SKILL.md)。

### 首次引入

- **2026-07-30**：加入手动逐层澄清复杂决策的协议，每次推进一个关键问题，事实由调查确认、取舍由用户决定；共同理解达成前保持只读，不直接进入实施。[d1c55c1](https://github.com/ccwq/ccwq-skill-list/commit/d1c55c1)

### 重要调整

- **2026-07-31**：固定结束确认语改为用户明确回复 `ok`，未收到确认时继续讨论，不擅自宣布完成。提交标题中的 `grilling` 不代表 Skill 从 `pro-grilling` 更名。[6750ca3](https://github.com/ccwq/ccwq-skill-list/commit/6750ca3)

## aria-filedown

当前说明：[SKILL](skills/aria-filedown/SKILL.md)。

### 首次引入

- **2026-07-30**：加入手动授权的 aria2 下载辅助，支持断点续传、终端或 JSONL 进度、可用性检查和获准后的安装；代理优先级为显式参数、进程环境、项目 `.env`。大文件或海外来源本身不是自动接管下载的授权。[05df0f6](https://github.com/ccwq/ccwq-skill-list/commit/05df0f6)

## chatgpt-web-skill

当前说明：[README](skills/chatgpt-web-skill/README.md)。

### 首次引入

- **2026-07-31**：纳入通过 `agent-browser` 操作 ChatGPT Web 的图片工作区 Skill，在指定 `agents-op` Project 内生图、改图或审阅；Search/Deep Research 需本次明确授权。引入时已有按版本隔离的临时经验库；导入资料中更早的日期不是加入本仓库的日期。[cb378b3](https://github.com/ccwq/ccwq-skill-list/commit/cb378b3)

### 重要调整

- **2026-07-31**：增加浏览器 CLI 包装入口，集中传递 session 和可选 CDP 配置，要求实时验证 Project 归属、控件状态与消息是否真正发送，优先复用已有 tab。[1b5cf84](https://github.com/ccwq/ccwq-skill-list/commit/1b5cf84)
- **2026-08-01**：将 Project、消息提交、图像可见性检查及经验原子写入脚本化；加入任务 tab lease，只关闭本次创建的 tab。浏览器连接改为复用已登录 CDP，daemon 重启后丢弃旧 tab ID/lease；图片模式和文件落盘都要有实际证据，不将点击成功当成交付成功。[3c28500](https://github.com/ccwq/ccwq-skill-list/commit/3c28500) · [6f3493c](https://github.com/ccwq/ccwq-skill-list/commit/6f3493c) · [4f4cda6](https://github.com/ccwq/ccwq-skill-list/commit/4f4cda6)
- **2026-08-02**：加入 `-t/--trim` 经验整理，逐主题讨论并在最终确认后原子写回；未证实条目保留，主动测试、生成图片或上传等动作仍受各自授权约束。[ab71e18](https://github.com/ccwq/ccwq-skill-list/commit/ab71e18) · [e203573](https://github.com/ccwq/ccwq-skill-list/commit/e203573)
- **2026-08-03**：加入单图 `visual-review` 结构化审查，以固定中文 YAML 和编号标准输出，再由本地计算通过、阻断或待定状态；上传、解析或证据失败时关闭通过路径，只有 `VISUAL_PASSED` 可以继续。[fa68442](https://github.com/ccwq/ccwq-skill-list/commit/fa68442)
- **2026-08-04**：经验存储由逐版本临时文件改为用户配置目录下的统一分组库，旧临时库不自动迁移或删除；版本与条数异常通过稳定 warning 提醒。Project 归属验证同时兼容首页和项目内既有对话，不强求对话 URL 以 `/project` 结尾。[e42fd30](https://github.com/ccwq/ccwq-skill-list/commit/e42fd30)
- **2026-08-12**：固化从实时 sidebar 定位 Project 的流程、任务新建 tab 的共享超时预算和结束释放规则；加入聊天图像导出及落盘验证。后台请求只观察可见 UI 动作实际产生的记录，不构造或重放独立 `/backend-api/*` 请求。[914d2f1](https://github.com/ccwq/ccwq-skill-list/commit/914d2f1) · [ed4fad5](https://github.com/ccwq/ccwq-skill-list/commit/ed4fad5)
- **2026-08-14**：CDP 支持端口与完整 HTTP(S) URL，按调用参数、环境变量、用户配置、默认 `9222` 的优先级选择；先发现 WebSocket 再连接并核验目标，连接失败不静默退回另一浏览器。[9b98f91](https://github.com/ccwq/ccwq-skill-list/commit/9b98f91)

## subagent-router

当前说明：[README](skills/subagent-router/README.md)。

### 首次引入

- **2026-08-04**：加入临时 Codex 子 Agent 路由，提供成本、均衡和质量策略及可选 Grilling；派发前展示完整预览并取得明确确认，写入任务分配独占文件，主线程负责集成与验收，不创建持久角色配置。[98a6161](https://github.com/ccwq/ccwq-skill-list/commit/98a6161)

### 重要调整

- **2026-08-05**：改为原生 Multi-agent 优先，仅在已证明原生不支持且获单独授权时考虑外部执行回退；拆开“达成共识”和“授权执行”，明确外部进程、隔离工作区及上下文边界，不能把技术失败当成永久不兼容。[ad63d4c](https://github.com/ccwq/ccwq-skill-list/commit/ad63d4c)
- **2026-08-06**：授权绑定当前完整预览；模型、权限、范围、并发、验证等关键字段变化后，必须更新预览并重新授权，不能沿用局部或旧方案许可。[8bb0973](https://github.com/ccwq/ccwq-skill-list/commit/8bb0973)
- **2026-08-11**：改为仅用原生 Worker，删除外部执行回退；以预览后精确回复 `okok` 作为单次授权，增加模型感知的嵌套规则和子级委派信封，限制深度、总量、并发与写入范围，主线程独立验收。[6f0c2c3](https://github.com/ccwq/ccwq-skill-list/commit/6f0c2c3)
- **2026-09-04**：加入 `-f/--fast`，在目标、范围、权限、验证和委派边界内部明确后跳过用户确认等待；它只省确认等待，不放宽其他边界。[0e95ec0](https://github.com/ccwq/ccwq-skill-list/commit/0e95ec0)

## dockerhub-mirror

当前说明：[README](skills/dockerhub-mirror/README.md)。

### 首次引入

- **2026-08-05**：加入 Docker Hub 拉取慢或失败的分诊，支持候选探测、比较、发现和缓存管理；写入分支先讨论与授权，不自动改 daemon、重启 Docker 或代用户执行 pull/run，也不把私有凭据发给公共镜像。[ad63d4c](https://github.com/ccwq/ccwq-skill-list/commit/ad63d4c)

### 重要调整

- **2026-08-17**：共识口令仍为 `ok`，具体执行授权从“授权执行”改为精确 `okok`；范围、成本、风险或路径改变时重新讨论。[6f4eefa](https://github.com/ccwq/ccwq-skill-list/commit/6f4eefa)

## joint-debugging

当前说明：[SKILL](skills/joint-debugging/SKILL.md)。

### 首次引入

- **2026-08-06**：加入手动技术联调协议，用动态主线轮次协调环境基线、证据采集、故障分析、修改授权与验证；支线结束后恢复主线，没有目标环境证据时不宣称已解决。[4db3095](https://github.com/ccwq/ccwq-skill-list/commit/4db3095)

## deep-investigation

当前说明：[SKILL](skills/deep-investigation/SKILL.md)。

### 首次引入

- **2026-08-11**：加入面向公共事件、组织、人物、政策或商业议题的证据优先调查复盘；维护证据账本、时间线、关系判断与竞争解释，区分事实、当事方主张、推断和未知。支持条件允许时独立分支取证，不以多数表态替代核验。[d06f230](https://github.com/ccwq/ccwq-skill-list/commit/d06f230)

## tool-evaluator

当前说明：[SKILL](skills/tool-evaluator/SKILL.md)。

### 首次引入

- **2026-08-11**：加入工具调查、比较与筛选，以 Gate-first 硬约束淘汰不合格候选，再进行场景加权、证据分级和敏感性检查；默认只研究资料，安装、运行、注册和 POC 另需授权。同日并行分支的同一 Skill 归并为一次引入，不计为两个 Skill。[8735398](https://github.com/ccwq/ccwq-skill-list/commit/8735398) · [bfa59d7](https://github.com/ccwq/ccwq-skill-list/commit/bfa59d7)

## agent-human-debug

当前说明：[README](skills/agent-human-debug/README.md)。

### 首次引入

- **2026-08-12**：加入 Agent 负责分析、用户充当目标设备执行端的联调流程；每轮尽量一段可粘贴脚本，结果先脱敏再写剪切板，失败则回退终端和临时文件，修改与高风险动作单独授权。[b0d42e2](https://github.com/ccwq/ccwq-skill-list/commit/b0d42e2)

### 重要调整

- **2026-08-12**：为未知环境固化首轮单行只读探测，记录 OS、Shell、运行时和剪切板能力，并区分脱敏待审、部分采集与致命失败状态。[aafadb1](https://github.com/ccwq/ccwq-skill-list/commit/aafadb1)
- **2026-08-20**：升级为跨平台环境识别与统一 `debug_report` 协议；未知环境先选择一个匹配的 bootstrap probe，不再默认给多平台脚本让用户猜。按当前假设做最小采集，支持本机、SSH、容器和 CI/CD；不为了探测自动安装运行时，剪切板失败不阻断诊断。[66f3ba0](https://github.com/ccwq/ccwq-skill-list/commit/66f3ba0)

## tutor-man

当前说明：[SKILL](skills/tutor-man/SKILL.md)。

### 首次引入

- **2026-08-12**：纳入 Tutor-Man，默认中文，以自适应费曼式掌握等级 `L1–L5` 组织工具、概念和方法学习；默认 `L4`，支持等级差距比较，按证据检验掌握程度而非堆砌知识篇幅。[af760ad](https://github.com/ccwq/ccwq-skill-list/commit/af760ad)

## website-state-sync-agent

当前说明：[SKILL](skills/website-state-sync-agent/SKILL.md)。

### 首次引入

- **2026-08-13**：纳入通过 CDP 导出、导入、同步及回环验证网站 Cookie、localStorage 和 sessionStorage 的 Skill，状态包使用 AES-256-GCM 加密，运行参数来自环境变量，交付脱敏统计。引入时提供默认密码，生产或共享环境应显式覆盖，不能把“已加密”等同于安全配置已完成。[4442643](https://github.com/ccwq/ccwq-skill-list/commit/4442643)

## network-debug

当前说明：[SKILL](skills/network-debug/SKILL.md)。

### 首次引入

- **2026-08-19**：纳入手动触发的跨平台网络诊断，沿名称解析、接口、路由、传输、代理/VPN、TLS 和应用层定位最早失败边界；覆盖桌面、服务器、路由器、NAS、容器及 overlay，不凭设备品牌猜根因。[b6393a9](https://github.com/ccwq/ccwq-skill-list/commit/b6393a9)

### 重要调整

- **2026-08-19**：主体说明本地化为中文，默认中文交互，命令、协议、错误串及配置键保留原文；延续显式调用与最小侵入排障边界。[8f485f6](https://github.com/ccwq/ccwq-skill-list/commit/8f485f6)

## engineering-method-selector

当前说明：[SKILL](skills/engineering-method-selector/SKILL.md)。

### 首次引入

- **2026-08-25**：加入显式调用的工程方法论选择器，从目标、阶段、产物、质量属性和风险诊断，再推荐最小有效的方法组合及验证要求；提供建议与约束，不替用户拍板，不把术语解释当作完成。[23e5445](https://github.com/ccwq/ccwq-skill-list/commit/23e5445)

## progressive-doc

当前说明：[SKILL](skills/progressive-doc/SKILL.md)。

### 首次引入

- **2026-08-25**：加入中文技术文章的渐进式披露写作与审查，以先交付结论的速览区和逐项证明的深度正文服务不同阅读深度；要求每一层新增信息，区分事实、估算、推断和建议，不用换词复述凑层次。[da3c738](https://github.com/ccwq/ccwq-skill-list/commit/da3c738)

## bash-completion

当前说明：[SKILL](skills/bash-completion/SKILL.md)。

### 首次引入

- **2026-09-30**：纳入 Bash 补全安装与排障，区分普通 Tab、fzf、ble.sh 实时建议/高亮和 zoxide 跳转；先识别目标账号、权限、启动模式和已有配置，再验证真实交互行为，支持回滚与隔离安装回归，不默认迁移到 zsh/fish。其内嵌日志的旧日期不作为本仓库引入日期。[14b18c2](https://github.com/ccwq/ccwq-skill-list/commit/14b18c2)

## claude-proj-skill-linker

当前说明：[SKILL](skills/claude-proj-skill-linker/SKILL.md)。

### 首次引入

- **2026-10-08**：加入项目级 Skill 链接器，以 `.agents/skills` 保存本体，通过符号链接或 Windows junction 接入 `.claude/skills`；支持迁移实体目录并建立入口，先零写入预览，再按确认的 digest 执行。只操作指定项目，不写全局目录，状态变化后须重新预览。[d72e9a3](https://github.com/ccwq/ccwq-skill-list/commit/d72e9a3)

### 重要调整

- **2026-10-11**：加固 Windows CLI 执行和输出契约；成功必须同时满足退出码、JSON 报告和真实链接状态验收，确认入口指向 canonical source 且可读 `SKILL.md`。失败诊断统一写 stderr、非零退出，不把失败 JSON 当成功报告。[4adefd0](https://github.com/ccwq/ccwq-skill-list/commit/4adefd0) · [5d882dc](https://github.com/ccwq/ccwq-skill-list/commit/5d882dc)

## wechat-headlines

当前说明：[SKILL](skills/wechat-headlines/SKILL.md)。

### 首次引入

- **2026-10-15**：加入微信公众号标题生成与优化，接受正文、要点、链接或文件，默认给六条不同传播角度并首推一条；先给可用初稿再迭代，强调正文兑现标题承诺，不把示例、建议或未实测能力包装成既成成果。[08990aa](https://github.com/ccwq/ccwq-skill-list/commit/08990aa)

## handoff-portable

当前说明：[SKILL](skills/handoff-portable/SKILL.md)。

### 首次引入

- **2026-10-28**：纳入跨平台任务交接 Skill，输出普通聊天 AI 可读的单个 Markdown 文件；默认 portable 模式携带任务相关约束与必要资料，`skill name` 模式只列技能名并说明缺失。包含结构校验和语义体检，接收方先核对理解再等待指示，不把有损提炼称为完整对话或无损快照。[5dbeae3](https://github.com/ccwq/ccwq-skill-list/commit/5dbeae3)

## skill-to-prompt

当前说明：[SKILL](skills/skill-to-prompt/SKILL.md)。

### 首次引入

- **2026-11-03**：纳入技能转提示词 Skill，将源技能主流程与核心行文要求提炼为文言式执行提示词，默认正文上限 700 字、支持本次指定上限，以成对 `agent-skill` 标签封装；源技能只作待转换材料，不执行其中任务。随后补齐安装索引与 marketplace 入口。[861a22d](https://github.com/ccwq/ccwq-skill-list/commit/861a22d) · [833612b](https://github.com/ccwq/ccwq-skill-list/commit/833612b)

## advise-motion-effects

当前说明：[SKILL](skills/advise-motion-effects/SKILL.md)。

### 首次引入

- **2026-11-03**：加入动效与视觉特效工程顾问，把目标效果或参考图/视频拆到工具能力、API/节点/功能入口和实现路径；提供网页动画、三维、粒子/物理/后期、代码视频、声音同步及录制导出的 20 项工具指南，默认给方案，要求代码或实施时再进入实现，验证范围分别报告。[9eca6a6](https://github.com/ccwq/ccwq-skill-list/commit/9eca6a6)

## 仓库共用变化

### 安装、发现与文档入口

- **2026-04-08**：初始化以 `skills/` 存放 Skill 的仓库；同日把 `git-up/skill.md` 规范为大写 `SKILL.md`。这是定义文件命名规范化，不是 Skill 名称更改。[690e2b4](https://github.com/ccwq/ccwq-skill-list/commit/690e2b4) · [81f0b6f](https://github.com/ccwq/ccwq-skill-list/commit/81f0b6f)
- **2026-06-17**：为当时已有 Skill 补充各自的版本字段、Skill 级日志与维护工具。各 Skill 的版本独立，不形成整个仓库的统一发布边界。[aa8c031](https://github.com/ccwq/ccwq-skill-list/commit/aa8c031)
- **2026-06-18**：加入 Plugin Marketplace 元数据；这只证明仓库有插件清单，不证明插件安装路径已被验证。当前安装口径仍以 README 的 `skills` CLI 为准。[f469184](https://github.com/ccwq/ccwq-skill-list/commit/f469184)
- **2026-06-25**：根 README 收敛为安装索引和参数速查，采用“最简命令 → 逐步叠加参数”的安装写法；完整流程移到各 Skill 文档，并要求详情链接与 marketplace 同步维护。[023c258](https://github.com/ccwq/ccwq-skill-list/commit/023c258)
- **2026-08-06**：增加主 Skill 分组清单和生成的插件入口，区分交互安装选择器中的主分组与其他已发现 Skill。[851b9dc](https://github.com/ccwq/ccwq-skill-list/commit/851b9dc)
- **2026-08-11**：主分组配置支持多行；为 `codex-windows-hooks-fix`、`debug-instrumentation`、`git-history-cleaner`、`lite-team`、`nano-prompt`、`ntl-script-descriptions`、`rd-mode`、`software-license-checker`、`subagent-router` 补充 `disable-model-invocation` 手动调用标记，减少未经显式调用的自动触发。[3677724](https://github.com/ccwq/ccwq-skill-list/commit/3677724) · [5ae8b3f](https://github.com/ccwq/ccwq-skill-list/commit/5ae8b3f) · [0cc56ec](https://github.com/ccwq/ccwq-skill-list/commit/0cc56ec) · [ccd2a55](https://github.com/ccwq/ccwq-skill-list/commit/ccd2a55)
- **2026-10-15**：重整 README 的安装、索引和折叠参数速查，补齐分层详情入口，并明确外部 `skills` CLI 未固定版本、Plugin Marketplace 安装尚未验证。[252c8eb](https://github.com/ccwq/ccwq-skill-list/commit/252c8eb)

### 旧路径与本地副本

- **2026-04-20**：根目录 `nano-prompt/` 迁为 `skills/nano-prompt/`，定义文件内容完全相同；详见 [nano-prompt](#nano-prompt)。历史盘点将迁移前后视为同一个 Skill。[fb2c46a](https://github.com/ccwq/ccwq-skill-list/commit/fb2c46a)
- **2026-08-11**：历史中加入了 `.agents/skills/project-self-memory/` 和 `.claude/skills/project-self-memory/` 两套项目本地副本；它们不是两个新 Skill，规范分发目录中的同名 Skill 早已存在。[8572510](https://github.com/ccwq/ccwq-skill-list/commit/8572510)
- **2026-10-22**：项目结构整理删除上述两套本地副本，以及根目录 `gemin-mirror/HANDOFF.md` 等工作材料；`skills/project-self-memory/` 与 `skills/gemin-mirror/` 仍保留，不能据此写成 Skill 被移除或互相替代。[1a6c113](https://github.com/ccwq/ccwq-skill-list/commit/1a6c113)

### 打包与跨平台分发

- **2026-08-22**：增加按单个 Skill 或全量生成 `skill-zips/<名称>.zip` 的打包入口，并纳入 ZIP 产物；这是分发形式增加，不将每次重打包计作 Skill 新功能。[c1938a9](https://github.com/ccwq/ccwq-skill-list/commit/c1938a9) · [59b1b64](https://github.com/ccwq/ccwq-skill-list/commit/59b1b64)
- **2026-10-31**：ZIP 写入改用 POSIX 正斜杠条目名，修复 Windows 生成的反斜杠路径在 Linux/macOS 解包异常；随后重建全部 Skill ZIP。该修复影响分发包兼容性，不表示每个 Skill 的业务能力均发生变化。[839cc12](https://github.com/ccwq/ccwq-skill-list/commit/839cc12) · [bd0a0c5](https://github.com/ccwq/ccwq-skill-list/commit/bd0a0c5)
