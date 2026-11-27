## PowerShell 效率（本机实测）

每次调用都是**新的 pwsh 进程**，没有缓存；沙箱里 `& rg` / `fd` / `git` / `node -e` 会被拒绝或静默返回空。
搜索 / 读文件优先用宿主的 grep / glob / read 工具（宿主进程内跑 ripgrep，ms 级）。

慢写法 → 快写法：

- `Get-ChildItem -Recurse`（无 `-Filter` / `-Depth`）→ 先 `-Filter *.ext` 或 `-Depth N` 压规模；只要路径时用 `[System.IO.Directory]::EnumerateFiles($p,'*.x','AllDirectories')`（12,357 个文件：2,693ms → 1,193ms）
- `-Recurse` 后接 `Where-Object` / `Select-String` / `Measure-Object` → 改用 `-Filter`，或直接换宿主 grep 工具
- `Get-Content f -Raw` 再正则 → `Select-String -Path f -Pattern x`；只要开头用 `-TotalCount 50`；只要行数用 `(Get-Content -ReadCount 0).Count`
- 大结果 `Format-Table -AutoSize` → `Select-Object -First 20 <需要的列>`

会挂到超时、绝不要写：`Get-Content -Wait`、`Read-Host` / `Pause` / `ReadKey` / `-Confirm`、
`while(...){Start-Sleep}` 轮询、`Wait-Process`。长任务交给后台 job，用 `job_output` 收。

逃生：确有必要原样执行时，在命令里加注释 `# pwsh-guard:allow`。
