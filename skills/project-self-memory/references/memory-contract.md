# 项目记忆契约

本文件是 `self-memory/memory.md` 中长期内容的唯一规则来源。

## 规范位置

记忆文件固定为 `<project-root>/self-memory/memory.md`。技能可安装于 `<project-root>/.agents/skills/project-self-memory/` 或 Claude Code 的 `<project-root>/.claude/skills/project-self-memory/`。`references/` 只保存技能的说明与格式规则，不保存项目经验。

## 必需的可见来源头

写入第一条结论前，完整复制 [memory-template.md](memory-template.md) 中的来源头。除技能自身维护规则变更外，保持该可见来源头不变。

## 正文形态

按持久的项目主题分组。每个主题使用简短标题，每行使用一个带标签的结论：

```md
## 鉴权

- [事实] 受保护请求前的会话续期由 `src/auth/refresh.ts` 处理。
- [决策] 项目会话 token 使用 HttpOnly Cookie，不存入浏览器存储。
- [避坑] 修改 CSRF 处理后必须运行浏览器流程；仅靠单元测试无法确认 Cookie 已送达。
```

只使用以下标签：

- `[事实]`：已验证的行为、归属、接口、配置或运行时事实。
- `[决策]`：用户确认的长期约束与选择。
- `[避坑]`：已复现的失败模式及其规避规则。

使用仍能聚合未来相关结论的最窄主题标题。新结论只是同一规则但证据更强或表述更新时，改写既有行。替代结论成立后，淘汰旧行；不在本文件内保留归档。
