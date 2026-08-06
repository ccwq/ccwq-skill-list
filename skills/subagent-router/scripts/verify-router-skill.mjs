#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const required = ['SKILL.md', 'agents/openai.yaml', 'references/routing-policy.md', 'references/grilling-protocol.md', 'references/external-exec-policy.md', 'references/worker-contract.md', 'references/failure-policy.md', 'scripts/route-decision.mjs', 'scripts/validate-worker-contract.mjs', 'scripts/verify-router-skill.mjs'];
const errors = [];
for (const relative of required) if (!fs.existsSync(path.join(root, relative))) errors.push(`missing required file: ${relative}`);
const markdown = required.filter((x) => x.endsWith('.md'));
for (const relative of markdown) {
  const full = path.join(root, relative); if (!fs.existsSync(full)) continue;
  const text = fs.readFileSync(full, 'utf8');
  if (relative === 'SKILL.md' && !/^---\r?\nname: subagent-router\r?\ndescription: .+\r?\n---/s.test(text)) errors.push('SKILL.md frontmatter must contain name and description');
  for (const match of text.matchAll(/\[[^\]]+\]\(([^)#]+)(?:#[^)]+)?\)/g)) { const target = path.resolve(path.dirname(full), match[1]); if (!fs.existsSync(target)) errors.push(`${relative} has broken relative reference: ${match[1]}`); }
  for (const match of text.matchAll(/```json\s*\r?\n([\s\S]*?)```/g)) { try { JSON.parse(match[1]); } catch (e) { errors.push(`${relative} has invalid JSON example: ${e.message}`); } }
}
const all = markdown.map((x) => fs.existsSync(path.join(root, x)) ? fs.readFileSync(path.join(root, x), 'utf8') : '').join('\n');
for (const phrase of ['native_spawn', 'external_exec', 'native_supported', 'native_unsupported', 'unknown', 'temporarily_unavailable', 'routing policy', '已达成共同理解', '授权执行', 'authorization fingerprint', 'complete preview', 'minimal', 'summarized', 'expanded', 'unverified', 'independent workspace', 'Never silently']) if (!all.includes(phrase)) errors.push(`missing core semantic: ${phrase}`);
if (all.includes('确认分发` authorizes') || all.includes('确认分发`确认')) errors.push('obsolete confirmation gate appears to authorize execution');
if (errors.length) { errors.forEach((e) => console.error(`verify-router-skill: ${e}`)); process.exit(2); }
console.log('verify-router-skill: valid skill tree, references, frontmatter, JSON examples, and core semantics');
