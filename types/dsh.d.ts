/**
 * Hand-written subset of the DeepSeek Harness plugin contract.
 *
 * Why this file exists: a DSH plugin runs out of the *profile's* node_modules,
 * which does not contain `@deepseek-ai/dsh-*` packages, so `import type` from
 * the real host packages is not possible (and must not become a runtime
 * dependency). This file declares only the surface this plugin touches, so
 * `jsconfig.json` + `checkJs` can type-check lib/*.js for free (the editor's
 * bundled TypeScript service, no `npm install`).
 *
 * VERIFIED AGAINST: @deepseek-ai/dsh 0.2.1-rc.2 (2026-11-27)
 *   - dsh-tools/lib/types/index.d.ts:47  'tools/pre-execute'
 *   - dsh-tools/lib/types/index.d.ts:58  'tools/execute'
 *   - dsh-tools/lib/types/index.d.ts:70  'tools/post-execute'
 *   - dsh-system-prompt/lib/types/index.d.ts:214  section(section)
 *   - dsh-sandbox-policy/lib/types/index.d.ts:71,88  resolve(request)
 *   - dsh-llm/lib/types/message.d.ts  source form 'notice' requires `summary`
 *   - dsh-tool-pwsh/lib/index.js:318,321  ctx.get('sandboxPolicy').resolve({session})
 *
 * `scripts/check-host.mjs` re-verifies the same contracts against whatever dsh
 * is installed; run it after upgrading dsh.
 */

export {};

declare global {
  // ── llm: content blocks and messages ──────────────────────────────────────

  interface DshTextBlock {
    type: 'text';
    text: string;
  }

  /** Every other block kind (reasoning, tool-call, image, file, …). */
  interface DshOtherBlock {
    type: string;
    [key: string]: unknown;
  }

  type DshContentBlock = DshTextBlock | DshOtherBlock;

  /**
   * `source.form: 'notice'` is the harness-wide shape for an injected notice;
   * `summary` is the one line a collapsed row shows. `kind` is merge-extensible
   * (first-party plugins use their own, e.g. 'repeat-tool-reminder').
   */
  interface DshNoticeSource {
    kind: string;
    form: 'notice';
    summary: string;
    [key: string]: unknown;
  }

  interface DshUserMessage {
    id: string;
    role: 'user';
    content: DshContentBlock[];
    source: DshNoticeSource | { kind: string; form?: string; [key: string]: unknown };
  }

  // ── agent ─────────────────────────────────────────────────────────────────

  /**
   * Public Agent declares only `id`, but the live agent has `session` — the
   * first-party pwsh tool reads `exec.agent.session` directly. Treat it as
   * optional and fall back to `ctx.get('sessions').get(agent.id)`.
   */
  interface DshAgent {
    readonly id: string;
    readonly session?: DshSession;
  }

  interface DshSession {
    readonly id: string;
  }

  interface DshSessionStore {
    get(id: string): DshSession | undefined;
  }

  // ── tools pipeline ────────────────────────────────────────────────────────

  interface DshToolExecution {
    readonly callId: string;
    readonly name: string;
    readonly arguments: unknown;
    readonly agent?: DshAgent;
    readonly signal: AbortSignal;
  }

  interface DshToolExecutionSuccess {
    readonly isError: false;
    readonly value: unknown;
    readonly content: DshContentBlock[];
    readonly meta?: unknown;
  }

  interface DshToolExecutionFailure {
    readonly isError: true;
    readonly error: { readonly message?: string; readonly code?: string; [key: string]: unknown };
    readonly content: DshContentBlock[];
    readonly meta?: unknown;
  }

  type DshToolExecutionResult = DshToolExecutionSuccess | DshToolExecutionFailure;

  type DshPreToolDecision =
    | { kind: 'allow' }
    | { kind: 'deny'; reason: string; info?: unknown }
    | { kind: 'cancel' }
    | { kind: 'ask'; reason?: string; displayReason?: unknown };

  type DshPostToolDecision =
    | { kind: 'accept'; content?: DshContentBlock[]; value?: never; additionalContexts?: DshUserMessage[] }
    | { kind: 'accept'; value: unknown; content?: never; additionalContexts?: DshUserMessage[] }
    | { kind: 'block'; feedback: DshContentBlock[]; additionalContexts?: DshUserMessage[] };

  // ── system prompt ─────────────────────────────────────────────────────────

  interface DshPromptSection {
    readonly name: string;
    readonly order: number;
    readonly text: string | ((context: unknown) => string);
    readonly interpolate?: boolean;
    readonly complete?: boolean;
  }

  /** `TOOL_PWSH` is 1010 in the host's SECTION_ORDERS table. */
  type DshPromptSectionOrderName =
    | 'HARNESS_IDENTITY'
    | 'DEPLOYMENT_PERSONA_PREFIX'
    | 'TOOL_BASH'
    | 'TOOL_PWSH'
    | 'TOOL_READ'
    | 'TOOL_GREP'
    | 'MCP_SERVERS'
    | string;

  interface DshSystemPromptService {
    section(section: DshPromptSection): () => void;
    getSectionOrder(name: DshPromptSectionOrderName): number;
  }

  // ── sandbox policy ────────────────────────────────────────────────────────

  type DshSandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access';

  interface DshSandboxExecutionPolicy {
    readonly mode: DshSandboxMode;
    readonly workspaceRoot?: string;
  }

  interface DshSandboxPolicyService {
    resolve(request?: { session?: DshSession; mode?: DshSandboxMode }): DshSandboxExecutionPolicy;
    overrideOf(session: DshSession): DshSandboxMode | undefined;
  }

  // ── plugin context (only what this plugin calls) ───────────────────────────

  /**
   * Cordis Context surface. `on` registers event listeners (disposed with the
   * plugin), `get` resolves an *optional* service without injecting it, and
   * `inject` runs a callback once the named services are available, which is
   * the order-independent way to register a prompt section.
   */
  interface DshPluginContext {
    systemPrompt?: DshSystemPromptService;
    on(event: string, listener: (...args: any[]) => any): () => void;
    get(name: string): any;
    inject(deps: string[], callback: (ctx: DshPluginContext) => void): unknown;
    [key: string]: any;
  }

  // ── this plugin's own config ──────────────────────────────────────────────

  interface PwshGuardConfig {
    /** learn = notice only; guard = deny `high`; strict = deny `high` + `medium`. */
    mode: 'learn' | 'guard' | 'strict';
    /** Tool names this plugin watches. */
    tools: string[];
    /** A completed call at or above this wall time is reported to the model. */
    slowMs: number;
    /** Deny a given rule at most once per session (per agent). */
    denyOncePerSession: boolean;
    /** After a denial, a retry of the same construct gets one more notice. */
    noticeOnDenyRetry: boolean;
    /** Hard cap for the static prompt section. */
    maxSectionChars: number;
    /** Override the bundled rules document. */
    rulesFile: string | null;
    /** Append a duration line to the tool result the model sees. */
    appendTiming: boolean;
    /** Emit an `additionalContexts` notice for slow / rule-hit calls. */
    slowNotice: boolean;
    /** Rule families to silence entirely (e.g. ['output']). */
    silentFamilies: string[];
    /** Hits of the same rule before the notice switches to predictive tone (M3). */
    predictiveAfter: number;
    /** ...and the slowest of those hits must reach this many ms. */
    predictiveMinMs: number;
    /** 0 = off; >0 = stop sparing a rule with deny-once once it repeated this often. */
    liftDenyOnceAfter: number;
  }
}
