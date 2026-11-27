# Changelog

本项目的所有重要变更都记在这里。

格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [Semantic Versioning 2.0.0](https://semver.org/lang/zh-CN/)，
判定规则见 [`docs/07-版本约定.md`](docs/07-版本约定.md)。

## [Unreleased]

## [0.2.0] - 待发布

M3 会话内自适应，外加两处**真实会话里才暴露**的修正。拦截通道（`mode: guard`）已实测：
拦截 → 同规则第二次放行 → 逃生口静默，三条路径均通过。

### 新增

- `predictiveAfter`（默认 3）+ `predictiveMinMs`（默认 10000）：同一规则在同一会话里反复拖慢、
  且最慢一次超过阈值时，notice 从「教学」切到「预测」——直接报「本会话第 N 次、最慢 X、累计 Y」，
  并指出该写的快写法。
- `liftDenyOnceAfter`（默认 0 = 关闭）：某条规则重复到设定次数后，撤回它的「只拦一次」宽限，改为每次都拦。
- 同一规则的累计耗时（`totalMs`）与规则的「慢写法」描述进入 notice 正文。

### 修复

- 首次拦截的 reason 末尾原写「本会话同类写法已提示过」，与事实不符。
  现在区分两种真实语义：「只会被拦这一次」/「每次都会被拦」。
- **计时口径**：带 `sandbox_permissions` 的调用，测量窗口包含人工审批等待，而那可能远超命令本身
  （实测：命令 1 秒，审批等了 34 分钟）。这类调用现在**不测量** —— 无法归因的时间宁可不说，
  也不给一个需要读者自己打折的数字；只有真的跑满超时时才带「含审批等待」标注照报。
- 「被拦后重试」的短提示不再跳过该规则的命中统计，重复次数不会再漏记。

### 变更

- `renderDenyReason` / `renderTimingLine` / `renderSlowNotice` 入参扩展（内部 API，不属于公开契约）。
- 守则段正文由 1292 字符压缩到 852 字符 —— 原来超出 1200 预算会被从尾部裁掉，
  而尾行正是「后台 job」与「逃生口」两条关键信息。预算现在由测试锁定。

## [0.1.0] - 待发布

首个可用版本。默认 `mode: learn` —— **只测量、只提示，不拦截任何命令**。

### 新增

- 静态守则段 `guard:pwsh-efficiency`：注册在 `TOOL_PWSH` 之后（order 1011），
  内容为本机实测的「慢写法 → 快写法」对照与「会挂到超时」清单，长度受 `maxSectionChars` 约束。
- 慢命令计时：`tools/execute` 包裹 dispatch 计时（只观测，不改结果），按 `callId` 传给 `tools/post-execute`。
- **两条路反馈**：
  - 工具结果末尾追加一行 `[pwsh-guard] 48.2s`（模型无法忽略）；
  - 命中规则 / 超时 / 被拦后重试时，额外注入一条 `form: 'notice'` 的 `additionalContexts`，
    给出「慢在哪 + 换成什么写法 + 本机实测数字」。
- 规则表 `rules/rules.json`：10 条规则（`block` / `search` / `read` / `count` / `output` 五族）
  + 5 条 allowlist，支持 `rulesFile` 覆盖。
- 拦截路径（`mode: guard` / `strict`）：命中 high 规则时 `deny` 并给出替代写法，
  每会话每规则只拦一次；命令里带 `# pwsh-guard:allow` 可逃生；
  `danger-full-access` 会话与「判不出沙箱档」一律不拦。
- `npm run check:host`：读本机已装 dsh 的 `.d.ts` / `lib/index.js`，断言本插件依赖的
  5 个宿主契约仍在，用于 dsh 升级后的体检。

### 说明

- 计时口径包含沙箱升级审批的等待时间；带 `sandbox_permissions` 的调用会在 notice 里注明。
- 插件自身任何异常都走失败安全：`pre-execute` 返回 allow，`post-execute` 原样放行。
