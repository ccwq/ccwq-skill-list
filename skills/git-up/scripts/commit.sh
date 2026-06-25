#!/usr/bin/env sh
# git-up --commit 执行脚本
#
# 读取由 Claude 写入的中间产物，逐 step 执行 git add + git commit。
# 中间产物目录：<repo-root>/tmp/git-up-<hash4>/
#   step-N.msg    第 N 个提交的完整 message 原文（供 git commit -F 使用）
#   step-N.files  第 N 个提交的文件清单，每行一个路径（含空格也安全）
#
# 设计要点：
#   - 纯 POSIX sh，零外部依赖，兼容 Linux / macOS / Windows git bash
#   - fail-fast：set -e，任意步骤失败立即终止
#   - 断点续跑：每步成功后删除该步的 msg/files，重跑时自动从失败处继续
#   - 空提交防护：暂存区无变更则跳过该步，不报错中止
#   - 全部成功后删除空的批次目录，工作树无残留
#
# 用法：sh skills/git-up/scripts/commit.sh
set -e

# 定位批次目录：不重算 HEAD hash（提交会移动 HEAD 导致漂移、破坏断点续跑），
# 改为在仓库内查找唯一一个含待执行 step 的 tmp/git-up-* 目录。
REPO=$(git rev-parse --show-toplevel)

DIR=""
for d in "$REPO"/tmp/git-up-*/; do
  [ -d "$d" ] || continue
  # 该目录是否含至少一个待执行 step
  for m in "$d"step-*.msg; do
    [ -f "$m" ] || continue
    if [ -n "$DIR" ] && [ "$DIR" != "${d%/}" ]; then
      echo "✗ 发现多个待执行批次目录，无法判断执行哪个：" >&2
      echo "    $DIR" >&2
      echo "    ${d%/}" >&2
      echo "  请手动清理后重试。" >&2
      exit 1
    fi
    DIR="${d%/}"
    break
  done
done

if [ -z "$DIR" ]; then
  echo "✗ 未在 $REPO/tmp/ 下找到待执行的 git-up 批次目录。" >&2
  echo "  请先由 git-up --commit 写入计划，再执行本脚本。" >&2
  exit 1
fi

# 收集实际存在的 step 编号并按数字升序排列。
# 不假设从 1 连续——断点续跑时已完成的步骤文件已删除（如只剩 step-2、step-3）。
STEPS=$(for m in "$DIR"/step-*.msg; do
  [ -f "$m" ] || continue
  b=${m##*/step-}
  echo "${b%.msg}"
done | sort -n)

total=$(printf '%s\n' "$STEPS" | grep -c .)
if [ "$total" -eq 0 ]; then
  echo "✗ 目录中没有待执行的 step：$DIR" >&2
  exit 1
fi

# 逐 step 执行
idx=0
for n in $STEPS; do
  idx=$((idx + 1))
  subject=$(head -n 1 "$DIR/step-$n.msg")
  echo ">>> Step $n ($idx/$total): $subject"

  # 按文件清单逐行 git add（逐行读取以兼容含空格的路径）
  if [ -f "$DIR/step-$n.files" ]; then
    while IFS= read -r f; do
      [ -n "$f" ] && git add "$f"
    done < "$DIR/step-$n.files"
  fi

  # 空提交防护：暂存区无变更则跳过该步
  if git diff --cached --quiet; then
    echo "    (暂存区无变更，跳过)"
  else
    git commit -F "$DIR/step-$n.msg"
  fi

  # 成功即删该步文件，实现断点续跑
  rm -f "$DIR/step-$n.msg" "$DIR/step-$n.files"
done

# 全部成功，删除空的批次目录
rmdir "$DIR" 2>/dev/null || true

echo "✅ All $total commits done."
