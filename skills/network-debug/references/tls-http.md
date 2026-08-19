# TLS / HTTP Branch

Do not diagnose TLS until lower transport and proxy/tunnel evidence is adequate.

A message such as `TLS handshake failed` can mean the remote TLS server never responded because an earlier outbound path failed.

Separate:

- no TLS response;
- protocol/cipher negotiation;
- SNI;
- certificate chain;
- hostname mismatch;
- interception;
- trust store;
- clock;
- revocation.

For curl, record transport outcome and HTTP outcome separately. HTTP 4xx/5xx may still return exit 0 unless requested otherwise.

Useful controls include `--write-out` and `--fail-with-body`.

On Windows curl using Schannel, `--ssl-revoke-best-effort` can narrowly test whether revocation-distribution failure is blocking an otherwise viable TLS path. `--ssl-no-revoke` and `-k/--insecure` are broader bypasses and must not be default fixes.

Determine who generated HTTP errors: local proxy, remote CDN/WAF, reverse proxy, or target app.
