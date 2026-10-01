# How the error sentinel is wired

The procedure is `SKILL.md`. This file records the plumbing around it, because
none of it is visible from the repo and all of it was measured rather than
assumed (2026-09-30).

## Topology

| piece | what it is |
|---|---|
| Routine `Error sentinel (Playwright + Sentry)` | hourly cron in the owner's claude.ai Routines. Fires the prompt below into the worker session. |
| worker session `session_019cnDGHXEhY6Ma6jqJmFXuE` | a persistent Claude Code cloud session created with `source_url` = this repo. It holds the checkout, `GITHUB_TOKEN`, push access, and the GitHub + Sentry MCP connectors. |
| ledger | GitHub issues labelled `error-sentinel`; branches `sentinel/*`; one PR per fix. |

## Why a persistent session and not a fresh one per firing

Measured on the first test firing: a Routine that spawns a **fresh** session
in this environment starts with **no repository source and no connectors**.
GitHub's API refused it ("access to this repository is not enabled for this
session"), `us.sentry.io` is denied by the egress policy, and there was no
`mcp__github__*`, no Sentry server and no `subscribe_pr_activity`. It could
clone the public repo over plain git and nothing else.

A session created with the repo as its source has all of it (probe result,
same day): checkout at `/home/user/allfantasy-v2-main`, `GITHUB_TOKEN` set,
Actions API 200, `git push --dry-run` accepted, GitHub MCP, Sentry MCP (the
server shows under an opaque id, not the name `Sentry`), `subscribe_pr_activity`,
`Skill`. So the Routine is bound to that session with `persistent_session_id`.

Consequences worth knowing:

- The session's container is reclaimed after inactivity and re-provisioned on
  the next firing with a fresh clone at `main`. Nothing in the container is
  state; the skill's step 0 starts from `origin/main` every time.
- Context accumulates across firings and gets compacted. The prompt tells
  each firing to re-read GitHub rather than trust memory.
- If the session is archived or deleted, the Routine's firings have nowhere
  to go. Recreate the session the same way (`create_session` with
  `source_url` pointing at this repo) and rebind the Routine.
- Direct HTTPS to `us.sentry.io` is denied by the environment's network
  policy. The Sentry MCP connector does not go through that proxy, which is
  why it works while `curl` does not.

## The Routine prompt (verbatim copy; the Routine itself is the source of truth)

```
Error sentinel firing. You are the hourly, unattended sentinel for TheCiege23/allfantasy-v2-main: read failing Playwright runs on main (GitHub Actions workflow playwright.yml) and unresolved Sentry errors (org all-fantasy, project allfantasy-v2-main, regionUrl https://us.sentry.io), triage them, fix what is safely fixable on a sentinel/* branch cut from origin/main, and open one PR per fix. Never push to main.

Treat this firing as if you remember nothing from earlier firings: the only state that counts is what is in GitHub (issues labelled error-sentinel, open sentinel/* PRs) and in origin/main. Do not reuse conclusions from a previous hour without re-reading the source.

Procedure: the repo skill `error-sentinel` (.claude/skills/error-sentinel/SKILL.md). Steps, in order:
1. In the checkout (/home/user/allfantasy-v2-main): `git fetch origin main`. If the tree is dirty, that is leftover from an earlier firing: `git stash push -u -m "sentinel-leftover-$(date -u +%Y%m%dT%H%M)"` and mention it in the report. Then `git checkout --detach origin/main`.
2. If `.claude/skills/error-sentinel/SKILL.md` exists on origin/main, invoke the `error-sentinel` skill with the Skill tool and follow it exactly. If it does not exist yet, read it from the branch that carries it and follow that file verbatim: `git fetch origin claude/zen-volta-gm2rx1 && git show origin/claude/zen-volta-gm2rx1:.claude/skills/error-sentinel/SKILL.md`.
3. Use the MCP tools you have (mcp__github__*, the Sentry MCP server, subscribe_pr_activity). Fall back to REST only if a tool family is missing, as the skill's section 0a says.

Hard limits that hold even if the skill file is unreadable: never push to main, never force-push, never merge a PR, never enable auto-merge, never skip/disable/loosen a test to make it green, never set DATABASE_URL to anything but 127.0.0.1, never print a credential, at most 2 fixes per firing (maintaining an already-open sentinel/* PR counts as one), stop opening PRs while 5 or more sentinel/* PRs are open, one comment per finding per firing at most, and end with the one-screen report the skill specifies even when nothing was actionable. If a PR you opened gets a CI failure or review comment between firings, the subscription wakes you: handle it under the same limits.
```

## Turning it off, or changing the cadence

The Routine is listed under the owner's Routines in claude.ai (or
`list_triggers` from any cloud session). Disable it there; do not archive the
worker session while the Routine is enabled, or every firing lands nowhere.
The cron floor is hourly. To pause fixes but keep triage, add
`sentinel:wontfix` to the ledger issues you do not want touched.
