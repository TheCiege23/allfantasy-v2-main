# Cross-Provider Team Identity + Live Lineup Foundation (Fantasy OS Phase 5D-c)

## Stop-gate 1 — team identity audit
- ESPN: 32 teams, numeric id + abbreviation (e.g. `12:KC`, `28:WSH`, `30:JAX`).
- Sleeper: player `team` = abbreviation. Matches ESPN **except Washington** (Sleeper `WAS` ↔ ESPN `WSH`) — the one real cross-provider divergence. Plus relocated franchises (OAK→LV, SD→LAC, STL→LAR, JAC→JAX).
- Free-agent players have `team = null` → unresolved by design.

## Stop-gate 2 — lock authority (reconfirmed)
`lineupLockService` / `redraft lineupLock` / league lock policy remain the **final** authority. The gateway supplies **evidence only**. Decision sequence: authorize → roster eligibility → resolve sports facts → freshness → **league lock policy** → allow/reject → record evidence. Sports data never bypasses authorization, eligibility, or lock policy.

## Canonical team mapping (`teamIdentity.ts`, Parts 1–3)
- `CanonicalTeamIdentity` (32 NFL teams): `canonicalTeamId = nfl:<ABBR>`, `providerIds {espn, sleeper}`, aliases (incl. WAS/WSH + historical), `historicalAliases`.
- `resolveTeam` — fails closed: certified provider id > verified provider abbreviation > verified alias (+ sport). **Never** resolves on display name/city alone or abbreviation without sport. Free-agent = unresolved by design; ambiguous/conflicting quarantined.
- `certifyNflTeamMapping` — 32 active, no duplicate abbreviation, no provider id → multiple teams, deterministic checksum.

**Proving run:** certified (32 teams, checksum `ed9930a4`); real ESPN 32/32 + real Sleeper abbrs resolved; **ESPN + Sleeper agree on canonical team 32/32**.

## Player → game resolution (`playerGameResolution.ts`, Part 4)
Player team → canonical team → canonical game (ESPN game team ids resolved to canonical too). Outcomes: `resolved` (one eligible game) · `bye` (only when schedule certified complete) · `free_agent` · `unresolved_team` · `multiple_games` · `missing_schedule` · `conflicting_schedule`. Free-agent is not a bye; missing schedule is not a bye; all fail closed.

## Auto-switch safety + lock evidence (`lineupSafety.ts`, Parts 5,7,8)
`evaluateAutoSwitchSafety` allows **only** `verified_unlocked` (authorized + roster-legal + resolved + fresh schedule + before start). Fails closed for already_locked / schedule_unavailable / schedule_stale / team_unresolved / game_conflict / postponed / suspended / final / identity_unresolved / authorization_failed / roster_illegal. Injury never unlocks. `buildLockEvidence` emits a structured record (no credentials/raw payloads) for support/commissioner explanation.

## NOT wired (honest — Part 16)
The **live call-site injection** into the real `lineupLockService`/Start-Sit/auto-switch path is **not** done this increment — these modules are not yet reachable from a compiled application route, so live wiring is **not claimed**. The deterministic foundation above is complete + tested + proven; injection is the next, risk-managed step against the existing lock service.
