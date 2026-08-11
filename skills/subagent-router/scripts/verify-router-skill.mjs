#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const required = ['SKILL.md', 'agents/openai.yaml', 'references/routing-policy.md', 'references/grilling-protocol.md', 'references/worker-contract.md', 'references/failure-policy.md', 'scripts/route-decision.mjs', 'scripts/validate-worker-contract.mjs', 'scripts/verify-router-skill.mjs'];
const errors = [];
for (const relative of required) if (!fs.existsSync(path.join(root, relative))) errors.push('missing required file: ' + relative);
if (fs.existsSync(path.join(root, 'references/external-exec-policy.md'))) errors.push('obsolete external-exec-policy.md must be removed');
const markdown = required.filter((relative) => relative.endsWith('.md'));
for (const relative of markdown) {
  const full = path.join(root, relative);
  if (!fs.existsSync(full)) continue;
  const text = fs.readFileSync(full, 'utf8');
  if (relative === 'SKILL.md' && !/^---\r?\nname: subagent-router\r?\ndescription: .+\r?\n---/s.test(text)) errors.push('SKILL.md frontmatter must contain name and description');
  for (const match of text.matchAll(/\[[^\]]+\]\(([^)#]+)(?:#[^)]+)?\)/g)) {
    const target = path.resolve(path.dirname(full), match[1]);
    if (!fs.existsSync(target)) errors.push(relative + ' has broken relative reference: ' + match[1]);
  }
  for (const match of text.matchAll(/~~~json\s*\r?\n([\s\S]*?)~~~/g)) {
    try { JSON.parse(match[1]); } catch (error) { errors.push(relative + ' has invalid JSON example: ' + error.message); }
  }
}
const corpus = markdown.map((relative) => fs.existsSync(path.join(root, relative)) ? fs.readFileSync(path.join(root, relative), 'utf8') : '').join('\n');
for (const phrase of ['native_spawn', 'okok', 'delegation envelope', 'parent_model', 'active_workers', 'Luna', 'Terra', 'Sol', 'minimal', 'summarized', 'expanded', 'unverified', 'Never silently']) if (!corpus.includes(phrase)) errors.push('missing core semantic: ' + phrase);
for (const obsolete of ['external_exec', 'native_unsupported', 'native_supported', '授权执行', '已达成共同理解']) if (corpus.includes(obsolete)) errors.push('obsolete V2 semantic remains: ' + obsolete);
if (errors.length) { errors.forEach((error) => console.error('verify-router-skill: ' + error)); process.exit(2); }
console.log('verify-router-skill: valid V3 native nesting, authorization, references, frontmatter, and JSON examples');
