# Push 规则

`--push/-P` 只能跟提交执行模式组合：`-cP`、`-pcP`、`-sP` 或 `-s -P`。不支持单独 push、`-p -P` 或 `-d -P`。

使用当前分支已配置的 upstream，不自动创建 upstream 或改变 remote。网络/传输错误最多重试 3 次，并报告 attempt；可重试的例子包括 DNS、超时、连接重置、TLS、HTTP 5xx、early EOF、RPC failed 和 remote end hung up unexpectedly。

认证、权限、repository not found、无 upstream、non-fast-forward、protected branch、pre-receive hook 拒绝和计划/工作区错误不重试。最终失败必须报告 commit 是否完成、尝试次数、最后 stderr 和失败分类。
