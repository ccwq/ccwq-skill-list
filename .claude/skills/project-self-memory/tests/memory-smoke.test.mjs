import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const cli = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../scripts/memory.mjs');
const run = (root, ...argv) => execFileSync(process.execPath, [cli, '--project-root', root, ...argv], { encoding: 'utf8' });
const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'psm-invariant-'));
const store = (next = '0001') => `<!-- <psm-store version="1" next_id="${next}" group_dimension="" /> -->\n`;
const record = (id, content, status = 'active') => `<!-- <psm id="${id}" type="fact" status="${status}" positive="0" negative="0" created_at="2026-08-05T00:00:00Z" last_scored_at="" /> -->\n${content}\n`;
const memory = (root) => path.join(root, '.project-self-memory', 'memory.md');
function init(root) { run(root, 'init'); }

/**
 * Given：next_id 与现存 ID 冲突、或同一数值使用不同宽度的结构化库
 * When：执行 validate 或 add
 * Then：两者均拒绝，且 add 不会制造重复 ID；四位标准 ID 与大整数连续 ID 均可用
 * 防回归：高水位损坏后自动写入覆盖既有记录
 */
test('rejects duplicate next_id before every write', () => { const root=temp(); init(root); fs.writeFileSync(memory(root),store('0001')+record('0001','已有')); assert.throws(()=>run(root,'validate'),/next_id/); const body=path.join(root,'x.txt');fs.writeFileSync(body,'新增');assert.throws(()=>run(root,'add','--type','fact','--content-file',body),/next_id/);assert.equal((fs.readFileSync(memory(root),'utf8').match(/<psm id="0001"/g)||[]).length,1);fs.writeFileSync(memory(root),store('0002')+record('0001','甲')+record('00001','乙'));assert.throws(()=>run(root,'validate'),/canonical|固定字段/);assert.throws(()=>run(root,'add','--type','fact','--content-file',body),/拒绝写入/);const big='9007199254740992';fs.writeFileSync(memory(root),store(big));assert.equal(run(root,'add','--type','fact','--content-file',body).trim(),big);assert.equal(run(root,'add','--type','fact','--content-file',body).trim(),'9007199254740993'); });

/**
 * Given：未知 XML 元素、普通 Markdown ## 正文和一条合法记录
 * When：读取 active 记录
 * Then：未知元素隔离，## 不被误认分组，合法记录仍输出且 diagnose 不允许写入
 * 防回归：严格格式错误阻断无关的可用经验
 */
test('isolates malformed records and keeps markdown headings in content', () => { const root=temp();init(root);fs.writeFileSync(memory(root),store('0002')+record('0001','## 正文标题\n正文')+'<!-- <unknown x="1" /> -->\n');const out=run(root,'read');assert.match(out,/\[事实\]/);assert.match(out,/## 正文标题/);assert.doesNotMatch(out,/unknown/);assert.equal(JSON.parse(run(root,'diagnose')).write_safe,false);assert.throws(()=>run(root,'validate'),/未知/); });

/**
 * Given：active、review、disabled 三种合法记录
 * When：read 与 read --all 查询
 * Then：两次都只输出 active 记录且中文类型名一致
 * 防回归：维护参数泄漏非活动结论
 */
test('read is always active-only', () => { const root=temp();init(root);fs.writeFileSync(memory(root),store('0004')+record('0001','可见')+record('0002','审阅','review')+record('0003','禁用','disabled'));for(const command of [['read'],['read','--all']]){const out=run(root,...command);assert.match(out,/可见/);assert.doesNotMatch(out,/审阅|禁用/);}});

/**
 * Given：legacy 来源包含两项文本
 * When：扫描快照后以重复 U001 或错误快照迁移
 * Then：命令拒绝且 legacy 原始顺序不变
 * 防回归：重复迁移或旧计划删除错误内容
 */
test('legacy validates snapshot and unique temporary IDs', () => { const root=temp();init(root);fs.mkdirSync(path.join(root,'self-memory'));const legacy=path.join(root,'self-memory','memory.md');const raw=Buffer.from('甲  \r\n\r\n乙\r\n','utf8');fs.writeFileSync(legacy,raw);const scan=JSON.parse(run(root,'legacy','scan'));const plan=path.join(root,'p.json');fs.writeFileSync(plan,JSON.stringify({snapshot:scan.snapshot,items:[{temporary_id:'U001',source_hash:scan.items[0].source_hash,type:'fact',content:'甲新'},{temporary_id:'U001',source_hash:scan.items[0].source_hash,type:'fact',content:'重复'}]}));assert.throws(()=>run(root,'legacy','migrate','--plan-file',plan),/temporary_id/);assert.deepEqual(fs.readFileSync(legacy),raw);fs.writeFileSync(plan,JSON.stringify({snapshot:scan.snapshot,items:[{temporary_id:'U001',source_hash:scan.items[0].source_hash,type:'fact',content:'甲新'},{temporary_id:'U002',source_hash:scan.items[1].source_hash,type:'bad',content:'乙新'}]}));assert.match(run(root,'legacy','migrate','--plan-file',plan),/"ok": true/);assert.deepEqual(fs.readFileSync(legacy),Buffer.from('\r\n\r\n乙\r\n'));const after=JSON.parse(run(root,'legacy','scan'));fs.appendFileSync(legacy,'尾部');fs.writeFileSync(plan,JSON.stringify({snapshot:after.snapshot,items:[]}));assert.throws(()=>run(root,'legacy','migrate','--plan-file',plan),/快照/); });

/**
 * Given：活动 memory.md 含未结构化文本
 * When：尝试 add 写入
 * Then：命令拒绝且整个文件逐字节不变
 * 防回归：序列化时静默丢失用户尚未迁移的内容
 */
test('blocks writes that would discard active opaque content', () => { const root=temp();init(root);const raw=Buffer.from(store('0001')+'保留  \r\n');fs.writeFileSync(memory(root),raw);const body=path.join(root,'x.txt');fs.writeFileSync(body,'新');assert.throws(()=>run(root,'add','--type','fact','--content-file',body),/未结构化/);assert.deepEqual(fs.readFileSync(memory(root)),raw); });

/**
 * Given：两个永久 ID 的记录
 * When：merge 试图 keep=remove 或保留较晚 ID
 * Then：命令拒绝且数据未改变
 * 防回归：合并误删自己或违反最早记录保留规则
 */
test('merge rejects self and later keep IDs', () => { const root=temp();init(root);fs.writeFileSync(memory(root),store('0003')+record('0001','甲')+record('0002','乙'));const body=path.join(root,'b.txt');fs.writeFileSync(body,'合并');assert.throws(()=>run(root,'merge','--keep','0001','--remove','0001','--content-file',body),/不同 ID/);assert.throws(()=>run(root,'merge','--keep','0002','--remove','0001','--content-file',body),/较早/); });

/**
 * Given：两个合法记录且 ledger 已初始化
 * When：将较晚记录合并到较早记录并 inspect 保留记录
 * Then：inspect 返回包含 keep/remove 原版本的 lineage
 * 防回归：合并正文覆盖评分历史却不留下来源谱系
 */
test('merge inspect preserves evidence lineage', () => {
  const root = temp(); init(root);
  fs.writeFileSync(memory(root), store('0003') + record('0001', '甲') + record('0002', '乙'));
  const body = path.join(root, 'merge-lineage.txt'); fs.writeFileSync(body, '合并后的结论');
  run(root, 'merge', '--keep', '0001', '--remove', '0002', '--content-file', body);
  const inspected = JSON.parse(run(root, 'inspect', '0001'));
  assert.equal(inspected.lineage.length, 2);
  assert.deepEqual(inspected.lineage.map((item) => item.record_id), ['0001', '0002']);
});

/**
 * Given：一个记录和一个既有稳定分组
 * When：groups apply 缺少 assignments 或删除稳定分组
 * Then：计划在写前被拒绝
 * 防回归：分组重构留下悬空记录或改变稳定 ID
 */
test('groups apply requires complete stable plan', () => { const root=temp();init(root);fs.writeFileSync(memory(root),`<!-- <psm-store version="1" next_id="0002" group_dimension="topic" /> -->\n## 原\n<!-- <psm-group id="old" scope="旧范围" /> -->\n\n${record('0001','甲')}`);const plan=path.join(root,'g.json');fs.writeFileSync(plan,JSON.stringify({group_dimension:'topic',groups:[{id:'new',title:'新',scope:'新范围'}],assignments:{'0001':'new'}}));assert.throws(()=>run(root,'groups','apply','--plan-file',plan),/稳定/); });

/**
 * Given：只缺一个可安全解释的 config 键
 * When：config repair
 * Then：补齐默认值并模板化文件
 * 防回归：安全缺字段被当成致命错误或开启不确定自动行为
 */
test('config repair fills missing keys', () => { const root=temp();init(root);const cfg=path.join(root,'.project-self-memory','config.yaml');fs.writeFileSync(cfg,'version: 1\nauto_load: false\nauto_save: true\n');assert.match(run(root,'config','repair'),/REPAIRED/);const repaired=fs.readFileSync(cfg,'utf8');assert.match(repaired,/auto_rate: true/);assert.match(repaired,/# Given：任务开始且 store\/ledger 校验通过。/);assert.match(repaired,/# relevant 特点：先做相关性、质量和预算筛选；适合绝大多数日常任务，能减少无关历史。/);assert.match(repaired,/# 取值：off \| relevant \| all。参考值：relevant。/);assert.match(repaired,/# 取值：0\.\.1。参考值：0；需要更保守筛选时可用 0\.25 或 0\.5。/); });

/**
 * Given：损坏的 store 头
 * When：diagnose 和 migrate-schema
 * Then：诊断返回非负计数；v1 明确无前版可迁移
 * 防回归：诊断产生负数或迁移命令伪称完成
 */
test('diagnose is structured and schema v1 is explicit', () => { const root=temp();init(root);fs.writeFileSync(memory(root),'坏头\n');const diag=JSON.parse(run(root,'diagnose'));assert.equal(diag.valid_records,0);assert.equal(diag.write_safe,false);fs.writeFileSync(memory(root),store());assert.match(run(root,'migrate-schema'),/无可迁移前版/); });
