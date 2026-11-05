# 运行时与统一 preview

本 Skill 发行两个产物：

| 产物 | 位置 | 作用 |
|---|---|---|
| 运行时单文件 | `runtime-dist/psm-cli.js` | 承载全部业务命令与 `preview`，自包含、无第三方依赖 |
| 旧独立查看器 | `viewer-dist/view-memoery.js` | 历史产物，保留原字节、仍可自行运行，不再部署 |

「skill 安装」指宿主可加载的指令与配套发行文件；「运行时部署」指为目标项目提供可独立运行的工具产物。两者不等价：在项目里部署运行时不需要把完整 skill 装进项目。

## 命令入口

```text
node <skill-path>/runtime-dist/psm-cli.js <command> [options]
```

运行时是 Node 22+ 的单文件脚本，无 package 配置、CommonJS 与 ESM 项目中都能直接执行，不访问网络，不依赖相邻源码、静态资源或第三方依赖目录。

源码入口 `scripts/memory.mjs` 是同一份实现的薄兼容层，供宿主适配器（`memory-session.mjs`、`reference-host.mjs`）与源码调试使用。两种入口复用同一份业务实现，不存在第二套存储、锁或写入语义。

构建：`node scripts/build-runtime.mjs`；只读一致性校验：`node scripts/build-runtime.mjs --check`。构建确定性：源码不变时重复构建产物字节一致，产物不依赖机器绝对路径或 checkout 行尾。

## 项目解析

所有命令与 `preview` 使用同一优先级：

1. 显式 `--project-root`（相对路径按启动 cwd 解析）；
2. 运行时落在某项目的 `.project-self-memory/` 内时，绑定该项目；
3. 其余安装位置使用当前工作目录。

绑定按运行时文件的真实位置判定：项目里指向全局产品的链接不会被当成项目独立副本。不自动向父目录猜测项目，不创建其它项目的记忆库。

## preview

```text
node <skill-path>/runtime-dist/psm-cli.js preview [--port N] [--no-open]
```

前台长驻子命令。默认分配可用端口；端口被占用或参数非法时明确失败退出，不留下后台服务。

启动输出：

```text
PSM_VIEWER_URL: http://127.0.0.1:<port>/#token=<token>
```

默认用系统默认浏览器打开该地址。`--no-open` 或 `PSM_VIEWER_OPEN=0` 禁止打开；`PSM_VIEWER_OPEN=echo` 只打印待打开地址（无头环境与测试诊断用，优先级最高）。浏览器打开失败不影响已经就绪的服务，用户可手动访问。

安全与数据模型与旧查看器一致：只监听本机回环，随机令牌通过 URL fragment 交接，API 全部要求 Bearer 令牌，写操作校验 Origin 与 Host，请求体限长，不提供任意文件服务。缺库或损坏库时保持可诊断的只读状态，不隐式初始化、修复或迁移。

HTTP 路由与响应细节见 [viewer.md](viewer.md)。

## 项目运行时部署

只有用户明确要求「项目独立运行」时才部署；普通 `init`、`read`、`validate`、`preview` 不构成部署授权。

```text
node <skill-path>/runtime-dist/psm-cli.js runtime install
node <skill-path>/runtime-dist/psm-cli.js runtime status
node <skill-path>/runtime-dist/psm-cli.js runtime update
```

部署目标固定为 `<project-root>/.project-self-memory/psm-cli.js`，只落这一个文件：不复制 skill 指令、参考文档、源码模块、测试或旧查看器产物。消费项目无需额外清单文件，发行信息随运行时内联。

- `runtime install`：目标缺失时部署；目标与当前官方产物字节相同则报告无变化；目标已存在且不是当前官方产物时拒绝覆盖，提示改用 `runtime update` 或人工处理。符号链接一律拒绝。
- `runtime status`：只读输出稳定 JSON，至少含 `exists`、`official`、`up_to_date` 与可定位的 `diagnostics`，另附 `hash`、`symlink`、`target`、`distribution`、`runtime_version`。不写库、不写运行时。
- `runtime update`：只替换能被当前发行信息识别的官方旧产物；当前版报告无变化。未知内容、本地修改、符号链接与非普通文件拒绝覆盖，不跟随链接写穿。替换前备份原文件到 `.project-self-memory/backups/`，备份或准备阶段失败保留原文件。升级不修改记忆正文、评分账本、配置或 cache。

官方识别基于发行文件字节哈希：当前官方产物是本次运行的发行文件本身，已发布的历史版本哈希记录在发行信息里。哈希用于识别已知产物字节，不是可独立认证来源的签名机制。

不提供联网自更新，不在运行时启动时替换自身，不自动提交或忽略运行时产物，也不替用户改全仓库 Git 跟踪策略。

## 旧查看器兼容

旧产物 `view-memoery.js` 原字节保留，仍可自行运行并提供同样的浏览与编辑能力，但不会自动获得新功能。`init` 不再部署它，也不删除或覆盖已有副本。

- `viewer install` / `viewer update`：退出 1，明确说明未执行旧查看器部署或更新，并给出迁移方向（统一 `preview`，或按需 `runtime install`）。不以其它部署冒充成功。
- `viewer status`：只读兼容，继续输出既有状态字段并补充弃用诊断；官方识别只依据已知旧查看器产物哈希，无法识别时如实报告，不把运行时版本当作旧查看器版本。
