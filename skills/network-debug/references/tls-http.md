# TLS / HTTP 分支

在传输层和 proxy/tunnel 证据充分前，不要诊断 TLS。

`TLS handshake failed` 可能表示远端 TLS server 从未响应，因为更早的 outbound 路径已经失败。

区分：

- 没有 TLS 响应；
- protocol/cipher 协商；
- SNI；
- certificate chain；
- hostname mismatch；
- interception；
- trust store；
- clock；
- revocation。

对于 curl，分别记录 transport outcome 和 HTTP outcome。HTTP 4xx/5xx 即使返回错误页面，也可能让 curl 以 exit 0 结束，除非显式要求失败。

可用的受控开关包括 `--write-out` 和 `--fail-with-body`。

Windows 上使用 Schannel 的 curl，可以用 `--ssl-revoke-best-effort` 窄范围测试 revocation-distribution failure 是否阻塞了本来可行的 TLS 路径。`--ssl-no-revoke` 和 `-k/--insecure` 是更宽泛的 bypass，不得作为默认修复。

判断 HTTP error 是由谁生成：local proxy、remote CDN/WAF、reverse proxy 还是 target app。
