# Fiets Vandaag

Morning "bike or public transport today?" recommendation for cycling commuters in Dutch cities, from wind direction relative to the saved route and rain probability in the commute window. Origin and research: Notion page "Ricerca Deep Research — Idee di app mobile sviluppabili in 2 settimane" (idea 1, score 79/100).

Project decisions (phases 1-3.5, stack, costs, design) live in `docs/decisions.md`. Tickets reference that file instead of re-deriving its content.

## Bootstrap: load the shared skills repo (do this before any work)

This project relies on the private repo `alessiogarifo92/claude-skills` (skills, agents, global rules). A remote session (Claude Code on the web, a cloud container, a GitHub Action) does not have `~/.claude/`, so without this step none of those rules apply.

1. Attach it: `mcp__claude-code-remote__add_repo` with `owner=alessiogarifo92`, `repo=claude-skills` (access `read`), run the clone command it returns, then `register_repo_root`.
2. If the clone already existed (an earlier attach, a container reused), update it first: `git -C <clone> fetch origin main`, then fast-forward (`git -C <clone> merge --ff-only origin/main`, or rebase a working branch). The project's `.claude/session-start-hook.sh` does this on every session start and prints the skills commit and whether it is behind: read that line and act on it. If the project has no `.claude/session-start-hook.sh`, add it and its `.claude/settings.json` entry (copy `<clone>/templates/session-start-hook.sh`; the JSON is in its header) and commit them on the working branch without asking. State the skills commit in your first visible message. Run `bash <clone>/scripts/install.sh` (links every skill into `~/.claude/skills`, agents into `~/.claude/agents`, `CLAUDE.md` into `~/.claude/CLAUDE.md`), then check `ls ~/.claude/skills ~/.claude/agents`. If the running session does not pick the agents up, dispatch `general-purpose` with an explicit `model` and the agent file's body pasted into the brief, plus an instruction to load that agent's frontmatter `skills:` with the Skill tool first and to respect its read-only / no-git limits. If a named skill is still missing from the Skill list, Read `<clone>/<skill>/SKILL.md` directly and follow it. Read the clone's `README.md`.
3. New application or project: invoke `project-lifecycle` first, then `autonomous-workflow` to run its phases unattended. An existing backlog or multi-stage goal: `autonomous-workflow`. A single ticket: `product-ownership`.
   Claude Code detects agent files added to an existing `~/.claude/agents/` without a restart, but not when that directory did not exist at session start (typical in a fresh container). Then either restart the session once, or use the fallback above for this session. `templates/session-start-hook.sh` can install everything before the session starts (best effort).
4. If the attach fails, say so in visible text and ask the user how to proceed. Never continue silently without the rules.

Run / preview (manual gate):
- Local: `npm ci && npm run dev` → http://localhost:5173 (app) and http://localhost:5173/api/health. Port 5173 is the only dev port.
- Remote session / user check: every PR from this repo gets a Worker preview version from CI, `https://pr-<n>-fiets-vandaag.alessiogarifo92.workers.dev` (link in the "Preview version (PR)" job summary). Production is `https://fiets-vandaag.alessiogarifo92.workers.dev`, deployed by CI on push to `main`.
- Checks: `npm run lint`, `npm run typecheck`, `npm run test:coverage`, `npm run build`.

Repo visibility: public (check: `gh api repos/alessiogarifo92/fiets-vandaag --jq .private`). Public means standard GitHub-hosted runners have unlimited minutes; a CI job that never starts is not a minutes problem, investigate it.

Needed environment variables / connectors for this project (details in `README.md`):
- GitHub repository secret `CLOUDFLARE_API_TOKEN` (Workers Scripts: Edit, D1: Edit, Account Settings: Read) for the CI preview/deploy jobs.
- Worker secrets: `VAPID_PRIVATE_KEY`, `INVITE_CODE`; vars `VAPID_PUBLIC_KEY`, `VAPID_SUBJECT`, `MAX_DEVICES` in `wrangler.jsonc`. Rotating VAPID invalidates every subscription.
- A remote session reaches `api.cloudflare.com` through the proxy-injected token (account `02a4c350badad3fae1cee187b3a0f738`, Workers Free).
- npm 10 (Node 22) crashes with "Cannot read properties of null (reading 'edgesOut')" when adding packages; add them with `npx -y npm@11 i -D <pkg>`. `npm ci` works with either.
