# 教程必须写明「在宿主里敲什么」

用户是 Codex 用户。第一版教程只讲自然语言意图（「说『处理候选』」），被指出不够具体：「应该假设是一个codex用户, 应该如何使用, 我没有看到 类似 project-self-memory -c 这种带指令的用法」。

**Why**：Skill 的真实入口是宿主里的显式调用，不是自然语言。Codex 用 `$` 前缀（`$project-self-memory -c`），Claude Code 用 `/` 前缀。用户在 Codex 里需要知道两件事：敲 `$project-self-memory -c`，以及 skill 装在 `.agents/skills/project-self-memory/`。

**How to apply**：每一步都给可粘贴的命令行，分清「在宿主里敲什么」和「CLI 在背后跑什么」。安装章节给 `skills add --agent codex` 的实测结果（装到 `.agents/skills/`，不是 `.codex/skills/`）。skill 目录与记忆库目录是两个概念，必须分节讲清——直接敲 `node scripts/memory.mjs` 在 Codex 下会失败。
