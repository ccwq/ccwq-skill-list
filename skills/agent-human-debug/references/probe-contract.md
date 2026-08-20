# Probe 模块契约

Probe 是一次最小、可解释、默认只读的证据采集任务。它不是固定脚本库，也不是“尽可能多收集”的诊断包。

## 分类

| 类别 | 回答的问题 | 最小证据示例 |
|---|---|---|
| `environment` | 命令在哪个环境、以何种能力运行？ | OS、Shell、权限、工具是否存在 |
| `filesystem` | 文件是否存在、可访问、内容是否符合预期？ | 元数据、有限 hash、权限、相关路径 |
| `process` | 目标是否运行、由谁启动、退出为何？ | PID、父进程、状态、有限命令行 |
| `network` | 名称、路由、端口、TLS 或代理在哪一层失败？ | DNS、TCP、HTTP 状态、代理状态 |
| `application` | 业务入口返回什么、何时失败？ | 健康响应、错误码、版本、最小请求结果 |
| `configuration` | 必要配置键是否存在且被读取？ | 键名、非敏感类型/状态、加载来源 |
| `logs` | 哪段有限上下文解释异常？ | 时间窗口、相关 request ID、错误摘要 |
| `security` | 权限、认证或安全边界是否阻断行为？ | UID/ACL 状态、认证失败类别、证书元数据 |

## 必填元数据

每个 probe 在说明和报告中都必须可追溯到：

```text
probe_id: <category>/<short-name>
purpose: <一个可证伪的假设>
operation: read-only | low-risk-change | high-risk-change | destructive
environment_requirements: <所需 shell/tool，允许 unknown>
inputs: <最少人工填写项，默认无>
evidence_limits: <行数、时间窗、目录深度、请求数等上限>
```

Probe 脚本自身必须将 stdout、stderr 和退出码转换为有限的证据字段。命令缺失、权限拒绝、超时和采集异常必须分别标记，不能伪装成被测对象失败。

## 编写规则

1. 一个 probe 只服务一个当前假设；多个竞争假设优先拆为可比较的小 probe。
2. 首选已有系统命令；不自动安装依赖、提权、联网或上传。
3. 路径、端口、服务名等可填参数置于脚本开头，并安全引用；不要把用户输入交给 `eval`、拼接 shell 代码或广泛通配符。
4. 默认设定采集上限：日志限定时间窗/行数，目录限定深度/条目数，网络请求限定次数/超时。
5. 聚合完成后先 sanitize，再输出、写剪切板或写临时文件；原文不得落盘。
6. 所有失败分支仍尽力输出一个合法 `debug_report`，除非连报告自身也无法生成。

## 执行与回传

成功采集不代表诊断成功。脚本完成时使用 `RESULT_READY`，并在 `SUMMARY` 中记录：`collection_status`（`ok`、`partial`、`fatal`）、`clipboard_status`（`ok`、`unavailable`、`skipped_for_review`）与 `redaction_status`（`ok`、`review`、`failed`）。

若 `redaction_status` 不是 `ok`，只允许将报告输出到终端或脱敏临时文件，提示人工审查；禁止自动剪切板写入。
