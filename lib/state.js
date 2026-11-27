/**
 * Session-scoped memory. Nothing is written to disk: state lives on objects the
 * agent owns, so closing a session drops it (`docs/01`: 会话内 only).
 *
 *   perAgent: WeakMap<Agent, SessionState>   // dies with the agent
 *   timings:  Map<callId, ms>                // bounded; consumed by post-execute
 *
 * The timing map is keyed by `callId` rather than the `exec` object because
 * `tools/execute` and `tools/post-execute` receive *different views* of the
 * same call (`ToolDispatchExecution` vs `ToolExecution`), while `callId` is
 * stable across both.
 *
 * @module dsh-pwsh-guard/state
 */

const MAX_TIMINGS = 256;

/** @returns {{ denied: Set<string>, deniedCalls: Set<string>, retryHints: Set<string>, hits: Map<string, { count: number, maxMs: number, lastMs: number, totalMs: number }> }} */
function createSessionState() {
  return {
    /** Rule ids already denied in this session (deny-once bookkeeping). */
    denied: new Set(),
    /** callIds whose denial this plugin issued, so post-execute can skip them. */
    deniedCalls: new Set(),
    /** Rule ids denied earlier that deserve a short line when the retry lands. */
    retryHints: new Set(),
    /** ruleId -> how often it repeated and how bad it got. */
    hits: new Map(),
  };
}

export function createStateStore() {
  /** @type {WeakMap<object, ReturnType<typeof createSessionState>>} */
  const perAgent = new WeakMap();
  const anonymous = createSessionState();
  /** @type {Map<string, number>} */
  const timings = new Map();

  /**
   * Per-agent state. A missing agent degrades to one shared bucket instead of
   * throwing — the guard must never be the reason a call fails.
   * @param {unknown} agent
   */
  function of(agent) {
    if (agent === null || (typeof agent !== 'object' && typeof agent !== 'function')) return anonymous;
    const key = /** @type {object} */ (agent);
    let state = perAgent.get(key);
    if (state === undefined) {
      state = createSessionState();
      perAgent.set(key, state);
    }
    return state;
  }

  return {
    of,

    /**
     * Remember a measured duration until post-execute reads it.
     * @param {unknown} callId
     * @param {number} ms
     */
    rememberTiming(callId, ms) {
      if (typeof callId !== 'string' || !Number.isFinite(ms)) return;
      if (timings.size >= MAX_TIMINGS) {
        const oldest = timings.keys().next();
        if (!oldest.done) timings.delete(oldest.value);
      }
      timings.set(callId, ms);
    },

    /**
     * Read and forget one duration.
     * @param {unknown} callId
     * @returns {number | undefined}
     */
    takeTiming(callId) {
      if (typeof callId !== 'string') return undefined;
      const ms = timings.get(callId);
      if (ms !== undefined) timings.delete(callId);
      return ms;
    },

    /** Test/diagnostic hook: how many stale timings are parked. */
    timingCount() {
      return timings.size;
    },
  };
}

/**
 * Record one observed hit for a rule and return its ordinal in this session.
 * @param {{ hits: Map<string, { count: number, maxMs: number, lastMs: number, totalMs: number }> }} session
 * @param {string} ruleId
 * @param {number | undefined} ms
 * @returns {number}
 */
export function noteHit(session, ruleId, ms) {
  const previous = session.hits.get(ruleId) ?? { count: 0, maxMs: 0, lastMs: 0, totalMs: 0 };
  const next = {
    count: previous.count + 1,
    maxMs: Math.max(previous.maxMs, typeof ms === 'number' ? ms : 0),
    lastMs: typeof ms === 'number' ? ms : previous.lastMs,
    totalMs: previous.totalMs + (typeof ms === 'number' ? ms : 0),
  };
  session.hits.set(ruleId, next);
  return next.count;
}
