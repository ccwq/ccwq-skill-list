# ChatGPT Web 现场笔记 / Field Notes

仅记录可复用、由证据支持的工作流观察。不得记录用户 prompt、生成图、聊天内容、账户 ID、cookie、私有 URL 或暂态任务状态。

## 2026-07-24 — 初始 CDP 探查 / Initial CDP discovery

- **观察 UI：** 已认证的 `chatgpt.com` Web app。
- **证据：** attachment menu 有 `Create image`；选择后 composer placeholder 为 `Describe or edit an image`，并出现 `data-id="picture_v2"` 的 inline pill。
- **上传：** 图片为 `#upload-photos[accept="image/*"]` 且 `multiple`；通用上传为 `#upload-files`。
- **Project 路由：** `New project` 使用 `form[data-testid="create-new-project-form"]`、`input#project-name`；创建 `agents-op` 后 title 是 `ChatGPT - agents-op`、URL 以 `/project` 结束、composer label 是 `New chat in agents-op`。
- **验证：** 运行时重新发现元素；发送 prompt 前以至少两项实时指标确认 Project 归属。

## 2026-07-24 — Project settings 与 instructions

- **入口：** `button[aria-label="Open project options for agents-op"]` 菜单有 Share/Rename/Project settings/Delete；settings 中有 Chats、Sources、`textarea#instructions`、Library access 与 Memory。
- **规则：** 以上设置是持久状态，获得明确授权才改。写入 instructions 时设置值后必须合成 `input` 和 `change`，再读回比对预期；保存获批文本及读回证据。

## 2026-07-24 — 浏览器会话与 tab 边界

- 使用当前项目派生的 session；只有任务新建 tab 时才在结束后关闭它并重新枚举确认。现有 ChatGPT tabs 可能含用户无关工作，仅凭 URL/domain 不能证明所有权。
- 有既有 CDP 端口配置时接入该浏览器；没有配置时不传 `--cdp`。

## 2026-07-25 — 跨平台图片流转

- 同一 Chrome CDP 实例的不同 tab 有不同 `targetId`。已验证可从 ChatGPT tab 用 canvas `toDataURL` 导出，再上传至另一平台 tab；源图可由如下方式取得：

```js
var canv = document.createElement('canvas');
canv.width = imgs[0].naturalWidth; canv.height = imgs[0].naturalHeight;
canv.getContext('2d').drawImage(imgs[0], 0, 0);
canv.toDataURL('image/jpeg', 0.92)
```

- CDP 返回文件是 JSON，不是纯文本；解析后才提取 base64。相关 selectors 和结果路径随 UI/build 漂移，下一次必须重新验证。

## 2026-07-28 — 轮询、下载、上传边界

- assistant message selector 可能为 0，即使已渲染图片；可靠信号是可见 `document.images` 中 `naturalWidth >= 1000` 的项目，再交叉验证 composer 和截图。
- 页面内 `fetch(img.src)` 可能携带会话而成功，host `curl` 到相同 CDN URL 常为 403；优先可见下载按钮，或当前页可访问的已渲染资源。
- 从 HTTPS ChatGPT 页面 `fetch(file://...)` 和 `fetch(http://localhost:...)` 会受安全策略阻断。用原生 file input；必要时 base64 → `File` → `DataTransfer` → `change`，并核验 UI 接收结果。
- 不混用不同控制通道。若 poll 与 composer 状态冲突，截图为最高优先级的可见证据。
- 以上是特定日期的现场观察，不是 API 契约；每次 session 重新验证 selector 与图片 URL 形态。

## 2026-07-31 — ref 与 Project home 的实时验证

- DOM selector 与 agent-browser ref 均会因页面更新失效；每个 UI 操作前后均以实时 snapshot 验证，不能依赖旧 ref。
- PowerShell 调用必须给 ref 加引号，如 `click '@e123'`；PowerShell 不支持 `&&`。
- Enter 不保证发送成功；snapshot 中确认用户消息渲染后才视为已提交。未渲染时重新定位并点击实时 `Send prompt`。
- Project home 的普通 ref click 无效时，在同一 agent-browser session 通过实时 DOM 定位 `agents-op` 控件并触发 click，再同时确认 `/project` URL 与 `New chat in agents-op`。

## 2026-07-31 — CLI 配置固化

- 可将项目会话名和可选 CDP 参数固化到 Python 入口；入口只调用 `agent-browser` CLI，不固化会漂移的 DOM selector 或 ref。

## 2026-07-31 — 验证经验的脚本化边界

- 已验证的 Project 双证据、生成图尺寸轮询与经验文件格式适合由脚本机械执行；脚本输出结构化结果，减少 LLM 反复解析。
- selector、ref、tab ID 和视觉质量仍随页面或任务变化，继续由实时 snapshot 和截图复核；不纳入固定脚本契约。

## 2026-08-01 — 提交结果的结构化分类

- Prompt 的成功信号应同时检查 marker 是否离开可见 composer、是否出现在 snapshot，以及是否被认证/登录页中断。
- `pending` 时不盲目连点 Send，`interrupted` 时停止；这两个状态都不能当作已发送。

## 2026-08-01 — 跨命令 tab 锁定

- 同一 CDP 浏览器下，新 session 不等于后续命令自动选中刚创建的 tab；每条检查命令必须显式切换到任务 tab ID 或唯一 label。
- tab ID/label 是调用期输入，不写死进脚本；切换失败时停止，避免把其他 tab 的证据误判为当前任务。

## 2026-08-01 — Windows 的 eval 传输

- 复杂 JavaScript 作为命令行参数时可被 PowerShell 拆分；由 Python 以 `agent-browser eval --stdin` 和标准输入传递，避免 shell 参与解析。
- CLI 可能在 JSON array 前输出诊断文本；解析时从首个可解码 array 提取载荷，不能假设输出首字符就是 `[`。
- 调用 eval 时启用 CLI 的 `--json`；兼容 array、嵌套 JSON 与字符串化 JSON，错误仅报告输出形状而不泄露页面内容。

## 2026-08-01 — 图片出现后的即时收敛

- 图片检查每轮先读取 snapshot；一旦出现 `Generated image` 可见证据，立即截图并结束，不能在图片已出现后继续等待尺寸轮询。
- 跨命令调用使用实时 tab list 返回的稳定 tab ID；label 只用于人为识别，不能作为脚本锁定依据。
- 枚举标签页使用 `tab list`（不是 `tabs`）；辅助入口优先复用 PATH 中已安装的 `agent-browser`，以避免 `npx` 启动造成 daemon 会话不一致。
