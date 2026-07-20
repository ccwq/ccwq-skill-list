---
name: gemin-mirror
description: Gemini 镜像站的全面浏览器操作、账号切换、页面探查、会话与内容管理。
disable-model-invocation: true
---

# Gemini 镜像站操作

这是一个 user-invoked skill。只有用户明确输入 `$gemin-mirror` 或明确要求使用本 skill 时才运行。

## 运行契约

- 目标站点：`https://gemini-d-google-d-com-s-gmn.tuangouai.com/app`。
- 复用已打开的 Gemini 标签页；找不到目标标签页时暂停，不新建标签页。
- 所有 `agent-browser` 调用携带 `--cdp 9696 --session <当前项目路径派生值>`；可用 `--session` 显式覆盖。
- LLM 和脚本不得直接绕过命令解析器调用 CLI；统一按“Windows `w -l` → `w abc` → 原生 CLI，Linux/macOS `source ~/.bashrc` → `abc` → 原生 CLI”执行。
- 每次运行固定实际 runner，并在审计中记录；失败时按既定顺序有限回退并记录原因。
- 默认先做只读能力探针，再执行用户授权范围内的动作。
- 运行开始确认操作类别与目标清单；范围内的动作可连续执行，超出范围立即暂停。

## 操作步骤

### 1. 绑定与探针

1. 列出标签页并选中现有 Gemini 标签页，核对 URL 和页面标题。
2. 检查页面是否为 401/登录失效；是则停止并报告。
3. 探测原生导航、账号面板、会话列表、库、笔记本、输入框和模式选择器。
4. 完成标准：输出当前 URL、可用入口、面板是否存在、当前账号标识及可读的会话计数来源。

常用探针（必须通过统一 resolver 执行；以下仅展示参数形态）：

```bash
<resolved-runner> --cdp 9696 --session <当前项目路径派生值> tab list
<resolved-runner> --cdp 9696 --session <当前项目路径派生值> eval "({url:location.href,title:document.title,loggedIn:!document.body.innerText.includes('登录已失效'),nativeChats:document.querySelectorAll('#sidenav-section-content-chats gem-nav-list-item').length,accountPanel:!!document.querySelector('#_my_chat_list_container')})"
```

`<resolved-runner>` 只能由 `scripts/delete-current-account-sessions.mjs` 中的 resolver 解析为 `w abc`、`abc` 或原生 `agent-browser`；LLM 不得自行替换。

### 2. 账号面板与切换

- 面板是镜像侧注入的 `#_my_chat_list_container`，账号卡片为 `.-my-chat-account`。
- 卡片字段：`.account-id`、`.chat-count`、`.load-full`/`.load-low`、`.account-indicators`、`data-expanded`。
- 面板打开时，以卡片数据为准；此时原生会话选择器为 0 不代表账号为空。
- 手动模式：真实鼠标点击用户指定卡片。
- 自动模式：先读取并展示账号 ID、会话数、负载、媒体标记和顺序；用户确认筛选条件后才切换。每次切换后重新探针核验实际账号。
- 账号切换完成标准：URL/页面状态稳定，账号标识或会话列表发生预期变化，且未出现 401。

### 3. 普通页面操作

- 优先语义选择器和 accessibility ref；需要悬停或菜单时使用真实鼠标。
- 坐标只从当前元素 `getBoundingClientRect()` 实时计算，不复用旧坐标。
- 点击后等待页面状态变化，再读取 DOM 或网络结果；不要把表面点击当作成功。
- 复杂页面先保存截图或快照到 `%TEMP%\agent-browser-captures`。

### 4. 会话与内容管理

仅在授权范围包含对应类别时执行。删除/重命名等不可逆动作先输出目标数量和账号，再执行。

原生会话列表选择器：

```js
document.querySelectorAll('#sidenav-section-content-chats gem-nav-list-item')
```

删除单条会话的稳定交互：

1. 将首项 `scrollIntoView({block:'center'})`。
2. hover 首项标题，读取该项更多按钮的 `getBoundingClientRect()`。
3. 用真实鼠标点击更多按钮，读取可见 `[role=menuitem]` 中文本为“删除”的菜单项并点击。
4. 读取确认对话框中可见的“删除”按钮并点击。
5. 等待约 700–1000ms，重新读取会话数量。

完成标准：目标账号的会话计数为 0，且刷新/重新探针后仍为 0。跨平台 Node.js 脚本见 `scripts/delete-current-account-sessions.mjs`。

### 5. API 加速分支

站点使用 `/_/BardChatUi/data/batchexecute` RPC。只有已调查、已建立参数契约并与当前页面/账号绑定的 RPC 才能封装；未知 `rpcids` 不直接猜测调用。API 失败时回退 UI/CDP；若响应语义不明确，停止而不是继续。

### 6. 验证、重试与审计

- 每批动作记录 before/after 计数、账号标识、动作、重试次数、错误和页面 URL。
- 删除脚本所有运行均须提供 `--expected-account <账号 ID>`；实际删除还须提供 `--confirm-delete`。只读 `--dry-run` 不需要确认标记。
- 脚本只接受账号面板中唯一展开卡片的精确账号 ID；缺失、重复或不匹配均 fail-closed。
- 记录保存为 JSONL/Markdown；账号标识只保存短哈希，不得保存完整账号 ID、cookies、token 或完整会话正文。
- 单步失败最多有限重试（默认 3 次）；状态不一致、关键元素缺失、账号不确定或页面出现 401 时立即停止。
- 运行完成标准：所有目标账号和动作均有 after 状态，未完成项明确列出，审计文件路径可交付。

## 版本漂移护栏

运行前执行能力探针。优先稳定语义选择器；坐标只作实时回退。以下任一情况触发 fail-closed：

- 目标域名或标签页不匹配；
- 登录状态失效；
- 面板/会话元素缺失或出现多个无法区分的候选；
- 菜单文本、确认文本或计数来源改变；
- API 响应无法映射到已知契约。

详细 DOM、注入脚本和 RPC 观察记录见 [`references/site-map.md`](references/site-map.md)。
