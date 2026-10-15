#!/usr/bin/env bash
# SessionStart hook: keeps the shared skills repo current and tells the session what it is running on.
# Copy to <project>/.claude/session-start-hook.sh and register it in <project>/.claude/settings.json:
#   {"hooks": {"SessionStart": [{"hooks": [{"type": "command",
#     "command": "bash \"$CLAUDE_PROJECT_DIR/.claude/session-start-hook.sh\""}]}]}}
# On a local machine the same entry can live once in ~/.claude/settings.json for every project.
#
# Whatever this prints reaches the session as context, so it states facts the session must act on:
# which skills commit is installed, whether it is behind origin/main, and whether the project repo
# is private (finite GitHub Actions minutes -> local `verify` is the push gate, see test-verification).
# It never fails the session: every step is best effort and exits 0.
set -u

# 0. Project copy only: when the user-level entry (cloud setup script) is registered and has a clone
#    to run, it already prints all of this; exit so the session gets one status line, not two.
#    The skills repo runs this file in place from its own .claude/settings.json and passes --project,
#    since its path is then the same one the user-level entry runs.
if { [ "${1:-}" = "--project" ] || [ "$(cd "$(dirname "$0")" && pwd)" = "${CLAUDE_PROJECT_DIR:-}/.claude" ]; } \
   && grep -q 'templates/session-start-hook.sh' "$HOME/.claude/settings.json" 2>/dev/null; then
  for f in /home/user/claude-skills "$HOME/claude-skills" "$HOME/.claude-skills-repo"; do
    [ -f "$f/templates/session-start-hook.sh" ] && exit 0
  done
fi

repo_url="${SKILLS_REPO_URL:-https://github.com/alessiogarifo92/claude-skills.git}"
t() { timeout "${HOOK_TIMEOUT:-20}" "$@"; }

# 1. Find the clone (attached repo in a cloud session, or a local checkout), else clone one.
dir=""
for d in "${SKILLS_REPO_DIR:-}" "$HOME/claude-skills" /home/user/claude-skills "$HOME/.claude-skills-repo"; do
  [ -n "$d" ] && [ -d "$d/.git" ] && { dir="$d"; break; }
done
if [ -z "$dir" ]; then
  dir="${SKILLS_REPO_DIR:-$HOME/.claude-skills-repo}"
  t git clone -q "$repo_url" "$dir" 2>/dev/null \
    || { echo "claude-skills: NOT INSTALLED (clone failed). Attach it with add_repo and run scripts/install.sh before any work, and say so in visible text."; dir=""; }
fi

# 2. Update it: fast-forward only, and only when the checkout is clean and has no commits of its own
#    (main, or a session branch created from it); a branch with unmerged work is reported, not touched.
if [ -n "$dir" ]; then
  status="fetch failed (offline?): freshness unknown"
  if t git -C "$dir" fetch -q origin main 2>/dev/null; then
    branch="$(git -C "$dir" rev-parse --abbrev-ref HEAD)"
    if [ -z "$(git -C "$dir" status --porcelain)" ] && git -C "$dir" merge-base --is-ancestor HEAD origin/main 2>/dev/null; then
      git -C "$dir" merge -q --ff-only origin/main 2>/dev/null || true
    fi
    behind="$(git -C "$dir" rev-list --count HEAD..origin/main 2>/dev/null || echo '?')"
    if [ "$behind" = "0" ]; then status="up to date with origin/main"
    else status="BEHIND origin/main by $behind commit(s) on branch '$branch': update it (git -C $dir pull --ff-only, or rebase the working branch) before relying on any skill"; fi
  fi
  bash "$dir/scripts/install.sh" >/dev/null 2>&1 || status="$status; install.sh FAILED"
  t bash "$dir/scripts/install-design-skills.sh" >/dev/null 2>&1 || status="$status; design skills (impeccable, emil) not installed"
  echo "claude-skills: $(git -C "$dir" log -1 --format='%h %cs') in $dir, $status."
fi

# 3. Project repo visibility decides the CI budget.
proj="${CLAUDE_PROJECT_DIR:-$PWD}"
slug="$(git -C "$proj" remote get-url origin 2>/dev/null | sed -E 's#.*github\.com[:/]##; s#\.git$##; s#^.*/git/##')"
if [ -n "$slug" ] && command -v gh >/dev/null 2>&1; then
  private="$(t gh api "repos/$slug" --jq .private 2>/dev/null || true)"
  case "$private" in
    true)  echo "repo $slug: PRIVATE, GitHub Actions minutes are finite. Run the project's local verify before every push; if CI does not start for billing/minutes, follow test-verification (local run + evidence comment), never wait on it." ;;
    false) echo "repo $slug: public, standard GitHub-hosted runners have unlimited minutes. A CI job that does not start is not a minutes problem: investigate it." ;;
    *)     echo "repo $slug: visibility unknown (gh api failed). Check it with gh api repos/$slug --jq .private before deciding how to treat CI." ;;
  esac
fi

# 4. Entry points, so the right skill is invoked before the work starts.
echo "skills entry: new project/app -> project-lifecycle (unattended: autonomous-workflow); a ticket -> product-ownership; before a push -> test-verification."
exit 0
