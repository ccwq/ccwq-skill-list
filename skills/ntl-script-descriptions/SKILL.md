---
name: ntl-script-descriptions
version: 1.0.0
description: 为包含 package.json 的项目补充 ntl 可读取的 scripts 说明；适用于 ntl、Node Task List、package scripts 描述、维护 ntl.descriptions 等场景。
---

# NTL Script Descriptions

用于给项目 `package.json` 的 `scripts` 补充 `ntl.descriptions`。`ntl` 会读取这些说明，并在交互式脚本列表里展示，避免用户只看到 `build:xxx`、`dev:xxx` 这类缺少上下文的入口。

## 适用场景

- 项目根目录或用户指定目录存在 `package.json`。
- 用户希望解释、整理或补充 `package.json` scripts 的用途。
- 用户明确提到 `ntl`、`Node Task List`、`ntl.descriptions`、`--descriptions`、`--descriptions-only`。
- 用户想让前端项目的 `npm run` / `pnpm run` / `yarn` scripts 更容易选择和理解。

## 目标产物

核心产物是写回 `package.json`：

```json
{
  "scripts": {
    "build": "vite build",
    "test": "vitest run"
  },
  "ntl": {
    "descriptions": {
      "build": "构建生产环境产物，执行 vite build。",
      "test": "运行 Vitest 单元测试。"
    }
  }
}
```

不要默认把说明写入 `README.md` 或 `docs/`。只有用户明确要求文档同步时，才额外更新文档。

## 工作流程

1. 定位目标 `package.json`。
   - 优先使用用户指定路径。
   - 未指定时使用当前工作目录的 `package.json`。
   - 找不到时，向用户报告缺少目标文件，不要凭空创建 Node 项目。
2. 解析 `package.json`，读取：
   - `scripts`
   - 现有 `ntl.descriptions`
   - `packageManager`、依赖和常见配置文件，用来理解脚本语义
3. 为每个 `scripts` key 生成说明。
   - 默认覆盖所有 scripts，包括 `pre*` / `post*` lifecycle scripts。
   - 保留已有 `ntl.descriptions`，只补缺失项。
   - 如果已有说明和脚本命令明显冲突，只在最终报告里标出，不自动覆盖。
4. 写回 `package.json`。
   - 保持 JSON 可读缩进，通常使用 2 空格。
   - 不重排无关字段；把 `ntl` 放在已有位置，若不存在则追加到顶层后部即可。
5. 写入后验证。
   - 必须重新解析 `package.json`，确认 JSON 合法。
   - 必须确认每个新增说明都位于 `ntl.descriptions`。
   - 不要自动安装或运行 `ntl`，除非用户明确要求。
6. 汇报变更清单。
   - 新增了哪些 script 说明。
   - 保留了哪些已有说明。
   - 跳过或冲突了哪些项。
   - JSON 校验结果。

## 说明文案规则

- 默认使用中文，命令、框架名、script 名、文件名、环境变量保留英文。
- 每条说明保持简短，适合在 `ntl` 交互列表中横向展示。
- 优先说明“这个 script 做什么”，必要时补充“何时使用”。
- 不要机械复述命令全文；命令已经在 `scripts` 里存在。
- 如果脚本只是包装另一个脚本，要说明它的入口语义，而不是只写“运行 xxx”。
- 如果无法确定语义，使用保守说明，并在报告中标记为“需人工确认”。

常见映射参考：

```text
dev/start      启动本地开发服务
build          构建生产环境产物
preview        预览生产构建结果
test           运行测试
test:watch     以 watch 模式运行测试
lint           运行代码规范检查
format         格式化代码
typecheck      运行 TypeScript 类型检查
prepare        安装后或发布前的准备步骤
pretest        测试前置检查或准备步骤
postbuild      构建后的收尾步骤
```

## 语义调查方法

不要只靠 script 名猜测。优先结合命令和项目文件判断：

- `vite`、`webpack`、`rollup`、`tsup`、`unbuild` 通常是构建或开发服务。
- `vitest`、`jest`、`tap`、`playwright`、`cypress` 通常是测试。
- `eslint`、`biome`、`prettier`、`stylelint` 通常是质量检查或格式化。
- `vue-tsc`、`tsc --noEmit` 通常是类型检查。
- `capacitor`、`gradle`、`android`、`ios` 通常和移动端构建或运行有关。
- `node scripts/*.js`、`tsx scripts/*.ts` 需要查看对应脚本文件名，必要时读取脚本头部或核心函数。

如果一个命令链较复杂，先拆解关键命令：

```json
{
  "build:android": "node scripts/build-android.mjs && npx cap sync android"
}
```

可描述为：

```text
构建 Android 相关产物并同步 Capacitor Android 工程。
```

## 保留和冲突规则

- 已存在 `ntl.descriptions.<script>` 时默认保留。
- 不要为了统一风格自动重写已有说明。
- 如果 `scripts.test` 已从 `jest` 改成 `vitest`，但说明仍写 “运行 Jest 测试”，最终报告中标记冲突。
- 删除了 script 但仍残留描述时，不自动删除；在报告中列为“孤儿说明”，由用户决定是否清理。

## 写入注意事项

- 只修改目标 `package.json`，除非用户要求同步其他文件。
- 不要自动安装 `ntl`，也不要添加 `devDependencies.ntl` 或 `scripts.start = "ntl"`。添加依赖属于另一个决策。
- 不要运行 scripts；有些脚本会启动服务、发布、删除文件或访问网络。
- 修改测试文件时才需要测试用例 GWT 注释；本 skill 通常只改配置文件。

## 输出格式

完成后用中文报告，结构如下：

```text
已更新 <path-to-package.json> 的 ntl.descriptions。

新增说明：
- dev：启动本地开发服务。
- build：构建生产环境产物。

保留已有说明：
- test：运行单元测试。

需人工确认：
- deploy：命令包含发布动作，说明已保守生成/未覆盖。

校验：
- JSON 解析：通过
- ntl.descriptions 覆盖：新增 2 项，保留 1 项
```

如果没有写入，明确说明原因和下一步需要用户提供什么。
