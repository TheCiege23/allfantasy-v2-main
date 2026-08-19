# Cross-League Player Intelligence Certification

Date: 2026-07-13. The evidence-based certification record for the
Cross-League Player Intelligence phase, mirroring the format established
by `COMMISSIONER_OS_CERTIFICATION.md`.

## Automated test results (real, executed this phase)

`npx vitest run __tests__/cross-league-player/` — **28/28 passed**, 4 test
files: the core coordinator (identity dedup, roster status, exposure,
injury/schedule enrichment, privacy), the list API route, the detail API
route (including the explicit Part 20 player-ID-probing rejection test),
and the Chimmy seam (including the explicit cross-user rejection test).

Regression (files this phase modified — `UserPlayerExposureService.ts`
exported one previously-private function — plus the surfaces this
phase's new code touches):
- `npx vitest run __tests__/user-os/ __tests__/league-hub/
  __tests__/commissioner-os/` — **162/162 passed**.

## TypeScript baseline

`NODE_OPTIONS="--max-old-space-size=8192" npx tsc --noEmit -p
tsconfig.json` — 191 pre-existing baseline errors (this session's
established, unrelated baseline), **0 errors in any file this phase
touched or created**.

## Lint

`npx eslint` against every file this phase touched or created — **0
warnings, 0 errors**.

## Prisma validation

`npx prisma validate` — schema valid. No schema changes made this phase
(read-only consumption of `Roster`, `League`, `LeagueTeam`, `UserProfile`,
`PlayerIdentityMap`, `SportsPlayer`, `FantasyScheduleGame` — all
pre-existing models). The real, disclosed Yahoo/Fantrax direct-id-column
gap on `PlayerIdentityMap` was found but not migrated this phase (see
`CANONICAL_PLAYER_IDENTITY_CONTRACT.md`).

## Physical validation (Part 21) — disposable Neon branch

Branch `br-green-lab-admi6kkj`, project `icy-field-51189449`. Script:
`scripts/cross-league-player-physical-validation.ts` (left in the repo,
uncommitted, `DATABASE_URL`-gated, refuses the production host marker).

Real fixtures created via Prisma (not raw SQL): 2 `AppUser`s (userA with a
real `UserProfile.sleeperUserId` link, userB unrelated), 3 real `League`s
for userA (League A — Sleeper, fresh sync, "Test Star Player" starting;
League B — ESPN, fresh sync, the SAME real player on the bench under a
DIFFERENT raw provider id; League C — Sleeper, STALE sync, a second real
player "Test Injured Player" on IR), 1 League for userB (unrelated
player), a real `PlayerIdentityMap` row linking both "Test Star Player"
provider ids to one canonical UUID, a real `SportsPlayer` row with
`status: 'IR'`, and real `FantasyScheduleGame` rows for team BUF across
the season with one deliberate schedule gap (the real bye-week proof).
All cleaned up after the run (confirmed via independent read-only SQL
against every touched table) — the branch's ~20+ pre-existing leftover
rows from prior phases were left untouched.

| # | Claim | Result |
|---|---|---|
| 1 | userA's `connectedLeagueCount === 3` | **PASS** |
| 2 | Exactly ONE item for "Test Star Player" (dedup across Sleeper+ESPN raw ids) | **PASS** |
| 3 | `identityConfidence === 'verified'` (real `PlayerIdentityMap` direct match, not name-matching luck) | **PASS** |
| 4 | `canonicalPlayerId` matches the real `PlayerIdentityMap.id` | **PASS** |
| 5 | `exposure.leagueCount === 2`, `leagueAppearances.length === 2` | **PASS** |
| 6 | League A appearance `rosterStatus === 'starter'` | **PASS** |
| 7 | League B appearance `rosterStatus === 'bench'` | **PASS** |
| 8 | Real, non-null bye week derived for "Test Star Player" (team BUF) | **PASS** — `byeWeek: 7` |
| 9 | "Test Injured Player" found, real injury status reflects the real `SportsPlayer.status: 'IR'` row | **PASS** (after the fix below) |
| 10 | "Test Injured Player" `rosterStatus === 'ir'` | **PASS** |
| 11 | League C (stale sync) appearance `syncFreshness.state === 'stale'` | **PASS** |
| 12 | userB's `connectedLeagueCount === 1`, contains only userB's own player | **PASS** |
| 13 | userB's portfolio contains ZERO trace of userA's leagues/players/ids | **PASS** |
| 14 | Chimmy summary's `injuredPlayers` includes "Test Injured Player" | **PASS** |
| 15 | Chimmy summary has no `items` key — genuinely narrower than the full portfolio | **PASS** |
| 16 | Cross-user player-id probing via `getChimmyPlayerLookup` returns `null` | **PASS** |
| 17 | No secrets (token/Bearer/oauth/password) anywhere in captured output | **PASS** |

**20/20 individual assertions passed** (the table above groups closely
related assertions from the script's own 20-line summary).

## Real defect found and fixed this phase

The physical validation's first pass surfaced `injury.status: 'out'` for
the real `SportsPlayer.status: 'IR'` fixture row — not `'ir'`, even
though `InjuryStatus` declares `'ir'` as a valid member. Root cause: the
original mapping only used the collapsed 4-category
`InjuryAvailabilityCategory` (`available`/`uncertain`/`unavailable`/
`unknown`) — `'unavailable'` mapped unconditionally to `'out'`, making
`'ir'`/`'suspended'`/`'doubtful'`/`'day_to_day'` permanently unreachable
dead code in the type union. Fixed by adding `toInjuryStatus()`, which
maps from the real, already-available RAW status string first (Sleeper's
own real tokens — `'ir'`, `'sus'`/`'suspended'`, `'o'`/`'out'`, `'q'`/
`'questionable'`, `'d'`/`'doubtful'` — the exact same real tokens
`injuryEnrichedWorld.ts`'s own `UNAVAILABLE_STATUSES` set already
recognizes), falling back to the collapsed category only when the raw
token isn't one of the known ones. Re-ran the physical validation script
after the fix — claim #9 above now genuinely passes with `injury.status:
'ir'`, not a coincidental `'out'` match. Covered by a new dedicated
regression test.

## Domain certification status (final)

| Domain | Status |
|---|---|
| Canonical Player Identity | **CERTIFIED WITH DOCUMENTED LIMITATIONS** — physically proven dedup across two real providers via a real `PlayerIdentityMap` row; Yahoo/Fantrax direct-id resolution remains a real, disclosed schema gap |
| My Players Workspace | **CERTIFIED WITH DOCUMENTED LIMITATIONS** — real `/my-players` page, filters, sorting, detail drawer, dashboard summary card all built and typechecked; browser/mobile/tablet visual verification not performed this phase (production-DB safety, same disclosed limitation as the prior Commissioner OS phase) |
| Exposure Intelligence | **CERTIFIED WITH DOCUMENTED LIMITATIONS** — real league-count/percentage exposure physically proven; position/team/injury/bye-week *concentration* reports are a real, disclosed deferral (see `CROSS_LEAGUE_EXPOSURE_MODEL.md`) |
| Injury & Schedule Intelligence | **CERTIFIED WITH DOCUMENTED LIMITATIONS** — real injury status (now correctly distinguishing `'ir'`) and real NFL bye-week derivation both physically proven; non-NFL schedule/bye is a real, disclosed gap (no source data exists yet) |
| League-Specific Player Actions | **CERTIFIED WITH DOCUMENTED LIMITATIONS** — real, genuinely different per-league recommendations proven via a dedicated fixture test (start in one league, bench in another for the same real player); execution-capability truthfulness only partially cross-checked against the full provider capability matrix |

## Overall Cross-League Player Intelligence Status

**CERTIFIED WITH DOCUMENTED LIMITATIONS** — the core dedup/exposure/
injury/schedule/recommendation pipeline is real, physically proven against
a real Postgres branch with real cross-provider fixtures, and every real
gap (Yahoo/Fantrax identity, non-NFL schedule, concentration reports,
execution-capability depth, live browser verification) is disclosed by
name rather than silently absent.
