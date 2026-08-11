/**
 * Minimal, host-owned adapter for embedding MemorySession.
 *
 * This is a reference integration seam, not a production host. It deliberately
 * exposes only the lifecycle payload and capability declaration to an Agent.
 */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MemorySession } from './memory-session.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Run one host-owned lifecycle and return its observable integration result. */
export async function runReferenceHost(options = {}) {
  if (!isObject(options)) throw new TypeError('options 必须是对象');
  const projectRoot = path.resolve(options.projectRoot || process.cwd());
  const policy = {
    auto_load: options.autoLoad ?? options.policy?.auto_load ?? false,
    auto_save: options.autoSave ?? options.policy?.auto_save ?? false,
    auto_rate: options.autoRate ?? options.policy?.auto_rate ?? false,
  };
  for (const [key, value] of Object.entries(policy)) {
    if (typeof value !== 'boolean') throw new TypeError(`${key} 必须是 boolean`);
  }
  const audit = [];
  const session = new MemorySession({
    projectRoot,
    cliPath: path.join(scriptDir, 'memory.mjs'),
    sessionOverrides: policy,
    onAudit: (event) => audit.push(event),
    agent: {
      run(payload, tools) {
        return { payloadSeen: payload, capabilitiesSeen: tools.capabilities };
      },
    },
  });
  const payload = await session.beginTask({
    context: options.context || options.task || 'reference-host smoke task',
  });
  const end = await session.endTask({
    candidates: options.candidates || [],
    evidence: options.evidence || [],
  });
  return Object.freeze({
    projectRoot,
    payload,
    finalPayload: payload,
    capabilities: payload.capabilities,
    audit: audit.slice(),
    end,
  });
}

function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--project-root') result.projectRoot = argv[++i];
    else if (arg === '--auto-load') result.autoLoad = true;
    else if (arg === '--auto-save') result.autoSave = true;
    else if (arg === '--auto-rate') result.autoRate = true;
    else if (arg === '--context') result.context = argv[++i];
    else if (arg === '--help') result.help = true;
    else throw new Error(`未知参数: ${arg}`);
  }
  return result;
}

const invokedAsEntry = process.argv[1]
  && fs.realpathSync.native(path.resolve(process.argv[1])) === fs.realpathSync.native(fileURLToPath(import.meta.url));

if (invokedAsEntry) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      console.log('node scripts/reference-host.mjs [--project-root <path>] [--auto-load] [--auto-save] [--auto-rate] [--context <text>]');
    } else {
      const result = await runReferenceHost(options);
      console.log(JSON.stringify(result, null, 2));
    }
  } catch (error) {
    console.error(`REFERENCE_HOST_ERROR: ${error.message}`);
    process.exitCode = 1;
  }
}
