/**
 * All model-facing wording lives here, as pure functions.
 *
 * Two channels, deliberately different jobs (`docs/05` §7):
 *   - the timing line goes onto the tool result: short, factual, impossible to miss;
 *   - the notice teaches: what was slow, what to write instead, how fast that is.
 * Neither repeats the other.
 *
 * @module dsh-pwsh-guard/notice
 */

/**
 * Human-readable duration. Kept coarse on purpose: the model only needs
 * "three seconds" vs "three minutes", not microsecond precision.
 * @param {number} ms
 * @returns {string}
 */
export function formatMs(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return 'unknown';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.round((ms % 60000) / 1000);
  return `${minutes}m${String(seconds).padStart(2, '0')}s`;
}

/**
 * Truncate to a character budget, preferring a newline boundary.
 * @param {string} text
 * @param {number} max
 * @returns {string}
 */
export function clampText(text, max) {
  if (typeof text !== 'string') return '';
  if (!Number.isFinite(max) || max <= 0 || text.length <= max) return text;
  const head = text.slice(0, Math.max(1, max - 1));
  const boundary = head.lastIndexOf('\n');
  return `${boundary > max * 0.6 ? head.slice(0, boundary) : head}…`;
}

/**
 * The `deny` reason. First line is a hard requirement: without it the model
 * treats a policy denial as a failed command and starts debugging it.
 * @param {{ rule: { why: string, measured: string, fast: string, alt?: string }, bumped: boolean, denyAgain?: boolean }} hit
 * @returns {string}
 */
export function renderDenyReason(hit) {
  const { rule, bumped, denyAgain = false } = hit;
  const lines = [
    '[pwsh-guard] 这不是命令失败，是效率建议。',
    `这条会慢：${rule.why}${rule.measured ? `（本机实测：${rule.measured}）` : ''}`,
  ];
  if (bumped) lines.push('而且命令里出现了 node_modules / 盘符根 / 用户目录这类危险区，规模不可控。');
  lines.push(`换成：${rule.fast}`);
  if (rule.alt) lines.push(`或者：${rule.alt}`);
  lines.push(
    denyAgain
      ? '（本会话这类写法每次都会被拦；确有必要原样执行，请在命令里加注释 `# pwsh-guard:allow` 后重发）'
      : '（本会话这类写法只会被拦这一次；确有必要原样执行，请在命令里加注释 `# pwsh-guard:allow` 后重发）',
  );
  return lines.join('\n');
}

/**
 * The line appended to the model-facing tool result (channel 1).
 *
 * `approvalWait` matters: the measured window includes the human answering an
 * escalation prompt, which can be minutes of wall time that the COMMAND never
 * spent. Saying so keeps the number honest.
 * @param {{ ms?: number, timedOut: boolean, thresholdMs: number, approvalWait?: boolean }} input
 * @returns {string}
 */
export function renderTimingLine(input) {
  const { ms, timedOut, thresholdMs, approvalWait = false } = input;
  const caveat = approvalWait ? '，其中含审批等待' : '';
  if (timedOut) {
    return `[pwsh-guard] 跑满了超时窗口（${formatMs(ms)}${caveat}）。长任务请用 run_in_background 交给后台 job，再用 job_output 收结果。`;
  }
  return `[pwsh-guard] 实测耗时 ${formatMs(ms)}${caveat}（超过 ${formatMs(thresholdMs)} 阈值）。`;
}

/**
 * The notice that carries advice (channel 2).
 * @param {{ rule?: { why: string, measured: string, fast: string, alt?: string, when?: string } | null, ms?: number, timedOut: boolean, attempt: number, approvalWait?: boolean, predictive?: boolean, stats?: { count: number, maxMs: number, totalMs: number } }} input
 * @returns {string}
 */
export function renderSlowNotice(input) {
  const { rule, ms, timedOut, attempt, approvalWait, predictive = false, stats } = input;
  const head = timedOut
    ? `[pwsh-guard] 上一条命令把超时窗口跑满了（${formatMs(ms)}）${approvalWait ? '，其中含审批等待' : ''}。`
    : `[pwsh-guard] 上一条命令实测 ${formatMs(ms)}${approvalWait ? '（含审批等待）' : ''}。`;

  // M3 predictive tone: the same rule has cost this session real time more than
  // once — stop teaching, start predicting.
  if (rule && predictive && stats && stats.count >= 2) {
    const lines = [
      head,
      `又是它：本会话第 ${stats.count} 次同类慢命令（最慢 ${formatMs(stats.maxMs)}，累计 ${formatMs(stats.totalMs)}）。`,
    ];
    if (rule.when) lines.push(`慢写法：${rule.when}`);
    lines.push(`下次直接写：${rule.fast}`);
    return lines.join('\n');
  }

  // Second and later hits in the same session: say it once, briefly.
  if (attempt >= 2 && rule) {
    return [head, `本会话同类第 ${attempt} 次。上次给过的写法：${rule.fast}`].join('\n');
  }

  if (!rule) {
    return [
      head,
      '它没有命中已知规则，但如果只是在枚举 / 搜索文件，改用宿主的 grep、glob、read 工具会快一到两个数量级；',
      '在壳里枚举时用 -Filter / -Depth 先压规模，别让每个文件都变成 PSObject。',
    ].join('\n');
  }

  const lines = [head, `慢在：${rule.why}${rule.measured ? `（本机实测：${rule.measured}）` : ''}`, `更快：${rule.fast}`];
  if (rule.alt) lines.push(`或者：${rule.alt}`);
  return lines.join('\n');
}

/**
 * After a denial, the retry that got through still deserves one short line.
 * @param {{ fast: string }} rule
 * @returns {string}
 */
export function renderDenyRetryNotice(rule) {
  return [
    '[pwsh-guard] 这个写法本会话已被拦过一次，这次放行。',
    `更快的写法：${rule.fast}`,
    '确实必须原样执行：在命令里加注释 `# pwsh-guard:allow`，之后不再提示。',
  ].join('\n');
}
