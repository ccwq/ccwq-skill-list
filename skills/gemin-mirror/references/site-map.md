# Mirror site adapter guide

本文件是默认适配器的单一事实来源：它描述可替换字段与多账号站点契约，不把某个站点的 DOM 当成永久标准。执行前按本文件核验页面；字段不足时只保留探针结果。

脚本参数与环境变量的用户速查统一维护在根 [README](../../../README.md#gemin-mirror)；脚本默认值以代码为准。本文件仅维护默认适配器的静态 DOM、dashboard 与 RPC 契约。

## 默认适配器字段

| 用途 | 默认值 | 说明 |
|---|---|---|
| 页面 origin | `https://gemini-d-google-d-com-s-gmn.tuangouai.com/app` | 必须 exact/前缀校验 |
| 账号面板 | `#_my_chat_list_container` | 镜像注入层，缺失即停止 |
| 账号卡片 | `.-my-chat-account` | 读取 ID、会话数、负载、媒体标记 |
| 原生会话 | `#sidenav-section-content-chats gem-nav-list-item` | 只在面板关闭/账号已核验时使用 |
| 输入框 | `textarea` 或 textbox“为 Gemini 输入提示” | 只读探针 |
| 模式选择器 | `button[aria-label*="模式选择器"]` | 只读探针 |

## 账号证据与多账号切换

不要仅凭 `data-expanded` 判断当前账号：不同注入版本可能同时把多个卡片标为展开。优先使用 `data-active`、`aria-current`、显式 selected class 或当前会话标题与卡片会话项的交集；若不能得到唯一结果，停止并要求显式选择/适配器配置。

### `#_my_chat_list_container` 契约

- 卡片是 `.-my-chat-account`；`.account-id` 和 `.chat-count` 能提供注入层的账号编号与会话数量，适合用于发现候选，不能单独授权删除。
- 同一时刻可有多个卡片的 `data-expanded="1"`，它只表示列表展开状态，不是活动账号状态。
- 卡片会话数可能与当前原生侧栏会话数不同；把它视为缓存/候选信息，必须在切换后以 `.mavatar-footer-left[aria-label]` 中的邮箱和原生会话 selector 重新核验。
- 候选卡片内的 `.-my-chat-list li` 仅用于打开会话详情，不能作为账号切换入口。适配器应从 dashboard 的账号面板选择匹配的账号卡片，并要求切换后活动邮箱或原生会话集产生可验证变化。
- 现场验证中，点击任一候选卡片的会话项后，页面可能仍显示原活动 Google 邮箱，而原生会话 selector 计数变为 0。内部账号编号可能是镜像站虚拟账号或缓存维度，不能假定与 Google 邮箱一一对应；多账号清理必须以额外的稳定身份字段或站点公开的账号切换契约为前提。
- `.mavatar-footer-left` 的 `aria-label` 可读取当前 Google 账号邮箱，但该元素本身可能是第三方外链（现场跳转至 `https://hiwaike.com/`），仅可作为只读身份证据，禁止点击它来切换账号。
- 追加验证：真实点击候选卡片的首条会话后，页面通常进入带有随机会话短标识的详情路由；详情态可能无法读取活动邮箱和原生侧栏计数。该动作更像打开镜像会话详情，而非切换 Google 账号，因此不能据此调用当前账号 API 删除。
- 多账号证据链：候选卡片仅用于发现目标；切换后必须同时得到唯一 selected 卡片、唯一活动邮箱和重新加载的原生会话列表。缺少任一项时停止该批处理。账号编号、会话短标识和缓存计数只留在运行时。
- API runner 兼容性经验：自定义 `gem-nav-list-item` 的 `:first-child` 在不同渲染状态下可能匹配不到；触发只读请求时应点击 selector 下第一个实际 `a` 元素，并等待请求完成后再提取模板。请求模板缺失必须停止，不得复用旧模板或猜测参数。
- Windows eval 兼容性经验：动态拼接 `querySelectorAll` 表达式时，selector 必须作为完整 JS 字符串传入（例如将 `selector + ' a'` 一起编码）；不要把字符串字面量和 `a` 选择器片段拼接在引号外，否则会生成语法错误。运行时字符串应统一转义后再交给 batch。
- 账号切换探针经验：候选会话容器中的卡片与列表项没有可用的账号切换控件；页面底部的 `gem-open-account-menu`/`mavatar-footer-left` 只是站点外部账号菜单链接。应从页面的 shadow roots 中运行时查找包含 `.dash-banner-menu` 的 dashboard 宿主，点击其实际 `.dash-banner-btn`，等待 `.account-panel.dashboard-item` 加载，再在其中点击目标 `.account-card`。
- 切换完成的稳定证据是：重新打开账号面板后，目标 `.account-card` 成为唯一 `.selected`；页面可读取唯一活动邮箱；原生会话列表完成重新加载。具体宿主的 `nth-child` 位置会随页面注入而变动，不能写死；运行时根据 shadow root 内的菜单类名解析。

## 删除适配器

原生列表删除的稳定顺序是：滚动首项、hover 标题、实时读取首项内部更多按钮的 `getBoundingClientRect()`、真实鼠标点击、查找可见且文本精确匹配的删除菜单项、点击可见确认按钮、等待并验证计数下降。坐标不可缓存。

### RPC

当前镜像已验证：`/_/BardChatUi/data/batchexecute` 的 `GzXR5e` 接受 `c_<conversation-id>` 并返回 200；列表刷新使用其他 RPC。`at`、`f.sid`、`bl`、`_reqid` 均视为运行时参数，不写入 skill 或审计日志。API 适配器必须先捕获同源请求模板，再限制并发、加入抖动、分类重试，并在刷新后验证计数为 0。未知 rpcid、响应业务错误、账号上下文变化或模板缺失时 fail-closed。
### 动态 batchexecute 参数探测

删除 API 需要运行时获取 `at`，不得固化其值。优先从同源 `batchexecute` 请求体读取；若列表请求不携带 `at`，可按 `GEMINI_MIRROR_AT_GLOBAL_PATH`（默认 `WIZ_global_data.SNlM0e`）读取当前文档的运行时回退值，仅在内存中传给删除请求，不输出、不审计、不持久化。若请求 URL 缺少 `source-path`，以当前页面 pathname 补齐，仍不得猜测认证参数。

### 删除后的持久化复核

删除 runner 报告 `remaining=0` 或页面即时计数归零，不足以证明服务端已持久化；列表可能在异步重载或刷新后重新出现条目。完成判定必须等待页面稳定、强制刷新，并再次读取原生会话计数；只有刷新后的稳定计数仍为 0 才算完成。若 CDP 在 API 批次回传阶段超时，先读取当前计数和审计状态再决定是否重试，避免重复提交仍可能存在的会话 ID。
