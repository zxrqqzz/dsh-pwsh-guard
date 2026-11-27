#!/usr/bin/env node
/**
 * Host-contract check: the cheapest possible answer to "did a dsh upgrade
 * break this plugin?" without loading the host.
 *
 * Nothing here imports the host. It reads the *installed* dsh package's
 * declaration files and a couple of bundled sources and asserts the five
 * contracts `lib/` actually uses still exist:
 *
 *   1. tools/pre-execute | tools/execute | tools/post-execute
 *   2. systemPrompt.section + getSectionOrder
 *   3. ctx.sandboxPolicy.resolve({ session })
 *   4. the `pwsh` tool that calls them
 *   5. the `form: 'notice'` message source carrying a `summary`
 *
 * Usage:
 *   node scripts/check-host.mjs                 # auto-detect the installed dsh
 *   node scripts/check-host.mjs --dsh D:\path   # point at a specific install
 *   DSH_INSTALL_DIR=... node scripts/check-host.mjs
 *
 * Exit code 0 = every contract present, 1 = at least one missing (with the
 * exact needle it looked for).
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** @param {string} path */
function readOrNull(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

/** @returns {string[]} */
function candidateRoots() {
  const roots = [];
  const envDir = process.env.DSH_INSTALL_DIR;
  if (envDir) roots.push(envDir);
  const { APPDATA, LOCALAPPDATA, ProgramFiles } = process.env;
  if (APPDATA) roots.push(join(APPDATA, 'npm', 'node_modules', '@deepseek-ai', 'dsh'));
  if (LOCALAPPDATA) roots.push(join(LOCALAPPDATA, 'npm', 'node_modules', '@deepseek-ai', 'dsh'));
  if (ProgramFiles) roots.push(join(ProgramFiles, 'nodejs', 'node_modules', '@deepseek-ai', 'dsh'));
  roots.push('/usr/local/lib/node_modules/@deepseek-ai/dsh');
  roots.push('/usr/lib/node_modules/@deepseek-ai/dsh');
  roots.push(join(homedir(), '.npm-global', 'lib', 'node_modules', '@deepseek-ai', 'dsh'));
  roots.push(join(homedir(), '.local', 'share', 'pnpm', 'global', '5', 'node_modules', '@deepseek-ai', 'dsh'));
  // nvm / fnm style layouts
  const nvm = join(homedir(), '.nvm', 'versions', 'node');
  if (existsSync(nvm)) {
    for (const version of readdirSync(nvm)) roots.push(join(nvm, version, 'lib', 'node_modules', '@deepseek-ai', 'dsh'));
  }
  return roots;
}

/** @returns {string | undefined} */
function resolveDshRoot() {
  const argv = process.argv.slice(2);
  const flag = argv.indexOf('--dsh');
  if (flag !== -1 && argv[flag + 1]) {
    const given = argv[flag + 1];
    return existsSync(join(given, 'package.json')) ? given : undefined;
  }
  for (const root of candidateRoots()) {
    if (root && existsSync(join(root, 'package.json'))) return root;
  }
  return undefined;
}

/**
 * One contract check.
 * @typedef {{ id: string, what: string, file: (root: string) => string, needles: string[] }} Check
 */

/** @type {Check[]} */
const CHECKS = [
  {
    id: 'tools-hooks',
    what: 'tools/pre-execute · tools/execute · tools/post-execute',
    file: (root) => join(root, 'node_modules', '@deepseek-ai', 'dsh-tools', 'lib', 'types', 'index.d.ts'),
    needles: ["'tools/pre-execute'", "'tools/execute'", "'tools/post-execute'"],
  },
  {
    id: 'prompt-section',
    what: 'systemPrompt.section + getSectionOrder',
    file: (root) => join(root, 'node_modules', '@deepseek-ai', 'dsh-system-prompt', 'lib', 'types', 'index.d.ts'),
    needles: ['section(section:', 'getSectionOrder('],
  },
  {
    id: 'sandbox-policy',
    what: 'ctx.sandboxPolicy.resolve(request)',
    file: (root) => join(root, 'node_modules', '@deepseek-ai', 'dsh-sandbox-policy', 'lib', 'types', 'index.d.ts'),
    needles: ['resolve(request'],
  },
  {
    id: 'pwsh-tool',
    what: 'the pwsh tool + its own sandboxPolicy/section usage',
    file: (root) => join(root, 'node_modules', '@deepseek-ai', 'dsh-tool-pwsh', 'lib', 'index.js'),
    needles: ['"tool-pwsh"', 'sandboxPolicy', 'systemPrompt.section'],
  },
  {
    id: 'notice-source',
    what: "message source form 'notice' with a summary",
    file: (root) => join(root, 'node_modules', '@deepseek-ai', 'dsh-llm', 'lib', 'types', 'message.d.ts'),
    needles: ["form: 'notice'", 'summary: string'],
  },
];

function main() {
  const root = resolveDshRoot();
  if (root === undefined) {
    console.error('check-host: could not find an installed dsh. Pass --dsh <path> or set DSH_INSTALL_DIR.');
    for (const candidate of candidateRoots()) console.error(`  tried: ${candidate}`);
    return 2;
  }

  const manifest = readOrNull(join(root, 'package.json'));
  let version = '(unknown)';
  try {
    version = JSON.parse(manifest ?? '{}').version ?? version;
  } catch {
    /* keep unknown */
  }

  console.log(`dsh runtime: ${version}`);
  console.log(`dsh root:    ${root}`);
  console.log('');

  let failures = 0;
  for (const check of CHECKS) {
    const path = check.file(root);
    const text = readOrNull(path);
    if (text === null) {
      console.log(`  FAIL  ${check.id.padEnd(15)} missing file: ${path}`);
      failures += 1;
      continue;
    }
    const missing = check.needles.filter((needle) => !text.includes(needle));
    if (missing.length === 0) {
      console.log(`  ok    ${check.id.padEnd(15)} ${check.what}`);
    } else {
      failures += 1;
      console.log(`  FAIL  ${check.id.padEnd(15)} ${check.what}`);
      for (const needle of missing) console.log(`          missing needle: ${needle}   (in ${path})`);
    }
  }

  console.log('');
  if (failures === 0) {
    console.log(`check-host: all ${CHECKS.length} contracts present — safe to keep using this plugin on dsh ${version}.`);
    return 0;
  }
  console.log(`check-host: ${failures}/${CHECKS.length} contract(s) missing on dsh ${version}.`);
  console.log('  The plugin degrades by itself (every read is feature-detected), but the affected channel may go silent.');
  console.log('  Fix: adapt lib/compat.js + lib/index.js to the new host, then bump the minor version (docs/07 §3).');
  return 1;
}

process.exitCode = main();
