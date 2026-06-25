#!/usr/bin/env sh
# git-up --commit 执行脚本
#
# 读取由 /git-up --plan / --modify 写入的计划工件，校验当前工作区未偏离计划，
# 再逐 step 执行 git add + git commit。
# 工件目录：$(git rev-parse --git-path git-up)
#   plan.yaml      权威 YAML 计划
#   manifest.env   简单元数据
#   staged.diff    计划同步时的 git diff --cached 快照
#   worktree.diff  计划同步时的 git diff 快照
#   status.txt     计划同步时的 git status --short -uall 快照
#   step-N.msg     第 N 个提交的完整 message 原文（供 git commit -F 使用）
#   step-N.files   第 N 个提交的文件清单，每行一个路径（含空格也安全）
#
# 设计要点：
#   - 纯 POSIX sh，零外部依赖，兼容 Linux / macOS / Windows git bash
#   - 工件存放在 Git 内部路径，避免污染工作区和 .gitignore
#   - fail-fast：set -e，任意步骤失败立即终止
#   - 缺失/过期拒绝：不在 commit 阶段重建计划
#   - 断点续跑：每步成功后删除该步的 msg/files，并刷新快照
#   - 空提交防护：暂存区无变更则跳过该步，不报错中止
#
# 用法：sh skills/git-up/scripts/commit.sh
set -e

REFUSE_MSG='✗ git-up 计划工件缺失或已过期。
  请先运行 /git-up --plan 生成计划，或在变更后运行 /git-up --modify 同步计划，然后再执行 /git-up --commit。'

refuse() {
  printf '%s\n' "$REFUSE_MSG" >&2
  if [ "$#" -gt 0 ]; then
    printf '  原因：%s\n' "$*" >&2
  fi
  exit 1
}

write_snapshot() {
  git diff --cached > "$DIR/staged.diff"
  git diff > "$DIR/worktree.diff"
  git status --short -uall > "$DIR/status.txt"
}

assert_snapshot_current() {
  git diff --cached > "$DIR/.current.staged.diff"
  git diff > "$DIR/.current.worktree.diff"
  git status --short -uall > "$DIR/.current.status.txt"

  if ! cmp -s "$DIR/.current.staged.diff" "$DIR/staged.diff"; then
    rm -f "$DIR/.current.staged.diff" "$DIR/.current.worktree.diff" "$DIR/.current.status.txt"
    refuse "staged diff 与计划快照不一致"
  fi

  if ! cmp -s "$DIR/.current.worktree.diff" "$DIR/worktree.diff"; then
    rm -f "$DIR/.current.staged.diff" "$DIR/.current.worktree.diff" "$DIR/.current.status.txt"
    refuse "worktree diff 与计划快照不一致"
  fi

  if ! cmp -s "$DIR/.current.status.txt" "$DIR/status.txt"; then
    rm -f "$DIR/.current.staged.diff" "$DIR/.current.worktree.diff" "$DIR/.current.status.txt"
    refuse "git status 与计划快照不一致"
  fi

  rm -f "$DIR/.current.staged.diff" "$DIR/.current.worktree.diff" "$DIR/.current.status.txt"
}

DIR=$(git rev-parse --git-path git-up)

[ -d "$DIR" ] || refuse "未找到计划工件目录：$DIR"
[ -f "$DIR/plan.yaml" ] || refuse "缺少 plan.yaml"
[ -f "$DIR/manifest.env" ] || refuse "缺少 manifest.env"
[ -f "$DIR/staged.diff" ] || refuse "缺少 staged.diff"
[ -f "$DIR/worktree.diff" ] || refuse "缺少 worktree.diff"
[ -f "$DIR/status.txt" ] || refuse "缺少 status.txt"

# 收集实际存在的 step 编号并按数字升序排列。
# 不假设从 1 连续——断点续跑时已完成的步骤文件已删除（如只剩 step-2、step-3）。
STEPS=$(for m in "$DIR"/step-*.msg; do
  [ -f "$m" ] || continue
  b=${m##*/step-}
  echo "${b%.msg}"
done | sort -n)

total=0
for _step in $STEPS; do
  total=$((total + 1))
done
[ "$total" -gt 0 ] || refuse "目录中没有待执行的 step：$DIR"

assert_snapshot_current

idx=0
for n in $STEPS; do
  idx=$((idx + 1))
  msg="$DIR/step-$n.msg"
  files="$DIR/step-$n.files"

  [ -f "$msg" ] || refuse "缺少 step-$n.msg"
  [ -f "$files" ] || refuse "缺少 step-$n.files"

  subject=$(sed -n '1p' "$msg")
  echo ">>> Step $n ($idx/$total): $subject"

  # 每一步开始前再校验一次，避免断点续跑或人为修改后继续执行旧计划。
  assert_snapshot_current

  # 按文件清单逐行 git add（逐行读取以兼容含空格的路径）
  while IFS= read -r f; do
    [ -n "$f" ] && git add "$f"
  done < "$files"

  # git add 后刷新快照：如果 git commit 因 hook/冲突等原因失败，重跑脚本仍能识别当前断点状态。
  write_snapshot

  # 空提交防护：暂存区无变更则跳过该步
  if git diff --cached --quiet; then
    echo "    (暂存区无变更，跳过)"
  else
    git commit -F "$msg"
  fi

  # 成功即删该步文件，实现断点续跑
  rm -f "$msg" "$files"

  # 提交移动 HEAD 后，刷新为剩余步骤对应的快照。
  write_snapshot
done

# 全部成功，删除计划工件目录，避免旧计划被误用。
rm -rf "$DIR"

echo "✅ All $total commits done."
