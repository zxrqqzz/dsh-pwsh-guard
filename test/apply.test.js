/**
 * End-to-end behaviour against a fake Cordis context.
 *
 * The fake implements exactly the surface `lib/` touches: `on`, `get`,
 * `inject`, `systemPrompt.section`, `systemPrompt.getSectionOrder`, `logger`.
 * Running the three listeners as real waterfalls is what catches wiring bugs
 * (wrong argument order, a `next()` that is never called, state keyed on the
 * wrong object).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { apply } from '../lib/index.js';

const SLOW_MS = 20;

/**
 * @param {{ mode?: string, sandbox?: boolean, config?: object }} [options]
 */
function harness(options = {}) {
  /** @type {Map<string, Function[]>} */
  const listeners = new Map();
  /** @type {any[]} */
  const sections = [];
  // One stable Agent per harness: real sessions reuse the same live agent for
  // every call, and WeakMap state is keyed by that identity.
  const agent = { id: 'agent-1' };
  const ctx = {
    logger: () => ({ warn() {}, error() {} }),
    on(event, listener) {
      const list = listeners.get(event) ?? [];
      list.push(listener);
      listeners.set(event, list);
      return () => {};
    },
    get(name) {
      if (name === 'sandboxPolicy' && options.sandbox !== false) {
        return { resolve: () => ({ mode: options.mode ?? 'workspace-write', workspaceRoot: 'D:\\workspace' }) };
      }
      if (name === 'sessions') return { get: (id) => ({ id }) };
      return undefined;
    },
    inject(_deps, callback) {
      callback(ctx);
    },
    systemPrompt: {
      section(section) {
        sections.push(section);
      },
      getSectionOrder(name) {
        return name === 'TOOL_PWSH' ? 1010 : 0;
      },
    },
  };
  apply(ctx, { slowMs: SLOW_MS, ...options.config });
  return { listeners, sections, agent };
}

/** Run one waterfall listener chain. */
function waterfall(list = [], args = [], terminal) {
  let index = 0;
  const next = () => (index >= list.length ? terminal() : list[index++](...args, next));
  return next();
}

let callSeq = 0;

/**
 * Drive one simulated pwsh call through all three hooks.
 * @param {{ listeners: Map<string, Function[]> }} env
 */
async function call(env, { command, delay = 0, timedOut = false, agent = env.agent, extraArgs = {} } = {}) {
  const exec = {
    callId: `call-${++callSeq}`,
    name: 'pwsh',
    arguments: { command, ...extraArgs },
    agent,
    signal: new AbortController().signal,
  };
  const pre = await waterfall(env.listeners.get('tools/pre-execute'), [exec], async () => ({ kind: 'allow' }));

  const denied = pre.kind === 'deny';
  const result = denied
    ? { isError: true, error: { message: pre.reason }, content: [{ type: 'text', text: pre.reason }] }
    : await waterfall(env.listeners.get('tools/execute'), [exec], async () => {
        if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
        return { isError: false, value: { timedOut, exitCode: 0 }, content: [{ type: 'text', text: 'ok' }] };
      });

  const post = await waterfall(env.listeners.get('tools/post-execute'), [exec, result], async () => ({ kind: 'accept' }));
  return { pre, result, post };
}

test('the section is registered right after the pwsh tool section', () => {
  const env = harness();
  assert.equal(env.sections.length, 1);
  const [section] = env.sections;
  assert.equal(section.name, 'guard:pwsh-efficiency');
  assert.equal(section.order, 1011);
  assert.equal(typeof section.text, 'string');
  assert.ok(section.text.length <= 1200);
});

test('a slow call appends the duration and injects one notice', async () => {
  const env = harness();
  const { pre, post } = await call(env, { command: 'Start-Sleep -Seconds 1', delay: SLOW_MS + 15 });

  assert.equal(pre.kind, 'allow');
  assert.equal(post.kind, 'accept');
  const line = post.content.at(-1);
  assert.equal(line.type, 'text');
  assert.match(line.text, /\[pwsh-guard\] 实测耗时/);

  assert.equal(post.additionalContexts.length, 1);
  const notice = post.additionalContexts[0];
  assert.equal(notice.role, 'user');
  assert.equal(notice.source.form, 'notice');
  assert.equal(notice.source.kind, 'pwsh-guard');
  assert.equal(typeof notice.source.summary, 'string');
});

test('a fast call says nothing at all', async () => {
  const env = harness();
  const { post } = await call(env, { command: 'Start-Sleep -Seconds 1' });
  assert.equal(post.content, undefined);
  assert.equal(post.additionalContexts, undefined);
});

test('a timed-out call points at background jobs', async () => {
  const env = harness();
  const { post } = await call(env, { command: 'Start-Sleep -Seconds 1', delay: 5, timedOut: true });
  const text = post.additionalContexts[0].content[0].text;
  assert.match(text, /超时窗口/);
  assert.match(post.content.at(-1).text, /job_output/);
});

test('the escape hatch is total silence', async () => {
  const env = harness();
  const { post } = await call(env, { command: 'Start-Sleep -Seconds 1 # pwsh-guard:allow', delay: SLOW_MS + 15 });
  assert.equal(post.content, undefined);
  assert.equal(post.additionalContexts, undefined);
});

test('a call that waited on approval is not measured or nagged', async () => {
  // Real case: the command took 1s, the human took 34 minutes to approve.
  // The window cannot be attributed, so a caveat is not good enough — report nothing.
  const env = harness();
  const { post } = await call(env, {
    command: 'Start-Sleep -Seconds 1',
    delay: SLOW_MS + 15,
    extraArgs: { sandbox_permissions: 'danger-full-access' },
  });
  assert.equal(post.content, undefined, 'approval wait must not be reported as command cost');
  assert.equal(post.additionalContexts, undefined);
});

test('a timed-out call is still reported even when approval was involved', async () => {
  const env = harness();
  const { post } = await call(env, {
    command: 'Start-Sleep -Seconds 1',
    delay: 5,
    timedOut: true,
    extraArgs: { sandbox_permissions: 'danger-full-access' },
  });
  assert.ok(post.additionalContexts, 'a real timeout is the command\'s own doing');
  assert.match(post.content.at(-1).text, /含审批等待/);
});

test('guard mode denies a slow construct once per session', async () => {
  const env = harness({ config: { mode: 'guard' } });

  const first = await call(env, { command: 'Get-ChildItem . -Recurse' });
  assert.equal(first.pre.kind, 'deny');
  assert.equal(first.pre.reason.split('\n')[0], '[pwsh-guard] 这不是命令失败，是效率建议。');

  const second = await call(env, { command: 'Get-ChildItem . -Recurse' });
  assert.equal(second.pre.kind, 'allow', 'the same rule must not deny twice');
  assert.equal(second.post.additionalContexts.length, 1, 'the retry still gets one short line');
  assert.match(second.post.additionalContexts[0].content[0].text, /已被拦过一次/);
});

test('the denied call itself produces no notice', async () => {
  const env = harness({ config: { mode: 'guard' } });
  const { post } = await call(env, { command: 'Get-ChildItem . -Recurse' });
  assert.equal(post.kind, 'accept');
  assert.equal(post.additionalContexts, undefined);
});

test('learn mode never denies', async () => {
  const env = harness({ config: { mode: 'learn' } });
  const { pre } = await call(env, { command: 'Get-ChildItem . -Recurse' });
  assert.equal(pre.kind, 'allow');
});

test('high-privilege sessions are never denied', async () => {
  const env = harness({ mode: 'danger-full-access', config: { mode: 'guard' } });
  const { pre } = await call(env, { command: 'Get-ChildItem . -Recurse' });
  assert.equal(pre.kind, 'allow');
});

test('an unprovable sandbox mode degrades to allow', async () => {
  const env = harness({ sandbox: false, config: { mode: 'guard' } });
  const { pre } = await call(env, { command: 'Get-ChildItem . -Recurse' });
  assert.equal(pre.kind, 'allow');
});

test('the allowlist protects well-written commands even in strict mode', async () => {
  const env = harness({ config: { mode: 'strict' } });
  const { pre } = await call(env, { command: 'Get-ChildItem . -Recurse -Filter *.js' });
  assert.equal(pre.kind, 'allow');
});

test('strict mode also denies medium severity', async () => {
  const env = harness({ config: { mode: 'strict' } });
  const { pre } = await call(env, { command: 'Get-Content .\\big.log -Raw' });
  assert.equal(pre.kind, 'deny');
});

test('deny-once is per agent', async () => {
  const env = harness({ config: { mode: 'guard' } });
  await call(env, { command: 'Get-ChildItem . -Recurse', agent: { id: 'A' } });
  const other = await call(env, { command: 'Get-ChildItem . -Recurse', agent: { id: 'B' } });
  assert.equal(other.pre.kind, 'deny', 'a subagent gets its own first denial');
});

test('denyOncePerSession=false keeps denying', async () => {
  const env = harness({ config: { mode: 'guard', denyOncePerSession: false } });
  assert.equal((await call(env, { command: 'Get-ChildItem . -Recurse' })).pre.kind, 'deny');
  assert.equal((await call(env, { command: 'Get-ChildItem . -Recurse' })).pre.kind, 'deny');
});

test('liftDenyOnceAfter re-arms the denial after a repeated slow hit', async () => {
  const env = harness({ config: { mode: 'guard', liftDenyOnceAfter: 1 } });

  const first = await call(env, { command: 'Get-ChildItem . -Recurse' });
  assert.equal(first.pre.kind, 'deny');
  assert.match(first.pre.reason, /只会被拦这一次/);

  // The retry is spared by deny-once, and its slow run still counts as one hit.
  const second = await call(env, { command: 'Get-ChildItem . -Recurse', delay: SLOW_MS + 15 });
  assert.equal(second.pre.kind, 'allow');
  assert.match(second.post.additionalContexts[0].content[0].text, /已被拦过一次/);

  // One repeated slow hit is enough to withdraw the grace.
  const third = await call(env, { command: 'Get-ChildItem . -Recurse' });
  assert.equal(third.pre.kind, 'deny');
  assert.match(third.pre.reason, /每次都会被拦/);
});

test('predictive tone kicks in after repeated hits of the same rule', async () => {
  const env = harness({ config: { mode: 'guard', predictiveAfter: 2, predictiveMinMs: 0 } });

  // `Get-Content -Raw` is medium severity: guard mode lets it run, so it can
  // repeat and be measured (medium is only denied under `strict`).
  const first = await call(env, { command: 'Get-Content .\\big.log -Raw', delay: SLOW_MS + 15 });
  assert.equal(first.pre.kind, 'allow');
  assert.ok(!first.post.additionalContexts[0].content[0].text.includes('又是它'));

  const second = await call(env, { command: 'Get-Content .\\big.log -Raw', delay: SLOW_MS + 15 });
  const text = second.post.additionalContexts[0].content[0].text;
  assert.match(text, /又是它/);
  assert.match(text, /第 2 次/);
  assert.match(text, /下次直接写：/);
  assert.match(text, /慢写法：/);
});

test('predictive tone stays off until the configured hit count', async () => {
  const env = harness({ config: { mode: 'guard', predictiveAfter: 99, predictiveMinMs: 0 } });
  await call(env, { command: 'Get-Content .\\big.log -Raw', delay: SLOW_MS + 15 });
  const second = await call(env, { command: 'Get-Content .\\big.log -Raw', delay: SLOW_MS + 15 });
  assert.ok(!second.post.additionalContexts[0].content[0].text.includes('又是它'));
});

test('unwatched tools are ignored', async () => {
  const env = harness({ config: { mode: 'guard' } });
  const exec = { callId: 'bash-1', name: 'bash', arguments: { command: 'Get-ChildItem . -Recurse' }, agent: {}, signal: new AbortController().signal };
  const pre = await waterfall(env.listeners.get('tools/pre-execute'), [exec], async () => ({ kind: 'allow' }));
  assert.equal(pre.kind, 'allow');
});

test('a call without a command is ignored', async () => {
  const env = harness({ config: { mode: 'guard' } });
  const exec = { callId: 'no-command', name: 'pwsh', arguments: {}, agent: {}, signal: new AbortController().signal };
  const pre = await waterfall(env.listeners.get('tools/pre-execute'), [exec], async () => ({ kind: 'allow' }));
  assert.equal(pre.kind, 'allow');
});

test('apply survives a context without optional services', () => {
  /** @type {any} */
  const bare = { on() {}, get() { return undefined; } };
  assert.doesNotThrow(() => apply(bare, {}));
});
