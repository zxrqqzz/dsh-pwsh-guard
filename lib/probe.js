/**
 * Small, defensive readers for the exec/result objects.
 *
 * `exec.arguments` is already schema-validated by the pwsh tool (it rejects an
 * empty `command`), but this plugin must still behave when another tool, a PTC
 * sub-dispatch, or a future version hands it a different shape.
 *
 * @module dsh-pwsh-guard/probe
 */

const ESCAPE_HATCH = /#\s*pwsh-guard:allow/i;

/**
 * The PowerShell command text of a call, if it has one.
 * @param {{ arguments?: unknown } | undefined} exec
 * @returns {string | undefined}
 */
export function commandOf(exec) {
  if (!exec || typeof exec !== 'object') return undefined;
  const args = /** @type {{ command?: unknown }} */ (exec).arguments;
  if (!args || typeof args !== 'object') return undefined;
  const command = /** @type {{ command?: unknown }} */ (args).command;
  return typeof command === 'string' && command.trim() !== '' ? command : undefined;
}

/**
 * `# pwsh-guard:allow` anywhere in the command: never deny, never nag.
 * @param {string | undefined} command
 * @returns {boolean}
 */
export function hasEscapeHatch(command) {
  return typeof command === 'string' && ESCAPE_HATCH.test(command);
}

/**
 * The tool's own structured value, when it produced one.
 * @param {{ value?: unknown } | undefined} result
 * @returns {Record<string, unknown> | undefined}
 */
export function resultValueOf(result) {
  if (!result || typeof result !== 'object') return undefined;
  const value = /** @type {{ value?: unknown }} */ (result).value;
  return value !== null && typeof value === 'object' ? /** @type {Record<string, unknown>} */ (value) : undefined;
}

/**
 * Whether the call exhausted its timeout window.
 * @param {{ value?: unknown } | undefined} result
 * @returns {boolean}
 */
export function isTimedOut(result) {
  const value = resultValueOf(result);
  return value !== undefined && value.timedOut === true;
}

/**
 * True when the call requested a sandbox escalation, which means part of the
 * measured wall time is a human answering an approval — worth labelling.
 * @param {{ arguments?: unknown } | undefined} exec
 * @returns {boolean}
 */
export function isApprovalGated(exec) {
  if (!exec || typeof exec !== 'object') return false;
  const args = /** @type {{ sandbox_permissions?: unknown, justification?: unknown }} */ (exec).arguments;
  if (!args || typeof args !== 'object') return false;
  return args.sandbox_permissions !== undefined || args.justification !== undefined;
}
