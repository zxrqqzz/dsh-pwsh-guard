/**
 * Wording tests. The two channels have different jobs (`docs/05` §7):
 * the timing line is a fact, the notice is advice — neither duplicates the other.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  clampText,
  formatMs,
  renderDenyReason,
  renderDenyRetryNotice,
  renderSlowNotice,
  renderTimingLine,
} from '../lib/notice.js';

const RULE = {
  id: 'gci-recurse-nofilter',
  family: 'search',
  severity: 'high',
  why: '递归枚举会把每个文件对象化',
  measured: '2693 ms / 12357 files',
  fast: '[System.IO.Directory]::EnumerateFiles(...)',
  alt: '-Filter *.ext 先压规模',
};

test('formatMs is coarse but readable', () => {
  assert.equal(formatMs(500), '500ms');
  assert.equal(formatMs(48_200), '48.2s');
  assert.equal(formatMs(65_000), '1m05s');
  assert.equal(formatMs(Number.NaN), 'unknown');
  assert.equal(formatMs(-1), 'unknown');
});

test('clampText keeps short text and truncates long text at a line boundary', () => {
  assert.equal(clampText('abc', 10), 'abc');
  const long = `${'x'.repeat(40)}\n${'y'.repeat(40)}\n${'z'.repeat(40)}`;
  const clamped = clampText(long, 60);
  assert.ok(clamped.length <= 60, `length ${clamped.length}`);
  assert.ok(clamped.endsWith('…'));
  assert.ok(!clamped.includes('\n' + 'z'), 'cut before the last line');
});

test('deny reason opens with the "not a failure" line', () => {
  const text = renderDenyReason({ rule: RULE, bumped: false });
  assert.equal(text.split('\n')[0], '[pwsh-guard] 这不是命令失败，是效率建议。');
  assert.ok(text.includes('递归枚举会把每个文件对象化'));
  assert.ok(text.includes('（本机实测：'));
  assert.ok(text.includes(RULE.fast));
  assert.ok(text.includes(RULE.alt));
  assert.ok(text.includes('# pwsh-guard:allow'));
  assert.ok(!text.includes('危险区'));
});

test('deny reason names the danger zone when bumped', () => {
  const text = renderDenyReason({ rule: RULE, bumped: true });
  assert.ok(text.includes('危险区'));
});

test('timing line is factual and short', () => {
  const normal = renderTimingLine({ ms: 48_200, timedOut: false, thresholdMs: 5000 });
  assert.ok(normal.includes('实测耗时 48.2s'));
  assert.ok(!normal.includes('更快'), 'the timing line must not carry advice');
  assert.ok(normal.split('\n').length === 1, 'one line only');

  const timedOut = renderTimingLine({ ms: 120_000, timedOut: true, thresholdMs: 5000 });
  assert.ok(timedOut.includes('超时窗口'));
  assert.ok(timedOut.includes('job_output'));
});

test('the timing line admits when the window included an approval wait', () => {
  // Real case: the command took 1s, the human took 34 minutes to approve.
  const text = renderTimingLine({ ms: 2_062_000, timedOut: false, thresholdMs: 5000, approvalWait: true });
  assert.ok(text.includes('含审批等待'), 'a number this big must not look like command cost');
});

test('slow notice explains and advises', () => {
  const text = renderSlowNotice({ rule: RULE, ms: 48_200, timedOut: false, attempt: 1 });
  assert.ok(text.includes('实测 48.2s'));
  assert.ok(text.includes('慢在：'));
  assert.ok(text.includes('更快：'));
  assert.ok(text.includes(RULE.measured));
});

test('slow notice shortens on repeat', () => {
  const first = renderSlowNotice({ rule: RULE, ms: 48_200, timedOut: false, attempt: 1 });
  const third = renderSlowNotice({ rule: RULE, ms: 41_000, timedOut: false, attempt: 3 });
  assert.ok(third.length < first.length, 'repeat hit must be shorter');
  assert.ok(third.includes('上次给过的写法'));
  assert.ok(third.includes('第 3 次'));
});

test('slow notice without a rule still says something useful', () => {
  const text = renderSlowNotice({ rule: null, ms: 900, timedOut: false, attempt: 0 });
  assert.ok(text.includes('没有命中已知规则'));
  assert.ok(text.includes('grep'));
});

test('approval wait is labelled', () => {
  const text = renderSlowNotice({ rule: RULE, ms: 30_000, timedOut: false, attempt: 1, approvalWait: true });
  assert.ok(text.includes('含审批等待'));
});

test('deny-retry notice points at the escape hatch', () => {
  const text = renderDenyRetryNotice(RULE);
  assert.ok(text.includes('已被拦过一次'));
  assert.ok(text.includes('# pwsh-guard:allow'));
  assert.ok(text.includes(RULE.fast));
});

test('deny reason tells the truth about how often it will deny', () => {
  const once = renderDenyReason({ rule: RULE, bumped: false });
  assert.ok(once.includes('只会被拦这一次'));
  const again = renderDenyReason({ rule: RULE, bumped: false, denyAgain: true });
  assert.ok(again.includes('每次都会被拦'));
});

test('predictive notice names the repeat count and the accumulated cost', () => {
  const text = renderSlowNotice({
    rule: { ...RULE, when: 'Get-ChildItem 带 -Recurse' },
    ms: 30_000,
    timedOut: false,
    attempt: 3,
    predictive: true,
    stats: { count: 3, maxMs: 48_000, totalMs: 90_000 },
  });
  assert.ok(text.includes('又是它'));
  assert.ok(text.includes('第 3 次'));
  assert.ok(text.includes('最慢 48.0s'));
  assert.ok(text.includes('累计 1m30s'));
  assert.ok(text.includes('慢写法：Get-ChildItem 带 -Recurse'));
  assert.ok(text.includes('下次直接写：'));
});

test('predictive tone needs the configured count', () => {
  const text = renderSlowNotice({
    rule: RULE,
    ms: 30_000,
    timedOut: false,
    attempt: 2,
    predictive: false,
    stats: { count: 2, maxMs: 30_000, totalMs: 40_000 },
  });
  assert.ok(!text.includes('又是它'));
  assert.ok(text.includes('上次给过的写法'));
});
