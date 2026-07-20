# Gemini 镜像站调查记录

## 页面与注入层

- 页面：`https://gemini-d-google-d-com-s-gmn.tuangouai.com/app`
- 原生 Gemini 页面使用 Angular Material 风格组件。
- 镜像注入资源：`/__tpp/inject.js`、`/__tpp/inject.css`、`/__tpp/user.js`。
- `user.js` 返回 JSONP 用户状态（包含 `accountId`、指纹和 `isMain`），不要把该数据写入审计日志。

## 原生入口

- 侧栏导航：视频、库、笔记本、最近。
- 会话项：`#sidenav-section-content-chats gem-nav-list-item`。
- 会话项更多按钮：首项内部 `button`，必须在 hover 后才稳定可见。
- 输入框：`textarea`/textbox“为 Gemini 输入提示”。
- 模式按钮：可访问名称“打开模式选择器，当前模式为……”。

## 镜像账号面板

面板容器：`#_my_chat_list_container`。

```html
<div class="-my-chat-account" data-expanded="1">
  <div class="-my-chat-account-header">
    <span class="account-id">账号: #3069</span>
    <span class="chat-count">会话: 3</span>
    <span class="load-full">负载: 满</span>
    <span class="account-indicators">🖼️🎞️</span>
  </div>
  <ol class="-my-chat-list">…</ol>
</div>
```

调查中可见多个账号卡片；卡片列表自身有内部滚动，不能使用固定屏幕坐标。面板打开时原生列表计数为 0 是正常现象，应读取卡片的 `.chat-count`。

## 网络观察

核心请求：

`POST /_/BardChatUi/data/batchexecute`

调查中见过的 `rpcids` 包括 `ESY5D`、`CNgdBe`、`aPya6c`、`VxUbXb`、`ku4Jyf`、`GzXR5e`、`qWymEb`。这些标识只是观察结果，不代表可直接复用；必须建立请求体、账号上下文和响应解析契约后才能进入 API 分支。

## 已验证的交互经验

1. 普通 CSS `.click()` 可能只触发表面状态；删除会话使用真实鼠标事件更稳定。
2. 菜单和确认框位置随视口变化；每次通过 `getBoundingClientRect()` 读取。
3. 删除后等待约 700–1000ms，再读取数量；批量脚本遇到菜单延迟应有限重试。
4. 401 页面文本为“登录已失效，请重新登陆”；检测到该文本立即停止。
