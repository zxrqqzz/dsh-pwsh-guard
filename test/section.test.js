/**
 * Section text: single source is `prompt/section-pwsh-guard.md`.
 *
 * The important assertion here is the BUDGET one: a section longer than the
 * default `maxSectionChars` gets clamped, and clamping cuts the TAIL — which is
 * exactly where the background-job advice and the escape hatch live. A section
 * that only fits after truncation is a bug, so this test measures the raw file.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { DEFAULTS } from '../lib/config.js';
import { SECTION_FALLBACK, SECTION_URL, clampSection, loadSectionText } from '../lib/section.js';

const RAW = readFileSync(fileURLToPath(SECTION_URL), 'utf8').trim();

test('the section fits the default budget without truncation', () => {
  assert.ok(RAW.length > 200, `unexpectedly short: ${RAW.length} chars`);
  assert.ok(
    RAW.length <= DEFAULTS.maxSectionChars,
    `over budget: ${RAW.length} > ${DEFAULTS.maxSectionChars} chars — the default config would clamp the tail away`,
  );
  const { text, source } = loadSectionText(DEFAULTS.maxSectionChars);
  assert.equal(source, 'file');
  assert.equal(text, RAW, 'the shipped section must not be clamped');
});

test('the section keeps the load-bearing facts', () => {
  for (const token of ['EnumerateFiles', 'job_output', '-Filter', '# pwsh-guard:allow']) {
    assert.ok(RAW.includes(token), `missing load-bearing token: ${token}`);
  }
});

test('an explicit smaller budget is enforced at a line boundary', () => {
  const { text } = loadSectionText(300);
  assert.ok(text.length <= 300, `length ${text.length}`);
  assert.ok(text.endsWith('…'));
});

test('fallback exists for a missing file and stays short', () => {
  assert.ok(SECTION_FALLBACK.length > 100);
  assert.ok(SECTION_FALLBACK.length < DEFAULTS.maxSectionChars);
  assert.ok(SECTION_FALLBACK.includes('# pwsh-guard:allow'));
});

test('clampSection leaves text under budget untouched', () => {
  assert.equal(clampSection('hello', 100), 'hello');
  assert.equal(clampSection('hello', 0), 'hello');
});
