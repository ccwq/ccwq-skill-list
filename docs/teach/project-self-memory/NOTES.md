# 教程工作笔记

## 用户偏好

- 输出中文。启用 `ste`（ASD-STE100 中文版）：回复要短句、关键信息先行、状态词固定。
- 要求「详细到每个特性如何使用 + 工作原理简述」。所以每个特性都要写：怎么用、看到什么、原理一句话、边界。
- **视角必须是使用者，不是 CLI。** 第一版教程按命令表组织，被明确否定：「内容非常差劲，我需要补充使用 skill 的视角来使用的文档，当前的文档完全是 cli 视角」。改法：正文按「你的意图」组织——我此刻想干什么、我该对 agent 说什么、它会替我做哪些事、我需要决定什么。命令退到附录。

## 教学写法约定

- 每节用「剧本」组件呈现：场景 → 你说什么 → agent 做什么 → 你要决定什么 → 结果。
- 每个特性先给「怎么用」，再给「工作原理」一段，最后给边界与常见坑。
- **必须写明「在宿主里敲什么」**。第一版只写自然语言意图，被否定。用户是 Codex 用户，要看到 `$project-self-memory -c` 这种带指令的写法，以及 skill 装在哪、CLI 路径怎么解析。
- **两个目录必须分清**：skill 目录（`.agents/skills/project-self-memory/`，固定）与记忆库目录（`<项目根>/.project-self-memory/`，跟项目走）。
- 事实来源优先级：代码 > `references/cli-contract.md` > `SKILL.md` > skill README > 根 README。
- 本机可实测的：`skills add --agent codex` 的安装落点、CLI 的实际输出、错误前缀。

## 本仓库的文档分工（AGENTS.md）

- 根 `README.md`：安装索引 + 参数速查。本教程不重复它，只做解释与串联。
- `skills/project-self-memory/SKILL.md`：行为规范。
- `skills/project-self-memory/references/*.md`：单主题细节。
- `skills/project-self-memory/scripts/*.mjs`：唯一真相。教程与代码冲突时以代码为准。

## 已确认的关键事实（来自本次实现）

- cache 落盘文件：`.project-self-memory/cache.jsonl`，锁 `.project-self-memory/cache.lock`。
- 落盘字段：`event_id, type, target_refid, target_record_version, base_content, payload, evidence, source, created_at, processed_at, status`。
- `status` 只有三态：`pending` / `applied` / `discarded`。`stale` 是读时派生，不落盘。
- `event_id` = sha256(op + target_refid + payload fingerprint + source) 前 32 位。含会话维度，所以同会话重复幂等，跨会话重复保留两条。
- 五种操作：`add` / `update` / `delete` / `+1` / `-1`。
- 自动评分方向映射：`applied_success`/`still_valid` → `+1`，`applied_failure` → `-1`，`review_candidate` 不投票。
- pending 超过 20 条给出非阻断 warning。
- `cache prune` 只清已处理与已失效条目；pending 无 TTL，不自动过期。
- 自动流程的证据内联进条目（reason / observation / event_id / kind / observed_at），`-c` 展示不需要回查 `evidence.jsonl`。
- 修改类候选的落地正文优先取 `--content-file`，即「改写后写入」。

## 待确认

- 用户是否希望教程进入根 README 的参数速查。暂按 AGENTS.md 分工处理：教程放 `docs/teach/`，根 README 不动。
