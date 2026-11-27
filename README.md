# dsh-pwsh-guard

> DSH 插件（设计中，v0 交接）：让 Agent 在任务期间**写出来的 PowerShell 命令更快**，
> 并避免死锁 / 超时等待型命令。

## 要解决的三件事

| # | 问题 | 现在的表现 | 目标 |
|---|------|-----------|------|
| 1 | 慢命令 | Agent 写 `Get-ChildItem -Recurse`、`Select-String -Recurse`，在 `node_modules` 或大盘上跑几十秒到几分钟 | 用同语义的快写法，或改用 DSH 内置的 grep/glob 工具 |
| 2 | 无耗时反馈 | `dsh-tool-pwsh` 只把 stdout 和 `[exit code: N]` 给模型，**成功命令的耗时模型看不到** | 超阈值命令当场回报耗时 + 替代写法，让它在本次任务里就换 |
| 3 | 死锁 / 等死 | `Get-Content -Wait`、`Read-Host`、`while(...){Start-Sleep}`、`Wait-Process` 之类会一直挂到工具超时 | 执行前拦掉，给非阻塞写法 |

**不是**什么：

- 不是 rtk 那类 token 压缩插件。`dsh-pwsh-rtk-rewrite` 只把输出换成紧凑格式，
  对 `Get-ChildItem` 之类根本不改写（`rtk rewrite` 返回 exit 1），且它是**加一个 rtk 前缀进程**，
  只会更慢。省 token 和省时间正交，本项目只做后者。
- 不改写命令内容（C 方案除外，见 `docs/03`）。默认只做「提示 + 拦截 + 计时反馈」。

## 目录

```
dsh-pwsh-guard/
├── README.md                     # 本文件：目标、边界、验收
├── docs/
│   ├── 01-需求确认.md            # 需求逐条对译 + 待确认项 + 不做清单
│   ├── 02-实测依据.md            # 本机实测数据与内核 API 契约（带来源）
│   ├── 03-设计B-规格.md          # 四组件规格、配置、失败安全、分阶段
│   └── 04-规则表.json            # 规则种子数据（机器可读，可直接被插件加载）
└── prompt/
    └── section-pwsh-guard.md     # 常驻守则草稿（systemPrompt 段落文本）
```

## 当前状态

设计交接完成，**尚未写代码**。实现者按 `docs/03` 的 M1 → M2 → M3 推进，
规则的内容在 `docs/04-规则表.json`，措辞在 `prompt/section-pwsh-guard.md`。

## 验收标准（可测）

1. 装上后新会话的系统提示里能看到守则段（长度 < 1200 字符）。
2. 对 `Get-ChildItem -Recurse`（无 `-Filter`/`-Depth`）发一次命令：被拦一次、收到带替代写法的反馈；
   **同一会话再发同一条不再拦**（只教一次，不烦人）。
3. 对 `Get-ChildItem -Recurse -Filter *.js`、`Get-ChildItem -Depth 2`：**不拦**（有白名单）。
4. 任何一条跑了 > `slowMs` 的命令，下一次请求能看到一条 notice，含实测耗时与建议写法。
5. `Get-Content -Wait` / `Read-Host` / `Get-ChildItem C:\ -Recurse`：直接拦，不进工具超时。
6. 插件自身抛异常时，命令照常执行（失败安全，绝不阻断）。
7. 学习状态**只在会话内存**：同一会话后续每个请求都生效，会话结束即丢弃——不落盘、不跨会话、不跨项目。
8. `danger-full-access` 会话（高权限）一律不拦不改；判不出策略时降级为只提示。

## 硬约束（本机实测得出，不是推测）

- DSH 沙箱（read-only / workspace-write）下，`& exe` 调用外部程序**被拒绝**或**静默返回空**
  （`Access is denied`）。所以「让 AI 改用 rg/fd/git」这类方案在 shell 里**跑不起来**，
  只能改用 DSH 内置工具（宿主进程里跑自带 ripgrep）或进程内 .NET API。
- `rg`/`fd`/`jq` 不在 PATH 上；DSH 自带的 `rg.exe` 位于
  `...\@deepseek-ai\dsh\node_modules\@vscode\ripgrep-win32-x64\bin\rg.exe`，但壳里同样调不动。
- 每次 `pwsh` 工具调用都是**新进程**，没有任何缓存红利。

- 壳是 **Windows PowerShell 5.1**（不是 pwsh 7）：快写法必须 5.1 兼容，详见 `docs/02` F 节。

