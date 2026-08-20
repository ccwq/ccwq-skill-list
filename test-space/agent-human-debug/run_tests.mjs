import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');
const skillPath = path.join(root, 'skills', 'agent-human-debug', 'SKILL.md');
const skill = fs.readFileSync(skillPath, 'utf8');

function readReference(name) {
  return fs.readFileSync(path.join(root, 'skills', 'agent-human-debug', 'references', name), 'utf8');
}

/**
 * Given：agent-human-debug 需要在未知环境中发起第一轮诊断
 * When：读取 Skill 入口和环境识别契约
 * Then：入口先要求识别环境，并链接可用的 environment profile
 * 防回归：防止 Skill 重新固定输出某个平台或 Shell 的命令
 */
{
  const environment = readReference('environment-detection.md');
  assert.match(skill, /第 0 轮：环境识别/);
  assert.match(skill, /不得固定输出某个平台、Shell 或运行时的命令/);
  assert.match(environment, /os: windows \| linux \| macos \| unknown/);
  assert.match(environment, /不要收集用户名、主机名或完整路径作为识别前提/);
}

/**
 * Given：一个 probe 收集到了可回传的诊断结果
 * When：按统一报告和脱敏协议处理结果
 * Then：报告含 SUMMARY、EVIDENCE、NEXT，且脱敏异常时禁止自动写剪切板
 * 防回归：防止原始敏感输出或 clipboard-first 逻辑绕过安全降级
 */
{
  const protocol = readReference('debug-report-protocol.md');
  const sanitization = readReference('sanitization.md');
  assert.match(protocol, /SUMMARY[\s\S]*EVIDENCE[\s\S]*NEXT/);
  assert.match(protocol, /RESULT_READY run_id=<id> clipboard=<ok\|unavailable\|skipped_for_review>/);
  assert.match(sanitization, /<REDACTED:CREDENTIAL>/);
  assert.match(sanitization, /禁止写入/);
}

/**
 * Given：Agent 需要根据当前假设选择最小证据采集
 * When：读取 probe 契约
 * Then：类别、采集上限、状态语义和默认只读边界均被明确规定
 * 防回归：防止诊断脚本退化为全量日志、配置或目录采集
 */
{
  const probe = readReference('probe-contract.md');
  assert.match(probe, /environment.*filesystem.*process.*network/s);
  assert.match(probe, /evidence_limits/);
  assert.match(probe, /不自动安装依赖、提权、联网或上传/);
  assert.match(probe, /collection_status/);
}

/**
 * Given：各平台 adapter 在剪切板失败时需要生成临时文件降级
 * When：读取平台安全模式
 * Then：其要求统一报告、排他创建临时文件，且 PowerShell 不会因全局 Stop 中断报告
 * 防回归：防止旧骨架重新输出自由文本或覆盖同名临时文件
 */
{
  const platform = readReference('platform-and-script-patterns.md');
  assert.match(platform, /SUMMARY \/ EVIDENCE \/ NEXT/);
  assert.match(platform, /fs\.openSync[\s\S]*"wx"/);
  assert.match(platform, /FileMode\]::CreateNew/);
  assert.match(platform, /不要以全局 `\$ErrorActionPreference = 'Stop'`/);
  assert.doesNotMatch(platform, /^\$ErrorActionPreference\s*=\s*["']Stop["']/m);
}

console.log('AGENT_HUMAN_DEBUG_CONTRACT_TESTS_PASSED');
