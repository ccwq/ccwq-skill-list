# Disposable-copy 安装卫生

安装或验证 host adapter 时，应把 Skill 复制到临时目录，再从不同 `cwd` 启动。不要把验证产生的 `.agents`、`skills-lock.json`、`.pid`、`.port`、`.stream` 或 `.project-self-memory` 运行时目录写回 source Skill 或项目根。

验收至少包括：

1. source Skill 与 `subject/project-self-memory` Junction 两个入口都能运行同一个 adapter。
2. 启动前后 source Skill 和项目根的运行时条目集合不增加（已有污染保留，不删除）。
3. disposable copy 能独立解析 `scripts/memory-session.mjs`，不依赖启动时 `cwd`。

真实 host 接入仍需由宿主系统自行完成；本文件只描述参考 adapter 的验证边界。

