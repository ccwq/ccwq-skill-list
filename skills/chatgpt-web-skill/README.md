# ChatGPT Web Skill

在已登录的 ChatGPT Web 中完成图片生成、编辑、单图结构化视觉审查，以及经确认后的经验整理。它面向需要复用现有浏览器会话的任务，不是通用网页爬取工具。

## 使用前提

- 已安装并可使用 `agent-browser`。
- 已有登录态浏览器，并通过 CDP 接入；项目默认端口为 `9696`。
- 任务在 ChatGPT Web 的 `agents-op` Project 中进行。

先复用已打开的目标 tab；没有可用 CDP daemon 或无法确认 Project 归属时，Skill 会停止并报告，不会新开未登录的浏览器实例。

## 快速开始

```text
$chatgpt-web-skill 在 agents-op 中生成一张简洁的蓝色立方体图
$chatgpt-web-skill 审阅当前 chat 附带的商品主图，并给出可执行改图建议
$chatgpt-web-skill visual-review 上传一张商品主图，按 S1、S2 标准审查
```

跨多条浏览器命令的任务可用临时 lease 固定 tab，避免误操作其他 ChatGPT 页面：

```powershell
python skills/chatgpt-web-skill/scripts/browser_task.py acquire <url>
python skills/chatgpt-web-skill/scripts/browser_task.py status <lease-path>
python skills/chatgpt-web-skill/scripts/browser_task.py release <lease-path>
```

完整调用参数仍以根 [README](../../README.md) 的“参数速查”为准。

## 工作方式

每个任务都会重新枚举 tab，并以实时 snapshot 和至少两项页面证据确认 `agents-op` Project。图像任务会在当前任务 chat 中完成；审查任务只上传本次指定的一张图片，要求返回结构化中文 YAML，再由本地规则计算 `VISUAL_PASSED`、`VISUAL_BLOCKED` 或 `VISUAL_PENDING`。

浏览器 UI、selector 和 tab ID 都是短期线索。操作前后必须重新观察页面；浏览器重启或 tab 失效后，需要重新获取 lease 与归属证据。

## 授权与边界

- Search 或 Deep Research 需先说明原因并获得当次明确授权。
- Project instructions、Memory/Library 设置、重命名、分享、删除 chat 或 Project、付费/权限确认均需单独授权。
- 不输入凭据、不处理付款或订阅，也不把未文档化的后端接口当作稳定 API。
- 默认最多进行 3 个图片生成或编辑轮次；用户提供轮次预算时，以其为上限。

统一经验库仅由 `experience_memory.py` 维护。只有已验证、脱敏的结论才能追加；整理全库需要用户对最终计划明确回复 `ok`。

## 脚本与验证

| 入口 | 用途 |
| --- | --- |
| `run_agent_browser.py` | 统一传递 session 与 CDP 配置调用 `agent-browser` |
| `browser_task.py` | 获取、追踪和释放任务 tab lease |
| `runtime_checks.py` | 机械检查 Project 归属、消息提交和图片可见性 |
| `experience_memory.py` | 读取、追加和按确认计划整理脱敏经验 |

完整执行步骤、视觉审查 YAML 契约和故障恢复规则见 [SKILL.md](SKILL.md) 与 [visual-review 参考](references/visual-review.md)。
