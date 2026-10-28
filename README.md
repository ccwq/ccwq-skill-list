# Agent Skill 仓库

本仓库收集一些真是工作中常用的Agent Skill, 无关具体业务。

https://github.com/ccwq/ccwq-skill-list

## 安装

最简：启动交互式安装，勾选需要的 Skill。

```bash
npx skills add ccwq/ccwq-skill-list
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

本仓库不固定外部 `skills` CLI 的版本。

> 当前通过 `skills` CLI 安装。仓库包含 Plugin Marketplace 元数据，但插件安装尚未验证。

## 可用 Skill

点击「速查」查看调用与参数。点击「README」或「SKILL」打开详细说明。

| Skill | 说明 | 详情 |
|-------|------|------|
| `agent-human-debug` | Agent 主导、人类执行的跨平台故障诊断；最小只读 probe、脱敏回传 | [速查](#agent-human-debug) · [README](skills/agent-human-debug/README.md) |
| `aria-filedown` | 手动授权的 aria2 稳定下载，支持代理优先级与项目 `.env` | [速查](#aria-filedown) · [SKILL](skills/aria-filedown/SKILL.md) |
| `bash-completion` | 配置与排查 Bash 补全：Tab、fzf、ble.sh、zoxide 及启动顺序冲突 | [速查](#bash-completion) · [SKILL](skills/bash-completion/SKILL.md) |
| `chatgpt-web-skill` | 在指定 ChatGPT Project 中受授权地生图、改图与单图结构化审查 | [速查](#chatgpt-web-skill) · [README](skills/chatgpt-web-skill/README.md) |
| `claude-proj-skill-linker` | 把 `.agents/skills` 通过目录链接接入 `.claude/skills`，并整理链接入口 | [速查](#claude-proj-skill-linker) · [SKILL](skills/claude-proj-skill-linker/SKILL.md) |
| `codex-windows-hooks-fix` | 修复 Windows 上 Codex hooks 的命令入口、包装器与 JSON 输出 | [速查](#codex-windows-hooks-fix) · [README](skills/codex-windows-hooks-fix/README.md) |
| `debug-instrumentation` | 添加、采集和分析可清理的 token 化调试日志埋点 | [速查](#debug-instrumentation) · [SKILL](skills/debug-instrumentation/SKILL.md) |
| `deep-investigation` | 对公共事件、组织、人物或商业议题做可追溯的深度调查复盘 | [速查](#deep-investigation) · [SKILL](skills/deep-investigation/SKILL.md) |
| `dockerhub-mirror` | 诊断 Docker Hub 拉取卡顿，探测、评分并管理镜像候选 | [速查](#dockerhub-mirror) · [README](skills/dockerhub-mirror/README.md) |
| `engineering-method-selector` | 按工程阶段、产物、质量属性和风险推荐可验证的方法论组合 | [速查](#engineering-method-selector) · [SKILL](skills/engineering-method-selector/SKILL.md) |
| `ffmpeg-video-processing` | 用 ffmpeg / ffprobe 压缩、转码、裁剪、抽取音频与检查媒体 | [速查](#ffmpeg-video-processing) · [SKILL](skills/ffmpeg-video-processing/SKILL.md) |
| `gemin-mirror` | Gemini 兼容镜像站的账号探针、账号切换与安全会话删除 | [速查](#gemin-mirror) · [README](skills/gemin-mirror/README.md) |
| `git-history-cleaner` | 清理 Git 历史中的特定文件或目录 | [速查](#git-history-cleaner) · [SKILL](skills/git-history-cleaner/SKILL.md) |
| `git-up` | Git 提交与 `.gitignore` 维护，支持规划、讨论、委派与一步提交 | [速查](#git-up) · [README](skills/git-up/README.md) |
| `handoff-portable` | 把当前任务交接给普通聊天 AI，生成可粘贴的单个 Markdown 文件并做结构校验与语义体检 | [速查](#handoff-portable) · [SKILL](skills/handoff-portable/SKILL.md) |
| `joint-debugging` | 手动协调技术联调、故障诊断、验证与修复 | [速查](#joint-debugging) · [SKILL](skills/joint-debugging/SKILL.md) |
| `lite-team` | 轻量多 Agent 协作，用协作板在不同 Agent / session 间手动交接 | [速查](#lite-team) · [README](skills/lite-team/README.md) |
| `nano-prompt` | AI 图像提示词生成，输出分层 YAML 结构 | [速查](#nano-prompt) · [SKILL](skills/nano-prompt/SKILL.md) |
| `network-debug` | 证据驱动定位 DNS、路由、TCP/UDP、HTTP/TLS、代理与 overlay 故障 | [速查](#network-debug) · [SKILL](skills/network-debug/SKILL.md) |
| `npm-license-declaration` | 为前端项目生成 npm 第三方依赖许可证声明文档 | [速查](#npm-license-declaration) · [SKILL](skills/npm-license-declaration/SKILL.md) |
| `ntl-script-descriptions` | 为 package.json 补充 ntl 可读取的 scripts 中文说明 | [速查](#ntl-script-descriptions) · [SKILL](skills/ntl-script-descriptions/SKILL.md) |
| `pro-grilling` | 手动逐层厘清复杂决策，在共同理解前保持只读 | [速查](#pro-grilling) · [SKILL](skills/pro-grilling/SKILL.md) |
| `progressive-doc` | 用渐进式披露结构创建、改写或审查中文技术文章 | [速查](#progressive-doc) · [SKILL](skills/progressive-doc/SKILL.md) |
| `project-self-memory` | 维护项目级结论记忆，支持逐问策展、评分、候选逐条入库、结论暂存、可选派生多标签与 legacy 迁移 | [速查](#project-self-memory) · [README](skills/project-self-memory/README.md) |
| `rd-mode` | 远程开发模式规则，统一通过 `abc` 命令操作 host 浏览器 | [速查](#rd-mode) · [README](skills/rd-mode/README.md) |
| `software-license-checker` | 评估软件企业内部使用的许可证合规与付费风险 | [速查](#software-license-checker) · [README](skills/software-license-checker/README.md) |
| `subagent-router` | 预览并确认后临时创建子 Agent，支持动态模型路由 | [速查](#subagent-router) · [README](skills/subagent-router/README.md) |
| `tool-evaluator` | 调查、比较并筛选适合当前约束的工具 | [速查](#tool-evaluator) · [SKILL](skills/tool-evaluator/SKILL.md) |
| `tutor-man` | 用自适应费曼式掌握等级快速学会工具、概念或方法 | [速查](#tutor-man) · [SKILL](skills/tutor-man/SKILL.md) |
| `website-state-sync-agent` | 在 Chrome 实例之间迁移加密的 Cookie 与 Web Storage | [速查](#website-state-sync-agent) · [SKILL](skills/website-state-sync-agent/SKILL.md) |
| `wechat-headlines` | 生成与优化微信公众号标题，默认六条不同方向候选 | [速查](#wechat-headlines) · [SKILL](skills/wechat-headlines/SKILL.md) |

> 触发形式：`/skill-name` 偏 slash command 风格，`$skill-name` 偏按 skill 名触发；实际以你的 Claude Code / skills 运行环境为准。

## 参数速查

### agent-human-debug

Agent 负责诊断，人类负责执行命令。

Agent 先识别环境，再选择最小只读探针（probe）。结果脱敏后生成 `debug_report`，优先复制到剪切板。

```text
$agent-human-debug 排查 Windows 本地服务调用接口偶发超时
$agent-human-debug 联调容器中的前后端问题，要求每轮只执行一段 PowerShell 脚本
```

默认只读取证。未经授权，Agent 不执行以下操作：

- 创建文件。
- 保存日志。
- 安装工具。
- 上传完整信息。

修改前，Agent 必须说明影响、风险、回滚与验证方式。每次修改必须取得针对当前操作的授权。

<details>
<summary>参数</summary>

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `[待处理事项]` | 联调、诊断、验证或修复目标，可补充环境、约束和期望证据 | 无 |

</details>

详情见 [README.md](skills/agent-human-debug/README.md)。

---

### aria-filedown

只在用户显式调用，或普通下载已发生网络异常且用户同意切换时使用。下载切换授权不等同于 aria2 安装授权。

```text
$aria-filedown 使用代理下载 https://example.com/model.zip 到 ./downloads
python skills/aria-filedown/scripts/aria2-wrapper.py -p http://localhost:7897 -- https://example.com/file.zip
```

脚本示例按仓库根目录给出；安装后使用时换成实际的 `<skill-dir>/scripts/aria2-wrapper.py`。

<details>
<summary>参数</summary>

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `--proxy <URL>` / `-p <URL>` | 本次下载或 aria2 安装使用的代理，优先级最高 | 无 |
| `--install` | 缺少 `aria2c` 时安装；必须先确认安装目录 | `false` |
| `--install-dir <目录>` | aria2 安装目录 | `ARIA2C` 或无 |
| `--progress <模式>` | `auto`、`tty`、`jsonl`、`off` | `auto` |

代理优先级为命令行 > 进程环境 > 项目 `.env`；每层内 `ARIA2_PROXY` > `PROXY`。项目 `.env` 位于 Git 根目录，代理凭据不会回显。`--` 之后的参数原样透传给 aria2。

</details>

详情见 [SKILL.md](skills/aria-filedown/SKILL.md)。

---

### bash-completion

配置、安装或排查 Bash 补全体验。适用于「输入命令没提示」「Tab 不补全」「Ctrl-R 失效」；不用于普通 shell 脚本编写，也不默认迁移到 zsh/fish。

```text
$bash-completion 输入 git 后没有自动建议，Ctrl-R 和 Tab 都正常，帮我找原因
$bash-completion 在新机器上配置 Bash 补全，先只做只读检查，不要安装
$bash-completion 发行版 fzf 不支持 --bash，但有 key-bindings.bash，要不要升级
```

无固定 CLI 参数，用自然语言说明目标环境与现象即可。默认先做只读基线，再按授权分阶段变更并保留回滚。

<details>
<summary>辅助脚本</summary>

| 脚本 | 说明 | 默认值 |
|------|------|--------|
| `scripts/probe-bash.sh` | POSIX sh 静态探针：进程模式、TTY、locale、工具路径、启动文件存在性 | 无参数 |
| `scripts/verify-pty.py --tests <项> --timeout <秒>` | 实验性 PTY 验证器，按 `readiness`、`tab`、`fzf-history`、`fzf-files`、`fzf-dirs`、`ble` 分项验证 | 干净 Bash + 临时 HOME，`--timeout 15` |
| `scripts/verify-pty.py --user-config` | 加载真实用户启动文件后才验真实配置，非沙箱 | 关闭 |

探针不执行找到的工具、不 source 配置、不输出配置正文。两者只在已选定的 Unix 环境内运行，不负责连接和提权。未指定远程目标时先问，不从提权后的 HOME 推断配置对象。

</details>

详情见 [SKILL.md](skills/bash-completion/SKILL.md)。

---

### chatgpt-web-skill

在 `agents-op` ChatGPT Project 中生成、编辑或审阅图片。操作依赖 `agent-browser`。

默认不使用 ChatGPT Search 或 Deep Research。使用前，Agent 必须说明理由并取得当次授权。不得把本 Skill 用作通用外站浏览或抓取工具。

```text
$chatgpt-web-skill 在 agents-op 中生成一张简洁的蓝色立方体图
$chatgpt-web-skill 审阅当前 chat 附带的商品主图，并给出可执行改图建议
$chatgpt-web-skill visual-review 上传一张商品主图，按 S1 文字完整、S2 无裁切审查
$chatgpt-web-skill -t 整理统一经验库
```

只接入已登录的浏览器。连接失败时提示配置方式，不启动新浏览器。

默认最多生成或编辑 3 轮图片。`visual-review` 每次只上传一张图。审查结果使用中文 YAML。仅当状态为 `VISUAL_PASSED` 时，流程可以继续。

<details>
<summary>参数</summary>

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `[图片任务]` | 生图、编辑或审阅图片的需求；Research 必须另获当次授权 | 无 |
| `-t [主题]` / `--trim [主题]` | 本地与实时 UI 核验后逐主题讨论统一经验整理；最终 `ok` 后原子改写、合并或删除全库经验 | 全部经验 |
| `--cdp` / `-c <port-or-url>` / `AGENT_BROWSER_CDP_PORT` | 只接入已登录浏览器；优先级为参数 > 环境变量 > 用户级 `agent-browser` 配置的 `cdp` > `9222` | `9222` |
| `--tab <tab-id>` | 每次脚本命令前切换到实时 tab list 返回的稳定任务 tab ID | 不传 |
| `browser_task.py acquire/status/action/release` | 通过已登录 CDP 浏览器运行；以临时 lease 管理 URL 精确复用或 `--force-new` 专用 tab | 同 CDP 优先级 |
| `runtime_checks.py project/images/message` | 机械验证 Project 双证据、生成图尺寸或 prompt 渲染；仍需实时 snapshot 复核 | 按当前 session |
| `project_locator.py --tab <tab-id> --name <project>` / `--new-tab` | 从实时 sidebar 精确匹配 Project 行并点击同行 `Open project home`；返回浏览器实际导航的 `/project` URL 与页面证据 | `agents-op` |
| `image_exporter.py --selector <css>` / `--url <image-url>` | 在指定登录 Tab 的浏览器上下文中导出图像到 `--output`；多图时选择靠近聊天框的可见图 | 无 |
| `visual-review` | 上传一张图片，按 `S` 编号标准获得严格中文 YAML 审查 | `VISUAL_PENDING` fail-closed |
| `experience_memory.py read [--full]/status/append/trim` | 读取、原子追加或按确认计划整理统一的脱敏经验 | `%USERPROFILE%` 或 `~/.config` |
| `experience_memory.py trim --plan <file> --confirm ok` | 用户回复 `ok` 后整理全库。每项改写、合并或删除必须有非空 `evidence` | 不自动执行 |

</details>

参数中列出三种 CDP 配置方式：

- 脚本参数 `-c <port-or-url>`。
- 环境变量 `AGENT_BROWSER_CDP_PORT`。
- 用户级配置 `~/.agent-browser/config.json`，例如 `{ "cdp": 9222 }`。

直接调用示例：

```text
python skills/chatgpt-web-skill/scripts/run_agent_browser.py -c <port-or-url> --tab <tab-id> <command>
```

PowerShell 中，元素引用（ref）必须加引号。

详情见 [README.md](skills/chatgpt-web-skill/README.md)。

---

### claude-proj-skill-linker

把项目 `.agents/skills` 下的 skill 通过目录链接接入 `.claude/skills`，并把 `.claude` 中的实体 skill 迁移到 `.agents`。依赖 Node.js ≥ 20。

```bash
node <skill-dir>/scripts/link-skills.mjs --project-root <root>                    # 只读预览，输出 JSON 与 digest
node <skill-dir>/scripts/link-skills.mjs --project-root <root> --skill my-skill   # 只预览指定 skill
node <skill-dir>/scripts/link-skills.mjs --project-root <root> --apply --expect <digest>  # 确认后执行
```

`--expect` 必须来自紧邻的预览。状态变化时，CLI 返回 `STALE`；必须重新预览确认。

项目根、`.agents` 和 `.claude` 必须是实体目录。CLI 拒绝使用链接目录作为容器。

<details>
<summary>参数</summary>

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `--project-root <dir>` | 被整理的项目根目录 | 当前工作目录 |
| `--skill <name>` | 只处理指定 skill，可重复传入 | 两侧全部子项 |
| `--apply` | 执行变更 | false（只读预览） |
| `--expect <digest>` | 执行时必填，必须匹配最新预览的摘要 | 无 |
| `--help` / `-h` | 输出帮助 | - |

</details>

详情见 [SKILL.md](skills/claude-proj-skill-linker/SKILL.md)。

---

### codex-windows-hooks-fix

修复 Windows 上 Codex hooks 的入口、输出和路径问题。

常见症状包括：

- `SessionStart`、`UserPromptSubmit`、`PreToolUse` 或 `Stop` 报 hook failed。
- 输出出现 `invalid JSON output`。
- 入口直接使用 `sh`、`python3` 或 `.sh`。
- `PreToolUse` 输出 `decision=allow`。
- 配置中的路径展开错误。

```text
$codex-windows-hooks-fix Windows 上 PreToolUse hook 报 invalid pre-tool-use JSON output，pre-tool-use.ps1 输出了 decision=allow，帮我修
$codex-windows-hooks-fix codex 在 Windows 启动时报 SessionStart/UserPromptSubmit hook failed，hooks.json 里用了 sh 和 python3
```

无显式参数。诊断与验证顺序如下：

1. 读取真实 `hooks.json` 和 hook 脚本。
2. 执行最小修复。
3. 用 `Test-Json` 检查 JSON。
4. 直接执行配置中注册的命令。
5. 用 `codex exec` 验证真实 hook 链路。

详情见 [README.md](skills/codex-windows-hooks-fix/README.md)。

---

### debug-instrumentation

为调试问题生成、采集和分析带统一 token 的临时日志埋点，完成后按确认流程清理。

```text
$debug-instrumentation 这个异步 bug 偶发，帮我在 submitOrder 和 refreshStatus 加日志追踪
$debug-instrumentation 我已经加了一些 log，日志在 E:\logs\worker.log，帮我看看 [DBG_worker-retry 前缀的输出
```

日志统一以 `[DBG_<语义标签>_<4位随机字符>]` 开头。新建前会检索历史 `[DBG_]`，命中后可选择清理后新增、沿用现有或仅新增；多标签在写入前一次确认。分析结束后默认先询问是否清理，展示 diff 后再等待最终确认。

详情见 [SKILL.md](skills/debug-instrumentation/SKILL.md)。

---

### deep-investigation

调查公共事件、组织、人物、政策或商业议题。

报告区分已证实事实、当事方主张、推断和未知。

```text
$deep-investigation 调查某公司收购案：还原关键时间线、交易关系、争议证据与可能后续
```

近期或持续演变的事件会主动联网。可用子智能体时按事实、关系、反证分支独立调查后综合。

<details>
<summary>参数</summary>

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `<调查话题>` | 需要还原的事件、对象或争议；可包含时间、地域、主体和关注问题 | 必填 |

</details>

详情见 [SKILL.md](skills/deep-investigation/SKILL.md)。

---

### dockerhub-mirror

诊断 Docker Hub 拉取卡顿与失败。

检查范围包括网络、TLS、token 和限流错误。

获得授权后，工具可以探测和排序镜像候选。它也可以发现新候选或维护候选缓存。

```text
$dockerhub-mirror 排查 docker pull nginx:1.27 卡住的问题
node "skills/dockerhub-mirror/bin/dockerhub-mirror.mjs" --dry-run --image nginx:1.27
```

工具只输出建议的 `docker pull` 命令。它不修改 Docker daemon 配置，也不执行镜像拉取。

授权分两步：

1. 用户回复 `ok`，确认讨论结论。
2. Agent 展示计划，等待用户回复 `授权执行`。

两步结束前，只能使用 `--dry-run`。收到执行授权后，才可以运行写入缓存的模式。

<details>
<summary>参数</summary>

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `--dry-run` | 只读探测，不写入本地候选缓存 | 未授权时使用 |
| `--image <镜像>` | 为这个镜像引用生成替代 `docker pull` 命令；不参与探测 | 不传 |
| `--deep` | 额外探测首字节延迟与有限 Blob 吞吐量 | `false` |
| `--scrape` / `-f` | 发现新候选镜像源并写入缓存。必须先取得执行授权 | `false` |
| `--add` / `--remove` / `--retry-quarantine` | 维护缓存中的候选记录，同样需要写授权 | 无 |
| `--list` / `--quarantine` | 不联网列出 active 或隔离记录 | 无 |
| `--json` / `--verbose` | 输出机器可读 JSON，或附带原始指标 | 无 |
| `--config <path>` / `--timeout <ms>` / `--concurrency <n>` / `--max-age <days>` | 覆盖缓存路径、超时、并发与过期阈值 | 见 `config/defaults.json` |

内置探测固定使用 `config/defaults.json` 中的 `testImage`，与 `--image` 无关。

</details>

详情见 [README.md](skills/dockerhub-mirror/README.md)。

---

### engineering-method-selector

根据工程问题推荐方法组合，必须手动调用。

推荐依据包括工程活动、目标产物和质量属性。输出包含执行约束和证据验证方式。

```text
$engineering-method-selector 为订单系统增加退款能力，需求复杂且担心边界遗漏
$engineering-method-selector 排查线上偶发支付超时，日志不完整，如何选择排障方法
$engineering-method-selector 比较 CQRS 与 CRUD，重点看扩展性、性能和团队成本
```

默认只输出工程诊断卡，不主动执行改码、部署或生产变更；建议始终绑定可观察证据。

<details>
<summary>参数</summary>

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `[工程问题]` | 目标、上下文、约束、风险、阶段或待改进产物；可自然语言描述 | 无 |

</details>

详情见 [SKILL.md](skills/engineering-method-selector/SKILL.md)。

---

### ffmpeg-video-processing

通过 ffmpeg / ffprobe 处理音视频，包括压缩、转码、裁剪、缩放、变帧率、抽取音频、拼接、字幕烧录、水印与媒体检查。

```text
/ffmpeg-video-processing 把 input.mov 压缩成更小的 mp4，尽量保留清晰度
/ffmpeg-video-processing 把 video.mp4 裁掉前 5 秒并导出为 webm
/ffmpeg-video-processing 检查这个文件的编码、分辨率和时长
```

无显式参数，用自然语言描述处理目标。

本机缺少 `ffmpeg` 或 `ffprobe` 时，必须提供路径或确认下载。Skill 不猜测路径，也不静默换用其他编码器。

详情见 [SKILL.md](skills/ffmpeg-video-processing/SKILL.md)。

---

### gemin-mirror

操作 Gemini 或兼容镜像站：探查页面、切换账号与管理会话。必须复用已有 CDP 浏览器标签页，并先确认本次授权范围。

```text
$gemin-mirror 调查当前账号和账号面板，不做修改
$gemin-mirror 切换指定账号并唯一核验活动邮箱，列出当前会话数
$gemin-mirror 在已授权账号中删除全部会话，并生成审计记录
```

删除优先 API-first。账号证据、请求模板或刷新复核不通过时停止。

<details>
<summary>参数（按入口区分）</summary>

**API 入口**：`scripts/delete-sessions-via-api.mjs`

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `--expected-account <账号标识>` | 必填；与页面唯一活动账号证据精确匹配 | 无 |
| `--confirm-delete` | 实际删除的必填确认标记 | false |
| `--dry-run` | 核验账号、捕获请求模板并统计候选，不发送删除请求；仍会操作浏览器并写审计 | false |
| `--origin <URL>` / `GEMINI_MIRROR_ORIGIN` | 允许操作的页面 origin | 默认适配器 |
| `--at-global-path <路径>` / `GEMINI_MIRROR_AT_GLOBAL_PATH` | 覆盖 API 动态 `at` 的页面全局路径 | 默认适配器 |
| `--concurrency <数量>` / `--max-retries <次数>` / `--wait-ms <毫秒>` | API 删除的并发、重试与刷新等待 | 4 / 3 / 1200 |

**DOM 入口**（用户明确选择的回退）：`scripts/delete-current-account-sessions.mjs`

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `--delete-text <文本>` / `GEMINI_MIRROR_DELETE_TEXT` | 覆盖 DOM 删除按钮文案 | `删除` |
| `--chat-selector <CSS>` / `GEMINI_MIRROR_CHAT_SELECTOR` | 覆盖原生会话项选择器 | 默认适配器 |
| `--active-account-selector <CSS>` / `GEMINI_MIRROR_ACTIVE_ACCOUNT_SELECTOR` | 覆盖活动账号证据选择器 | 默认适配器 |
| `--login-failure-text <文本>` / `GEMINI_MIRROR_LOGIN_FAILURE_TEXT` | 覆盖登录失效文案 | `登录已失效` |

**通用**

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `--cdp <端口>` / `CDP_PORT` | 覆盖 CDP 端口 | `9696` |
| `--session <名称>` / `AGENT_BROWSER_SESSION` | 覆盖 browser session | 当前项目路径派生值 |
| `--audit <路径>` | 覆盖本地 JSONL 审计路径 | 系统临时目录 |
| `--confirm-delete-all` | 多账号入口 `delete-candidate-accounts.mjs` 的必填确认标记 | false |

运行时认证参数只在内存中使用。审计日志只记录账号短哈希。

</details>

默认适配器的站点契约见 [site-map.md](skills/gemin-mirror/references/site-map.md)，完整流程与审计规则见 [SKILL.md](skills/gemin-mirror/SKILL.md)。

---

### git-history-cleaner

清理 Git 仓库历史中的特定文件或目录以减小仓库体积。

```text
$git-history-cleaner --repo /path/to/repo --path bin/ --dry-run
$git-history-cleaner --repo /path/to/repo --path "*.log" --auto
```

改写历史会改变提交 ID。执行前会创建 `.git` 备份；检测到远程仓库时会提示后续需要手动 `git push --force`。

<details>
<summary>参数</summary>

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `--repo` | 仓库路径 | 当前目录 |
| `--path` | 要删除的路径模式；支持目录、精确路径和 glob | 必填 |
| `--dry-run` | 只分析历史，不创建备份、不改写历史 | false |
| `--auto` | 自动模式，无需确认 | false |

</details>

详情见 [SKILL.md](skills/git-history-cleaner/SKILL.md)。

---

### git-up

规划和执行 Git 提交，也可以维护 `.gitignore`。

提交计划可以先讨论、再调整。提交任务可以完全委派给一个子智能体。

简单、安全的 `-pc/-pcP` 任务自动采用快车道。

```text
/git-up --plan, -p      # 分析 diff，在会话中输出 YAML 提交计划
/git-up --discuss, -d   # 轻量讨论提交计划，最多 1-3 个关键问题
/git-up --modify <内容>  # 根据反馈调整计划并重新输出
/git-up --commit, -c    # 优先用 Python fast path 执行会话中的计划
/git-up --sub-agent, -s 仅提交 skills/git-up  # 委派一个子智能体执行 git-up -pc
/git-up --ignore, -i       # 自动识别技术栈，直接创建或增量维护 .gitignore
/git-up -l en --plan     # 使用英文输出计划、讨论问题和 commit message
/git-up                  # 直接生成 commit message
```

计划保存在对话上下文中。`-p` 与 `-c` 必须在同一会话。

`--push/-P` 必须与 `-c`、`-pc` 或 `-s` 组合。它不支持单独 push，也不自动创建 upstream。

`-s` 后的文字限定提交范围。子智能体无法满足范围要求时，必须停止。父智能体不得改为自行提交。

<details>
<summary>参数与模式</summary>

模式：plan / discuss / modify / commit / plan+commit / commit+push / plan+commit+push / sub-agent / sub-agent+push / ignore / default。

| 简写 | 等价 | 作用 |
|------|------|------|
| `-p` | `--plan` | 输出 YAML 提交计划 |
| `-d` | `--discuss` | 围绕计划逐个提出 1-3 个关键问题，每问给推荐答案 |
| `-c` | `--commit` | 执行会话中的计划 |
| `-P` | `--push` | 提交成功后 push |
| `-s` | `--sub-agent` | 创建子智能体同步执行 `git-up -pc` |
| `-i` | `--ignore` | 维护 `.gitignore` |
| `-l <zh\|en>` | `--lang` | 控制输出语言，默认 `zh` |

- `-pcP` / `--plan --commit --push` 一步规划、提交并 push。
- `-sP`、`-s -P`、`--sub-agent --push` 让子智能体执行 `git-up -pcP`。
- `-s` 不得与其他主模式混用，包括 `-p`、`-c`、`-d`、`--modify` 和 `-i`。它可以与 `-l/--lang` 组合。
- `-i` 自动识别 Node.js/Python 项目。它只增量加入高置信度规则，并附中文用途说明。
- `.env` 默认不纳入忽略规则。
- 指定技术栈参数时，只维护对应技术栈的规则。
- 自定义规则使用 `--add <规则> --reason <说明>`。
- `--clean` 只预览重复项。删除时必须同时传入 `--apply`。
- 网络或传输失败时，push 最多重试 3 次。
- 认证、权限、无 upstream 或 non-fast-forward 错误不重试。
- `-l/--lang` 影响计划说明、讨论问题、commit subject/body 和最终汇报；type/scope/emoji、文件路径和命令保持原样。

</details>

详情见 [README.md](skills/git-up/README.md)。

---

### handoff-portable

把当前任务交接给普通聊天窗口，生成单个可上传或粘贴的 Markdown 文件。

默认 `portable` 模式：提炼与任务相关的技能约束、全局规则和项目规则，并内嵌接续所需的资料。

```text
$handoff-portable 把当前任务的上下文交接给普通聊天窗口
$handoff-portable 用 skill name 模式交接，只列技能名
```

```text
python <skill-dir>/scripts/portable.py build manifest.json --output HANDOFF.md
python <skill-dir>/scripts/portable.py verify HANDOFF.md
python <skill-dir>/scripts/portable.py check manifest.json
```

接收方先核对理解，再等待用户指示。接收方不会自动继续原任务。

`build` 自动跑一次语义体检，`check` 可单独预检。退出码：`0` 成功无警告；`2` 成功但有警告，需人眼判断；`1` 失败。`build` 有警告仍退出 `0`（文件已产出），`verify` 与 `check` 有警告退出 `2`。

<details>
<summary>参数</summary>

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `[模式]` | `portable` 提炼任务相关约束正文；`skill name` 只列技能名 | `portable` |
| `[输出路径]` | 交接文件保存位置 | 系统临时目录下的独立目录 |
| `[语言]` | 交接描述语言 | 中文 |

表里是调用 skill 时的选择项；脚本的命令行参数见 [格式与脚本接口](skills/handoff-portable/references/package-format.md)，其中 `--output` 为必填。

- `portable` 模式保留强制要求、条件、例外、授权边界和适用范围。摘录精炼结果，不复制技能原文。
- `skill name` 模式只输出 `<skill name="…" />`。接收方无法据此恢复约束正文，缺失会明确写出。
- `verify` 解析段落配对、顺序、内容与技能标签形态。代码围栏内的同名文本不算标签。CRLF 行尾自动归一化。
- `build` 只在 manifest 硬校验不通过时拒绝产出。产出结构自检只发警告，文件照常写出，由 `verify` 决定是否放行。
- 脚本只做结构与一致性检查并检测意外改动。不证明语义正确、来源穷尽或脱敏充分。
- 语义体检只警告不阻断：技能列表为空、被丢弃的约束正文、声明范围与正文长度不符、源文件比采集时间新、疑似未脱敏凭据。
- 凭证和不必要个人信息替换为 `[REDACTED:原因]`。
- 平台隐藏的系统提示词和隐藏推理不提取、不重构。

</details>

详情见 [SKILL.md](skills/handoff-portable/SKILL.md)。

---

### joint-debugging

用于手动协调本地、远程、容器、代码与接口的技术联调、故障诊断、验证和修复。

```text
$joint-debugging 排查登录接口在容器环境中偶发超时，并按证据链提出最小修复与验证步骤
```

每次回复以 `主线：第 n/total 轮｜当前阶段` 开始；严格按环境基线、证据分级、授权范围、脱敏和验证标准推进。

<details>
<summary>参数</summary>

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `[待处理事项]` | 联调、诊断、验证或修复协调目标；不传时仅询问目标 | 无 |

</details>

详情见 [SKILL.md](skills/joint-debugging/SKILL.md)。

---

### lite-team

手动角色协作，按需用 BBS 协作板交接；不自动编排、不自动读取。调用全用自然语言：

```text
切换到开发角色
给测试 Agent 留一条交接：登录异常分支已完成，需验证错误凭证、重复提交和超时。
切换到测试角色（或"假设你是测试"）
读取协作板
任务结束，帮我归档
```

> 嫌长可用极简词：`role <角色名>` / `bbs init|read|write` / `done`，与上述说法等价。它们是对话简写，**不是**注册的 slash 命令或 skill 参数。

不得在 BBS 写入密钥或 Token。协作板会纳入 Git 版本管理。

- `message` 最多 7 条。
- `history` 最多 9 条。
- 每条历史摘要不超过 120 字。

<details>
<summary>脚本命令（Python 3 ≥ 3.8，统一用 <code>python3</code>）</summary>

| 命令 | 说明 |
|------|------|
| `init` | 初始化协作板 |
| `add` | 写入一条交接（自动生成 id，守 7 条上限与 500 字软约束） |
| `status` | 查看消息数量 |
| `clear --yes` | 清空当前消息，保留历史 |
| `archive --summary` | 确认归档后写入历史 |

</details>

详情见 [README.md](skills/lite-team/README.md)。

---

### nano-prompt

AI 图像提示词生成，基于 Nano Banana Pro 的核心提示技巧，输出 YAML 格式的分层提示词结构。

```text
/nano-prompt 一个赛博朋克女孩在霓虹雨夜中行走
/nano-prompt 宫崎骏风格的中国古建筑风景
```

无显式参数，直接描述画面。

输出使用分层 YAML。字段包括创意、光线、氛围、环境、相机、颜色、纹理、风格、细节和负面提示。

详情见 [SKILL.md](skills/nano-prompt/SKILL.md)。

---

### network-debug

手动触发的跨平台网络故障诊断技能，按分层证据定位首个失败边界。

```text
$network-debug 排查当前主机访问目标 API 的 DNS、TCP、TLS 与代理问题
```

无显式参数。调用时描述平台、目标、现象和错误信息。

Skill 必须手动调用，默认用中文回复。命令和技术标识保留英文原文。技术标识包括错误串、协议名、产品名、配置键和路径。

详情见 [SKILL.md](skills/network-debug/SKILL.md)。

---

### npm-license-declaration

为前端项目的直接 npm 依赖生成许可证声明，固定输出到 `docs/npm-license-declaration.md`。

```text
$npm-license-declaration 为当前项目生成 npm 第三方依赖许可证声明
$npm-license-declaration 检查 E:\project\portal，并输出 docs/npm-license-declaration.md
```

无显式参数。依赖范围是 `dependencies` 与 `devDependencies`。Skill 对依赖去重排序后，查询 npm Registry 的 latest 元数据。

查询失败时，只使用 lock 文件中的原始 `resolved` URL 兜底。

许可证未知或未纳入内置分级时，包被标为「⚪ 不可用」。这些包必须手动核实。

详情见 [SKILL.md](skills/npm-license-declaration/SKILL.md)。

---

### ntl-script-descriptions

为包含 `package.json` 的项目补充 `ntl` 可读取的 scripts 中文说明，写入 `package.json#ntl.descriptions`。

```text
$ntl-script-descriptions 帮这个前端项目补齐 package scripts 的中文说明，给 ntl 用
$ntl-script-descriptions package.json 里已有 ntl.descriptions，不要覆盖，只补缺失项
```

无显式参数。默认保留已有说明，覆盖所有 scripts（包括 `pre*` / `post*`），写入后校验 JSON 并输出新增、保留、冲突和孤儿说明清单。

详情见 [SKILL.md](skills/ntl-script-descriptions/SKILL.md)。

---

### pro-grilling

手动讨论复杂目标、依赖、风险和取舍。

每轮只问一个最影响后续判断的问题。Agent 可以执行低成本的只读核验。用户决定目标、偏好、优先级和关键取舍。

用户确认 `ok` 前，不得执行实际操作或输出最终方案。

```text
$pro-grilling 评估是否把现有单体前端拆成微前端，并厘清迁移边界
$pro-grilling 我们要重做登录态方案，但先把安全、兼容和上线风险讨论清楚
```

Codex 使用 `$pro-grilling` 显式调用。调查档位为「直接继续 / 快速核验 / 充分调查」，只有结论或后续路径可能改变时才会询问选择。

<details>
<summary>参数</summary>

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `[待讨论事项]` | 需要逐层澄清的计划、决策或复杂任务；不传时会先询问事项 | 无 |

</details>

详情见 [SKILL.md](skills/pro-grilling/SKILL.md)。

---

### progressive-doc

创建、改写或审查中文技术文章。

文章分两层：速览提供行动依据，正文展开证据、机制和适用边界。

```text
$progressive-doc 写一篇面向后端工程师的 Redis 缓存一致性教程
$progressive-doc 审查这篇事故复盘，标出证据缺口和未核验论断
```

事实不足时会标注未知、推断与建议，不补造证据。

<details>
<summary>参数</summary>

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `[文章任务]` | 科普、教程、调查、对比、架构分析、事故复盘或观点文章的创建、改写与审查需求 | 必填 |
| `[目标读者]` | 读者角色与技术水平；会影响文章结构和技术深度 | 根据上下文推断 |
| `[交付范围]` | 大纲、初稿、改写、审查或发布后复盘 | 根据请求判断 |

</details>

详情见 [SKILL.md](skills/progressive-doc/SKILL.md)。

---

### project-self-memory

非简单项目任务开始时，读取相关项目记忆。

任务结束后，只保存经过验证且可以复用的结论。记录范围包括事实、长期决策和避坑经验。

```text
$project-self-memory -g
$project-self-memory -r
$project-self-memory -t
$project-self-memory -c
$project-self-memory -a
$project-self-memory -a -c
$project-self-memory -g -r
$project-self-memory -l
```

Codex 用 `$` 前缀显式调用；Claude Code 用 `/` 前缀（`/project-self-memory -c`）。自然语言请求同样生效。

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `-g` / `--grilling` | 逐问盘点新增、修订、合并、冲突和迁移候选 | 显式调用或自然语言要求盘点时进入 |
| `-r` / `--rate` | 讨论本会话实际使用、有结果且尚未评分的记录 | 每条每会话最多评分一次 |
| `-t` / `--trim` | 清理负分占优的记录；可保留、修订、设为 review/disabled 或删除 | 只处理 `positive - negative < 0` 或 `negative >= 3 && negative >= positive` |
| `-c` / `--cache-write` | 处理自动暂存区（cache）里的待处理候选，逐条决定入库或丢弃 | 显式调用时进入；候选入库的唯一入口 |
| `-a` / `--stage-candidate` | 把本次会话的结论逐条暂存进 cache（`cache add`），记忆库保持不变 | 显式调用或自然语言要求「先攒起来」时进入；本次任务收尾时按 `auto_save` 自动暂存 |
| `-a -c` | 先暂存本次会话的候选，再逐条处理暂存区 | 一次调用里连用，暂存完立即处理 |
| `-g -r` / `-r -g` | 组合策展与评分，共享讨论进度 | 参数顺序不影响进度 |
| `-l` / `--load` | 显式读取：小库直接读，大库先查目录再按分组精读 | `auto_load: true` 时自动读取 |
| `--no-load` / `--no-save` / `--no-rate` | 仅本次任务关掉自动读、自动存或自动评分 | 任务级覆盖优先于会话级与配置 |
| `--no-load-session` / `--no-save-session` / `--no-rate-session` | 本次会话内持续关掉对应自动行为 | 本次任务收尾后失效 |

讨论量默认预计约 3 轮、复杂时可展开；以结论和具体操作授权为准，详见 [讨论轮次与结束条件](skills/project-self-memory/SKILL.md#讨论轮次与结束条件)。

活动目录固定为 `.project-self-memory/`；`self-memory/` 仅能通过 `legacy` 命令只读迁移。所有命令均可附 `--project-root <path>`。不记录凭据、个人数据、易失机器状态或未经验证推断。

CLI 脚本随 skill 安装，路径与当前工作目录无关：Codex 装在 `.agents/skills/project-self-memory/`，Claude Code 装在 `.claude/skills/project-self-memory/`。下面的示例用 `<skill-path>` 表示该目录。

```text
node <skill-path>/scripts/memory.mjs init
node <skill-path>/scripts/memory.mjs read --type pitfall
node <skill-path>/scripts/memory.mjs add --type fact --content-file conclusion.txt
node <skill-path>/scripts/memory.mjs --project-root E:\repo diagnose
node <skill-path>/scripts/memory.mjs tags show
node <skill-path>/scripts/memory.mjs tags suggest
node <skill-path>/scripts/memory.mjs tags stats
node <skill-path>/scripts/memory.mjs read --tag host_scope:tenc,component:api
node <skill-path>/scripts/memory.mjs catalog --by tag
node <skill-path>/scripts/memory.mjs cache list
node <skill-path>/scripts/memory.mjs cache show <id>
# 以下为显式写入，先确认具体分类标准或修正内容
node <skill-path>/scripts/memory.mjs cache apply --id <id> --decision write
node <skill-path>/scripts/memory.mjs tags apply --plan-file taxonomy.json
node <skill-path>/scripts/memory.mjs tags set 0001 --add component:api --remove host_scope:tenc
```

活动目录固定为 `.project-self-memory/`；`self-memory/` 仅能通过 `legacy` 命令只读迁移。所有命令均可附 `--project-root <path>`。不记录凭据、个人数据、易失机器状态或未经验证推断。

<details>
<summary>命令族</summary>

| 命令 | 说明 | 默认值 |
|------|------|--------|
| `init` / `validate` / `diagnose` | 初始化、严格校验、输出库健康摘要 | 当前项目根目录 |
| `read` / `catalog` / `inspect` | 人读的 active 经验、分类目录、维护 JSON | `read` 仅 active；`catalog` 默认旧分组 |
| `tags show` / `tags suggest` / `tags stats` | 只读查看分类标准、生成前缀与词频提案、统计覆盖率 | 不联网、不自动采纳提案 |
| `tags apply --plan-file <file>` | 显式应用完整 taxonomy JSON（取提案的 `taxonomy` 对象，不是整个提案） | 用户授权后加锁、备份旧文件、原子替换 |
| `tags set <id> --add <csv> --remove <csv>` | 为现存记录维护标签 override；逗号分隔，至少传一项 | 不改正文或评分版本 |
| `read --tag <csv>` | 多标签任一匹配；与 ID、类型、旧分组筛选取交集 | 不传时不过滤无标签记录 |
| `catalog --by tag` | 标签目录 `{name, count}[]`，只统计有效 active 记录 | 不传时保持旧分组目录 |
| `add` / `update` / `status` / `delete` | 用文件或 stdin 传正文维护记录 | ID 永不复用 |
| `score` / `merge` / `groups` / `legacy` / `config` | 评分、合并、兼容旧分组与迁移、自动行为配置 | 新分类推荐标签，不自动迁移 group |
| `cache add --op <op> [--target <id>] [--content-file <f>] [--record-type <t>] [--group <g>] [--source <s>] [--evidence-json <json>]` | 追加待处理候选；`op` 为 `add`/`update`/`delete`/`+1`/`-1` | 自动流程只暂存不落库；同会话同操作幂等 |
| `cache list` / `cache show <id>` | 列出待处理分组候选（含失效标记）/ 查看单条与目标正文快照 | 只列 `pending` |
| `cache discard <id>` / `cache apply --id <id> --decision write\|discard [--content-file <f>]` | 丢弃单条 / 落库或丢弃单条；`--content-file` 是「改写后写入」的正文 | 候选入库的唯一入口 |
| `cache prune [--older-than <N>d]` | 清理已处理与已失效条目 | `pending` 候选无 TTL，不自动过期 |
| `migrate-schema` | v1 明确报告无可迁移前版；未知版本拒绝 | 当前格式为 v1 |
| `viewer install` / `viewer update` / `viewer status` | 部署、按官方哈希升级、检查紧凑查看器 | 随 `init` 自动安装 |

命令的 JSON 输出和退出语义见 [cli-contract.md](skills/project-self-memory/references/cli-contract.md)。新写入正文必须单行（宿主按内置 STE 表达契约改写，CLI 校验；历史多行记录保持可读），错误带 `PSM_CONTRACT` 前缀；`MemorySession` 首次召回超过 37,000 估算 token 时发非阻断提醒。规则见 [expression-contract.md](skills/project-self-memory/references/expression-contract.md) 与 [memory-format.md](skills/project-self-memory/references/memory-format.md)。

标签按项目自身的分类标准读取时派生，每条最多 8 个；缺少或空白 `tags.json` 仍识别正文行首 `[key=value]` / `[key=v1,v2]`，损坏则全部标签关闭并报告 warning，不阻断其他功能。标签参与显式筛选（`read --tag`）与只读归因观测，**不参与检索 rank 排序**；显式标签筛选会排除未匹配记录。格式与规则见 [memory-format.md](skills/project-self-memory/references/memory-format.md)。

</details>

紧凑查看器（支持标签多选任一匹配、按首标签分组；标签只读，正文/类型/状态可编辑）：

```text
node .project-self-memory/view-memoery.js
```

输出带 `#token=` 的本机地址；只监听 127.0.0.1；令牌只在进程与页面内存中；默认自动用系统默认浏览器打开（`--no-open` 可禁止）。写入带备份、原子替换与乐观并发。暂存区可在查看器中查看、编辑并入、丢弃、清理。详见 [viewer.md](skills/project-self-memory/references/viewer.md)。

| 查看器参数 / 环境变量 | 说明 | 默认值 |
|------|------|--------|
| `--port <N>` | 监听端口，整数 `0..65535`；`0` 自动分配 | `0` |
| `--no-open` / `PSM_VIEWER_OPEN=0` | 禁止自动打开浏览器，适用于无头环境 | 自动打开 |
| `PSM_VIEWER_OPEN=echo` | 仅打印待打开地址，不执行浏览器命令，用于诊断 | 不设置 |

详情见 [README.md](skills/project-self-memory/README.md)。按「你的意图」组织的使用指南见 [使用指南](docs/teach/project-self-memory/lessons/0001-psm-usage-guide.html)。

---

### rd-mode

远程开发模式规则，约束 host/server 协作并统一通过 `abc` 命令操作 host 浏览器（CDP）。

```text
rd-mode --init   # 首次使用，问答补全 RHost / CDP_PORT，写入 ~/.config/rd-mode/.env
```

<details>
<summary>参数</summary>

| 参数 | 说明 |
|------|------|
| `--init` | 生成本地配置（`RHost`、`CDP_PORT`） |

</details>

host/server 架构、`abc` 用法与故障排查见 [README.md](skills/rd-mode/README.md)。

---

### software-license-checker

评估软件在企业内部使用场景下的许可证、授权与潜在付费要求。结论是公开信息基础上的合规预警，不构成正式法律意见。

```text
$software-license-checker 检查 FFmpeg 是否可以在企业内部使用
$software-license-checker TensorFlow 企业内部研发使用是否需要付费
```

无显式参数，直接描述待评估的软件与使用场景即可。只覆盖公司内部安装与使用；SaaS 对外服务、嵌入产品分发、OEM 与转售不在范围内。

详情见 [README.md](skills/software-license-checker/README.md)。

---

### subagent-router

为并行任务、上下文隔离、模型路由或独立复核创建临时子 Agent。

工具仅通过原生 `native_spawn` 创建子 Agent。默认先展示预览，再等待用户准确回复 `okok`。它不要求创建 `.codex/agents/*.toml`。

```text
$subagent-router -t 调查登录失败的前后端原因，并独立复核修复方案
$subagent-router -gs 讨论支付模块迁移的边界、风险和验收方式
$subagent-router -l 并行梳理项目结构、检查缺陷并分析测试覆盖
$subagent-router -f -t 直接实施已明确的多 Agent 修复任务，跳过 okok 确认
```

- Luna 只能作为不派生子 Agent 的末级子 Agent。
- Terra、Sol 可以在预览中的额度内继续派生。
- 所有策略默认最多创建 5 个临时子 Agent。

模型、范围、权限、验证或额度发生实质变化时，必须重新展示预览。用户必须再次单独回复 `okok`。

<details>
<summary>参数</summary>

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `[任务]` | 待评估、调度或讨论的工作事项 | 无 |
| `-l` / `--luna` | 成本优先；优先窄范围 Luna 叶节点工作 | 默认策略 |
| `-t` / `--terra` | 平衡策略；适合普通实现、测试和需要嵌套的任务 | 无 |
| `-s` / `--sol` | 质量优先策略；提高 Sol 与复核倾向，而非强制全部使用 Sol | 无 |
| `-g` / `--grilling` | 先进入单问题、只读调查讨论门禁 | 关闭 |
| `-f` / `--fast` | 跳过用户 `okok` 确认；不绕过范围、权限、验证或 delegation envelope 校验 | 关闭 |
| `-gl` / `-gt` / `-gs` | 同时记录讨论完成后的路由策略 | 无 |

辅助脚本：`node skills/subagent-router/scripts/route-decision.mjs --help`（预览派生决策）、`validate-worker-contract.mjs --help`（校验 Worker 契约）、`verify-router-skill.mjs --help`（静态检查）。

</details>

详情见 [README.md](skills/subagent-router/README.md)。

---

### tool-evaluator

根据用户目标、环境、硬约束和长期风险，调查、比较或探索筛选软件、服务和开发工具。

```text
$tool-evaluator 比较 uv、Poetry 与 PDM：Windows 开发、团队锁定依赖、需要 CI 自动化
$tool-evaluator 推荐可自托管的 API 文档平台：开源、Docker 部署、支持 OpenAPI，维护成本要低
```

支持指定候选比较和探索筛选两种模式。

先检查硬性门槛（Gate），淘汰不合格方案。通过者按证据等级（L1/L2/L3）和场景权重比较。敏感性分析检查权重变化是否改变结论。

未经明确授权，只提供概念验证（POC）方案。不得安装或运行候选工具。

<details>
<summary>参数</summary>

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `<候选工具或需求>` | 已指定的候选列表，或用于探索筛选的目标、环境与约束 | 必填 |

</details>

详情见 [SKILL.md](skills/tool-evaluator/SKILL.md)。

---

### tutor-man

用自适应的费曼式掌握等级，快速掌握工具、概念、方法或混合主题；默认从 `L4` 开始。

```text
$tutor-man L4 Docker
$tutor-man L3+L5 Git rebase
$tutor-man L2 一步一步讲清 HTTP 缓存
```

默认用中文回复。`L3`–`L5` 默认包含一次轻量掌握检查。

涉及以下知识时，Skill 先核验当前资料：

- 版本快速变化的知识。
- 当前实现。
- 存在争议的知识。

<details>
<summary>参数</summary>

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `[L1-L5]` | 目标掌握等级；等级决定所需能力和验证深度，不等同于篇幅 | `L4` |
| `[Lx+Ly]` | 对比两个掌握等级，先建立较低等级基线，再说明能力增量 | 无 |
| `[主题]` | 要学习的工具、概念、方法或混合主题 | 必填 |
| `一步一步` / `全部讲完` / `只讲原理` / `跳过验证` | 调整教学节奏、范围或验证方式的自然语言要求 | 按默认流程 |

</details>

详情见 [SKILL.md](skills/tutor-man/SKILL.md)。

---

### website-state-sync-agent

用于在已打开或临时隔离的 Chrome 实例之间迁移加密网站 Cookie、`localStorage` 和 `sessionStorage`。

```text
$website-state-sync-agent 导出当前页面状态
$website-state-sync-agent 将来源 CDP 的登录态同步到目标页面
```

运行配置只从环境变量读取。默认密码 `1599` 只适合本地快速验证，共享或生产环境必须显式设置 `WEBSET_STATE_SYNC_PASSWORD`。

<details>
<summary>参数</summary>

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `export --url <url>` | 从动态提供的页面 URL 导出加密状态包 | 无 |
| `import <file> --url <url>` | 将加密状态包合并写入目标页面 | 无 |
| `sync --source-cdp <url> --source-url <url> --target-cdp <url> --target-url <url>` | 在两个 CDP 浏览器页面之间同步状态 | 无 |
| `WEBSET_STATE_SYNC_PASSWORD` | 状态包加密与解密密码 | `1599`（建议显式设置） |
| `WEBSET_STATE_SYNC_CDP_URLS` / `WEBSET_STATE_SYNC_CDP_URL` | CDP HTTP 服务地址 | 无 |

</details>

来源仓库：[ccwq/website-state-sync-tools-cat](https://github.com/ccwq/website-state-sync-tools-cat)。详情见 [SKILL.md](skills/website-state-sync-agent/SKILL.md)。

---

### wechat-headlines

根据正文、要点、链接或文件生成与优化微信公众号标题。

默认提供六条不同方向的候选，并推荐其中一条。

```text
$wechat-headlines 根据这篇正文生成标题：<粘贴正文或要点>
$wechat-headlines https://example.com/post/123  （按链接正文起标题）
$wechat-headlines 更短、更尖锐一些，换三个方向  （按反馈迭代）
```

无显式参数，直接提供本次材料与要求。材料可以是正文、要点、链接或文件。

默认先给初稿，再按反馈调整。输入为链接时，只读取目标内容，不扩展外部资料。

标题承诺必须在正文中兑现。不得虚构实测与效果。

详情见 [SKILL.md](skills/wechat-headlines/SKILL.md)。

---

## 维护主分组

`npx skills add ccwq/ccwq-skill-list` 的交互选择器会把 `.env` 中 `MAIN_LIST` 列出的 Skill 放在 `ccwq-skill-list` 主分组；其余已发现的 `skills/*/SKILL.md` 自动归入 `Other`。

链路是 `MAIN_LIST` → 同步脚本 → `.claude-plugin/plugin.json` → 外部 `skills` CLI。安装端消费的是生成的 `plugin.json`，不是 `.env`。

修改清单后执行：

```bash
npm run sync:main-skills
npm run check:main-skills
```

`MAIN_LIST` 是逗号分隔的 Skill 名列表，必须指向存在的 `skills/<name>/SKILL.md`。生成文件 `.claude-plugin/plugin.json` 不手工编辑。

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
