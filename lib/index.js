/**
 * dsh-pwsh-guard — make the agent's PowerShell commands faster.
 *
 * Three contributions, one session-local memory:
 *
 *   A. rules (`tools/pre-execute`)  → deny a slow/hanging construct once per session
 *   B. timing (`tools/execute`)     → measure wall time, observing only
 *   C. feedback (`tools/post-execute`)
 *        channel 1: append `[pwsh-guard] 48.2s` to the tool result the model sees
 *        channel 2: inject a `form: 'notice'` message with the faster spelling
 *   S. state  → WeakMap<Agent, …>; nothing is written to disk
 *
 * Plus one static prompt section (`guard:pwsh-efficiency`).
 *
 * Failure policy, invariant: the guard only ever *subtracts* — a rule can teach
 * less, never block more. Every hook is wrapped so a bug here can only mean
 * "the command ran normally".
 *
 * @module dsh-pwsh-guard
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { normalizeConfig } from './config.js';
import { compileRules, isAllowlisted, matchRules, meetsThreshold } from './rules.js';
import { formatMs, renderDenyReason, renderDenyRetryNotice, renderSlowNotice, renderTimingLine } from './notice.js';
import { createStateStore, noteHit } from './state.js';
import { noticeMessage } from './message.js';
import { mayDenyIn, sandboxModeOf, sectionOrderOf } from './compat.js';
import { commandOf, hasEscapeHatch, isApprovalGated, isTimedOut } from './probe.js';
import { loadSectionText } from './section.js';

/** Plugin id: also the `id` used by the profile patch row. */
export const name = 'pwsh-guard';

/** No required services: every host read is feature-detected (`compat.js`). */
export const inject = [];

const SECTION_NAME = 'guard:pwsh-efficiency';
const BUNDLED_RULES_URL = new URL('../rules/rules.json', import.meta.url);

/**
 * Install the guard.
 * @param {DshPluginContext} ctx
 * @param {unknown} [rawConfig]
 */
export function apply(ctx, rawConfig = {}) {
  const { config, warnings } = normalizeConfig(rawConfig);
  const log = createLogger(ctx);
  for (const warning of warnings) log.warn(`config: ${warning}`);

  const compiled = loadRules(config, log);
  const state = createStateStore();

  registerSection(ctx, config, log);

  // ── A. before execution: deny (once per session, confined modes only) ──────
  ctx.on('tools/pre-execute', async (exec, next) => {
    /** @type {DshPreToolDecision | null} */
    let decision = null;
    try {
      decision = decide(exec);
    } catch (error) {
      log.error(`pre-execute: ${describeError(error)}`);
    }
    return decision ?? next();
  });

  // ── B. around dispatch: measure, change nothing ────────────────────────────
  ctx.on('tools/execute', async (exec, next) => {
    if (!tracks(exec)) return next();
    const startedAt = performance.now();
    try {
      return await next();
    } finally {
      state.rememberTiming(exec?.callId, performance.now() - startedAt);
    }
  });

  // ── C. after execution: duration line + advice notice ──────────────────────
  ctx.on('tools/post-execute', async (exec, result, next) => {
    const downstream = await next();
    try {
      return observe(exec, result, downstream);
    } catch (error) {
      log.error(`post-execute: ${describeError(error)}`);
      return downstream;
    }
  });

  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Whether this plugin watches the tool at all.
   * @param {{ name?: unknown } | undefined} exec
   */
  function tracks(exec) {
    return !!exec && typeof exec.name === 'string' && config.tools.includes(exec.name);
  }

  /**
   * Decide the pre-execution verdict, or null to let the call through.
   * @param {DshToolExecution} exec
   * @returns {DshPreToolDecision | null}
   */
  function decide(exec) {
    if (!tracks(exec)) return null;
    const command = commandOf(exec);
    if (command === undefined) return null;
    if (hasEscapeHatch(command)) return null;
    if (isAllowlisted(compiled, command)) return null;

    // Evidence first: a mode we cannot prove is a mode we never deny in.
    const mode = sandboxModeOf(ctx, exec.agent);
    if (!mayDenyIn(mode)) return null;
    if (config.mode === 'learn') return null;

    const hit = matchRules(compiled, command);
    if (hit === null) return null;
    const threshold = config.mode === 'strict' ? 'medium' : 'high';
    if (!meetsThreshold(hit.severity, threshold)) return null;

    const session = state.of(exec.agent);
    // M3: a rule that keeps costing this session real time loses its once-only
    // grace — but only when the user opts in with `liftDenyOnceAfter > 0`.
    const stats = session.hits.get(hit.rule.id);
    const lifted = config.liftDenyOnceAfter > 0 && stats !== undefined && stats.count >= config.liftDenyOnceAfter;
    if (config.denyOncePerSession && !lifted && session.denied.has(hit.rule.id)) return null;

    session.denied.add(hit.rule.id);
    if (typeof exec.callId === 'string') session.deniedCalls.add(exec.callId);
    if (config.noticeOnDenyRetry) session.retryHints.add(hit.rule.id);

    return { kind: 'deny', reason: renderDenyReason({ ...hit, denyAgain: lifted || !config.denyOncePerSession }) };
  }

  /**
   * Attach the two feedback channels to an already-settled result.
   * @param {DshToolExecution} exec
   * @param {DshToolExecutionResult} result
   * @param {DshPostToolDecision} downstream
   * @returns {DshPostToolDecision}
   */
  function observe(exec, result, downstream) {
    if (!tracks(exec)) return downstream;
    const command = commandOf(exec);
    if (command === undefined) {
      state.takeTiming(exec.callId);
      return downstream;
    }
    // The escape hatch is a promise of silence for this command.
    if (hasEscapeHatch(command)) {
      state.takeTiming(exec.callId);
      return downstream;
    }

    const ms = state.takeTiming(exec.callId);
    const session = state.of(exec.agent);

    // Our own denial travels through this waterfall too; bookkeep, say nothing.
    if (session.deniedCalls.delete(exec.callId)) return downstream;

    const hit = matchRules(compiled, command);
    const silenced = hit !== null && config.silentFamilies.includes(hit.rule.family);
    const timedOut = isTimedOut(result);
    const slow = typeof ms === 'number' && ms >= config.slowMs;
    // The measured window covers the whole dispatch, which includes a human
    // answering an escalation prompt. That wait can dwarf the command (a
    // 1-second test once reported 34 minutes), so such a call is NOT measured:
    // we cannot attribute its time, and a caveat does not fix a wrong number.
    const approvalWait = isApprovalGated(exec);
    const measurable = !approvalWait || timedOut;

    /** @type {DshPostToolDecision} */
    let out = downstream;

    // Channel 1 — the duration, appended where the model cannot miss it.
    if (config.appendTiming && measurable && (timedOut || slow) && out.kind === 'accept' && out.value === undefined) {
      const base = Array.isArray(out.content) ? out.content : Array.isArray(result.content) ? result.content : [];
      out = {
        ...out,
        content: [...base, { type: 'text', text: renderTimingLine({ ms, timedOut, thresholdMs: config.slowMs, approvalWait }) }],
      };
    }

    // Channel 2 — the advice.
    if (config.slowNotice && !silenced) {
      let text = null;
      // A retry hint is consumed by the next call of that rule, whatever its
      // speed, so a stale hint never fires on an unrelated later command.
      const retrying = hit !== null && session.retryHints.delete(hit.rule.id);
      let attempt = 0;
      let predictive = false;
      /** @type {{ count: number, maxMs: number, lastMs: number, totalMs: number } | undefined} */
      let stats;
      if (measurable && (timedOut || slow) && hit !== null) {
        attempt = noteHit(session, hit.rule.id, ms);
        stats = session.hits.get(hit.rule.id);
        predictive = stats !== undefined && stats.count >= config.predictiveAfter && stats.maxMs >= config.predictiveMinMs;
      }
      if (retrying && hit !== null) {
        text = renderDenyRetryNotice(hit.rule);
      } else if (measurable && (timedOut || slow)) {
        text = renderSlowNotice({
          rule: hit === null ? null : hit.rule,
          ms,
          timedOut,
          attempt,
          predictive,
          stats,
          approvalWait,
        });
      }
      if (text !== null) {
        const message = noticeMessage(text, summarize(ms, hit === null ? null : hit.rule.id));
        out = { ...out, additionalContexts: [message, ...(out.additionalContexts ?? [])] };
      }
    }

    return out;
  }
}

/**
 * Register the static efficiency section once `systemPrompt` exists — plugin
 * load order carries no guarantee, and `ctx.inject` is the order-independent
 * way to wait for a service.
 * @param {DshPluginContext} ctx
 * @param {PwshGuardConfig} config
 * @param {{ warn: (m: string) => void, error: (m: string) => void }} log
 */
function registerSection(ctx, config, log) {
  const { text, source } = loadSectionText(config.maxSectionChars);
  if (source === 'fallback') log.warn('section text fell back to the built-in short version (prompt/section-pwsh-guard.md unreadable?)');
  /** @param {DshPluginContext} scoped */
  const register = (scoped) => {
    try {
      scoped.systemPrompt.section({ name: SECTION_NAME, order: sectionOrderOf(scoped), text });
    } catch (error) {
      log.error(`section: ${describeError(error)}`);
    }
  };
  try {
    if (typeof ctx.inject === 'function') ctx.inject(['systemPrompt'], register);
    else if (ctx.systemPrompt) register(ctx);
  } catch (error) {
    log.error(`section inject: ${describeError(error)}`);
  }
}

/**
 * Read and compile the rules document, falling back to the bundled one.
 * @param {PwshGuardConfig} config
 * @param {{ warn: (m: string) => void, error: (m: string) => void }} log
 */
function loadRules(config, log) {
  const bundled = fileURLToPath(BUNDLED_RULES_URL);
  const file = typeof config.rulesFile === 'string' && config.rulesFile !== '' ? config.rulesFile : bundled;
  /** @type {unknown} */
  let doc;
  try {
    doc = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    log.warn(`rules file "${file}" could not be read (${describeError(error)}); falling back to the bundled rules`);
    try {
      doc = JSON.parse(readFileSync(bundled, 'utf8'));
    } catch (fallbackError) {
      log.error(`bundled rules unreadable (${describeError(fallbackError)}); running timing-only`);
      doc = { version: 0, allowlist: [], rules: [] };
    }
  }
  const compiled = compileRules(doc);
  for (const warning of compiled.warnings) log.warn(`rules: ${warning}`);
  if (compiled.rules.length === 0) log.warn('no usable rules: guard degrades to section + timing');
  return compiled;
}

/**
 * @param {DshToolExecution | undefined} exec
 * @param {string | null} ruleId
 */
function summarize(ms, ruleId) {
  const duration = formatMs(ms);
  return ruleId === null ? `${duration} slow pwsh call` : `${duration} · ${ruleId}`;
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function describeError(error) {
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * Prefer the host logger; fall back to the console without ever throwing.
 * @param {DshPluginContext} ctx
 */
function createLogger(ctx) {
  /** @type {{ warn?: Function, error?: Function } | undefined} */
  let scoped;
  try {
    if (typeof ctx?.logger === 'function') scoped = ctx.logger('pwsh-guard');
  } catch {
    scoped = undefined;
  }
  /** @param {'warn'|'error'} level @param {string} message */
  const write = (level, message) => {
    try {
      const fn = scoped?.[level];
      if (typeof fn === 'function') {
        fn.call(scoped, message);
        return;
      }
    } catch {
      /* fall through to console */
    }
    try {
      const line = `[pwsh-guard] ${message}`;
      if (level === 'warn') console.warn(line);
      else console.error(line);
    } catch {
      /* a logger is never allowed to break a call */
    }
  };
  return {
    warn: (/** @type {string} */ message) => write('warn', message),
    error: (/** @type {string} */ message) => write('error', message),
  };
}
