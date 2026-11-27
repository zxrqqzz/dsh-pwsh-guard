# dsh-pwsh-guard

> DSH 插件：让 Agent 在任务中写出来的 PowerShell **更快**，并把「刚才那条跑了 48 秒」这件事
> 变成模型看得见的信号；对会挂到超时的写法在执行前就拦下来。

## 它解决什么

| # | 问题 | 本插件的动作 |
|---|---|---|
| 1 | 慢命令（`Get-ChildItem -Recurse`、`Select-String -Recurse`） | 执行前按规则表拦截，给出替代写法（每会话每规则只拦一次） |
| 2 | **模型看不到成功命令的耗时** | 慢命令的工具结果末尾追加 `[pwsh-guard] 实测耗时 48.2s` |
| 3 | 死锁 / 等死（`Get-Content -Wait`、`Read-Host`、轮询循环） | 命中即拦，并说明为什么不会返回 |

再加上一段常驻的静态守则（`guard:pwsh-efficiency`），让模型在写命令之前就知道本机的快慢差异。

**不是什么**：不做 token 压缩，不静默改写命令，不落盘、不跨会话学习。

## 两条反馈通道（刻意分工）

| 通道 | 内容 | 出现时机 |
|---|---|---|
| 工具结果末尾一行 | `[pwsh-guard] 实测耗时 48.2s`（纯事实，无建议） | 超过 `slowMs` 或跑满超时 |
| `notice` 消息 | 「慢在哪 + 换成什么写法 + 本机实测数字」 | 命中规则 / 超时 / 被拦后重试 |

结果行负责**让模型无法忽略**，notice 负责**教它改**，两者不重复同一句话。

> 带 `sandbox_permissions`（需要人工审批）的调用**不做计时**：审批等待会污染数字，
> 而一个需要读者自己打折的耗时数字没有价值。真的跑满超时除外 —— 那是命令自己的问题。

## 安装

```powershell
# 从本地路径（开发期）
dsh plugin --profile web add D:\Xjk\vscode\DSH\Mods_Project\dsh-pwsh-guard

# 从 npm（发布后）
dsh plugin --profile web add dsh-pwsh-guard
```

需要重启 dsh（模块代码不会热加载）。也可以在 GUI 侧边栏的 **Plugins** 页填绝对路径安装。

装完新开一个会话，系统提示里应出现 `## PowerShell 效率`；发一条 `Start-Sleep -Seconds 6`，
结果末尾应出现 `[pwsh-guard] 实测耗时 6.x s`。

## 配置

写在 profile 的 `cordis.patch.yml` 里（`id: pwsh-guard`）：

```yaml
- id: pwsh-guard
  config:
    mode: learn          # learn = 只提示不拦（默认）| guard = 拦 high | strict = high + medium 都拦
    slowMs: 5000         # 超过多少毫秒算慢
    tools: [pwsh]        # 监视哪些工具
    denyOncePerSession: true
    noticeOnDenyRetry: true
    maxSectionChars: 1200
    rulesFile: null      # 指向外部规则 JSON，默认用包内 rules/rules.json
    appendTiming: true
    slowNotice: true
    silentFamilies: []   # 例如 [output] 关掉 output 族
    predictiveAfter: 3   # 同一规则第 N 次拖慢后，notice 换成「预测」语气
    predictiveMinMs: 10000  # 且最慢一次要超过这个值才算
    liftDenyOnceAfter: 0 # >0 时：重复到这个次数后不再给「只拦一次」的宽限
```

**默认 `mode: learn`**：只测量、只提示，一条命令都不会拦。确认计时与措辞没问题后再改成 `guard`。

## 逃生口

命令里带注释 `# pwsh-guard:allow` → 该条命令不拦、不提示、不计时：

```powershell
Get-ChildItem C:\data -Recurse   # pwsh-guard:allow
```

## 规则表

`rules/rules.json`，10 条规则（`block` / `search` / `read` / `count` / `output` 五族）+ 5 条 allowlist。
每条规则自带 `samples.hit` / `samples.miss`，`npm test` 会全量回归 —— **改规则必须同时改样本**。

用 `config.rulesFile` 指向外部 JSON 即可替换整套规则，不必改代码。

## 自检

```powershell
npm test              # 规则回归 + 措辞 + 配置 + 假 ctx 集成测（零依赖，node:test）
npm run check:host    # 读本机已装的 dsh，断言本插件依赖的 5 个宿主契约还在
```

`check:host` 是升级 dsh 后的第一件事：插件用 `ctx.get(...)` 特性检测兜底，但契约真的漂移时
某个通道会静默失效，这个脚本能在 10 秒内把它指出来。

## 失败安全

插件自身任何异常都不影响命令：

- `tools/pre-execute` 抛异常 → allow
- `tools/post-execute` 抛异常 → 原样放行下游决策
- 判不出沙箱档 → 只提示不拦
- `danger-full-access` 会话 → 不拦不改
- 规则文件读不到 / JSON 坏 → 回退包内规则；单条正则编译失败 → 跳过该条

## 文档

| 文件 | 内容 |
|---|---|
| [`docs/01-需求确认.md`](docs/01-需求确认.md) | 需求逐条对译与边界 |
| [`docs/02-实测依据.md`](docs/02-实测依据.md) | 本机实测数据与内核契约（带来源） |
| [`docs/03-设计B-规格.md`](docs/03-设计B-规格.md) | 组件规格与分阶段 |
| [`docs/04-规则表.json`](docs/04-规则表.json) | 规则种子（`rules/rules.json` 的来源） |
| [`docs/05-实现方案.md`](docs/05-实现方案.md) | 语言 / 架构 / 脚手架决策 |
| [`docs/06-生态调研.md`](docs/06-生态调研.md) | 社区插件语言分布与版本兼容机制 |
| [`docs/07-版本约定.md`](docs/07-版本约定.md) | SemVer 发布纪律，含「什么算不兼容」判定表 |

## License

MIT
