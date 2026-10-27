Status: resolved
Type: task
Blocked by:
Map: ../map.md

# 05 产物行尾漂移:autocrlf 下构建产物跨环境不一致

## Answer

采用方案 A(构建器行尾归一化),`build-viewer.mjs` 三处改动:

1. `moduleFactory` 读源后 `replace(/\r\n/g, '\n')` 归一化,再做 shebang 剥离(`/^#!.*\r?\n/` 正则保持不变,归一化后 LF 源与 CRLF 源均正确匹配)。
2. 入口模板 `build()` 返回前 `entry.replace(/\r\n/g, '\n')`——入口模板是构建器文件内的多行字面量,autocrlf 下构建器自身磁盘行尾是 CRLF,会原样进入产物,这一处不做则产物仍随环境漂移(工单文本「入口模板与产物写盘全程 LF」的落地)。
3. `--check` 比对 dist 时同样归一化:产物在仓库内是 LF,但 autocrlf 环境 fresh checkout 后磁盘字节是 CRLF,按原字节比对必报假漂移;归一化后只对真实内容漂移报警。

测试 `viewer-server.test.mjs`:

- 原复现性用例首读/二读改为归一化文本比对(忽略 checkout 行尾),其余断言(node --check、shebang 唯一、--check 通过)不变。
- 新增用例 `mixed-eol sources build to a byte-stable artifact`:临时副本目录注入 `here`,分别以全 CRLF 源与 CRLF/LF 逐行交替混合源构建,断言产物与归一化基线一致;并断言产物本体无 CRLF(全程 LF)。混合源注入前先归一到 LF,保证构造的是真混合行尾,避免在 CRLF 上叠 CRLF 的恒真构造。

验收 1(混合行尾源产物字节一致)在 autocrlf=true 本机实测通过;产物重建为纯 LF(2868 行 0 CRLF),manifest 追加新哈希。产物哈希变化会使 `viewer status` 对旧部署报 up_to_date=false,属预期,`viewer update` 即可同步。

## Task

### 问题

本机 `core.autocrlf=true`,仓库无 `.gitattributes`。构建器按磁盘原样读源(`scripts/build-viewer.mjs`),产物字节随 checkout 行尾浮动:提交时 CRLF,checkout 后源变 LF,重建产物即漂移。`--check` 只比字节,对「内容同而行尾异」敏感,跨环境报漂移;同环境内自洽。T1-T04 工单期间已实际观察到(03 工单坑 3)。

### 要做(两个方案二选一,倾向 A)

**方案 A(推荐):构建器行尾归一化**

- `moduleFactory` 读源后统一 `replace(/\r\n/g,'\n')` 归一化(shebang 修复已在正则层兼容 CRLF,此处再保证产物字节确定);入口模板与产物写盘全程 LF(`writeFileSync` 不引入平台转换,Node 默认不转)。
- `tests/viewer-server.test.mjs` 复现性用例补一条:模拟 CRLF/LF 混合源(临时副本)构建,断言产物字节一致。
- 重建产物提交。

**方案 B:`.gitattributes`**

- `skills/project-self-memory/**/*.mjs text eol=lf` + `skills/project-self-memory/viewer-dist/* -text`,checkout 即 LF。
- 代价:全库相关文件 renormalize 一次(commit 大),且影响其他贡献者的 checkout 行尾。

### 验收

1. `git config core.autocrlf` 为 true 的环境下:改任一源文件行尾再重建,产物字节与归一化后构建一致。
2. `node --test skills/project-self-memory/tests/viewer-server.test.mjs` 全绿。
3. `node skills/project-self-memory/scripts/build-viewer.mjs --check` 一致。

## Comments

- 来源:T1/T03 工单均报告;详情见 `.scratch/psm-viewer-cache/issues/03-page-staging-panel.md` 坑 3。
