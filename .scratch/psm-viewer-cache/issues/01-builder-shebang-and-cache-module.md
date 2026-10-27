Status: resolved
Type: task
Blocked by:
Map: ../map.md

# 01 修复构建器 shebang 缺陷并接入 cache 模块

## Answer

### 改动内容

- **A. shebang 正则**(`scripts/build-viewer.mjs` moduleFactory):`/^#!.*\n/` → `/^#!.*\r?\n/`,CRLF 源首行整体剥离,LF 行为不变。未引入 `.gitattributes`。
- **B. cache 接入**:
  - `MODULES` 在 tags 与 server 之间插入 `['cache', 'memory-cache.mjs']`;
  - `IMPORTS['memory-cache.mjs'] = ['crypto', 'fs', 'path']`(与源文件实际 node: 内置导入一致);
  - 新增 `DEPS_DESTRUCTURE = { 'memory-cache.mjs': ['TYPES'] }`:工厂体开头注入 `const { TYPES } = deps;`,入口接线 `cacheFactory({ TYPES: store.TYPES }, crypto, fs, path)`。未泛化 IMPORTS,其他模块零改动。
- **C. 可运行性防线**(`tests/viewer-server.test.mjs` 复现性用例):在字节幂等断言后追加 `node --check <产物>`(失败即用例失败,`--check` 模式仍只读零写)+ shebang 出现次数恰为 1 的断言;GWT 注释同步更新。
- **D. 产物重建**:`viewer-dist/view-memoery.js` 覆盖重建(新 sha256 `e9379af28d5a…`),manifest 追加该哈希条目(累积表,25 条)。

### 验收结果

1. `node --check skills/project-self-memory/viewer-dist/view-memoery.js` → 通过;`#!` 仅 1 处且在第 1 行。
2. `node --test skills/project-self-memory/tests/viewer-server.test.mjs` → **19 项全绿**(修复前基线 5 pass / 14 fail,14 项全部转绿)。
3. `node skills/project-self-memory/scripts/build-viewer.mjs --check` → `PSM_VIEWER_CONSISTENT`。

另跑 `tests/viewer-deploy.test.mjs`(5 项)确认无意外破坏,全绿。`node --check` 构建器与测试文件自身亦通过。

### 备注

- 开始时发现 worktree 分支落后 `feat/project-self-memory-viewer-cache` 14 个提交(工单里的文件在 HEAD 上不存在),先 `git merge --ff-only` 快进到该分支头再实现。
- 规格外验证:cache 工厂体内的 `TYPES` 仅一处使用(normalisePayload 的 record_type 校验),注入机制足量。

## Task

前置修复,阻塞全部后续工单。只动 `skills/project-self-memory/scripts/build-viewer.mjs` 与重建产物,不动 server/page 源文件。

### A. 修复 shebang 剥离正则(CRLF 兼容)

- 缺陷:`build-viewer.mjs:76` `raw.replace(/^#!.*\n/, '')` —— JS 正则 `.` 不匹配 `\r`,CRLF 源首行 `#!/usr/bin/env node\r\n` 整体失配,shebang 残留进工厂体,产物语法错误(当前产物第 31/227/379/800/1075 行各有一处非法 `#!`)。
- 修复:最小改动,如 `/^#!.*\r?\n/` 或读入后归一化换行,任选其一;保证 LF 与 CRLF 源都正确剥离。
- 不引入 `.gitattributes`(避免全库换行 renormalize 大 diff)。

### B. cache 模块接入构建序列

- `MODULES`(L27-34)增加 `['cache', 'memory-cache.mjs']`;`IMPORTS`(L36-44)为 cache 声明 node: 内置白名单(fs/path/crypto,以源文件实际 import 为准)。
- 处理唯一相对导入:`memory-cache.mjs:19` `import { TYPES } from './memory-store.mjs'` —— stripImports 会剥掉该 import,`TYPES` 需经 deps 注入:工厂体解构处注入 `const { TYPES } = deps;`(或等效机制),入口接线(L122-127)传 `cacheFactory({ TYPES: store.TYPES }, fs, path, crypto)`。`store.TYPES` 来自 storeFactory 返回的导出收集,天然可用。
- 其他模块零改动;不泛化 IMPORTS 支持模块依赖(过度设计)。

### C. 产物可运行性防线

- 复现性用例(`tests/viewer-server.test.mjs:297`)只比字节,对坏产物盲。给该用例或 `--check` 补产物可运行性检查(推荐:用例内对产物跑 `node --check`,失败即断言失败;`--check` 保持只读零写)。

### D. 重建产物并验收

- 重跑构建器生成 `viewer-dist/view-memoery.js` 与 `manifest.json`(坏产物被覆盖,属预期;manifest 是历史哈希累积表,新条目追加)。
- 验收命令(全部必须通过):
  1. `node --check skills/project-self-memory/viewer-dist/view-memoery.js`(产物可解析,`#!` 仅 1 处且在第 1 行)
  2. `node --test skills/project-self-memory/tests/viewer-server.test.mjs` —— 19 项全绿(其中 14 项因本修复转绿,这是验收核心)
  3. `node skills/project-self-memory/scripts/build-viewer.mjs --check` —— `PSM_VIEWER_CONSISTENT`
- 产物与 manifest 一并提交(commit 内含源码修复 + 产物)。

## Comments

- spec 依据:`.scratch/psm-viewer-cache/spec.md`「构建器修复与 cache 模块接入(前置)」节。
- 注意测试套件会重写 viewer-dist(字节幂等),属预期。
