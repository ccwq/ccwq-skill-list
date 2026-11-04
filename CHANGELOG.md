# Skill 演进日志

面向安装和使用本仓库 Skill 的人，记录各 Skill 何时加入本仓库，以及此后影响调用方式、行为边界、结果或安装的变化。安装方法与当前参数见 [README](README.md)。

## 记录规则与历史范围

- 首版检查了截至 2026-11-03 [9eca6a6](https://github.com/ccwq/ccwq-skill-list/commit/9eca6a6) 的全部 **230 个 HEAD 可达提交**，起点为 2026-04-08 [690e2b4](https://github.com/ccwq/ccwq-skill-list/commit/690e2b4)。覆盖旧根目录、历史路径、合并分支与当前 `skills/`，不是只扫描现有目录。
- 日期采用 Git 提交的作者日期（`%as`），仅用于追溯，不据此推断合入主分支、发布、上架、安装生效或上游创建时间。导入文档中的旧日期和版本不是本仓库的引入证据；仓库没有 Git tag，也没有据此编造统一发布版本。
- 每个 Skill 固定归属其**首次引入本仓库的提交批次**；同一引入提交中的多个 Skill 共用批次文件，各章中的事件按演进顺序排列。一个用户可理解的事件可以合并实现、文档和验证提交，不逐条复制提交日志。
- 只筛选有用户影响的变化。纯测试、产物刷新和内部重构不逐 Skill 列出；影响安装或跨平台分发的变化归入[仓库共用变化](docs/changelog/shared.md)。原有 Skill 级 `CHANGELOG.md` 保持独立，不由本文件替代。
- **人工维护**：新增 Skill 时按首次引入提交创建批次；同批次 Skill 共用一份文件。已有 Skill 的重要变化追加到原批次对应章节，保留真实日期和提交链接，不因后续调整提交新建该 Skill 的批次。更名或移除必须有历史证据；没有用户可见变化时，不为凑条目写“更新”。

## 批次索引

每批按首次引入提交分组，按提交作者时间倒序排列，最新批次在前；表中日期为作者日期，同日批次仍按具体作者时间倒序。本次覆盖 33 个 Skill，划分为 33 个引入批次；现有批次各含一个 Skill，不将同日的独立引入提交合并。

| 引入日期 | 引入提交 | 批次文件 | Skill 成员 |
|---|---|---|---|
| 2026-11-03 | [9eca6a6](https://github.com/ccwq/ccwq-skill-list/commit/9eca6a6) | [9eca6a6](docs/changelog/9eca6a6.md) | advise-motion-effects |
| 2026-11-03 | [861a22d](https://github.com/ccwq/ccwq-skill-list/commit/861a22d) | [861a22d](docs/changelog/861a22d.md) | skill-to-prompt |
| 2026-10-28 | [5dbeae3](https://github.com/ccwq/ccwq-skill-list/commit/5dbeae3) | [5dbeae3](docs/changelog/5dbeae3.md) | handoff-portable |
| 2026-10-15 | [08990aa](https://github.com/ccwq/ccwq-skill-list/commit/08990aa) | [08990aa](docs/changelog/08990aa.md) | wechat-headlines |
| 2026-10-08 | [d72e9a3](https://github.com/ccwq/ccwq-skill-list/commit/d72e9a3) | [d72e9a3](docs/changelog/d72e9a3.md) | claude-proj-skill-linker |
| 2026-09-30 | [14b18c2](https://github.com/ccwq/ccwq-skill-list/commit/14b18c2) | [14b18c2](docs/changelog/14b18c2.md) | bash-completion |
| 2026-08-25 | [da3c738](https://github.com/ccwq/ccwq-skill-list/commit/da3c738) | [da3c738](docs/changelog/da3c738.md) | progressive-doc |
| 2026-08-25 | [23e5445](https://github.com/ccwq/ccwq-skill-list/commit/23e5445) | [23e5445](docs/changelog/23e5445.md) | engineering-method-selector |
| 2026-08-19 | [b6393a9](https://github.com/ccwq/ccwq-skill-list/commit/b6393a9) | [b6393a9](docs/changelog/b6393a9.md) | network-debug |
| 2026-08-13 | [4442643](https://github.com/ccwq/ccwq-skill-list/commit/4442643) | [4442643](docs/changelog/4442643.md) | website-state-sync-agent |
| 2026-08-12 | [af760ad](https://github.com/ccwq/ccwq-skill-list/commit/af760ad) | [af760ad](docs/changelog/af760ad.md) | tutor-man |
| 2026-08-12 | [b0d42e2](https://github.com/ccwq/ccwq-skill-list/commit/b0d42e2) | [b0d42e2](docs/changelog/b0d42e2.md) | agent-human-debug |
| 2026-08-11 | [bfa59d7](https://github.com/ccwq/ccwq-skill-list/commit/bfa59d7) | [bfa59d7](docs/changelog/bfa59d7.md) | tool-evaluator |
| 2026-08-11 | [d06f230](https://github.com/ccwq/ccwq-skill-list/commit/d06f230) | [d06f230](docs/changelog/d06f230.md) | deep-investigation |
| 2026-08-06 | [4db3095](https://github.com/ccwq/ccwq-skill-list/commit/4db3095) | [4db3095](docs/changelog/4db3095.md) | joint-debugging |
| 2026-08-05 | [ad63d4c](https://github.com/ccwq/ccwq-skill-list/commit/ad63d4c) | [ad63d4c](docs/changelog/ad63d4c.md) | dockerhub-mirror |
| 2026-08-04 | [98a6161](https://github.com/ccwq/ccwq-skill-list/commit/98a6161) | [98a6161](docs/changelog/98a6161.md) | subagent-router |
| 2026-07-31 | [cb378b3](https://github.com/ccwq/ccwq-skill-list/commit/cb378b3) | [cb378b3](docs/changelog/cb378b3.md) | chatgpt-web-skill |
| 2026-07-30 | [05df0f6](https://github.com/ccwq/ccwq-skill-list/commit/05df0f6) | [05df0f6](docs/changelog/05df0f6.md) | aria-filedown |
| 2026-07-30 | [d1c55c1](https://github.com/ccwq/ccwq-skill-list/commit/d1c55c1) | [d1c55c1](docs/changelog/d1c55c1.md) | pro-grilling |
| 2026-07-29 | [7fcc8bf](https://github.com/ccwq/ccwq-skill-list/commit/7fcc8bf) | [7fcc8bf](docs/changelog/7fcc8bf.md) | project-self-memory |
| 2026-07-23 | [e621bad](https://github.com/ccwq/ccwq-skill-list/commit/e621bad) | [e621bad](docs/changelog/e621bad.md) | debug-instrumentation |
| 2026-07-20 | [78c4fdd](https://github.com/ccwq/ccwq-skill-list/commit/78c4fdd) | [78c4fdd](docs/changelog/78c4fdd.md) | npm-license-declaration |
| 2026-07-20 | [5c8f9ca](https://github.com/ccwq/ccwq-skill-list/commit/5c8f9ca) | [5c8f9ca](docs/changelog/5c8f9ca.md) | gemin-mirror |
| 2026-07-08 | [11d6aea](https://github.com/ccwq/ccwq-skill-list/commit/11d6aea) | [11d6aea](docs/changelog/11d6aea.md) | ntl-script-descriptions |
| 2026-06-30 | [4c4c368](https://github.com/ccwq/ccwq-skill-list/commit/4c4c368) | [4c4c368](docs/changelog/4c4c368.md) | codex-windows-hooks-fix |
| 2026-06-25 | [40945b7](https://github.com/ccwq/ccwq-skill-list/commit/40945b7) | [40945b7](docs/changelog/40945b7.md) | lite-team |
| 2026-06-25 | [afa6e34](https://github.com/ccwq/ccwq-skill-list/commit/afa6e34) | [afa6e34](docs/changelog/afa6e34.md) | rd-mode |
| 2026-05-29 | [2e41a96](https://github.com/ccwq/ccwq-skill-list/commit/2e41a96) | [2e41a96](docs/changelog/2e41a96.md) | ffmpeg-video-processing |
| 2026-04-20 | [294f65d](https://github.com/ccwq/ccwq-skill-list/commit/294f65d) | [294f65d](docs/changelog/294f65d.md) | nano-prompt |
| 2026-04-16 | [6b04224](https://github.com/ccwq/ccwq-skill-list/commit/6b04224) | [6b04224](docs/changelog/6b04224.md) | git-history-cleaner |
| 2026-04-15 | [492cc9e](https://github.com/ccwq/ccwq-skill-list/commit/492cc9e) | [492cc9e](docs/changelog/492cc9e.md) | software-license-checker |
| 2026-04-08 | [690e2b4](https://github.com/ccwq/ccwq-skill-list/commit/690e2b4) | [690e2b4](docs/changelog/690e2b4.md) | git-up |

## Skill 快速查找

| Skill | 演进记录 |
|---|---|
| git-up | [git-up](docs/changelog/690e2b4.md#git-up) |
| software-license-checker | [software-license-checker](docs/changelog/492cc9e.md#software-license-checker) |
| git-history-cleaner | [git-history-cleaner](docs/changelog/6b04224.md#git-history-cleaner) |
| nano-prompt | [nano-prompt](docs/changelog/294f65d.md#nano-prompt) |
| ffmpeg-video-processing | [ffmpeg-video-processing](docs/changelog/2e41a96.md#ffmpeg-video-processing) |
| rd-mode | [rd-mode](docs/changelog/afa6e34.md#rd-mode) |
| lite-team | [lite-team](docs/changelog/40945b7.md#lite-team) |
| codex-windows-hooks-fix | [codex-windows-hooks-fix](docs/changelog/4c4c368.md#codex-windows-hooks-fix) |
| ntl-script-descriptions | [ntl-script-descriptions](docs/changelog/11d6aea.md#ntl-script-descriptions) |
| gemin-mirror | [gemin-mirror](docs/changelog/5c8f9ca.md#gemin-mirror) |
| npm-license-declaration | [npm-license-declaration](docs/changelog/78c4fdd.md#npm-license-declaration) |
| debug-instrumentation | [debug-instrumentation](docs/changelog/e621bad.md#debug-instrumentation) |
| project-self-memory | [project-self-memory](docs/changelog/7fcc8bf.md#project-self-memory) |
| pro-grilling | [pro-grilling](docs/changelog/d1c55c1.md#pro-grilling) |
| aria-filedown | [aria-filedown](docs/changelog/05df0f6.md#aria-filedown) |
| chatgpt-web-skill | [chatgpt-web-skill](docs/changelog/cb378b3.md#chatgpt-web-skill) |
| subagent-router | [subagent-router](docs/changelog/98a6161.md#subagent-router) |
| dockerhub-mirror | [dockerhub-mirror](docs/changelog/ad63d4c.md#dockerhub-mirror) |
| joint-debugging | [joint-debugging](docs/changelog/4db3095.md#joint-debugging) |
| deep-investigation | [deep-investigation](docs/changelog/d06f230.md#deep-investigation) |
| tool-evaluator | [tool-evaluator](docs/changelog/bfa59d7.md#tool-evaluator) |
| agent-human-debug | [agent-human-debug](docs/changelog/b0d42e2.md#agent-human-debug) |
| tutor-man | [tutor-man](docs/changelog/af760ad.md#tutor-man) |
| website-state-sync-agent | [website-state-sync-agent](docs/changelog/4442643.md#website-state-sync-agent) |
| network-debug | [network-debug](docs/changelog/b6393a9.md#network-debug) |
| engineering-method-selector | [engineering-method-selector](docs/changelog/23e5445.md#engineering-method-selector) |
| progressive-doc | [progressive-doc](docs/changelog/da3c738.md#progressive-doc) |
| bash-completion | [bash-completion](docs/changelog/14b18c2.md#bash-completion) |
| claude-proj-skill-linker | [claude-proj-skill-linker](docs/changelog/d72e9a3.md#claude-proj-skill-linker) |
| wechat-headlines | [wechat-headlines](docs/changelog/08990aa.md#wechat-headlines) |
| handoff-portable | [handoff-portable](docs/changelog/5dbeae3.md#handoff-portable) |
| skill-to-prompt | [skill-to-prompt](docs/changelog/861a22d.md#skill-to-prompt) |
| advise-motion-effects | [advise-motion-effects](docs/changelog/9eca6a6.md#advise-motion-effects) |

## 仓库共用变化

完整记录见[仓库共用变化](docs/changelog/shared.md#仓库共用变化)。
