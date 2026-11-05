# 引入批次 7fcc8bf

- **真实引入提交**：[7fcc8bf](https://github.com/ccwq/ccwq-skill-list/commit/7fcc8bf)
- **作者日期**：2026-07-29
- **批次 Skill**：`project-self-memory`
- **根日志索引**：[CHANGELOG.md](../../CHANGELOG.md#skill-快速查找)

批次成员固定；后续变化持续记录在本文件对应 Skill 下，不因调整提交新建该 Skill 的批次。

## project-self-memory

当前说明：[README](../../skills/project-self-memory/README.md)。

### 首次引入

- **2026-07-29**：加入项目级结论记忆，初始活动文件为 `self-memory/memory.md`，保存已验证事实、长期决策和避坑；当时要求项目级安装位置，并支持显式记忆请求，尚不是后来的 Node CLI、cache 或查看器方案。[7fcc8bf](https://github.com/ccwq/ccwq-skill-list/commit/7fcc8bf)

### 重要调整

- **2026-07-29**：补充 `.claude/skills` 项目级安装支持，新增逐问 Grilling 经验盘点；讨论完成并得到明确确认前不写入记忆。[5b14bec](https://github.com/ccwq/ccwq-skill-list/commit/5b14bec)
- **2026-07-31**：Grilling 结束确认统一为明确回复 `ok`，不再使用“已达成共同理解”作为固定结束口令。[6750ca3](https://github.com/ccwq/ccwq-skill-list/commit/6750ca3)
- **2026-08-02**：加入记忆 Trim 整理能力，围绕已有结论讨论保留、修订、合并或删除，区别于新增经验盘点；同日并行分支中的重复变化按一个演进事件记录。[ab71e18](https://github.com/ccwq/ccwq-skill-list/commit/ab71e18) · [e203573](https://github.com/ccwq/ccwq-skill-list/commit/e203573)
- **2026-08-05**：活动存储迁到 `.project-self-memory/`，由 Node CLI 独占读写；旧 `self-memory/` 变为只读 legacy 来源。引入结构化记录、评分、人工策展、分组和显式迁移流程；Node 缺失或结构损坏时停止相关写入并降级，不直接手改活动文件。[2d5d87c](https://github.com/ccwq/ccwq-skill-list/commit/2d5d87c)
- **2026-08-11**：补全宿主自动加载、保存与评分的证据闭环，提供可运行的 `MemorySession` 参考适配器及审计结果；明确参考适配器不代表某个生产宿主已经完成接入。[e87b488](https://github.com/ccwq/ccwq-skill-list/commit/e87b488)
- **2026-10-20**：人工讨论改用自适应轮次预算，允许证据充分时提前结束、出现冲突时扩展；区分讨论共识与具体写入授权，避免把固定轮数或一句确认当成无限授权。[f38a884](https://github.com/ccwq/ccwq-skill-list/commit/f38a884)
- **2026-10-22**：加入本机紧凑查看器，可浏览和修改正文、类型与状态；仅监听回环地址，写入与 CLI 共用锁、备份、原子替换和乐观并发保护。[98db08a](https://github.com/ccwq/ccwq-skill-list/commit/98db08a)
- **2026-10-23**：修复查看器部署后的路径推导，默认自动打开系统浏览器，并提供禁止自动打开的选项。[2d675ec](https://github.com/ccwq/ccwq-skill-list/commit/2d675ec)
- **2026-10-23**：新增紧凑单行表达契约、首次非空召回用量提醒和可选派生多标签；保留旧多行记录及 legacy 分组兼容。随后修正标签行为：标签用于显式筛选和只读观测，不参与检索 rank 排序。[dea0759](https://github.com/ccwq/ccwq-skill-list/commit/dea0759) · [073a9a3](https://github.com/ccwq/ccwq-skill-list/commit/073a9a3)
- **2026-10-23**：改变自动保存/评分语义：**自动流程只暂存 cache，不再直接写记忆库或评分账本**；`-c/--cache-write` 按候选逐条征得写入或丢弃选择，可中断后继续。既有配置字段名不变，但含义改为自动暂存；修订、删除和评分也可以作为候选暂存。[77a0188](https://github.com/ccwq/ccwq-skill-list/commit/77a0188) · [0cb6dcc](https://github.com/ccwq/ccwq-skill-list/commit/0cb6dcc)
- **2026-10-24**：同步上述暂存语义和脚本路径说明，明确 Skill 自身位置与被操作项目根目录不同，避免从当前工作目录误找 CLI。[b04785f](https://github.com/ccwq/ccwq-skill-list/commit/b04785f)
- **2026-10-26**：增加 `-a` 显式暂存入口，细化任务收尾时机与提示词宿主行为：最终答复前只暂存本次任务已验证的新增结论，报告候选 ID，并说明尚未落库；连用 `-a -c` 时先暂存、再逐条确认。[5426028](https://github.com/ccwq/ccwq-skill-list/commit/5426028)
- **2026-10-27**：查看器加入暂存区面板及配套服务路由，可以查看、编辑并入、丢弃和清理候选；这是 cache 入库流程的可视化入口，不取消写入安全校验。[5c24779](https://github.com/ccwq/ccwq-skill-list/commit/5c24779) · [48d854c](https://github.com/ccwq/ccwq-skill-list/commit/48d854c) · [c65f7f7](https://github.com/ccwq/ccwq-skill-list/commit/c65f7f7)
- **2026-11-05**：新增随 Skill 安装的自包含单文件运行时 `runtime-dist/psm-cli.js`，把全部业务命令与 Web 预览合并为一个入口；写明运行时定位契约：按宿主加载位置定位，项目里没有 Skill 目录不等于工具不可用，不再建议把整套 Skill 装进项目。`init` 不再部署任何可执行文件；需要项目独立运行时才显式部署一个 `psm-cli.js`，升级只替换可识别的官方旧产物；旧独立查看器保留原样，其部署与升级命令退出并说明未执行。[d875a50](https://github.com/ccwq/ccwq-skill-list/commit/d875a50) · [6f354b3](https://github.com/ccwq/ccwq-skill-list/commit/6f354b3)
