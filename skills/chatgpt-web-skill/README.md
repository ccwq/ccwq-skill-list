# ChatGPT Web Skill

在已登录的 ChatGPT Web 中完成信息调查、图片生成与编辑、单图结构化视觉审查，以及经确认后的经验整理。它复用现有浏览器会话，以工作区归属、完整发送和业务后置条件验收操作，不是通用网页爬取工具。


## 安装

从插件市场安装（需先把本仓库加为 marketplace）：

```text
/plugin install chatgpt-web-skill --marketplace ccwq/ccwq-skill-list
```

或用 skills CLI 安装：

```bash
npx -y skills add https://github.com/ccwq/ccwq-skill-list --agent claude-code --skill chatgpt-web-skill
```


## 使用前提

- 已安装并可使用 `agent-browser`。
- 已有登录态浏览器，并通过 CDP 接入。优先使用脚本参数 `--cdp`/`-c`；完整优先级见根 README 的参数速查。
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

若当前 tab 不在目标 Project 首页，可从实时 sidebar 精确定位并跳转：

```powershell
python skills/chatgpt-web-skill/scripts/project_locator.py -c <port-or-url> --tab <tab-id> --name agents-op
```

脚本只点击当前页面中与 Project 名同一行的 `Open project home`，并返回浏览器实际导航后的 `/project` URL 与页面证据；不预存/拼接 URL，也不直接请求 `/backend-api/*`。

没有可复用 ChatGPT tab 时，使用 `--new-tab`。脚本经 `agent-browser tab new` 创建任务页，输出 `tab_id` 和 lease；新页定位与主页证据共享 skill 内部 `.env` 的 30 秒总超时（`CHATGPT_PROJECT_LOCATOR_NEW_TAB_TIMEOUT_SECONDS`），调用时可用 `--new-tab-timeout` 覆盖；任务结束后释放该 lease：

```powershell
python skills/chatgpt-web-skill/scripts/project_locator.py -c <port-or-url> --new-tab --name agents-op
python skills/chatgpt-web-skill/scripts/browser_task.py release <lease-path>
```

## 图像导出

图像导出脚本支持从当前页面的已渲染元素解析地址（`--selector`），或使用调用方提供的图像 URL（`--url`）。当 selector 匹配多张图时，脚本先排除已滚出视口的候选，再选择**与聊天输入框垂直距离最近**的可见图，通常就是最新消息的图；没有聊天框才回退到最后一个可见候选。读取动作仍在当前登录 Tab 的浏览器上下文中执行，并将结果原子写入任意本机可写目录：

```powershell
python skills/chatgpt-web-skill/scripts/image_exporter.py `
  -c <port-or-url> --tab <tab-id> `
  --selector 'img[alt^="Generated image"]' `
  --output 'E:\exports\image.png'

python skills/chatgpt-web-skill/scripts/image_exporter.py `
  -c <port-or-url> --tab <tab-id> `
  --url 'https://example.com/image.png' `
  --output 'E:\exports\image.png'
```

脚本在当前已登录 Tab 的浏览器上下文中读取已渲染图像，检查响应类型并原子写入目标路径。交付前仍需独立确认文件存在且非空，不以脚本返回成功替代该检查。它不使用宿主机 `curl`，因此能复用当前页面的会话权限。

完整调用参数仍以根 [README](../../README.md) 的“参数速查”为准。

## 工作方式

每个任务都会重新枚举 tab，先确认 HTTPS ChatGPT 站点，再以至少两项独立页面证据确认 `agents-op` Project。名称相似或归属冲突时停止；定位器未找到结果不代表账户没有该 Project。用户手动准备页面后，重新发现控件并核验归属。

发送前核对 composer 全文、关键约束和末尾；发送后关联本次新增用户消息并核对完整正文。只检查 marker、点击返回成功或输入框清空都不足以证明发送成功。提交不明时有界读取，不自动重发。

研究任务按需加载[研究与证据验收](references/research.md)，分别记录完整送达、生成完成、实际搜索与来源支持；只出现官方域名不能算来源已核验。图片任务仍使用独立图片流程；视觉审查只上传本次指定的一张图，以中文 YAML 和本地规则计算状态。

浏览器 UI、selector 和 tab ID 都是短期线索。操作前后必须重新观察页面；浏览器重启或 tab 失效后，需要重新获取 lease 与归属证据。

如需分析 ChatGPT 自身的后台请求，只能监听已登录 tab 的真实网络记录：清空日志、执行对应可见 UI 操作，再确认请求路径和页面渲染的关联。不得直接调用、重放或保存 `/backend-api/*` 请求；查询参数只能作为待验证的运行时线索。

## 授权与边界

- 普通对话、Search、Deep Research 的授权互不替代；后两者需说明原因并获得对应模式的当次授权。
- 创建 Project 与修改设置分开授权；instructions、Memory/Library、重命名、分享、删除等持久变更均需单独授权。
- 凭据、付款/订阅和权限批准交由用户手动处理；不把未文档化的后端接口当作稳定 API。
- 默认最多进行 3 个图片生成或编辑轮次；实际提交即计数，生成失败也计入。浏览器恢复另设上限，不与图片轮次混算。

统一经验库仅由 `experience_memory.py` 维护。只有已验证、脱敏的结论才能追加；整理全库需要用户对最终计划明确回复 `ok`。

## 脚本与验证

| 入口 | 用途 |
| --- | --- |
| `run_agent_browser.py` | 统一传递 session 与 CDP 配置调用 `agent-browser` |
| `browser_task.py` | 获取、追踪和释放任务 tab lease |
| `runtime_checks.py` | 机械检查 Project 归属、消息提交和图片可见性 |
| `project_locator.py` | 从实时 sidebar 精确定位 Project 行并打开、校验其主页 |
| `experience_memory.py` | 读取、追加和按确认计划整理脱敏经验 |

本地回归命令：

```text
python test-space/chatgpt-web-skill/run_tests.py
node --test test-space/chatgpt-web-skill/document-contract.test.mjs
```

第一项检查脚本行为，第二项检查文档契约、版本及链接；均不能证明当前真实页面可用。实网验收用例见 [LIVE_CASES.md](../../test-space/chatgpt-web-skill/LIVE_CASES.md)，执行前另行授权。

完整执行步骤、视觉审查 YAML 契约和故障恢复规则见 [SKILL.md](SKILL.md) 与 [visual-review 参考](references/visual-review.md)。
