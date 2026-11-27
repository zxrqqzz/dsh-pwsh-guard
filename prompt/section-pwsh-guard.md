## PowerShell 效率（本机已验证，非通用教条）

环境事实：每次调用是**新 pwsh 进程**（无缓存）；沙箱内 `& exe` 会被拒绝或静默返回空
——**不要**指望 `rg` / `fd` / `git` / `node -e` 在壳里能跑，它们不在 PATH 上也起不来。
需要搜索/读文件时，优先用宿主提供的 grep / glob / read 工具（ms 级）；确实要在壳里做，
只用下面这些进程内写法。

慢写法 → 快写法：

- `Get-ChildItem -Recurse`（无 `-Filter`/`-Depth`）→
  `-Filter *.ext` 或 `-Depth N` 先压规模；只要路径用
  `[System.IO.Directory]::EnumerateFiles($p,'*.x','AllDirectories')`（12,357 文件：2,693ms → 1,193ms）
- `Get-ChildItem -Recurse | Where-Object {...}` → `-Filter`（provider 层过滤），
  复杂谓词用 `EnumerateFiles` 拿路径后 `.NET` 属性判断，别让每个文件变成 PSObject
- `Select-String -Recurse` / `Get-ChildItem -Recurse | Select-String` → 改用 grep 工具；
  壳里搜索显式文件用 `Select-String -Path a,b -Pattern x -List`（命中即停）
- `Get-Content f -Raw` 再正则 → `Select-String -Path f -Pattern x`（流式）；
  只要开头 `-TotalCount 50`；只要行数 `(Get-Content -ReadCount 0).Count`
- 只为计数而 `-Recurse | Measure-Object` → `@([System.IO.Directory]::EnumerateFiles(...)).Count`
- 大结果集 `Format-Table -AutoSize` → `Select-Object -First 20 <需要的列>`

会挂到超时、绝不要写：

- `Get-Content -Wait`（tail -f 语义）、`Read-Host` / `Pause` / `ReadKey` / `-Confirm`
  （没有交互终端，没人回答）、`while(...){Start-Sleep}` 轮询、`Wait-Process` /
  `Start-Process -Wait` 等 GUI 进程 —— 这些只会耗尽整个超时窗口。
- 需要等待/长任务：交给后台 job，用 `job_output` 收结果，不要在前台阻塞。

逃生：确有必要原样执行时，在命令里加注释 `# pwsh-guard:allow`。
