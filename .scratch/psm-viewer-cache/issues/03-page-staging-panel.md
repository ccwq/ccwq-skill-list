Status: resolved
Type: task
Blocked by: 01
Map: ../map.md

# 03 页面:暂存区面板

## Answer

### 改动内容

只动 `skills/project-self-memory/scripts/viewer-page.mjs`(新增约 340 行),并重建产物。

- **工具栏**(「重新加载」按钮前):新增「暂存区」切换按钮 + 内嵌计数徽标(`#cache-badge`,样式仿 `.pill` 先例,实心 accent 底白字)。计数取 `snapshot.cache.count`,为 0 时徽标隐藏且按钮置灰(muted 类),tooltip 提示「暂存区没有待处理项」。
- **面板**(仿 `#editor`):`#cache-panel` 与编辑器同为 `#main` 内的右侧 390px 列,`.hidden` toggle 显示/隐藏;窄屏 `@media (max-width:767px)` 与编辑器一样转 `position:fixed; inset:0` 全屏。**与编辑器互斥未做强制**——两者可同时打开(编辑器 390px + 面板 390px 并列,列表自动收窄),以实现简洁为准(工单允许)。
- **头部**:`暂存区` 标题 + 「清理已处理」「刷新」「关闭」三个面板级按钮;空态在 `#cache-body` 内显示「暂存区没有待处理项」。
- **渲染**(全部 `textContent`/`createElement`,零 innerHTML):
  - 按 `cache.groups` 逐组渲染:组头含 kind 徽标(新记录/失效)、目标 refid、组级 conflict(「冲突」pill)、条目数;stale 组加红色边框(`.stale-group`)。
  - 每条候选:类型徽标(新增/修订/删除/调分+/调分-,配色沿用类型 pill 先例)、来源与暂存时间;`evidence` 的 reason/observation/kind/observed_at 以两列网格内联展示(空字段跳过)。
  - update 条目给「原正文」对照块(`base_content`,左灰条引用样式);stale 条目给「原基准」+「现状」(`current.content`,记录不存在时注明)双对照,左条红色。
  - add/update(非 stale)预填 `payload.content` 的 textarea(仿编辑器,`spellcheck=false`);stale 条目不渲染 textarea(只给丢弃);delete/±1 无 textarea。
- **操作映射**(复用既有 `api()` 帮手,Bearer 自动携带):
  - 写入 → `POST /api/cache/<event_id>/apply`,body `{ store_revision, content? }`;content 仅 add/update 且带编辑框时携带编辑框当前值;delete/±1 写入前 `confirm` 确认;apply body 不带 content。
  - 丢弃 → `POST /api/cache/<event_id>/discard`,无确认(轻量,工单允许);body `{ store_revision }`。
  - 清理 → `POST /api/cache/prune`,写前 `confirm`;body `{ store_revision }`(简化为不带天数,工单允许)。
  - 失效(stale)组只渲染「丢弃」按钮,不提供写入入口(失效拒直写)。
- **状态与错误处理**:操作成功走 `acceptSnapshot(r.body.snapshot)` 整体刷新(徽标、列表、面板全部重建),`state.cacheDrafts` 中对应草稿清除;失败路径(409/503/其他)**不重渲染面板**——草稿 textarea 原样保留,`setStatus` 按编辑器先例文案提示(409 用 conflict 样式提示「重新加载」,503 提示锁忙稍后重试,其余展示 `body.message`)。打开面板与点「刷新」时拉一次快照(`load()` 同款 acceptSnapshot+render 路径)避免陈旧数据;`load()` 完成时若面板开着也重渲染面板。
- **细节**:`state.cacheDrafts`(event_id → 编辑值)在重渲染时回填;`state.cacheBusy` 防并发提交(操作期间禁用面板全部按钮);旧版 server 无 cache 节时按空处理(空态,不报错);无「新建候选」入口;pending 不过期。

### 验收结果

1. `node skills/project-self-memory/scripts/build-viewer.mjs` 重建 → 新 sha256 `4fcfc56f9ef0…`,manifest 追加第 26 条哈希;`node --check` 产物通过;`--check` → `PSM_VIEWER_CONSISTENT`(测试套件重写产物后仍一致)。
2. `node --test skills/project-self-memory/tests/viewer-server.test.mjs` → **19 项全绿**;全量 `tests/*.test.mjs` 150 项全绿(零回归;未动 server 与任何测试文件)。
3. 人工冒烟(temp 项目 + init 部署产物 + `cache add` 造 3 条候选:新增/修订/±1,再外部改写目标制造 stale 组,spawn 部署产物):
   - HTTP:页面 HTML 含「暂存区」「cache-panel」「清理已处理」等全部标记;`/api/snapshot` 正常返回(本 worktree 尚未合入 02 的 cache 节,快照无 cache 字段,页面按空态渲染——正是容错路径)。
   - 浏览器(agent-browser,`%temp%\agent-browser-captures\psm-t03-*.png`):徽标「暂存区 0」置灰、面板开关、空态文案、面板右栏 390px 布局均确认。
   - **分组渲染验证**:工单 02 的路由未合入本分支,无法端到端造出 cache 节;改用「注入快照」验证——(a) 无头 DOM 层:从产物提取页面脚本,以冻结契约的完整快照驱动,38 项断言全过(徽标、三组渲染、update 原/新对照、stale 双对照且只有丢弃、apply 携带改写正文与 store_revision、discard、confirm 拦截 ±1、409 保留草稿、503 锁忙文案、prune、空态、开关);(b) 真浏览器:临时构建带 `window.__cacheInject` 钩子的一次性产物(未提交)注入同一快照截图,确认最终视觉(见 `psm-t03-panel-filled.png`)。
4. commit:`feat(project-self-memory): ✨查看器新增暂存区面板`。

### UI 决策摘要

- 面板与编辑器**并列叠加**(不做互斥切换),窄屏各自全屏。
- 丢弃无确认;删除/±1 写入与「清理已处理」用原生 `confirm`。
- 类型徽标配色:新增/修订=决策蓝、删除=避坑红、调分+=净分绿、调分-=净分红、失效=避坑红、冲突=待复核黄(全部沿用现有 pill 变量)。
- 证据字段空值整行跳过;时间显示去 T/Z。

### 偏差与坑

- **偏差(工单允许的简化)**:prune 不带天数;丢弃无确认;面板与编辑器不互斥。
- **坑 1(已修)**:补丁插入 `renderCache` 调用时吞掉了 `load()` 内的换行,`else if` 分支被错误绑定到新 if 上(面板关闭时 `refreshEditorBaseline` 不再执行);字节级复核发现并修复,这也是后续全部 DOM 断言跑通的前提。
- **坑 2(已修)**:面板 DOM 最初插在 `#main` 外(body 直属),`body` 是纵向 flex,面板变成底部横条;真浏览器冒烟截图发现,移入 `#main` 内修复(x=1674, w=390, 全高)。
- **坑 3(环境)**:本机 `core.autocrlf=true` + 构建器原样读盘,产物字节随磁盘行尾浮动(提交时 CRLF、checkout 后 LF 重建即漂移),`--check` 对「内容同而行尾异」敏感;本工单内构建/测试/提交全部在 worktree 内一致完成,`--check` 通过。根因(T1 的构建器字节幂等与 autocrlf 的交互)建议另立工单。
- **坑 4(工具)**:多轮文件读取出现内容错乱伪影,改用 `node` 脚本字节级 dump/补丁(锚点唯一性断言 + CRLF 归一)完成编辑,并以 `node --check` 与 DOM 断言兜底。

## Task

只动 `skills/project-self-memory/scripts/viewer-page.mjs`;**不动 viewer-server.mjs**(02 并行开发)。数据契约 = 02 工单冻结的快照 `cache` 节 schema(count + groups[],组字段 key/kind/refid/stale/conflict/count/entries[]/current,条目含 cache.jsonl 全部字段 + stale,entries[].payload.content、entries[].evidence.{reason,observation,event_id,kind,observed_at}、entries[].event_id、entries[].base_content)。规格:`.scratch/psm-viewer-cache/spec.md`「页面:暂存区面板」节。

### UI 结构

- 工具栏(L135-160)新增「暂存区」切换按钮,徽标显示 `snapshot.cache.count`(取自快照 cache 节;徽标样式仿 `.tag-chip`/`.pill` 先例)。空(0)时徽标隐藏或置灰,面板打开显示空态:「暂存区没有待处理项」。
- 面板仿 `#editor` 模式:`.hidden` toggle 显示/隐藏,窄屏 `@media (max-width:767px)` 全屏(沿用编辑器既有响应式处理)。与编辑器互斥或叠加均可,以实现简洁为准。
- 面板按 groups 渲染,每组:类型徽标(add/update/delete/+1/-1 中文名:新增/修订/删除/调分+/调分-)、目标 refid、组级 conflict/stale 标记。每条候选展示:
  - 正文:payload.content 预填可编辑(textarea,仿编辑器);
  - 修订类(update)原/新对照:base_content(原)vs payload.content(新);
  - 证据字段:reason/observation/kind/observed_at 内联展示;
  - 失效候选:stale 标记 + 原基准(base_content)vs 现状(current.content)对照。
- **全部经 `textContent`/`createElement` 渲染,零 innerHTML**(沿用现有防注入模式)。

### 操作映射

- 新增(add)/修订(update)候选:正文预填 payload.content、可编辑;按钮「写入」→ `POST /api/cache/<event_id>/apply`,body `{ store_revision, content: <编辑框当前值> }`(store_revision 取 `state.snapshot.store_revision`)。修订类无单独「原样直写」语义(预填即原样,改完即改写版),与 `-c` 等效。
- 删除(delete)/调分(±1)候选:按钮「写入」前弹 `confirm` 确认(高风险操作防误触);apply body 不带 content。
- 丢弃:每条候选「丢弃」按钮 → `POST /api/cache/<event_id>/discard`;无确认或轻确认均可,以实现简洁为准。
- 清理:面板级「清理已处理」按钮 → `POST /api/cache/prune`(可带输入的天数,简化为不带亦可);写前 `confirm`。
- 失效(stale)组:只给「丢弃」,不提供写入入口。

### 状态与错误处理

- 成功路径:响应里的完整新快照走既有 `acceptSnapshot` 整体刷新页面状态(列表、徽标、面板全部重建);用户能看到落库结果与刷新后的列表。
- 失败路径(409 冲突 / 503 锁忙 / 400 契约等):保留面板当前状态与草稿内容(不重渲染、不清编辑框),`setStatus` 提示原因,文案风格对齐编辑器先例(L682-693):冲突提示可「重新加载」、锁忙提示稍后重试、契约错误展示 message。
- 面板打开时或操作前可拉一次快照刷新(`load()` 复用),避免展示陈旧数据;实现取简洁方案。

### 硬约束

- 页面源码在模板字符串内:**禁反引号、禁出现 `</script>` 字面量、正则中 `\n`/`\s` 要写成 `\\n`/`\\s`**(对照 L554/L556 先例)。
- 不提供「新建候选」入口(职责约束:暂存入口只有 `-a` 与自动收尾)。
- pending 候选不做过期逻辑(永不自动过期)。

### 验收

- `node --test skills/project-self-memory/tests/viewer-server.test.mjs` 全绿(不新增服务端行为;若为面板 DOM 无法黑盒断言,人工验收放 Comments 里描述操作路径)。
- 重建产物后产物含新面板代码(构建由本工单内执行:`node scripts/build-viewer.mjs` 重生成 viewer-dist,一并提交)。

## Comments

- spec 依据:`.scratch/psm-viewer-cache/spec.md` User Stories 1-19(展示/编辑并入/丢弃/清理/失效标注/空态/无新建/不过期)与页面节。
- 人工验收操作路径(02 合入后可复跑):启动产物 → 工具栏「暂存区」→ 徽标计数 = pending 数;组内「写入」(add/update 可改写正文)→ 列表即时刷新、条目转已处理;删除/±1 写入弹确认;「丢弃」无确认直接转已丢弃;头部「清理已处理」弹确认后清空已处理条目;失效组只有「丢弃」。
