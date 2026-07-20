---
name: npm-license-declaration
version: 1.0.1
description: 为前端项目生成 npm 第三方依赖许可证声明文档。
disable-model-invocation: true
---

# NPM License Declaration

生成目标项目的 `docs/npm-license-declaration.md`。它是依赖清单和风险提示，不替代法务意见。

## 输入与产物

- 输入：目标项目根目录的 `package.json`；可选 `package-lock.json` 或 `yarn.lock`。
- 输出：覆盖 `docs/npm-license-declaration.md`；目录不存在时创建。
- 范围：仅处理去重、按名称排序后的 `dependencies` 与 `devDependencies`，不处理传递依赖。

## 固定流程

1. 定位项目根目录。优先用用户指定路径，否则用当前工作目录；`package.json` 缺失或无效时停止并报告。
   - 完成条件：已得到全部直接依赖的去重名称集合。
2. 运行生成器。

   ```powershell
   node <skill-directory>/scripts/generate-license-declaration.mjs --project <项目根目录>
   ```

   需要 Node.js 18+。包元数据只取 npm Registry `/latest`；查询失败时，只记录 lock 文件中原样的 `resolved` URL。生成器会处理可重试网络错误，并在写入后验证依赖名称集合和必需章节。
   - 完成条件：命令以 0 退出，并打印输出路径与分级统计。
3. 交付结果：报告输出文件、总依赖数及各分级数量；“⚪ 不可用”项需要手动核实。

## 许可证规则

`references/license-rules.json` 是唯一规则来源：脚本从中读取 SPDX 分级、许可证全称、建议和文档中的分级说明。变更许可证政策时只修改该文件。

## 输出边界

- 条目版本为 npm latest 的 `version`，而非 `package.json` 的 semver 范围。
- 每项都包含功能、GitHub、许可证、分级和建议；缺失值使用“未找到”或“未知”。
- “⚪ 不可用”项同时列在文末的“不可用依赖”中。
- 文档完整重建，以保持其与当前 `package.json` 同步。

## 示例

```text
$npm-license-declaration 为当前 Vue 项目生成依赖许可证声明
$npm-license-declaration 检查 E:\project\portal，并输出 docs/npm-license-declaration.md
```
