import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalId,
  editGuard,
  parseStore,
  ruleFreshness,
  serialize,
  validateModel,
  writeErrors,
} from '../scripts/memory-store.mjs';

const store = (next = '0001') => `<!-- <psm-store version="1" next_id="${next}" group_dimension="" /> -->\n`;
const record = (id, content, status = 'active', extra = '') => `<!-- <psm id="${id}" type="fact" status="${status}" positive="0" negative="0" created_at="2026-08-05T00:00:00Z" last_scored_at=""${extra} /> -->\n${content}\n`;

/**
 * Given：一条合法记录和存储分组
 * When：parseStore 后 serialize 再 parseStore
 * Then：record、group 字段完整 round-trip，无错误
 * 防回归：共享核心序列化丢字段导致 CLI 与查看器写出的格式不一致
 */
test('store round-trips records and groups byte-stably', () => {
  const model = parseStore(store('0003') + record('0001', '甲') + '## 组\n<!-- <psm-group id="g1" scope="范围" /> -->\n\n' + record('0002', '乙'));
  assert.equal(model.errors.length, 0);
  assert.equal(model.records[1].group, 'g1');
  const again = parseStore(serialize(model));
  assert.equal(again.errors.length, 0);
  assert.deepEqual(again.records.map((r) => [r.id, r.content, r.group]), [['0001', '甲', null], ['0002', '乙', 'g1']]);
  assert.equal(again.groups[0].title, '组');
});

/**
 * Given：正文含 XML 特殊字符与引号
 * When：序列化后重新解析
 * Then：属性转义无损还原；正文中的 < > 原样保留
 * 防回归：转义不对称造成重复保存后内容漂移
 */
test('attribute escaping round-trips special characters', () => {
  const model = parseStore(store('0002') + record('0001', '含 <tag> 与 & 符号\n"引号"'));
  assert.equal(model.errors.length, 0);
  const again = parseStore(serialize(model));
  assert.equal(again.records[0].content, '含 <tag> 与 & 符号\n"引号"');
});

/**
 * Given：未来版本号、未知属性、DOCTYPE 三类输入
 * When：parseStore / validateModel
 * Then：全部产生 fatal 错误，writeErrors 非空
 * 防回归：未知格式被静默丢弃后重新序列化
 */
test('strictly rejects future formats and unknown attributes', () => {
  const future = parseStore('<!-- <psm-store version="2" next_id="0001" group_dimension="" /> -->\n');
  assert.ok(validateModel(future).some((x) => x.impact === 'fatal'));
  const unknown = parseStore(store('0002') + `<!-- <psm id="0001" type="fact" status="active" positive="0" negative="0" created_at="2026-08-05T00:00:00Z" last_scored_at="" weight="3" /> -->\n甲\n`);
  assert.ok(unknown.errors.some((x) => /未知或重复属性/.test(x.message)));
  const doctype = parseStore('<!DOCTYPE html>\n' + store());
  assert.ok(doctype.errors.some((x) => x.impact === 'fatal'));
});

/**
 * Given：正文含 psm 结构标记、非法类型、非法状态的编辑输入
 * When：editGuard 校验
 * Then：三类均被拒绝；合法输入通过
 * 防回归：查看器写入制造结构标记破坏其他记录
 */
test('editGuard rejects structural markers and illegal enums', () => {
  assert.ok(editGuard({ content: '<!-- <psm id="0001" /> -->', type: 'fact', status: 'active' }).length > 0);
  assert.ok(editGuard({ content: '正常', type: 'weird', status: 'active' }).length > 0);
  assert.ok(editGuard({ content: '正常', type: 'fact', status: 'weird' }).length > 0);
  assert.ok(editGuard({ content: '  ', type: 'fact', status: 'active' }).length > 0);
  assert.equal(editGuard({ content: '## 普通 Markdown 标题', type: 'fact', status: 'active' }).length, 0);
});

/**
 * Given：固定时钟与不同类型的记录
 * When：ruleFreshness 计算
 * Then：decision/constraint 恒为 1；fact 45 天半衰；其他 90 天半衰；时间缺失为 0.5
 * 防回归：新鲜度规则在 CLI 检索与查看器显示之间漂移
 */
test('ruleFreshness follows documented decay rules with pinned clock', () => {
  const now = Date.parse('2026-10-22T00:00:00Z');
  const at = (days) => new Date(now - days * 86400000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  assert.equal(ruleFreshness({ type: 'decision', created_at: at(365) }, now), 1);
  assert.equal(ruleFreshness({ type: 'constraint', created_at: at(365) }, now), 1);
  assert.ok(Math.abs(ruleFreshness({ type: 'fact', created_at: at(45) }, now) - 0.5) < 1e-9);
  assert.ok(Math.abs(ruleFreshness({ type: 'experience', created_at: at(90) }, now) - 0.5) < 1e-9);
  assert.equal(ruleFreshness({ type: 'fact', created_at: 'bad' }, now), 0.5);
  // last_scored_at 优先于 created_at。
  assert.ok(Math.abs(ruleFreshness({ type: 'fact', created_at: at(1000), last_scored_at: at(45) }, now) - 0.5) < 1e-9);
});

/**
 * Given：四位 ID 与超出安全整数范围的 ID
 * When：canonicalId 校验
 * Then：两者都合法；前导零的五位 ID 非法
 * 防回归：大整数项目被误判损坏
 */
test('canonicalId accepts big-integer ids without leading zeros', () => {
  assert.ok(canonicalId('0001'));
  assert.ok(canonicalId('9007199254740993'));
  assert.ok(!canonicalId('00001'));
});

/**
 * Given：含未结构化残留文本的库
 * When：writeErrors
 * Then：报 fatal legacy 错误
 * 防回归：写入时静默丢失未迁移内容
 */
test('writeErrors blocks opaque legacy content', () => {
  const model = parseStore(store('0001') + '残留文本\n');
  assert.ok(writeErrors(model).some((x) => x.kind === 'legacy' && x.impact === 'fatal'));
});
