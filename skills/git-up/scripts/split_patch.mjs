#!/usr/bin/env node
/**
 * Split a unified diff into one patch file per hunk.
 *
 * Semantic commit plans need one patch per semantic group. A patch that
 * contains several hunks forces the whole file into one commit. This script
 * splits a diff file into per-hunk patches and prints a manifest that maps
 * each source file to its patches.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

/** 解析一个 diff 文件：按文件分段，每段再按 hunk 拆分。 */
export function splitDiff(text) {
  const lines = text.split(/(?<=\n)/);
  const sections = [];
  let current = null;

  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      current = { header: [line], hunks: [], path: parseDiffGitPath(line) };
      sections.push(current);
      continue;
    }
    if (current === null) {
      // 没有 diff --git 头时，把内容当作单文件补丁处理。
      current = { header: [], hunks: [], path: null };
      sections.push(current);
    }
    if (line.startsWith('@@')) {
      // 每个 @@ 头开启一个新的 hunk。
      current.hunks.push([line]);
      continue;
    }
    if (current.hunks.length === 0) {
      // 头部行：index、---、+++ 等。
      current.header.push(line);
      continue;
    }
    current.hunks[current.hunks.length - 1].push(line);
  }

  return sections;
}

function parseDiffGitPath(line) {
  const rest = line.slice('diff --git '.length).trim();
  const marker = ' b/';
  const index = rest.lastIndexOf(marker);
  const raw = index === -1 ? rest.split(' ')[0] : rest.slice(0, index);
  return raw.replace(/^a\//, '');
}

function parseArgs(argv) {
  const options = { diff: null, out: null, prefix: null, target: null };
  const takeValue = (name, index) => {
    const value = argv[index];
    if (value === undefined) throw new Error(`${name} requires a value`);
    return value;
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--diff') {
      options.diff = takeValue('--diff', i + 1);
      i += 1;
    } else if (arg === '--out') {
      options.out = takeValue('--out', i + 1);
      i += 1;
    } else if (arg === '--prefix') {
      options.prefix = takeValue('--prefix', i + 1);
      i += 1;
    } else if (arg === '--target') {
      options.target = takeValue('--target', i + 1);
      i += 1;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return options;
}

const USAGE = `usage: split_patch.mjs --diff FILE --out DIR [--prefix NAME] [--target PATH]

把 unified diff 按 hunk 拆成独立补丁文件，并输出 JSON 清单。

  --diff FILE     输入的 unified diff 文件
  --out DIR       补丁文件输出目录，目录会被创建
  --prefix NAME   补丁文件名前缀，默认取 diff 文件名
  --target PATH   只拆分指定文件的段落
`;

try {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(USAGE);
    process.exitCode = 0;
  } else if (!options.diff || !options.out) {
    process.stderr.write(`${USAGE}`);
    process.exitCode = 2;
  } else {
    const diffPath = path.resolve(options.diff);
    const outDir = path.resolve(options.out);
    const text = fs.readFileSync(diffPath, 'utf8');
    const prefix = options.prefix ?? path.basename(diffPath).replace(/\.diff$|\.patch$/, '');

    fs.mkdirSync(outDir, { recursive: true });
    const sections = splitDiff(text);
    const files = [];
    let counter = 0;

    for (const section of sections) {
      if (options.target && section.path !== options.target.replace(/\\/g, '/')) continue;
      // 二进制段落没有 hunk，无法按 hunk 拆分。清单要显式标出。
      const binary = section.header.some(
        (line) => line.startsWith('GIT binary patch') || line.startsWith('Binary files '),
      );
      const hunks = [];
      section.hunks.forEach((hunk, index) => {
        counter += 1;
        const patchPath = path.join(outDir, `${prefix}-${counter}.patch`);
        fs.writeFileSync(patchPath, [...section.header, ...hunk].join(''), 'utf8');
        hunks.push({
          index: index + 1,
          patch: patchPath,
          header: hunk[0].trim(),
        });
      });
      files.push({ path: section.path, binary, hunks });
    }

    process.stdout.write(
      `${JSON.stringify(
        {
          ok: true,
          source: diffPath,
          out_dir: outDir,
          files,
          patch_count: counter,
        },
        null,
        2,
      )}\n`,
    );
    process.exitCode = 0;
  }
} catch (error) {
  process.stderr.write(`${error?.message ?? error}\n`);
  process.exitCode = 2;
}
