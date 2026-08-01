# ChatGPT Web Skill 实时验证用例

离线测试运行 `python test-space/chatgpt-web-skill/run_tests.py`。以下四个用例用于有权限的真实浏览器回归：必须通过项目 `.env` 或调用期参数连接已登录浏览器（当前测试端口为 `9696`），禁止启动新的浏览器会话。每个用例均先执行 `tab list`，**新建专用 tab**，记录其稳定 tab ID；不得关闭或操作既有 tab。

## Case 1：Project 归属与新聊天隔离

- **题目**：在 `agents-op` 中新建 chat，并证明没有误落到普通 chat 或其他 Project。
- **步骤**：实时 snapshot 定位 Project；以 Project URL、title、`New chat in agents-op` 中至少两项确认归属；新建 chat 后再次 snapshot。
- **通过条件**：`runtime_checks.py project --name agents-op` 成功，且新 chat 位于该 Project 的专用 tab。
- **失败观察**：旧 ref 或旧 URL 不可作为证据；reload 后必须重新 snapshot。

## Case 2：Enter 与 Send prompt 提交恢复

- **题目**：发送含唯一 marker 的短消息，验证 Enter 不提交时能恢复为实时 Send prompt 点击。
- **步骤**：输入 marker 后尝试 Enter；snapshot 确认用户消息是否渲染。未渲染时重新 snapshot，点击当前 `Send prompt`，再运行 `runtime_checks.py message --marker <marker>`。
- **通过条件**：状态为 `sent`，marker 在快照中且不留在 composer；只出现一条用户消息。
- **失败观察**：认证或导航导致 `interrupted` 时立即停止，不重复提交。

## Case 3：图片出现后的即时收敛

- **题目**：在图片模式提交极简图片请求，确认已显示结果时不继续轮询。
- **步骤**：实时确认图片模式和 prompt 提交；运行 `runtime_checks.py images --screenshot <temp-path>`。
- **通过条件**：snapshot 出现 `Generated image` 后立刻保存截图并返回；日志中没有后续 `eval` 或等待轮次。
- **失败观察**：没有可见图片时才允许按上限轮询尺寸；不得因已显示图片继续等待。

## Case 4：CDP、session 与 tab 隔离

- **题目**：验证无 CDP 配置和自定义 CDP 配置均可运行，且只读取本用例新建 tab。
- **步骤**：使用 `.env` 的 `AGENT_BROWSER_CDP_PORT=9696` 或显式 `--cdp 9696`；每次读取前通过 `--tab <stable-tab-id>` 重选目标 tab；结束后只关闭该用例 tab 并 `tab list` 确认。
- **通过条件**：调用连接已登录浏览器，不启动新浏览器会话；既有 tabs 保持不变。
- **失败观察**：tab label 不能作为跨命令锁定依据，必须重新取得稳定 tab ID。
