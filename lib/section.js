/**
 * The static efficiency section.
 *
 * SINGLE SOURCE OF TRUTH: `prompt/section-pwsh-guard.md`. It is read once at
 * apply time, so rewording the section is a text edit, not a code edit. The
 * fallback below only exists so a missing file degrades to a short reminder
 * instead of an empty prompt.
 *
 * Static on purpose: `AssembleContext` carries only `{ scope?, signal? }` — no
 * agent, no session — so per-session rendering is impossible, and a
 * process-global one would leak between sessions (`docs/01`). A static section
 * also keeps the request prefix cache-stable.
 *
 * @module dsh-pwsh-guard/section
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Where the reviewable text lives (packaged via `files: ["prompt/"]`). */
export const SECTION_URL = new URL('../prompt/section-pwsh-guard.md', import.meta.url);

/** Used only when the markdown cannot be read. Kept deliberately short. */
export const SECTION_FALLBACK = `## PowerShell 效率（本机实测）

每次调用都是新的 pwsh 进程，没有缓存；沙箱里 \`& rg\` / \`git\` / \`node -e\` 会被拒绝。搜索和读文件优先用宿主的 grep / glob / read 工具。
枚举先压规模：\`Get-ChildItem -Recurse\` 要带 \`-Filter\` 或 \`-Depth\`；只要路径用 \`[System.IO.Directory]::EnumerateFiles(...)\`。
绝不写会挂住的：\`Get-Content -Wait\`、\`Read-Host\`、\`-Confirm\`、\`while(...){Start-Sleep}\`、\`Wait-Process\`；长任务交给后台 job，用 job_output 收。
确有必要原样执行时，在命令里加注释 \`# pwsh-guard:allow\`。`;

/**
 * Read the section text and enforce the character budget.
 * @param {number} maxChars
 * @returns {{ text: string, source: 'file' | 'fallback' }}
 */
export function loadSectionText(maxChars) {
  let text = '';
  let source = /** @type {'file' | 'fallback'} */ ('fallback');
  try {
    text = readFileSync(fileURLToPath(SECTION_URL), 'utf8').trim();
    if (text !== '') source = 'file';
  } catch {
    text = '';
  }
  if (text === '') {
    text = SECTION_FALLBACK;
    source = 'fallback';
  }
  return { text: clampSection(text, maxChars), source };
}

/**
 * Cut at a line boundary, never mid-sentence if a newline is close enough.
 * @param {string} text
 * @param {number} max
 * @returns {string}
 */
export function clampSection(text, max) {
  if (typeof text !== 'string') return '';
  if (!Number.isFinite(max) || max <= 0 || text.length <= max) return text;
  const head = text.slice(0, Math.max(1, max - 1));
  const boundary = head.lastIndexOf('\n');
  return `${boundary > max * 0.6 ? head.slice(0, boundary) : head}…`;
}
