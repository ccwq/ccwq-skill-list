#!/bin/bash
# git-up 双端验证的 Linux 入口。
#
# 在 WSL 或原生 Linux 上跑同一份验证脚本。
# Node 若不在 PATH，用 NVM_DIR 或 VOLTA_HOME 指定的路径补进来。
#
# 用法：
#   bash scripts/verify-linux.sh

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Node 常见安装位置。
if ! command -v node >/dev/null 2>&1; then
  for candidate in \
    "$HOME/.volta/bin" \
    "$HOME/.nvm/versions/node"/*/bin \
    "/usr/local/bin" \
    "/usr/bin"; do
    if [ -x "$candidate/node" ]; then
      PATH="$candidate:$PATH"
      export PATH
      break
    fi
  done
fi

if ! command -v node >/dev/null 2>&1; then
  echo "找不到 node，无法运行双端验证。" >&2
  exit 1
fi

cd "$REPO_ROOT" || exit 1
exec node test-space/git-up-dual-platform/run_all.mjs
