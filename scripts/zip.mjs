#!/usr/bin/env node
/**
 * 最小 ZIP 读写实现。
 *
 * 存在的理由：.NET 的 `ZipFile.CreateFromDirectory` 在 Windows 上把条目名写成
 * `references\ignore.md` 这样的反斜杠路径。按 POSIX 路径匹配的解压器在
 * Linux 与 macOS 上找不到这些条目，跨平台分发因此失效。
 *
 * 本模块按 ZIP 规范写条目名，一律用正斜杠。只用 Node 内置的 zlib，不引第三方依赖。
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const LOCAL_SIGNATURE = 0x04034b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const END_SIGNATURE = 0x06054b50;

const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;

/** UTF-8 文件名标志位。 */
const FLAG_UTF8 = 0x0800;

// ---------------------------------------------------------------------------
// CRC-32
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (let index = 0; index < buffer.length; index += 1) {
    crc = CRC_TABLE[(crc ^ buffer[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ -1) >>> 0;
}

// ---------------------------------------------------------------------------
// 时间戳
// ---------------------------------------------------------------------------

/** 把 Date 转成 MS-DOS 的时间与日期字段。 */
function dosDateTime(date) {
  const year = Math.max(date.getFullYear(), 1980);
  const time =
    (date.getHours() << 11) | (date.getMinutes() << 5) | (Math.floor(date.getSeconds() / 2) & 0x1f);
  const day = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, date: day };
}

// ---------------------------------------------------------------------------
// 收集源文件
// ---------------------------------------------------------------------------

/**
 * 收集目录下的全部文件，条目名用正斜杠。
 *
 * 空目录也产出一条以 `/` 结尾的条目，否则解包后该目录会丢失。
 */
function collectEntries(sourceDirectory) {
  const entries = [];

  const walk = (directory, relativePrefix) => {
    const items = fs.readdirSync(directory, { withFileTypes: true });
    for (const item of items) {
      const absolute = path.join(directory, item.name);
      const relative = relativePrefix ? `${relativePrefix}/${item.name}` : item.name;
      if (item.isDirectory()) {
        const before = entries.length;
        walk(absolute, relative);
        // 子目录里没有文件时，目录本身要单独留一条。
        if (entries.length === before) entries.push({ name: `${relative}/`, directory: true });
      } else if (item.isFile()) {
        entries.push({ name: relative, absolute, directory: false });
      }
    }
  };

  walk(sourceDirectory, '');
  entries.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
  return entries;
}

// ---------------------------------------------------------------------------
// 写入
// ---------------------------------------------------------------------------

/**
 * 把目录打包成 zip。
 *
 * @param {string} sourceDirectory 源目录。zip 内以此目录的内容为根。
 * @param {string} destinationPath 目标 zip 路径，已存在则覆盖。
 * @returns {{entries: number, bytes: number}} 条目数与文件大小。
 */
export function writeZip(sourceDirectory, destinationPath) {
  const entries = collectEntries(sourceDirectory);
  const localChunks = [];
  const centralChunks = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuffer = Buffer.from(entry.name, 'utf8');
    const stats = fs.statSync(entry.absolute);
    const { time, date } = dosDateTime(stats.mtime);

    if (entry.directory) {
      // 目录条目：内容为空，方法为 store。
      const local = Buffer.alloc(30);
      local.writeUInt32LE(LOCAL_SIGNATURE, 0);
      local.writeUInt16LE(20, 4);
      local.writeUInt16LE(FLAG_UTF8, 6);
      local.writeUInt16LE(METHOD_STORE, 8);
      local.writeUInt16LE(time, 10);
      local.writeUInt16LE(date, 12);
      local.writeUInt32LE(0, 14);
      local.writeUInt32LE(0, 18);
      local.writeUInt32LE(0, 22);
      local.writeUInt16LE(nameBuffer.length, 26);
      local.writeUInt16LE(0, 28);
      localChunks.push(local, nameBuffer);

      centralChunks.push(buildCentralHeader({
        nameBuffer, time, date, method: METHOD_STORE, crc: 0,
        compressedSize: 0, size: 0, offset, externalAttributes: 0x41ed0010,
      }));
      offset += local.length + nameBuffer.length;
      continue;
    }

    const content = fs.readFileSync(entry.absolute);
    const deflated = zlib.deflateRawSync(content, { level: 9 });
    // 压缩后反而更大时退回 store，避免体积倒退。
    const useDeflate = deflated.length < content.length;
    const method = useDeflate ? METHOD_DEFLATE : METHOD_STORE;
    const payload = useDeflate ? deflated : content;
    const checksum = crc32(content);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL_SIGNATURE, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(FLAG_UTF8, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    local.writeUInt16LE(0, 28);
    localChunks.push(local, nameBuffer, payload);

    // 外部属性高 16 位存 Unix 模式。0o100644 表示普通文件。
    centralChunks.push(buildCentralHeader({
      nameBuffer, time, date, method, crc: checksum,
      compressedSize: payload.length, size: content.length, offset,
      externalAttributes: (0o100644 << 16) >>> 0,
    }));
    offset += local.length + nameBuffer.length + payload.length;
  }

  const centralDirectory = Buffer.concat(centralChunks);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(END_SIGNATURE, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  fs.writeFileSync(destinationPath, Buffer.concat([...localChunks, centralDirectory, end]));
  return { entries: entries.length, bytes: fs.statSync(destinationPath).size };
}

function buildCentralHeader({
  nameBuffer, time, date, method, crc, compressedSize, size, offset, externalAttributes,
}) {
  const header = Buffer.alloc(46);
  header.writeUInt32LE(CENTRAL_SIGNATURE, 0);
  // 高字节 3 表示 Unix，低字节 30 是版本 3.0。
  header.writeUInt16LE(0x031e, 4);
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(FLAG_UTF8, 8);
  header.writeUInt16LE(method, 10);
  header.writeUInt16LE(time, 12);
  header.writeUInt16LE(date, 14);
  header.writeUInt32LE(crc, 16);
  header.writeUInt32LE(compressedSize, 20);
  header.writeUInt32LE(size, 24);
  header.writeUInt16LE(nameBuffer.length, 28);
  header.writeUInt16LE(0, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE(externalAttributes, 38);
  header.writeUInt32LE(offset, 42);
  return Buffer.concat([header, nameBuffer]);
}

// ---------------------------------------------------------------------------
// 读取
// ---------------------------------------------------------------------------

/**
 * 列出 zip 中央目录的条目名。
 *
 * 用于校验条目名是否为 POSIX 路径。
 */
export function readZipEntries(zipPath) {
  const buffer = fs.readFileSync(zipPath);
  const entries = [];
  let offset = 0;
  while ((offset = buffer.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]), offset)) !== -1) {
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    entries.push(buffer.toString('utf8', offset + 46, offset + 46 + nameLength));
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/**
 * 读取 zip 内单个文件的内容。
 *
 * @param {string} zipPath zip 路径。
 * @param {string} entryName 条目名，须与中央目录一致。
 * @returns {Buffer} 文件内容。
 */
export function readZipFile(zipPath, entryName) {
  const buffer = fs.readFileSync(zipPath);
  const nameBuffer = Buffer.from(entryName, 'utf8');

  let offset = 0;
  while ((offset = buffer.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]), offset)) !== -1) {
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const localOffset = buffer.readUInt32LE(offset + 42);

    if (name === entryName) {
      const localNameLength = buffer.readUInt16LE(localOffset + 26);
      const localExtraLength = buffer.readUInt16LE(localOffset + 28);
      const dataStart = localOffset + 30 + localNameLength + localExtraLength;
      const payload = buffer.subarray(dataStart, dataStart + compressedSize);
      return method === METHOD_DEFLATE ? zlib.inflateRawSync(payload) : payload;
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  throw new Error(`zip 内没有条目：${entryName}`);
}
