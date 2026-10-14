#!/usr/bin/env bash
# SessionStart hook. Cloud containers can be reused with an old checkout.
# Moves the session branch onto main when it has no work of its own.
set -u
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0
git rev-parse --git-dir >/dev/null 2>&1 || exit 0
git fetch --quiet origin || { echo "sync: git fetch failed, checkout may be stale"; exit 0; }
# Prefer main or master. A repo created empty takes its first pushed branch as default,
# which can be an old session branch.
for b in main master; do
  git rev-parse --verify --quiet "origin/$b" >/dev/null && { base="origin/$b"; break; }
done
[ -n "${base:-}" ] || { echo "sync: no origin/main or origin/master, skipped"; exit 0; }
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "sync: uncommitted changes, left as is. Check against $base."
elif git merge-base --is-ancestor "$base" HEAD; then
  echo "sync: up to date with $base."
elif git merge-base --is-ancestor HEAD "$base"; then
  git merge --ff-only --quiet "$base" && echo "sync: fast-forwarded to $base ($(git rev-parse --short HEAD))."
elif ! git rev-parse --verify --quiet "origin/$(git branch --show-current)" >/dev/null \
  && [ -n "$(git branch -r --contains HEAD)" ]; then
  # New session branch, and every commit on it is already on the remote. Nothing to lose.
  old=$(git rev-parse --short HEAD)
  git reset --keep --quiet "$base" && echo "sync: moved from stale $old to $base ($(git rev-parse --short HEAD))."
else
  echo "sync: branch has diverged from $base. Merge $base before working."
fi
exit 0
