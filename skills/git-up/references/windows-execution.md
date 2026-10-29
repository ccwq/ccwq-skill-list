# Windows 执行细节

PowerShell 5.1 原生管道可能把中文和 emoji 替换为 `?`。包含非 ASCII 的计划写入 UTF-8 文件后传给执行器：

```powershell
$planFile = Join-Path $env:TEMP "git-up-plan-$PID.yaml"
[IO.File]::WriteAllText($planFile, $plan, [Text.UTF8Encoding]::new($false))
try {
  node skills/git-up/scripts/commit_plan.mjs commit --cwd . --plan-file $planFile
} finally {
  Remove-Item -LiteralPath $planFile -Force -ErrorAction SilentlyContinue
}
```

`commit_plan.mjs` 只支持 Git-up 生成的 YAML Lite，不依赖任何 YAML 库。`--plan-file` 按 UTF-8（可含 BOM）读取；POSIX 可从 stdin 输入。

执行器的安全不变量：先检查空 index；文件级模式每步只 `git add -- <files...>`；语义模式每步只把本步声明的补丁写入 index，不触碰工作区；空 staged diff 跳过；每步用 UTF-8 临时 message file 调用 `git commit -F`；语义模式最后比较最终 HEAD 与目标快照；任一步 Git 失败就返回 stderr 并停止。

语义模式还要求补丁由 `git diff` 生成。`git diff` 输出的是 index 表示的内容，在 `core.autocrlf=true` 的仓库里是 LF。用文件工具直接比较工作区文件得到的补丁含 CRLF，无法应用到 index。
