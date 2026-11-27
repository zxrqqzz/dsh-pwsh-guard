/**
 * Config normalization.
 *
 * No schema library: the profile's node_modules does not guarantee
 * `@deepseek-ai/schemastery`, and this plugin's config is a dozen flat scalars.
 * Invalid values fall back to the default and are reported once, so a typo in
 * `cordis.patch.yml` degrades instead of breaking the profile.
 *
 * @module dsh-pwsh-guard/config
 */

/** @typedef {import('../types/dsh').PwshGuardConfig} PwshGuardConfig */

/** @type {Readonly<PwshGuardConfig>} */
export const DEFAULTS = Object.freeze({
  mode: 'learn',
  tools: ['pwsh'],
  slowMs: 5000,
  denyOncePerSession: true,
  noticeOnDenyRetry: true,
  maxSectionChars: 1200,
  rulesFile: null,
  appendTiming: true,
  slowNotice: true,
  silentFamilies: [],
  /** Hits of the SAME rule needed before the notice switches to predictive tone. */
  predictiveAfter: 3,
  /** ...and the slowest of those hits must reach this many ms. */
  predictiveMinMs: 10000,
  /** 0 = off. >0: once a rule repeated this often, stop sparing it with deny-once. */
  liftDenyOnceAfter: 0,
});

const MODES = ['learn', 'guard', 'strict'];

/**
 * Merge user config over defaults, validating every field.
 * @param {unknown} raw - the `config` object from the Cordis patch entry.
 * @returns {{ config: PwshGuardConfig, warnings: string[] }}
 */
export function normalizeConfig(raw) {
  /** @type {string[]} */
  const warnings = [];
  const src = raw !== null && typeof raw === 'object' ? /** @type {Record<string, unknown>} */ (raw) : {};
  /** @type {PwshGuardConfig} */
  const config = { ...DEFAULTS };

  if (src.mode !== undefined) {
    if (typeof src.mode === 'string' && MODES.includes(src.mode)) config.mode = /** @type {PwshGuardConfig['mode']} */ (src.mode);
    else warnings.push(`mode must be one of ${MODES.join(' | ')}, got ${JSON.stringify(src.mode)}; using "${config.mode}"`);
  }

  if (src.tools !== undefined) {
    if (Array.isArray(src.tools) && src.tools.length > 0 && src.tools.every((t) => typeof t === 'string' && t.trim() !== '')) {
      config.tools = src.tools.map((t) => t.trim());
    } else {
      warnings.push(`tools must be a non-empty array of tool names, got ${JSON.stringify(src.tools)}; using ${JSON.stringify(config.tools)}`);
    }
  }

  if (src.slowMs !== undefined) {
    if (typeof src.slowMs === 'number' && Number.isFinite(src.slowMs) && src.slowMs >= 0) config.slowMs = src.slowMs;
    else warnings.push(`slowMs must be a finite number >= 0, got ${JSON.stringify(src.slowMs)}; using ${config.slowMs}`);
  }

  for (const key of ['denyOncePerSession', 'noticeOnDenyRetry', 'appendTiming', 'slowNotice']) {
    if (src[key] === undefined) continue;
    if (typeof src[key] === 'boolean') /** @type {any} */ (config)[key] = src[key];
    else warnings.push(`${key} must be a boolean, got ${JSON.stringify(src[key])}; using ${/** @type {any} */ (config)[key]}`);
  }

  if (src.maxSectionChars !== undefined) {
    const value = src.maxSectionChars;
    if (typeof value === 'number' && Number.isInteger(value) && value >= 200) config.maxSectionChars = value;
    else warnings.push(`maxSectionChars must be an integer >= 200, got ${JSON.stringify(value)}; using ${config.maxSectionChars}`);
  }

  if (src.rulesFile !== undefined) {
    if (src.rulesFile === null || typeof src.rulesFile === 'string') config.rulesFile = /** @type {string | null} */ (src.rulesFile);
    else warnings.push(`rulesFile must be a path string or null, got ${JSON.stringify(src.rulesFile)}; using the bundled rules`);
  }

  if (src.silentFamilies !== undefined) {
    if (Array.isArray(src.silentFamilies) && src.silentFamilies.every((f) => typeof f === 'string')) {
      config.silentFamilies = src.silentFamilies.map((f) => f.trim()).filter(Boolean);
    } else {
      warnings.push(`silentFamilies must be an array of strings, got ${JSON.stringify(src.silentFamilies)}; ignoring it`);
    }
  }

  // Adaptive tone (M3): all three keep the pre-M3 behaviour at their defaults.
  for (const key of ['predictiveAfter', 'liftDenyOnceAfter']) {
    if (src[key] === undefined) continue;
    const value = src[key];
    if (typeof value === 'number' && Number.isInteger(value) && value >= 0) /** @type {any} */ (config)[key] = value;
    else warnings.push(`${key} must be an integer >= 0, got ${JSON.stringify(value)}; using ${/** @type {any} */ (config)[key]}`);
  }

  if (src.predictiveMinMs !== undefined) {
    const value = src.predictiveMinMs;
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) config.predictiveMinMs = value;
    else warnings.push(`predictiveMinMs must be a finite number >= 0, got ${JSON.stringify(value)}; using ${config.predictiveMinMs}`);
  }

  return { config, warnings };
}
