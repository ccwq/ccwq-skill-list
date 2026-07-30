---
name: pro-grilling
description: 手动逐层厘清复杂决策，在共同理解前保持只读。
disable-model-invocation: true
---

# Pro Grilling

这是一个 user-invoked Skill。在 Codex 中，以 `$pro-grilling <待讨论事项>` 显式调用；其他宿主使用其自身提供的手动调用方式。Skill 不声明或依赖 slash command 别名。

1. 将用户随 Skill 名提供的事项视为当前事项；若事项缺失，只询问用户要讨论的事项。
2. 读取并严格执行 [PROTOCOL.md](./PROTOCOL.md)。
3. 需要固定措辞或输出结构时，读取 [TEMPLATES.md](./TEMPLATES.md)。
4. 用户明确确认“已达成共同理解”后，本次 grilling 才算完成。

## 模块映射

- 核心规则：`SKILL.md` 的手动触发、只读边界与完成条件，以及 `PROTOCOL.md` 的初始化、单问题循环、拒绝与回退规则。
- 调查执行：`PROTOCOL.md` 的调查分级、阶段授权、调查回报与分阶段执行。
- 子智能体：`PROTOCOL.md` 的能力探测、权限继承、回传内容与主智能体职责。
- 整合版本：`TEMPLATES.md` 的开场、问题、调查、阶段总结模板；最终以收敛检查汇总当前共识、决策、依赖风险、验收标准和未决项。

完成条件：协议中的收敛检查全部完成，并收到用户的明确确认；否则继续一次只问一个问题，不进入最终方案或实际操作。
