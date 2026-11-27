/**
 * Rule engine: pure functions over a rules document.
 *
 * Rules are data (`rules/rules.json`), never code. A rule that fails to compile
 * is dropped with a warning and the rest keep working — a bad regex must not
 * take the guard down.
 *
 * Matching order (short-circuit), mirrors docs/03 section A:
 *   1. allowlist first, so a well-written command can never be flagged;
 *   2. every rule regex else, then the highest severity wins;
 *   3. `bumpWhen` escalates a medium rule when the command mentions a known
 *      danger zone (node_modules, a drive root, $env:USERPROFILE, C:\Windows).
 *
 * @module dsh-pwsh-guard/rules
 */

/** @typedef {{ id: string, family: string, severity: string, why: string, measured: string, fast: string, alt?: string }} RuleDoc */
/** @typedef {{ id: string, family: string, severity: 'high' | 'medium' | 'low', regex: RegExp, bumpWhen: RegExp[], why: string, measured: string, fast: string, alt?: string, when: string }} CompiledRule */

const SEVERITY_RANK = { high: 3, medium: 2, low: 1 };
const FAMILY_RANK = { block: 4, search: 3, read: 2, count: 1, output: 0 };

/**
 * Compile a rules document into ready-to-test regexes.
 * @param {unknown} doc - parsed `rules.json`.
 * @returns {{ rules: CompiledRule[], allowlist: { id: string, regex: RegExp, why: string }[], version: number, warnings: string[] }}
 */
export function compileRules(doc) {
  /** @type {string[]} */
  const warnings = [];
  const source = doc !== null && typeof doc === 'object' ? /** @type {any} */ (doc) : {};
  const version = Number.isInteger(source.version) ? source.version : 0;

  /** @type {{ id: string, regex: RegExp, why: string }[]} */
  const allowlist = [];
  for (const entry of Array.isArray(source.allowlist) ? source.allowlist : []) {
    if (!entry || typeof entry.id !== 'string' || typeof entry.regex !== 'string') {
      warnings.push(`allowlist entry skipped: ${JSON.stringify(entry)}`);
      continue;
    }
    try {
      allowlist.push({ id: entry.id, regex: new RegExp(entry.regex), why: String(entry.why ?? '') });
    } catch (error) {
      warnings.push(`allowlist "${entry.id}" has an invalid regex, skipped: ${/** @type {Error} */ (error).message}`);
    }
  }

  /** @type {CompiledRule[]} */
  const rules = [];
  for (const entry of Array.isArray(source.rules) ? source.rules : []) {
    if (!entry || typeof entry.id !== 'string' || typeof entry.regex !== 'string') {
      warnings.push(`rule entry skipped: ${JSON.stringify(entry)}`);
      continue;
    }
    let regex;
    try {
      regex = new RegExp(entry.regex);
    } catch (error) {
      warnings.push(`rule "${entry.id}" has an invalid regex, skipped: ${/** @type {Error} */ (error).message}`);
      continue;
    }
    const severity = entry.severity === 'medium' || entry.severity === 'low' ? entry.severity : 'high';
    const bumpWhen = [];
    for (const pattern of Array.isArray(entry.bumpWhen) ? entry.bumpWhen : []) {
      if (typeof pattern !== 'string') continue;
      try {
        bumpWhen.push(new RegExp(pattern, 'i'));
      } catch (error) {
        warnings.push(`rule "${entry.id}" has an invalid bumpWhen pattern, skipped: ${pattern}`);
      }
    }
    rules.push({
      id: entry.id,
      family: typeof entry.family === 'string' ? entry.family : 'other',
      severity,
      regex,
      bumpWhen,
      why: String(entry.why ?? ''),
      measured: String(entry.measured ?? ''),
      fast: String(entry.fast ?? ''),
      alt: typeof entry.alt === 'string' ? entry.alt : undefined,
      when: String(entry.when ?? ''),
    });
  }

  return { rules, allowlist, version, warnings };
}

/**
 * First allowlist entry the command satisfies, or null.
 * @param {{ allowlist: { id: string, regex: RegExp, why: string }[] }} compiled
 * @param {string} command
 * @returns {{ id: string, why: string } | null}
 */
export function isAllowlisted(compiled, command) {
  for (const entry of compiled.allowlist) {
    if (entry.regex.test(command)) return { id: entry.id, why: entry.why };
  }
  return null;
}

/**
 * The highest-severity rule the command matches, or null.
 * @param {{ rules: CompiledRule[] }} compiled
 * @param {string} command
 * @returns {{ rule: CompiledRule, bumped: boolean, severity: 'high' | 'medium' | 'low' } | null}
 */
export function matchRules(compiled, command) {
  /** @type {{ rule: CompiledRule, bumped: boolean, severity: 'high' | 'medium' | 'low' } | null} */
  let best = null;
  for (const rule of compiled.rules) {
    if (!rule.regex.test(command)) continue;
    const bumped = rule.bumpWhen.some((pattern) => pattern.test(command));
    const severity = bumped && rule.severity !== 'high' ? 'high' : rule.severity;
    if (best === null || beats(severity, rule.family, best.severity, best.rule.family)) {
      best = { rule, bumped, severity };
    }
  }
  return best;
}

/**
 * @param {'high'|'medium'|'low'} severity
 * @param {string} family
 * @param {'high'|'medium'|'low'} bestSeverity
 * @param {string} bestFamily
 * @returns {boolean}
 */
function beats(severity, family, bestSeverity, bestFamily) {
  const delta = SEVERITY_RANK[severity] - SEVERITY_RANK[bestSeverity];
  if (delta !== 0) return delta > 0;
  return (FAMILY_RANK[family] ?? 0) > (FAMILY_RANK[bestFamily] ?? 0);
}

/**
 * Whether a decided severity clears the mode's deny threshold.
 * @param {'high'|'medium'|'low'} severity
 * @param {'high'|'medium'} threshold
 * @returns {boolean}
 */
export function meetsThreshold(severity, threshold) {
  return SEVERITY_RANK[severity] >= SEVERITY_RANK[threshold];
}
