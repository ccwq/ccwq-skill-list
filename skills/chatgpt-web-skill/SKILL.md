---
name: chatgpt-web-skill
description: 通过 ChatGPT Web 进行信息搜集、Deep Research，以及图片生成和编辑。
license: MIT
metadata:
  version: 1.5.0
  tags: [chatgpt, chatgpt-web, agent-browser, image-generation, image-editing, research]
  related_skills: [agent-browser]
---

# ChatGPT Web 图片工作区 / Image Workspace

## 适用范围 / Scope

本 skill 依赖 `agent-browser` skill 与其 CLI 操作 ChatGPT Web UI；不提供独立的浏览器自动化实现。`agents-op` 指 **ChatGPT Web Project**，不是本地 Git/workspace 项目；它是图片生成与编辑的指定工作区，也可用于聊天、图片审阅、网页研究和讨论。

优先通过 `scripts/run_agent_browser.py` 调用 `agent-browser` CLI，统一传递 session 和可选 CDP 配置。会话名默认取当前项目绝对路径去除 `/` 后的字符串，截图保存到 `%temp%\agent-browser-captures\`。仅在系统、任务或环境变量已设定 CDP 端口时传入该值；没有设定时不传 `--cdp`。先枚举现有 tabs；目标 URL 已打开时复用该 tab，不要重复打开。例如：

```powershell
python scripts/run_agent_browser.py tabs
python scripts/run_agent_browser.py --cdp <configured-port> snapshot -i
```

此 skill 的全部业务动作都在 ChatGPT Web 对话内完成；不把它用作直接浏览、抓取或自动化外部网站的通用工具。普通讨论可直接在 chat 中进行。只有确有必要使用 ChatGPT Web 的 Search 或 Deep Research 时，发送前先向用户说明理由并取得本次明确授权；未获授权则继续普通对话，或报告信息边界。

## 经验演进 / Evolution Memory

每次触发此 Skill 后、任何浏览器操作前，读取**当前版本专属**的经验文件。经验目录为系统临时根目录下的 `chatgpt-web-skill-exp/`：Windows 为 `%TEMP%\chatgpt-web-skill-exp\`；macOS/Linux 为 `${TMPDIR:-/tmp}/chatgpt-web-skill-exp/`。当前版本文件固定为 `chatgpt-web-<metadata.version>.md`，例如 `chatgpt-web-1.5.0.md`。文件不存在时按空经验库继续；不要为此单独创建空文件。

经验文件的开头必须是：

```markdown
# chatgpt-web-skill 经验库
Skill: chatgpt-web-skill
Skill-Version: 1.5.0
```

只读取文件名与当前 `metadata.version` 一致的文件；不得读取、迁移、重命名或删除旧版本文件，也不得读取旧的 `chatgpt-web-skill.md`。读取当前版本文件时先核对 `Skill` 与 `Skill-Version`；任一字段缺失或不匹配时，停止使用该文件并报告，不覆盖原内容。

仅在任务结论已验证后、最终汇报前追加简短条目；不记录 prompt、图片、chat 内容、账户标识、cookie、私有 URL 或凭据。格式固定：

```markdown
## YYYY-MM-DD — 简短主题
- 场景: 触发条件
- 结论: 已验证的可复用做法
- 边界: 不适用条件或风险
```

当当前版本文件的有效经验条目达到或超过 20 条时，提醒用户审核可提炼的规则以升级 Skill；未经用户明确确认，不自动修改 `SKILL.md`。创建当前版本文件及追加已验证经验均仅作用于本机临时目录。

## 路由契约 / Routing Contract

每次任务按以下顺序执行；每项完成后才进入下一项：

1. 使用当前项目对应的 agent-browser session；按已有 CDP 配置决定是否接入既有浏览器。先枚举 tabs，只有不存在可复用的 ChatGPT tab 时才新建 tab。
2. 通过实时 agent-browser 页面证据确认页面是 ChatGPT Web 且 Project 名为 `agents-op`。禁止相信旧 tab ID、旧 URL 或记忆中的页面文本。
3. `agents-op` 不存在时，先报告并请求创建 Project 的持久化状态授权；存在时直接使用，名称重复也以实时证据选择正确 Project。
4. 为当前任务在 `agents-op` 内新建 chat；以当前 session 和 tab 作为本次任务的最小隔离边界。
5. 终态（成功、取消、平台阻断或不可恢复失败）关闭**本任务创建的** tab，重新枚举 tabs 并确认其消失；复用的既有 tab 不关闭。

可接受的 Project 实时证据至少两项：页面 title 含 `agents-op`、Project URL 以 `/project` 结尾、composer 标注/placeholder 为 `New chat in agents-op`、页面内容表明该 Project 的 chats/sources。无法确认归属时，诊断并报告，不在普通 Chat 或其他 Project 静默执行。

## 变更授权 / Authorization Boundaries

以下会改变持久化 ChatGPT 状态，未获本次明确授权时停止并书面报告：编辑/清空 Project instructions（`textarea#instructions`）、切换 Library access/Memory 等设置、重命名/分享/置顶/删除 Project 或 chat、批准付费/权限/订阅弹窗、上传到当前项目 chat 以外的位置。只读页面探测与视觉核验默认允许。

不把未文档化的 `/backend-api/*` 当成稳定自动化 API；只用浏览器 UI/CDP DOM 与当前页面已渲染资源。不得输入凭证、处理付款订阅或批准权限；遇到平台 policy/block 如实报告，不尝试绕过。

## 每次先重新发现 UI / Live Discovery

ChatGPT UI 会变化。DOM selector 与 agent-browser ref（如 `@e123`）都可能随页面更新失效；每次点击、输入或提交前后都必须取得实时 snapshot 验证控件与页面状态，绝不跳过验证。Python 入口仅固化 CLI 参数和会话配置，不能替代 DOM 的实时发现。下列 selector 仅为线索，不是永久契约：

- 在 PowerShell 中把 ref 作为字符串传入，例如 `click '@e123'`；PowerShell 不支持 `&&`，需要顺序执行的命令改为独立命令或使用 `;`。
- Enter 不一定会提交 prompt。提交后先在实时 snapshot 确认用户消息已经渲染；未渲染时，重新发现并点击当前页面的 `Send prompt` 控件，再次 snapshot 确认。
- Project home 中普通 ref `click` 无效时，不猜测或复用旧 ref。在同一 agent-browser session 内通过实时 DOM 定位 `agents-op` 的对应控件并触发 click；随后同时以 `/project` URL 和 `New chat in agents-op` 作为归属证据。

- `Create image` 菜单项；选择后确认 placeholder 变为 `Describe or edit an image`。
- 已观察到的图片模式 pill：`data-id="picture_v2"`。
- 图片上传：`#upload-photos[accept="image/*"]`；通用文件上传：`#upload-files`。
- Project options：`button[aria-label="Open project options for agents-op"]`，菜单应含 `Share project`、`Rename project`、`Project settings`、`Delete project`。

对 composer：先聚焦 `[aria-label="Add files and more"]`，确认可见 `.ProseMirror.ProseMirror-focused`，再向 ProseMirror 写入。常用可靠写入方式为 `document.execCommand('insertText', false, prompt)`；在该 editor 上分派 Enter 的 `keydown`。不要对激活后的 inert `textarea` 直接设值或按 Enter。

## 图片任务 / Image Tasks

不强制创建本地任务目录、manifest、prompt 文件、候选图副本或评审记录。用户沟通和 Project Instructions 默认中文；图片执行 prompt 默认可使用英文，除非用户指定其他语言。发送前在当前对话中确认意图、要求、排除项与验收标准。

### 新图生成

1. 新建 `agents-op` chat，选择 Create image 并从实时 placeholder 验证图片模式。
2. 把 brief 结构化为中文记录与英文执行 prompt（subject、composition、camera/view、lighting、material、palette、constraints；必要时 negative constraints）。
3. 默认避免图片内可读文字；若用户要求文字，使用精确字符串并逐字审阅。
4. 已观察到 composer 清空表示 prompt 被消费，但这不是生成成功证据。轮询可见 `document.images` 中 `naturalWidth >= 1000` 的图片，并结合 composer 状态和截图确认。
5. 下载优先走页面可见按钮；如无按钮，只有当前页能访问的已渲染资源才可经页面内 fetch/canvas 导出。不要用 host `curl` 直取 ChatGPT CDN（常见 403）。

### 编辑与参考图

优先使用用户手动放入 `agents-op` 的来源，不爬取历史 chat。上传用当前实时发现的图片控件。可主动改善构图、光线、色彩、材质、清理与整体连贯性，但不得违背需求。涉及身份关键人物、IP 或品牌时，在建档中记录 protected anchors 与允许改动；会明显影响 anchor 的最终 prompt 发送前，先让用户确认。

若页面 HTTPS 阻止 `file://` 或 `localhost` fetch，不把本地路径暴露给页面；使用浏览器原生文件上传能力。若必须 CDP 注入，读取本地文件后以 base64 构造 `File`、放入 `DataTransfer`、赋给当前 file input 并分派 `change`，然后核验 React UI 已接收文件。

## 审阅与迭代 / Review and Iteration

默认最多 **3 个图片生成/编辑轮次**，首张也计入。用户明确给出 `N` 轮验证/测试预算时，以 `N` 为硬上限：每次状态改变的 CDP 调用、导航或额外扩展均算一轮；工具/格式失败也消耗预算。预算接近耗尽时停止，汇总已验证证据并交回控制权。

每个候选都检查：主体/关键物体/姿态/风格、构图/裁切/比例/清晰度/伪影/边距、要求显示的文字、以及参考任务的 identity/layout/palette/protected anchors。剩余轮次内自动修复明显失败或重大质量缺口；最终向用户指出推荐候选及依据。

对于 `wx-publish-workflow` 的微信文章图片，封面与每张内文图是独立图片任务，各自享有 3 轮上限。封面验收以 2.35:1 消息列表显示为准；另查 1:1 分享/头像裁切，若后者丢失主题元素，记录为已知限制，而非在 2.35:1 已通过且用户未要求全端适配时继续生成。

## 提示的故障恢复 / Recovery Hints

- Composer reset 但 assistant selector 没结果时，不据此宣布失败；截图可见结果优先于 selector 沉默。
- 图片已渲染却 DOM 轮询不一致时，截屏进行视觉确认；当前页内 `fetch(img.src)` 或 canvas 可能成功，外部 curl 通常被会话认证拦截。
- `canvas.toDataURL()` 因跨域失败时，改用可见下载按钮；不得尝试跨域绕过。
- 不在同一 tab 混用 agent-browser console/click 与 raw CDP WebSocket 会话，选择一个控制通道并保持到任务结束。
- 编辑接口反复报 generation error 时，先记录错误；在用户允许的前提下，可改用不上传参考图的文字描述重试，明确镜头、布局和元素替换。

## Project Instructions 写入

Project instructions 是用户可见持久化配置，默认先用中文拟稿；将候选文本发给用户确认后才写入。React 受控 textarea 必须通过 prototype descriptor 设置并分派 `input` 与 `change`，写入后另做一次新的 evaluate 读回，并向用户报告读回结果。

## 完成检查 / Completion Checklist

- [ ] 使用当前项目对应 session；仅在无可复用 tab 时新建，并在 `agents-op` 内新建 chat。
- [ ] 至少两条实时证据确认 `agents-op` Project 归属。
- [ ] 每次 UI 操作前后均由实时 snapshot 验证；prompt 已确认渲染为用户消息。
- [ ] 图片模式（如需要）已由实时 UI 确认。
- [ ] 每轮均完成可见结果与质量核验；已向用户说明推荐候选和依据。
- [ ] 已关闭且重新枚举确认任务 tab 消失；未影响原有 tabs。
- [ ] ChatGPT Search / Deep Research（如使用）已在发送前获得本次明确授权。
- [ ] 未经授权未改变任何持久化 Project 状态。
