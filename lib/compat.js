/**
 * Host-contract adapters: the only place that reads a service this plugin did
 * not create. Everything is feature-detected and returns `undefined` rather
 * than throwing, so a contract drift degrades to "guard does less" instead of
 * breaking the profile (`docs/06` §3, risk 2).
 *
 * @module dsh-pwsh-guard/compat
 */

/** The host section order table puts TOOL_PWSH at 1010; ours rides right after. */
const FALLBACK_PWSH_ORDER = 1010;

/**
 * Resolve the sandbox mode that governs this call.
 *
 * Verified shape (`dsh-tool-pwsh/lib/index.js:318,321`):
 *   ctx.get('sandboxPolicy').resolve({ session: exec.agent.session }).mode
 *
 * `undefined` means "cannot prove", and the caller must degrade to learn-only.
 *
 * @param {DshPluginContext} ctx
 * @param {DshAgent | undefined} agent
 * @returns {DshSandboxMode | undefined}
 */
export function sandboxModeOf(ctx, agent) {
  try {
    if (typeof ctx?.get !== 'function') return undefined;
    const service = /** @type {DshSandboxPolicyService | undefined} */ (ctx.get('sandboxPolicy'));
    if (!service || typeof service.resolve !== 'function') return undefined;
    const session = sessionOf(ctx, agent);
    const policy = session === undefined ? service.resolve() : service.resolve({ session });
    return policy && typeof policy.mode === 'string' ? policy.mode : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The live agent carries `session`, but the public type only declares `id`.
 * Fall back to the session store before giving up.
 * @param {DshPluginContext} ctx
 * @param {DshAgent | undefined} agent
 * @returns {DshSession | undefined}
 */
export function sessionOf(ctx, agent) {
  if (!agent || typeof agent !== 'object') return undefined;
  const direct = agent.session;
  if (direct && typeof direct === 'object') return direct;
  try {
    const store = /** @type {DshSessionStore | undefined} */ (ctx.get('sessions'));
    if (store && typeof store.get === 'function' && typeof agent.id === 'string') {
      return store.get(agent.id) ?? undefined;
    }
  } catch {
    /* no session store: caller degrades */
  }
  return undefined;
}

/**
 * Where to register the efficiency section: right after the pwsh tool section.
 * @param {DshPluginContext} ctx
 * @returns {number}
 */
export function sectionOrderOf(ctx) {
  try {
    const prompt = ctx.systemPrompt;
    if (prompt && typeof prompt.getSectionOrder === 'function') {
      const base = prompt.getSectionOrder('TOOL_PWSH');
      if (typeof base === 'number' && Number.isFinite(base)) return base + 1;
    }
  } catch {
    /* fall through to the pinned value */
  }
  return FALLBACK_PWSH_ORDER + 1;
}

/**
 * Whether this session's mode allows denying at all.
 * A high-privilege session is never touched (`docs/01`: 非高权限的命令).
 * @param {DshSandboxMode | undefined} mode
 * @returns {boolean}
 */
export function mayDenyIn(mode) {
  return mode === 'read-only' || mode === 'workspace-write';
}
