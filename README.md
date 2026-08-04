# Claude Code Skill 仓库

本仓库用于存放和管理 Claude Code 的自定义 Skill。

https://github.com/ccwq/ccwq-skill-list

本 README 只做两件事：**安装索引** 与 **各 skill 的参数速查**。每个 skill 的完整说明在其自身的文档里，文末链接直达。

## 快速开始

最简：交互式选择并安装全部可用 skill。

```bash
npx -y skills add ccwq/ccwq-skill-list
```

逐步加参数（按需组合）：

```bash
# 1) 完整写法（等价于上面的简写）
npx -y skills add https://github.com/ccwq/ccwq-skill-list

# 2) 加 --skill：只装指定的 skill（可多个）
npx -y skills add https://github.com/ccwq/ccwq-skill-list --skill git-up nano-prompt

# 3) 加 --agent claude-code：安装到 Claude Code
npx -y skills add https://github.com/ccwq/ccwq-skill-list --agent claude-code

# 4) 组合：指定 skill + 安装到 Claude Code
npx -y skills add https://github.com/ccwq/ccwq-skill-list --agent claude-code --skill git-up nano-prompt
```

> 仓库根目录已存在 `.claude-plugin/marketplace.json`，仓库正在向 Plugin Marketplace 形态演进；当前实际内容仍以 `skills/` 为主，故安装方式只保留基于 `skills` CLI 的形式。

## 可用 Skill

| Skill | 说明 | 详情 |
|-------|------|------|
| `software-license-checker` | 评估软件企业内部使用的许可证合规风险，输出法务预警报告 | [SKILL.md](skills/software-license-checker/SKILL.md) |
| `git-history-cleaner` | 清理 Git 仓库历史中的特定文件或目录 | [SKILL.md](skills/git-history-cleaner/SKILL.md) |
| `git-up` | Git 提交与 `.gitignore` 维护工具，支持规划、讨论、提交、子智能体完全委派和忽略规则维护 | [SKILL.md](skills/git-up/SKILL.md) |
| `nano-prompt` | AI 图像提示词生成，基于分层结构构建专业级提示词 | [SKILL.md](skills/nano-prompt/SKILL.md) |
| `ffmpeg-video-processing` | 使用 ffmpeg / ffprobe 处理音视频，包括压缩、转码、裁剪与媒体检查 | [SKILL.md](skills/ffmpeg-video-processing/SKILL.md) |
| `codex-windows-hooks-fix` | 修复 Windows 环境中 Codex hooks 入口命令、PowerShell 包装器和 stdout JSON schema 问题 | [SKILL.md](skills/codex-windows-hooks-fix/SKILL.md) |
| `ntl-script-descriptions` | 为包含 package.json 的项目补充 ntl 可读取的 scripts 中文说明 | [SKILL.md](skills/ntl-script-descriptions/SKILL.md) |
| `npm-license-declaration` | 为前端项目生成 npm 第三方依赖许可证声明文档 | [SKILL.md](skills/npm-license-declaration/SKILL.md) |
| `debug-instrumentation` | 为调试问题添加、采集和分析可清理的 token 化日志埋点 | [SKILL.md](skills/debug-instrumentation/SKILL.md) |
| `rd-mode` | 远程开发模式规则，约束 host/server 协作并统一 CDP 浏览器操作（abc 命令） | [README.md](skills/rd-mode/README.md) |
| `lite-team` | 轻量多 Agent 协作，用 docs/bbs/lite-team-bbs.md 协作板在不同 Agent/session 间手动交接 | [README.md](skills/lite-team/README.md) |
| `gemin-mirror` | Gemini/兼容镜像站的探针、账号切换与 API-first 安全会话删除 | [SKILL.md](skills/gemin-mirror/SKILL.md) |
| `project-self-memory` | 维护项目级、可自进化的已验证结论记忆 | [SKILL.md](skills/project-self-memory/SKILL.md) |
| `pro-grilling` | 手动逐层厘清复杂决策，在共同理解前保持只读 | [SKILL.md](skills/pro-grilling/SKILL.md) |
| `aria-filedown` | 手动授权的 aria2 稳定下载工具，支持代理优先级与项目 `.env` | [SKILL.md](skills/aria-filedown/SKILL.md) |
| `chatgpt-web-skill` | 依赖 agent-browser 在指定 ChatGPT Project 中受授权地生图、编辑或执行单图结构化视觉审查 | [SKILL.md](skills/chatgpt-web-skill/SKILL.md) |

> 触发形式：`/skill-name` 偏 slash command 风格，`$skill-name` 偏按 skill 名触发；实际以你的 Claude Code / skills 运行环境为准。

## 参数速查

只列调用方式与参数。完整流程、注意事项见每个 skill 的「详情」链接。

### software-license-checker

评估软件在企业内部使用场景下的许可证、授权与潜在付费要求。

```text
$software-license-checker 检查 FFmpeg 是否可以在企业内部使用
$software-license-checker TensorFlow 企业内部研发使用是否需要付费
```

无显式参数，直接描述待评估的软件与使用场景即可。详情见 [SKILL.md](skills/software-license-checker/SKILL.md)。

---

### git-history-cleaner

清理 Git 仓库历史中的特定文件或目录以减小仓库体积。

```text
$git-history-cleaner --repo /path/to/repo --path bin/ --dry-run
$git-history-cleaner --repo /path/to/repo --path "*.log" --auto
```

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `--repo` | 仓库路径 | 当前目录 |
| `--path` | 要删除的路径模式 | 必填 |
| `--dry-run` | 预览模式，只分析不执行 | false |
| `--auto` | 自动模式，无需确认 | false |

改写历史会改变提交 ID，执行前会创建 `.git` 备份。详情见 [SKILL.md](skills/git-history-cleaner/SKILL.md)。

---

### git-up

Git 提交与 `.gitignore` 维护工具，支持规划、讨论、修改、执行提交和完全委派子智能体提交。

```text
/git-up --plan, -p      # 分析 diff，在会话中输出 YAML 提交计划
/git-up --discuss, -d    # 轻量讨论提交计划，最多 1-3 个关键问题
/git-up --modify <内容>  # 根据反馈调整计划并重新输出
/git-up --commit, -c    # 优先用 Python fast path 执行会话中的计划
/git-up --plan --commit, -pc  # 一步规划并提交，不等待用户确认
/git-up --plan --commit --push, -pcP  # 一步规划、提交并 push
/git-up --sub-agent, -s 仅提交 skills/git-up  # 委派一个子智能体执行 git-up -pc
/git-up -sP 仅提交 skills/git-up  # 委派一个子智能体执行 git-up -pcP
/git-up --ignore, -i       # 自动识别技术栈，直接创建或增量维护 .gitignore
/git-up -i node python     # 只维护指定技术栈规则
/git-up -i --add "tmp/" --reason "本地调试输出"  # 添加有中文说明的自定义规则
/git-up -i --clean         # 仅预览 Git-up 管理规则的重复项
/git-up -i --clean --apply # 确认后执行清理
/git-up -l en --plan     # 使用英文输出计划、讨论问题和 commit message
/git-up                  # 直接生成 commit message
```

模式：plan / discuss / modify / commit / plan+commit / commit+push / plan+commit+push / sub-agent / sub-agent+push / ignore / default。`--plan` 可简写为 `-p`，`--discuss` 可简写为 `-d`，`--commit` 可简写为 `-c`，`--push` 可简写为 `-P`，`--sub-agent` 可简写为 `-s`，`--ignore` 可简写为 `-i`。`-pcP` / `--plan --commit --push` 可一步规划、提交并 push；`-s` / `--sub-agent` 会在当前工作目录创建一个子智能体、同步等待它执行 `git-up -pc`，`-sP`、`-s -P`、`--sub-agent --push` 则执行 `git-up -pcP`。`-s` 后的描述性文本是强制提交边界，子智能体不能满足时必须停止，父智能体不会改为自行提交；它不与 `-p`、`-c`、`-d`、`--modify`、`-i` 等主模式混用，但可与 `-l/--lang` 组合。`-i` 自动识别 Node.js/Python 项目，只增量加入带中文用途说明的高置信度规则，默认不处理 `.env`；可用技术栈参数限缩范围，并用 `--add <规则> --reason <说明>` 加入自定义规则。已有等价规则会跳过；`--clean` 只预览 Git-up 管理区块的重复项，须额外传 `--apply` 才会删除。`--push/-P` 只支持绑定 `-c`、`-pc` 或 `-s`，不支持单独 push；push 只在网络/传输类错误失败后最多重试 3 次，认证、权限、无 upstream、non-fast-forward 等非网络错误不重试。`-l/--lang` 控制输出语言，支持 `zh`（默认）和 `en`，影响计划说明、讨论问题、commit subject/body 和最终汇报；type/scope/emoji、文件路径和命令保持原样。`--discuss/-d` 内置轻量讨论流程：只围绕提交计划逐个提出 1-3 个关键问题，每问给推荐答案；按拆分边界、文件归属/排除项、commit 顺序等决策分支推进，事实先查代码或 git 状态，决策再问用户，达成共识前不提交。`-c` 优先用 `scripts/commit_plan.py` 直接执行；解析失败时 LLM 修复 YAML 并重试 1 次，仍失败回退为原有提交路径。计划仍存于对话上下文，故 `-p` 与 `-c` 需在同一会话。详情见 [SKILL.md](skills/git-up/SKILL.md)。

---

### nano-prompt

AI 图像提示词生成，基于 Nano Banana Pro 的核心提示技巧，输出 YAML 格式的分层提示词结构。

```text
/nano-prompt 一个赛博朋克女孩在霓虹雨夜中行走
/nano-prompt 宫崎骏风格的中国古建筑风景
```

无显式参数，直接描述画面即可。输出含创意/光线/氛围/环境/相机/颜色/纹理/风格/细节/负面等分层结构。详情见 [SKILL.md](skills/nano-prompt/SKILL.md)。

---

### ffmpeg-video-processing

通过 ffmpeg / ffprobe 处理音视频，包括压缩、转码、裁剪、缩放、变帧率、抽取音频、拼接、字幕烧录、水印与媒体检查。

```text
/ffmpeg-video-processing 把 input.mov 压缩成更小的 mp4，尽量保留清晰度
/ffmpeg-video-processing 把 video.mp4 裁掉前 5 秒并导出为 webm
/ffmpeg-video-processing 检查这个文件的编码、分辨率和时长
```

无显式参数，用自然语言描述处理目标。本机缺少 `ffmpeg`/`ffprobe` 时需先提供路径或确认下载。详情见 [SKILL.md](skills/ffmpeg-video-processing/SKILL.md)。

---

### codex-windows-hooks-fix

修复 Windows 环境中 Codex hooks 报错，尤其是 `SessionStart`、`UserPromptSubmit`、`PreToolUse`、`Stop` 的 hook failed、`invalid JSON output`、裸 `sh/python3/.sh`、`decision=allow` 与路径展开问题。

```text
$codex-windows-hooks-fix Windows 上 PreToolUse hook 报 invalid pre-tool-use JSON output，pre-tool-use.ps1 输出了 decision=allow，帮我修
$codex-windows-hooks-fix codex 在 Windows 启动时报 SessionStart/UserPromptSubmit hook failed，hooks.json 里用了 sh 和 python3
```

无显式参数。默认流程是先调查真实 `hooks.json` 和 hook 脚本，再做最小改动，最后用 `Test-Json`、直接执行注册命令和 `codex exec` 子进程验证真实 hook 链路。详情见 [SKILL.md](skills/codex-windows-hooks-fix/SKILL.md)。

---

### ntl-script-descriptions

为包含 `package.json` 的项目补充 `ntl` 可读取的 scripts 中文说明，写入 `package.json#ntl.descriptions`。

```text
$ntl-script-descriptions 帮这个前端项目补齐 package scripts 的中文说明，给 ntl 用
$ntl-script-descriptions package.json 里已有 ntl.descriptions，不要覆盖，只补缺失项
```

无显式参数。默认保留已有说明，覆盖所有 scripts（包括 `pre*` / `post*`），写入后校验 JSON 并输出新增、保留、冲突和孤儿说明清单。详情见 [SKILL.md](skills/ntl-script-descriptions/SKILL.md)。

---

### npm-license-declaration

为前端项目的直接 npm 依赖生成许可证声明，固定输出到 `docs/npm-license-declaration.md`。

```text
$npm-license-declaration 为当前项目生成 npm 第三方依赖许可证声明
$npm-license-declaration 检查 E:\project\portal，并输出 docs/npm-license-declaration.md
```

无显式参数。读取 `dependencies` 与 `devDependencies` 后去重排序，统一查询 npm Registry 的 latest 元数据；npm 查询失败时仅用 `package-lock.json` 或 `yarn.lock` 的 `resolved` URL 兜底。许可证未知或不在内置分级中的包会列为“⚪ 不可用”，需手动核实。详情见 [SKILL.md](skills/npm-license-declaration/SKILL.md)。

---

### debug-instrumentation

为调试问题生成、采集和分析带统一 token 的临时日志埋点，完成后按确认流程清理。

```text
$debug-instrumentation 这个异步 bug 偶发，帮我在 submitOrder 和 refreshStatus 加日志追踪
$debug-instrumentation 我已经加了一些 log，日志在 E:\logs\worker.log，帮我看看 [DBG_worker-retry 前缀的输出
```

无显式参数。日志统一以 `[DBG_<语义标签>_<4位随机字符>]` 开头；新建前会检索历史 `[DBG_]`，命中后可选择清理后新增、沿用现有或仅新增，多标签在写入前一次确认。分析结束后默认先询问是否清理，展示 diff 后再等待最终删除确认。详情见 [SKILL.md](skills/debug-instrumentation/SKILL.md)。

---

### rd-mode

远程开发模式规则，约束 host/server 协作并统一通过 `abc` 命令操作 host 浏览器（CDP）。

```text
rd-mode --init   # 首次使用，问答补全 RHost / CDP_PORT，写入 ~/.config/rd-mode/.env
```

| 参数 | 说明 |
|------|------|
| `--init` | 生成本地配置（`RHost`、`CDP_PORT`） |

详情、host/server 架构、`abc` 用法与故障排查见 [README.md](skills/rd-mode/README.md)。

---

### lite-team

手动角色协作，按需用 BBS 协作板交接；不自动编排、不自动读取。调用全用自然语言（说人话）：

```text
切换到开发角色
给测试 Agent 留一条交接：登录异常分支已完成，需验证错误凭证、重复提交和超时。
切换到测试角色（或“假设你是测试”）
读取协作板
任务结束，帮我归档
```

> 嫌长可用极简词：`role <角色名>` / `bbs init|read|write` / `done`，与上述说法等价。它们是对话简写，**不是**注册的 slash 命令或 skill 参数。

脚本命令（Python 3，≥3.8，统一用 `python3`）：

| 命令 | 说明 |
|------|------|
| `init` | 初始化协作板 |
| `add` | 写入一条交接（自动生成 id，守 7 条上限与 500 字软约束） |
| `status` | 查看消息数量 |
| `clear --yes` | 清空当前消息，保留历史 |
| `archive --summary` | 确认归档后写入历史 |

BBS 会提交 Git，勿写密钥/Token；message 最多 7 条，history 最多 9 条。详情见 [README.md](skills/lite-team/README.md)。

---

### gemin-mirror

操作 Gemini 或兼容镜像站：探查页面、切换账号与管理会话。必须复用已有 CDP 浏览器标签页，并先确认本次授权范围；删除优先 API-first，账号证据、请求模板或刷新复核不通过时会停止。

```text
$gemin-mirror 调查当前账号和账号面板，不做修改
$gemin-mirror 切换指定账号并唯一核验活动邮箱，列出当前会话数
$gemin-mirror 在已授权账号中删除全部会话，并生成审计记录
```

脚本调用示例（先使用 `--dry-run` 验证，不会点击确认删除）：

```powershell
node skills/gemin-mirror/scripts/delete-sessions-via-api.mjs --expected-account "name@example.com" --dry-run
node skills/gemin-mirror/scripts/delete-sessions-via-api.mjs --expected-account "name@example.com" --confirm-delete
# 仅默认适配器：依次切换并删除运行时发现的候选账号
node skills/gemin-mirror/scripts/delete-candidate-accounts.mjs --confirm-delete-all --session my-project-session
```

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `--expected-account <账号标识>` | 必填；与页面唯一活动账号证据精确匹配 | 无 |
| `--confirm-delete` | 实际删除的必填确认标记；`--dry-run` 不需要 | false |
| `--dry-run` | 只验证删除交互，不点击最终确认按钮 | false |
| `--origin <URL>` / `GEMINI_MIRROR_ORIGIN` | 允许操作的页面 origin | 默认适配器 |
| `--cdp <端口>` / `CDP_PORT` | 覆盖 CDP 端口 | `9696` |
| `--session <名称>` / `AGENT_BROWSER_SESSION` | 覆盖 browser session | 当前项目路径派生值 |
| `--chat-selector <CSS>` / `GEMINI_MIRROR_CHAT_SELECTOR` | 覆盖原生会话项选择器 | 默认适配器 |
| `--active-account-selector <CSS>` / `GEMINI_MIRROR_ACTIVE_ACCOUNT_SELECTOR` | 覆盖活动账号证据选择器 | 默认适配器 |
| `--login-failure-text <文本>` / `GEMINI_MIRROR_LOGIN_FAILURE_TEXT` | 覆盖登录失效文案 | `登录已失效` |
| `--delete-text <文本>` / `GEMINI_MIRROR_DELETE_TEXT` | 覆盖 DOM 删除按钮文案 | `删除` |
| `--at-global-path <路径>` / `GEMINI_MIRROR_AT_GLOBAL_PATH` | 覆盖 API 动态 `at` 的页面全局路径 | 默认适配器 |
| `--concurrency <数量>` / `--max-retries <次数>` / `--wait-ms <毫秒>` | API 删除的并发、重试与刷新等待 | 4 / 3 / 1200 |
| `--audit <路径>` | 覆盖本地 JSONL 审计路径 | 系统临时目录 |
| `--confirm-delete-all` | 多账号入口的必填确认标记 | false |

运行时认证参数只在内存中使用。无固定自然语言参数；按任务描述声明操作类别、目标账号和是否允许破坏性操作。审计日志只记录账号短哈希。默认适配器的站点契约见 [site-map.md](skills/gemin-mirror/references/site-map.md)，完整流程见 [SKILL.md](skills/gemin-mirror/SKILL.md)。

---

### project-self-memory

在非简单项目任务开始时读取项目记忆，并在完成后仅沉淀已验证、可复用的事实、长期决策和避坑结论。

```text
$project-self-memory 调查当前仓库的登录刷新失败，修复后完成浏览器验证
$project-self-memory -m "生产部署必须先运行 npm run preflight"
$project-self-memory -g 鉴权迁移
$project-self-memory --grilling -m "生产部署必须先运行 npm run preflight"
$project-self-memory -t 鉴权
```

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `-m <内容>` / `--memory <内容>` | 显式提交一条记忆候选；内容不能为空 | 无 |
| `-g [主题]` / `--grilling [主题]` | 逐问盘点当前会话或指定主题中值得沉淀的经验；确认“ok”后写入 | 当前会话 |
| `-t [主题]` / `--trim [主题]` | 先本地核验再按主题逐问整理已有记忆；确认“ok”后自动改写、合并或删除，不新增结论 | 全部主题 |

消费者项目中该 skill 必须位于 `.agents/skills/project-self-memory/` 或 Claude Code 的 `.claude/skills/project-self-memory/`，记忆文件固定为 `self-memory/memory.md`；不记录凭据、个人数据、易失机器状态或未经验证的推断。`-t/--trim` 默认只读检查源码、配置、文档、测试与 Git 历史，不自动运行测试或联网。详情见 [SKILL.md](skills/project-self-memory/SKILL.md)。

---

### pro-grilling

在需要逐层厘清复杂目标、依赖、风险和取舍时手动调用。每轮只问一个高信息增益问题；可自行核验低成本的只读事实，但目标、偏好、优先级和关键取舍始终由用户决定。未确认“ok”前，不会执行实际操作或输出最终方案。

```text
$pro-grilling 评估是否把现有单体前端拆成微前端，并厘清迁移边界
$pro-grilling 我们要重做登录态方案，但先把安全、兼容和上线风险讨论清楚
```

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `[待讨论事项]` | 需要逐层澄清的计划、决策或复杂任务；不传时会先询问事项 | 无 |

Codex 使用 `$pro-grilling` 显式调用。调查档位为“直接继续 / 快速核验 / 充分调查”，只有结论或后续路径可能改变时才会询问选择。详情见 [SKILL.md](skills/pro-grilling/SKILL.md)。

---

### chatgpt-web-skill

依赖 `agent-browser` skill 与 CLI，在指定的 `agents-op` ChatGPT Project 中生成、编辑或审阅图片时使用。ChatGPT Search / Deep Research 不是默认行为，发送前必须说明理由并取得当次明确授权；不得将其用作通用外站浏览或抓取工具。

```text
$chatgpt-web-skill 在 agents-op 中生成一张简洁的蓝色立方体图
$chatgpt-web-skill 审阅当前 chat 附带的商品主图，并给出可执行改图建议
$chatgpt-web-skill visual-review 上传一张商品主图，按 S1 文字完整、S2 无裁切审查
$chatgpt-web-skill -t 整理当前版本经验库
```

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `[图片任务]` | 生图、编辑或审阅图片的需求；Research 必须另获当次授权 | 无 |
| `-t [主题]` / `--trim [主题]` | 本地与实时 UI 核验后逐主题讨论经验整理；最终 `ok` 后原子改写、合并或删除当前版本经验 | 全部经验 |
| `--cdp <port>` / `AGENT_BROWSER_CDP_PORT` | 必须接入已登录的既有浏览器；项目 `.env` 默认使用 `9696`，调用期参数或环境变量可覆盖 | `9696` |
| `--tab <tab-id>` | 每次脚本命令前切换到实时 tab list 返回的稳定任务 tab ID，避免读取其他 CDP tab | 不传 |
| `browser_task.py acquire/status/action/release` | 必须通过已登录 CDP 浏览器运行；以临时 lease 管理 URL 精确复用或 `--force-new` 专用 tab，动作前后保存 snapshot，release 只关闭本次创建的 tab | 项目 `.env` 的 `9696` |
| `runtime_checks.py project/images/message` | 机械验证 Project 双证据、生成图尺寸或 prompt 渲染；仍需实时 snapshot/截图复核 | 按当前 session |
| `visual-review` | 上传一张图片，按 `S` 编号标准获得严格中文 YAML 审查并本地计算视觉状态 | `VISUAL_PENDING` fail-closed |
| `experience_memory.py status/append/trim` | 校验、原子追加或按确认计划整理版本隔离的脱敏经验 | 当前 `metadata.version` |

可通过 `python skills/chatgpt-web-skill/scripts/run_agent_browser.py --tab <tab-id> <command>` 调用 `agent-browser`；跨命令任务可通过 `browser_task.py` 获取 lease 并在动作前后保存 snapshot，`runtime_checks.py` 将 Project 双证据、提交状态和图片可见/尺寸检查下沉为结构化结果，图片已出现在 snapshot 时会立刻截图返回，避免无效等待。`visual-review` 由调用方决定触发：仅上传一张图片，固定提示词要求模型只返回一个中文 YAML 代码块；其中逐项列出 `S` 标准检查、缺陷和改进建议。本地按 `critical`、`major`、`minor` 严格计算 `VISUAL_*`，仅 `VISUAL_PASSED` 可继续流程；它不删除或修改 chat。`experience_memory.py` 负责经验库格式与原子写入；`trim` 必须提供覆盖全部原始条目的确认计划与 `--confirm`，只处理当前版本经验库。DOM selector/ref、视觉质量和授权判断仍须实时验证。PowerShell 中 ref 必须加引号，且 Enter 后须确认用户消息已渲染。详情见 [SKILL.md](skills/chatgpt-web-skill/SKILL.md)。

---

### aria-filedown

只在用户显式调用，或普通下载已发生网络异常且用户同意切换时使用；不会自动接管下载。当前目标的下载切换授权不等同于 aria2 安装授权。

```text
$aria-filedown 使用代理下载 https://example.com/model.zip 到 ./downloads
python scripts/aria2-wrapper.py -p http://localhost:7897 -- https://example.com/file.zip
```

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `--proxy <URL>` / `-p <URL>` | 本次下载或 aria2 安装使用的代理，优先级最高 | 无 |
| `--install` | 缺少 aria2c 时安装；仍需先获得安装目录确认 | `false` |
| `--install-dir <目录>` | aria2 安装目录 | `ARIA2C` 或无 |
| `--progress <模式>` | `auto`、`tty`、`jsonl`、`off` | `auto` |

代理优先级为命令行 > 进程环境 > 项目 `.env`，每层内 `ARIA2_PROXY` > `PROXY`。项目 `.env` 位于 Git 根目录；代理凭据不会回显。详情见 [SKILL.md](skills/aria-filedown/SKILL.md)。

---

## 目录结构

```text
ccwq-skill-list/
├── .claude-plugin/
│   └── marketplace.json     # Marketplace 元数据（迁移方向）
├── skills/                  # 当前实际生效的 Skill 目录
├── scripts/                 # 辅助脚本
├── test-space/              # 测试与验证空间
├── CLAUDE.md                # 项目配置文档
└── README.md                # 项目说明文档
```

## License

MIT
