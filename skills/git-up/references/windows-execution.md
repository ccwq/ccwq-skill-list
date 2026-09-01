# Windows 执行细节

PowerShell 5.1 原生管道可能把中文和 emoji 替换为 `?`。包含非 ASCII 的计划写入 UTF-8 文件后传给执行器：

```powershell
$planFile = Join-Path $env:TEMP "git-up-plan-$PID.yaml"
[IO.File]::WriteAllText($planFile, $plan, [Text.UTF8Encoding]::new($false))
try {
  python skills/git-up/scripts/commit_plan.py commit --cwd . --plan-file $planFile
} finally {
  Remove-Item -LiteralPath $planFile -Force -ErrorAction SilentlyContinue
}
```

`commit_plan.py` 只支持 Git-up 生成的 YAML Lite，不依赖 PyYAML。`--plan-file` 按 UTF-8（可含 BOM）读取；POSIX 可从 stdin 输入。

执行器的安全不变量：先检查空 index；每步只 `git add -- <files...>`；空 staged diff 跳过；每步用 UTF-8 临时 message file 调用 `git commit -F`；任一步 Git 失败就返回 stderr 并停止。
