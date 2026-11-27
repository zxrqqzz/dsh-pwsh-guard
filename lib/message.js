/**
 * Durable user-message construction.
 *
 * `createUserMessage` is ~12 lines in the harness (`randomUUID` + deep freeze),
 * and the profile's node_modules has no `@deepseek-ai/dsh-session` to import it
 * from. The official `dsh-repeat-tool-reminder` bundles the same helper for the
 * same reason.
 *
 * `source.form: 'notice'` is what keeps an injected message from being rendered
 * as something the user typed; `summary` is the one line a collapsed row shows.
 *
 * @module dsh-pwsh-guard/message
 */

import { randomUUID } from 'node:crypto';

/**
 * Recursively freeze a plain JSON value.
 * @template T
 * @param {T} value
 * @returns {T}
 */
export function deepFreeze(value) {
  if (value === null || typeof value !== 'object') return value;
  const seen = new WeakSet();
  /** @param {object} node */
  const walk = (node) => {
    if (seen.has(node)) return;
    seen.add(node);
    for (const child of Object.values(node)) {
      if (child !== null && typeof child === 'object') walk(/** @type {object} */ (child));
    }
    Object.freeze(node);
  };
  walk(/** @type {object} */ (value));
  return value;
}

/**
 * Create one frozen user-role message with a stable identity.
 * @param {{ content: DshContentBlock[], source: DshUserMessage['source'] }} input
 * @returns {DshUserMessage}
 */
export function createUserMessage(input) {
  return deepFreeze({
    id: randomUUID(),
    role: /** @type {'user'} */ ('user'),
    content: input.content,
    source: input.source,
  });
}

/**
 * Wrap advice text as a notice the model receives before its next request.
 * @param {string} text
 * @param {string} summary - one-line account for a collapsed row.
 * @returns {DshUserMessage}
 */
export function noticeMessage(text, summary) {
  return createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'pwsh-guard', form: 'notice', summary },
  });
}
