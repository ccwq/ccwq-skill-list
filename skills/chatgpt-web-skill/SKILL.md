---
name: chatgpt-web-skill
description: 通过 ChatGPT Web 进行信息搜集、Deep Research、图片生成编辑、结构化视觉审查和统一经验整理。
license: MIT
metadata:
  version: 1.15.0
  tags: [chatgpt, chatgpt-web, agent-browser, image-generation, image-editing, visual-review, research]
  related_skills: [agent-browser]
---

# ChatGPT Web 图片工作区 / Image Workspace

## 适用范围 / Scope

本 skill 依赖 `agent-browser` skill 与其 CLI 操作 ChatGPT Web UI；不提供独立的浏览器自动化实现。`agents-op` 指 **ChatGPT Web Project**，不是本地 Git/workspace 项目；它是图片生成与编辑的指定工作区，也可用于聊天、图片审阅、网页研究和讨论。

优先通过 `scripts/run_agent_browser.py` 调用 `agent-browser` CLI，统一传递 session 和 CDP 配置。ChatGPT Web 任务必须连接已登录的既有浏览器，禁止在未配置 CDP 时启动新的浏览器会话；项目 `.env` 默认提供 `AGENT_BROWSER_CDP_PORT=9696` 和 `AGENT_BROWSER_USE_DEFAULT_CDP_SESSION=1`。在该模式下省略自定义 `--session`，复用 CDP 默认 daemon；调用期显式 `--cdp` 或环境变量可覆盖端口。没有默认 CDP daemon 时应报告阻断，不创建新浏览器。会话名默认取当前项目绝对路径去除 `/` 后的字符串（非 CDP 默认 daemon 场景），截图保存到 `%temp%\agent-browser-captures\`。先枚举现有 tabs；目标 URL 已打开时复用该 tab，不要重复打开。tab ID 只在当前 daemon 生命周期内有效：看到 `daemon version mismatch`、daemon restart 或 tab 切换失败时，立刻重新执行 `tab list`，废弃旧 ID 与旧 lease，不按编号猜测替代 tab。例如：

```powershell
python scripts/run_agent_browser.py tab list
python scripts/run_agent_browser.py --cdp <configured-port> snapshot -i
```

此 skill 的全部业务动作都在 ChatGPT Web 对话内完成；不把它用作直接浏览、抓取或自动化外部网站的通用工具。普通讨论可直接在 chat 中进行。只有确有必要使用 ChatGPT Web 的 Search 或 Deep Research 时，发送前先向用户说明理由并取得本次明确授权；未获授权则继续普通对话，或报告信息边界。

## 经验演进 / Evolution Memory

每次触发此 Skill 后、任何浏览器操作前，都通过 `experience_memory.py read` 读取**统一经验库**。文件永久位于 Windows `%USERPROFILE%\.config\chatgpt-web-skill\experience.md` 或 macOS/Linux `~/.config/chatgpt-web-skill/experience.md`；文件不存在时返回有效空库且不创建文件。禁止枚举、读取、迁移、重命名或删除旧临时经验文件，也不得手动编辑统一经验库。

经验文件由脚本独占维护，固定头为：

```markdown
# chatgpt-web-skill 经验库
Skill-Version: 1.15.0
Entry-Count: 0
```

仅在任务结论已验证后、最终汇报前运行 `append --group <group>` 追加脱敏条目；每条经验只能属于一个分组。脚本 warning 使用稳定 code 与上下文：`version_mismatch` 或 `experience_limit_exceeded`（实际条数大于 50）只提示 trim，不阻断任务；`entry_count_mismatch` 会拒绝普通追加，需 trim 修复。Agent 收到任一 warning 必须立即向用户给出中文友好提醒。不记录 prompt、图片、chat 内容、账户标识、cookie、私有 URL 或凭据。

### 经验整理：`-t` 和 `--trim`

使用 `-t` 或 `--trim` 时，整理统一经验库；可追加主题，裸参数处理全部经验。此模式只处理既有经验，不新增条目。

1. 先运行 `experience_memory.py read --full`，读取全量经验，并核验本地 `SKILL.md`、`scripts/` 与 `references/`。默认可接入已有 CDP 浏览器，复用现有 ChatGPT tab 做实时 snapshot 的只读核验。
2. 按主题逐问展示“保留 / 改写 / 合并 / 删除 / 本轮未证实”建议及其证据。只读核验不足时，先展示主动验证计划、影响和成功判据；用户确认该主题后，才可创建专用 chat、发送最小测试 prompt，并使用既有浏览器核验脚本。
3. 主动验证默认不生成图片、不上传内容、不改 Project 设置、不触发付费/权限；这些操作均需用户在该轮额外明确授权。无法取得更强当前证据的条目归为“本轮未证实”并保留。
4. 所有主题达成共识且用户明确回复 `ok` 后，生成含全部原始条目处理结果的 JSON 计划，并通过脚本原子写回。删除、改写和合并必须带已验证证据；改写或合并保留最早“首次记录日”，并写入“最近核验”。

```powershell
# 仅在用户确认最终计划后执行；计划中每个 source_indexes 必须恰好出现一次。
python scripts/experience_memory.py trim --plan <confirmed-plan.json> --confirm ok
```

完成条件：全库的每条原始经验都被恰好归为保留、改写、合并、删除或本轮未证实；改写、合并和删除必须附非空 `evidence`。只有全库 trim 成功才更新文件 `Skill-Version` 并重算 `Entry-Count`。

## 经验收敛 / Experience Promotion

把每条已验证经验按稳定性分流，避免以自然语言反复执行机械步骤：

- 对跨页面和跨任务不变、可观察且无副作用的步骤，先为 `scripts/` 增加标准库 Python 辅助逻辑和离线单元测试，再在 skill 中调用脚本。
- 对依赖当前页面、角色、Project 或构图的判断，只记录为现场线索；继续使用实时 snapshot、DOM 和截图核验，不把 selector、ref、tab ID 或私有 URL 写死到脚本。
- 对账户、单次任务或未复现的现象，只留在统一经验库；未获得明确确认时不据此修改 `SKILL.md`。

当前可直接复用的辅助脚本：

```powershell
# 返回至少两条 Project 实时归属证据，否则退出码为 1。
python scripts/runtime_checks.py --cdp <configured-port> --tab <tab-id> project --name agents-op

# 每轮先检查快照；一旦图片已可见就立即截图并返回，不再空等尺寸轮询。
python scripts/runtime_checks.py --cdp <configured-port> --tab <tab-id> images --min-width 1000 --screenshot <temp-path>

# 确认 marker 已离开 composer 并渲染；认证中断会以退出码 2 停止。
python scripts/runtime_checks.py --cdp <configured-port> --tab <tab-id> message --marker <unique-marker>

# 由当前 sidebar 的真实 Project 行定位并点击主页，再返回实时 URL 和双证据；不拼接 URL 或请求 backend-api。
python scripts/project_locator.py --cdp <configured-port> --tab <tab-id> --name agents-op

# 无可复用 ChatGPT tab 时，通过 agent-browser 新建任务 tab 后定位；终态必须 release 输出的 lease。
python scripts/project_locator.py --cdp <configured-port> --new-tab --name agents-op

# 读取、原子追加或按已确认计划整理统一的脱敏经验。
python scripts/experience_memory.py read
python scripts/experience_memory.py status
python scripts/experience_memory.py append --group <group> --topic <topic> --scene <scene> --conclusion <conclusion> --boundary <boundary>
python scripts/experience_memory.py trim --plan <confirmed-plan.json> --confirm ok
```

任务 tab 的稳定生命周期使用 `browser_task.py`：

```powershell
python scripts/browser_task.py acquire <url> [--force-new]
python scripts/browser_task.py status <lease-path>
python scripts/browser_task.py action <lease-path> -- click '@e123'
python scripts/browser_task.py release <lease-path> [--purge]
```

`acquire` 默认只复用规范化后完整 URL 精确匹配的 tab；回归测试使用 `--force-new`。lease 记录 session、可选 CDP、稳定 tab ID 和是否由本次创建；它不跨 daemon restart 生效。`release` 只关闭 `created=true` 的 tab，并重新执行 `tab list` 确认其消失；复用 tab 不关闭。`action` 允许透传任意 agent-browser 子命令，但会在动作前后重新选择 lease tab 并保存 snapshot。动作后的 snapshot 失败会标记 lease 为 `uncertain`，不会覆盖动作本身的退出码。发生 daemon restart 或 `status` 返回 stale 时，终止旧 lease、重新获取并重新验证 Project，不能把新 tab 的数字 ID 写回旧 lease。lease、snapshot 和截图保存到 `%temp%\agent-browser-captures\chatgpt-web-skill\`；默认不清理证据，只有显式 `--purge` 才删除已验证的专用 lease 目录。

`runtime_checks.py` 只机械判定 Project 证据、消息提交状态和图片可见性/尺寸；它不能授权持久化操作、选择动态控件或替代截图质量审阅。

## 路由契约 / Routing Contract

每次任务按以下顺序执行；每项完成后才进入下一项：

1. 使用当前项目对应的 agent-browser session；按已有 CDP 配置决定是否接入既有浏览器。先枚举 tabs，优先复用 ChatGPT tab；没有可复用 tab 时，可通过 `project_locator.py --new-tab --name agents-op` 创建。它经 `browser_task.acquire(... --force-new)` 调用 agent-browser `tab new`，在 skill `.env` 的 `CHATGPT_PROJECT_LOCATOR_NEW_TAB_TIMEOUT_SECONDS=30` **共享总预算**内依次等待 sidebar 与 Project 证据渲染；超时或失败会释放本次新建 tab，成功才返回稳定 `tab_id`、`created_tab=true` 和 lease。把该 ID 传给每个 `run_agent_browser.py --tab` 与 `runtime_checks.py --tab` 调用，终态用 `browser_task.py release <lease>` 关闭新建 tab。
   对需要跨多条命令的任务，优先通过 `browser_task.py acquire` 获取 lease；真实回归使用 `--force-new`，普通任务按精确 URL 复用。
2. 若当前 tab 尚未在目标 Project 首页，运行 `project_locator.py --name agents-op`：它从当前 sidebar 的实时 DOM 精确匹配 Project 行、点击同一行的 `Open project home`，再读取浏览器实际导航得到的 URL。不得预存、拼接或从 `/backend-api/*` 推导 Project URL。随后运行 `runtime_checks.py project --name agents-op` 并结合实时 snapshot，确认页面是 ChatGPT Web 且 Project 名为 `agents-op`。禁止相信旧 tab ID、旧 URL 或记忆中的页面文本。
3. `agents-op` 不存在时，先报告并请求创建 Project 的持久化状态授权；存在时直接使用，名称重复也以实时证据选择正确 Project。
4. 为当前任务在 `agents-op` 内新建 chat；以当前 session 和 tab 作为本次任务的最小隔离边界。
5. 终态（成功、取消、平台阻断或不可恢复失败）关闭**本任务创建的** tab，重新枚举 tabs 并确认其消失；复用的既有 tab 不关闭。

可接受的 Project 实时证据至少两项：页面 title 含 `agents-op`、**Project 首页** URL 以 `/project` 结尾、composer 标注/placeholder 为 `New chat in agents-op`、页面内容表明该 Project 的 chats/sources。Project 内既有对话通常为同一路径下的 `/c/<chat-id>`，不能要求其以 `/project` 结尾。无法确认归属时，诊断并报告，不在普通 Chat 或其他 Project 静默执行。

## 变更授权 / Authorization Boundaries

以下会改变持久化 ChatGPT 状态，未获本次明确授权时停止并书面报告：编辑/清空 Project instructions（`textarea#instructions`）、切换 Library access/Memory 等设置、重命名/分享/置顶/删除 Project 或 chat、批准付费/权限/订阅弹窗、上传到当前项目 chat 以外的位置。`visual-review` 调用仅授权在当前任务 chat 上传本次指定的一张图片和发送固定审查提示词；不授权删除或修改任何 chat。只读页面探测与视觉核验默认允许。

不把未文档化的 `/backend-api/*` 当成稳定自动化 API；只用浏览器 UI/CDP DOM 与当前页面已渲染资源。不得输入凭证、处理付款订阅或批准权限；遇到平台 policy/block 如实报告，不尝试绕过。

### 后台请求观察 / Backend Request Observation

当任务需要理解 ChatGPT Web 自身的后台请求时，只在已登录、已打开的 ChatGPT tab 上观察浏览器真实发出的网络记录；不对 `/backend-api/*` 使用 `open`、`fetch`、`curl`、重放或构造独立请求。先清空当前 tab 的日志，执行对应的**可见 UI 操作**，再读取 `network requests` 并按路径确认请求、方法、状态和触发动作；响应体、cookie、授权头、用户内容和完整私有 URL 都不落盘、不汇报。

例如，`/backend-api/gizmos/snorlax/sidebar?owned_only=true&conversations_per_gizmo=5&limit=20` 只有在展开 ChatGPT sidebar 的 Projects/自定义 GPT 列表或其“Show more”分页时，且网络日志实际出现该路径后，才能把它记录为 sidebar 数据加载请求。参数语义仅作运行时线索：`owned_only=true` 倾向筛选当前用户拥有的条目，`conversations_per_gizmo=5` 倾向为每项附带最多 5 个会话摘要，`limit=20` 倾向限制本页条目数；必须由本次请求和页面渲染共同验证，不能据此推断稳定接口契约。

## 每次先重新发现 UI / Live Discovery

ChatGPT UI 会变化。DOM selector 与 agent-browser ref（如 `@e123`）都可能随页面更新失效；每次点击、输入或提交前后都必须取得实时 snapshot 验证控件与页面状态，绝不跳过验证。Python 入口仅固化 CLI 参数、Project 证据和图片尺寸轮询，不能替代 DOM 的实时发现。下列 selector 仅为线索，不是永久契约：

- 在 PowerShell 中把 ref 作为字符串传入，例如 `click '@e123'`；PowerShell 不支持 `&&`，需要顺序执行的命令改为独立命令或使用 `;`。
- Enter 不一定会提交 prompt。提交后先运行 `runtime_checks.py message --marker <unique-marker>`；未发送时重新发现并点击当前页面的 `Send prompt`，再运行该检查。若仍为 `pending`，不要盲目重复提交；若为 `interrupted`，报告认证/导航中断并停止。
- Project home 中普通 ref `click` 无效时，不猜测或复用旧 ref。在同一 agent-browser session 内通过实时 DOM 定位 `agents-op` 的对应控件并触发 click；进入 Project 首页后，同时以 `/project` URL 和 `New chat in agents-op` 作为归属证据。Project 内既有对话通常为同一路径下的 `/c/<chat-id>`，不把它误判为 URL 证据缺失。

- `Create image` 菜单项；选择后同时确认图片模式 pill（已观察到 `data-id="picture_v2"`）与 placeholder 变为 `Describe or edit an image`。仅出现文字 `Create image` 不是模式成功证据。
- 图片上传：`#upload-photos[accept="image/*"]`；通用文件上传：`#upload-files`。
- Project options：`button[aria-label="Open project options for agents-op"]`，菜单应含 `Share project`、`Rename project`、`Project settings`、`Delete project`。

对 composer：先聚焦 `[aria-label="Add files and more"]`，确认可见 `.ProseMirror.ProseMirror-focused`，再向 ProseMirror 写入。常用可靠写入方式为 `document.execCommand('insertText', false, prompt)`；在该 editor 上分派 Enter 的 `keydown`。已有工具 pill 时，只向 ProseMirror 追加 prompt，不能 `selectAll` 或清空 editor，否则会移除工具模式。通过 CDP eval 以 base64 写入中文时，先将 `atob()` 结果转为 `Uint8Array`，再用 `TextDecoder` 按 UTF-8 解码后 `insertText`。不要对激活后的 inert `textarea` 直接设值或按 Enter。

## 图片任务 / Image Tasks

不强制创建本地任务目录、prompt 文件、候选图副本或评审记录。用户沟通、Project Instructions 与 `visual-review` 的固定 prompt 默认中文；用户明确指定其他语言时才切换。发送前在当前对话中确认意图、要求、排除项与验收标准。

### 新图生成

1. 新建 `agents-op` chat，选择 Create image；确认图片模式 pill 与实时 placeholder 后，向保留 pill 的 ProseMirror 追加执行 prompt。
2. 把 brief 结构化为中文记录与英文执行 prompt（subject、composition、camera/view、lighting、material、palette、constraints；必要时 negative constraints）。
3. 默认避免图片内可读文字；若用户要求文字，使用精确字符串并逐字审阅。
4. 已观察到 composer 清空表示 prompt 被消费，但这不是生成成功证据。优先运行 `runtime_checks.py images --min-width 1000`；每轮先检查 snapshot，已出现 `Generated image` 时立即保存截图并结束检查，不再空等尺寸轮询。随后结合 composer 状态和截图确认。
5. 下载优先走页面可见 `Save`/下载按钮；如无按钮，只有当前页能访问的已渲染资源才可经页面内 fetch/canvas 导出。下载完成条件是目标文件已落盘且非空；通用 download 命令返回 canceled、按钮点击成功或浏览器提示都不能单独作为成功证据。用户指定桌面时，先确认下载文件后再移动/命名到桌面。不要用 host `curl` 直取 ChatGPT CDN（常见 403）。

图像导出辅助脚本：

```powershell
python scripts/image_exporter.py --cdp 9696 --tab <tab-id> --selector 'img[alt^="Generated image"]' --output 'E:\exports\image.png'
python scripts/image_exporter.py --cdp 9696 --tab <tab-id> --url 'https://example.com/image.png' --output 'E:\exports\image.png'
```

`--selector` 和 `--url` 都只在当前 Tab 的浏览器上下文读取资源；两者互斥且必须指定 `--output`。selector 匹配多张图时，先排除已滚出视口的候选，再选择与聊天输入框垂直距离最近的可见图；没有聊天框才回退到最后一个可见候选。脚本校验 `image/*`、非空响应并原子落盘，不使用宿主机 `curl`，从而保留当前 Tab 的登录态、Cookie 和 Referer。

### 编辑与参考图

优先使用用户手动放入 `agents-op` 的来源，不爬取历史 chat。上传用当前实时发现的图片控件。可主动改善构图、光线、色彩、材质、清理与整体连贯性，但不得违背需求。涉及身份关键人物、IP 或品牌时，在建档中记录 protected anchors 与允许改动；会明显影响 anchor 的最终 prompt 发送前，先让用户确认。

若页面 HTTPS 阻止 `file://` 或 `localhost` fetch，不把本地路径暴露给页面；使用浏览器原生文件上传能力。若必须 CDP 注入，读取本地文件后以 base64 构造 `File`、放入 `DataTransfer`、赋给当前 file input 并分派 `change`，然后核验 React UI 已接收文件。

## 审阅与迭代 / Review and Iteration

默认最多 **3 个图片生成/编辑轮次**，首张也计入。用户明确给出 `N` 轮验证/测试预算时，以 `N` 为硬上限：每次状态改变的 CDP 调用、导航或额外扩展均算一轮；工具/格式失败也消耗预算。预算接近耗尽时停止，汇总已验证证据并交回控制权。

每个候选都检查：主体/关键物体/姿态/风格、构图/裁切/比例/清晰度/伪影/边距、要求显示的文字、以及参考任务的 identity/layout/palette/protected anchors。剩余轮次内自动修复明显失败或重大质量缺口；最终向用户指出推荐候选及依据。

对于 `wx-publish-workflow` 的微信文章图片，封面与每张内文图是独立图片任务，各自享有 3 轮上限。封面验收以 2.35:1 消息列表显示为准；另查 1:1 分享/头像裁切，若后者丢失主题元素，记录为已知限制，而非在 2.35:1 已通过且用户未要求全端适配时继续生成。

## 结构化视觉审查 / `visual-review`

`visual-review` 是单图图像识别评价门槛。调用方提供一张通过 ChatGPT Web 附件控件上传的图片、带 `S` 编号的审查标准文本及期望的完美结果文本；本 skill 不验证上游重试、页面静态门禁或发布策略。完整固定提示词、中文 YAML 契约和状态规则见 [references/visual-review.md](references/visual-review.md)。

上传前确认当前页面已接收该图片；图片不存在、不可上传、标准为空或期望结果为空时，不发送审查请求并失败关闭。每次操作前后都先取得实时 snapshot。模型只能返回一个中文 `yaml` 代码块，且只能包含 `审查结论`、`结论依据`、`标准检查`、`缺陷`和`改进建议`；代码块外文本、未知字段、重复键、tag、anchor、alias、多文档或类型错误均拒绝。

模型按每个 `S` 标准输出 `达标`、`不达标`或`无法可靠判断`，缺陷等级只允许 `critical`、`major`、`minor`。模型不能决定最终状态；本地严格计算：

- 任一 `critical` 或 `major` 缺陷：`VISUAL_BLOCKED`；
- 所有标准检查有效且没有 `critical` 或 `major` 缺陷：`VISUAL_PASSED`；
- 上传、发送、响应、解析或证据任一环节失败，或存在 `无法可靠判断`：`VISUAL_PENDING`。

只有 `VISUAL_PASSED` 可继续后续流程；`minor` 缺陷必须保留但不阻断。`visual-review` 不删除或修改 chat，结束时仅按现有 lease 规则关闭本次创建的 tab。

## 提示的故障恢复 / Recovery Hints

- Composer reset 但 assistant selector 没结果时，不据此宣布失败；截图可见结果优先于 selector 沉默。
- 图片已渲染却 DOM 轮询不一致时，截屏进行视觉确认；当前页内 `fetch(img.src)` 或 canvas 可能成功，外部 curl 通常被会话认证拦截。
- `canvas.toDataURL()` 因跨域失败时，改用可见下载按钮；不得尝试跨域绕过。
- 不在同一 tab 混用 agent-browser console/click 与 raw CDP WebSocket 会话，选择一个控制通道并保持到任务结束。
- 编辑接口反复报 generation error 时，先记录错误；在用户允许的前提下，可改用不上传参考图的文字描述重试，明确镜头、布局和元素替换。

## Project Instructions 写入

Project instructions 是用户可见持久化配置，默认先用中文拟稿；将候选文本发给用户确认后才写入。React 受控 textarea 必须通过 prototype descriptor 设置并分派 `input` 与 `change`，写入后另做一次新的 evaluate 读回，并向用户报告读回结果。

## 完成检查 / Completion Checklist

- [ ] 使用当前项目对应 session；仅在无可复用 tab 时新建，并在 `agents-op` 内新建 chat；辅助脚本均已通过 `--tab` 锁定任务 tab。
- [ ] 如需定位 Project 首页，已由 `project_locator.py` 的实时 sidebar 行匹配和点击取得浏览器实际 URL；未拼接或缓存 Project URL。
- [ ] 跨命令任务已通过 `browser_task.py` 记录 lease；结束时只释放本次创建的 tab，并重新枚举确认。
- [ ] 至少两条实时证据确认 `agents-op` Project 归属。
- [ ] 每次 UI 操作前后均由实时 snapshot 验证；prompt 已确认渲染为用户消息。
- [ ] 图片模式（如需要）已由图片模式 pill 与实时 placeholder 共同确认，且执行 prompt 未移除 pill。
- [ ] 每轮均完成可见结果与质量核验；已向用户说明推荐候选和依据。
- [ ] 使用 `visual-review` 时，仅上传本次指定的一张图片；模型只返回一个中文 YAML 代码块，且每个 `S` 标准均有有效检查结果。
- [ ] 本地已按 `critical`、`major`、`minor` 和失败关闭规则计算视觉状态；仅 `VISUAL_PASSED` 可继续后续流程。
- [ ] `visual-review` 未删除或修改任何 chat、Project 或其他持久设置。
- [ ] 用户要求下载时，目标文件已落盘且非空；桌面交付已核验最终路径。
- [ ] 已关闭且重新枚举确认任务 tab 消失；未影响原有 tabs。
- [ ] ChatGPT Search / Deep Research（如使用）已在发送前获得本次明确授权。
- [ ] 涉及后台请求时，结论来自当前 tab 的网络监听和关联 UI 渲染；未直接调用、重放或持久化 `/backend-api/*` 请求数据。
- [ ] 未经授权未改变任何持久化 Project 状态。
