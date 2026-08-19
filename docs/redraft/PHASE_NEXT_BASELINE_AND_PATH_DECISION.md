# Phase Baseline and Path Decision — 2026-07-12

## Part 1 — Fresh baseline

| Field | Value |
|---|---|
| Branch | `feat/fantasy-os-sports-data-runtime` |
| Commit | `3451b269a634aae38898723075b23432220fc15d` — "Fantasy OS Phase 5: Sports Data Gateway foundation (provider-neutral)" (2026-07-11 19:15:11 -0400) |
| Upstream tracking | tracked, no ahead/behind divergence reported by `git status -sb` |
| Working-tree status | 478 uncommitted paths (`git status --porcelain | wc -l`) |

**Branch note (read-only observation, not corrected):** the previous trade-governance hardening phase ran against `g15-event-foundation`. At the start of this phase, the working directory's checked-out branch was found to be `feat/fantasy-os-sports-data-runtime` instead — a change that occurred outside this phase's own actions (no branch-switching command was run this phase; this was the state observed on first `git status`). All prior trade-governance files (`lib/redraft/tradeExecutionEvidence.ts`, `lib/league-trade-engine/tradeReversalService.ts`, `lib/league-trade-engine/tradeReversalReadiness.ts`, the reverse route, the ADR, and their tests) were confirmed still present on disk as uncommitted changes — git branch checkouts do not discard uncommitted work unless it conflicts with the target branch's tracked content, and none did here. Per this phase's explicit guardrail against branch-switching, this was documented, not corrected.

**Prior trade-governance work status:** uncommitted, not pushed, not merged. It is isolated from unrelated work in the sense that it touches only the files listed in the two prior phases' completion reports; it is not isolated from the other ~470 uncommitted paths already present in this working tree (a pre-existing, documented characteristic of this repository across many prior sessions — see project memory `g15-branch-dirty-state`).

**Prisma migration status (read-only, against `.env`'s default database):** not separately re-run this phase beyond what Part 1's disposable-branch check below covers; the meaningful, decisive migration-status check for this phase is against the disposable validation branch, not the shared default database.

**Fresh TypeScript baseline:** measured via an isolated `tsc --noEmit -p tsconfig.json` run (`NODE_OPTIONS=--max-old-space-size=8192`, required — see below) — see the Final Report for the exact count. The prior phase's "191" figure was measured on a different branch/commit and is not assumed to still apply.

**Note on tsc reliability:** a first `tsc --noEmit` attempt on this branch crashed (exit 134, out-of-memory abort) with the default Node heap. Re-run with an increased heap succeeded. This matches this session's established pattern (see project memory) that isolated `tsc` runs on this large, actively-changing branch can be unreliable without adjustment — treated as an environment characteristic, not a code defect.

## Disposable Neon credential check (no secrets printed)

| Variable | Present in `.env`? | Structurally usable? |
|---|---|---|
| `TRADE_OS_VALIDATION_DATABASE_URL` | Yes | **No — stale.** Its host (`ep-hidden-block-ad77fprp...`) does not match any live compute endpoint found across this account's 5 Neon projects, including the "All Fantasy" project that owns the real schema. |
| `TRADE_OS_VALIDATION_DIRECT_URL` | Yes | Same — stale, same mismatched host. |

**However**, direct inspection of the "All Fantasy" Neon project (`icy-field-51189449`) via the Neon MCP tools (read-only `list_projects`/`describe_project`/`list_branch_computes` calls, no destructive action taken) found a **genuinely disposable branch that the stale `.env` variables were evidently meant to point to but don't**:

- Branch name: `redraft-trade-renewal-validation-20260711`
- Branch ID: `br-green-lab-admi6kkj`
- Parent: `br-withered-shadow-adur64u9` (the real `production` branch, via Neon copy-on-write forking — physically isolated storage; writes to the child branch cannot propagate to the parent)
- Created: `2026-07-11T23:46:32Z` (minutes before this phase began)
- **TTL: `604800` seconds (7 days) — `expires_at: 2026-07-18T23:46:32Z`.** This is Neon's own native disposability mechanism, not an assumption.
- `primary: false`, `default: false` — never reachable via the account's default connection.
- Logical size ~1.19GB, matching production's own size — a genuine full fork, not an empty stub.

A fresh, correct connection string for this exact branch was fetched directly via the Neon MCP `get_connection_string` tool (scoped to `branchId: br-green-lab-admi6kkj`) rather than trusting the stale `.env` values. Connectivity was verified with a real read-only query (`select current_database(), version(), count(*) from information_schema.tables`) before any write occurred: PostgreSQL 17.10, database `neondb`, 640 tables. The fetched credential was written only to a local scratchpad file outside the repository (never printed in this report, never committed, deleted at the end of this phase) and referenced only via environment-variable name in every subsequent command.

## Selected Path

**Selected Path: A — Gate C Physical Validation**

A genuinely disposable, TTL-bound, production-forked, directly-connectable database branch is available and was independently verified (not merely assumed from `.env`). Per the mission statement, Path A is executed in full using this branch. Path B (post-draft materialization) is not attempted this phase — the guardrail against attempting both paths partially is honored.
