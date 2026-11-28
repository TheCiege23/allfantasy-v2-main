# Converting an imported league to native IN PLACE — design and migration plan

Status: **decided; being built.** Steps 1–2 merged; owner decisions in §13. Written 2026-11-26 against `origin/main` at
`1270c0fbe`. Every `file:line` below was read at that commit; line numbers drift, so re-read
before building on one.

## 0. The ask, in one paragraph

Today the only way to "go native" is `/create-league?fromLeague=<id>`, which creates a
**second** `League` row and copies teams, rosters, FAAB, picks, history and scoring into it
while the import keeps syncing (`lib/league-creation/canonical/executeCanonicalLeagueCreation.ts:121-137`).
The owner wants **one** league: it mirrors its platform (mirror phase), and when the commissioner
triggers a switchover — normally in the offseason — that **same row** (same id, link, chat,
history) becomes native. Managers keep their team, team name and logo; unclaimed teams stay as
open seats that keep their name and logo.

## 1. Executive summary

- **The flag is `League.platform`.** Every engine and every sync selects leagues by platform.
  Changing it to `'manual'` turns every provider sync off and every native engine on, in one write.
  There is no `syncEnabled` column on `League` (§4).
- **The hard part is identity, not syncing.** An imported league stores provider ids in about a
  dozen places where native code expects AllFantasy ids:
  - `LeagueTeam.externalId` holds the provider team id; native code expects `Roster.id`.
  - `Roster.platformUserId` holds the provider user id; native code expects `AppUser.id` or `open-slot-…`.
  - Player ids are provider ids; native expects the Sleeper id (NFL) or the Rolling Insights id (other sports).
  - Future-pick owner ids are provider team ids; native expects `Roster.id`.
  - `RedraftRoster.ownerId` mirrors the provider user id.

  Flipping the flag without rewriting these yields a league every native reader misreads (§3).
- **About 80% of the translation already exists**, in the copy flow's
  `carryOverImportedLeague.ts` and `copyImportedHistory.ts`. They are written source → target
  across two league ids. The plan refactors them into **pure planners** that both the copy flow and
  the in-place flow use (§5).
- **Two sync leftovers would keep touching a converted league:**
  - Sleeper draft mirroring selects on `DraftSession.sleeperDraftId` and ignores `platform`.
  - A handful of lookups key on `platformLeagueId` alone.

  Both are closed by clearing `sleeperDraftId` and rewriting `platformLeagueId` to `manual-<uuid>` (§4, §6).
- **Duplicate copies must be merged first.** `League` is unique per importing user, so the same
  provider league can exist as several rows (`lib/league-import/duplicateLeagueMerge.ts:4-10`).
  Converting one leaves the others syncing and showing a second, diverging league to their members.
  The switchover refuses until there is one row (§7, step 1).
- **The switch is one transaction**, preceded by a stored snapshot. It can be undone only until
  the first native write; after that, undo is a restore, not a flip (§8).
- **The copy flow should be retired from the UI once this ships.** Keep its code as the shared
  translation library (§10).

## 2. What makes a league "native" today

### 2.1 The predicate — and it exists twice

| Where | Native set | Note |
|---|---|---|
| `lib/dashboard/platform-label.ts:17,28-30` | `allfantasy, af, manual, native`; null → native | Client-safe. `''` → **imported** (trimmed `''` is not in the set) |
| `lib/league/isNativeLeague.ts:81-105` | Same four, plus `allfantasy_test_adp_seed` and `''`; null → native | Server. `''` → **native** |
| `lib/league/write-authority.ts:60-68` | Uses the platform-label predicate | Says outright that `''` resolves to SHADOW, and that this is deliberate |

⚠ The two predicates disagree on `''` and on the ADP seed platform. That is harmless for this
plan, which writes `'manual'`, a value both agree on. **Do not write any other value.**
`'manual'` is also what canonical create writes (`createCanonicalLeagueInTransaction.ts:705`)
and what the hard-coded lists accept (`app/api/cron/weekly-awards/route.ts:255`;
`isNativeFuturePickLeague` in `lib/league-trade-engine/nativeFuturePicks.ts:46-52`, which
accepts **only** `'manual'`).

### 2.2 Native engines select by platform

Native jobs scope by `platform IN NATIVE_PLATFORM_VALUES`:
- `lib/season-week/rollSeasonWeek.ts:200,217`
- `lib/core-app/teamWorkspaceSweep.ts:13`
- `lib/automation/jobs/workspace/discoverWorkspaceRefreshLeagues.ts:113`
- `lib/core-app/nativeRailMatchups.ts:104`
- `lib/guillotine/finishGuillotineSeason.ts:209`

So the moment the row says `'manual'`, these jobs adopt it. That is the intended behaviour, and it
is why every identity rewrite must be done **in the same transaction** as the flip.

A second gate decides where weekly scores are read: `nativeWeeklyLeague`
(`lib/core-app/weeklyCapabilities.ts:52-57`) requires `platform` ∈ {manual, ''} **and**
`platformLeagueId` empty or starting `manual-`. Flip the platform but keep the provider id, and
Season Outlook, matchups and grading read `WeeklyMatchup`, which never holds a native game. The
comment there records exactly that failure in production on 2026-11-11.

### 2.3 What canonical create builds that an import may lack

`createCanonicalLeagueInTransaction` creates the following rows. The right-hand column says
what an imported league has already.

| Row (line) | Imported league has it? |
|---|---|
| `League` with `platform:'manual'`, `platformLeagueId: manual-<uuid>` (512, 699-706) | Provider values |
| `ScoringSettingsSnapshot` (835) | Not guaranteed — check per row |
| Format configs: guillotine, IDP, devy, dynasty, salary cap (851-1071, 1433) | Not guaranteed |
| `LeagueSettings`, `LeagueWaiverSettings` (1099, 1116) | Not guaranteed |
| `RedraftLeagueExtendedSettings`, `…DraftProfile`, `…HomepageState`, `…SportIntegration` (1132-1188) | Usually not |
| `RedraftLeagueChatRoom` (1204) | No. Only canonical create writes one (grep: sole writer) |
| `Roster` + `LeagueTeam` per seat, with `LeagueTeam.externalId = Roster.id` and `Roster.platformUserId` = user id or `open-slot-<leagueId>-<n>` (1213-1301) | Yes, but provider-keyed (§3) |
| `RedraftLeagueMember` per claimed manager (1246) | Usually not |
| `LeagueEntrySlot` per seat (1322) | Usually not |
| `DraftSession` with `slotOrder` of `Roster.id`s (1387) | Only if a provider draft was mirrored, and then keyed to provider ids with a `sleeperDraftId` |
| `LeagueInvite`, `FindLeagueListing` (1472, 1508) | No |
| `RedraftSeason` + `RedraftRoster` | **Yes, already**: `materializeRedraftSeasonForImportedLeague` (`lib/league-import/canonicalSeasonMaterialization.ts:71-190`). `ownerId = platformUserId \|\| team.id` (170) |
| `RedraftRosterPlayer` | **Yes, already**: `lib/league-runtime/materializeRedraftRosterPlayers.ts` projects `Roster.playerData` into them with `acquisitionType:'imported'`, keyed by **provider** player id |

**Rule for the switch: create only what is missing, and never overwrite what exists.** A
commissioner who already tuned settings on the imported league in AF keeps them.

## 3. Every place that keys on a provider identifier

Schema is the single file `prisma/schema.prisma`.

### 3.1 Columns to rewrite in place

| Column (schema line) | Import holds | Native expects | Rewrite |
|---|---|---|---|
| `League.platformLeagueId` (6443, NOT NULL; unique key 6809) | Provider league id | `manual-<uuid>` | Yes (§6) |
| `League.platform` (in unique key) | `sleeper`/`espn`/… | `manual` | Yes |
| `LeagueTeam.externalId` (8861; `@@unique([leagueId, externalId])` 8933) | Provider team id (MFL `0001`, Yahoo `449.l.x.t.3`) | `Roster.id` | Yes, via a two-phase rename |
| `LeagueTeam.platformUserId` (8920) | Provider user id | Claimer `AppUser.id` or `open-slot-…` | Yes |
| `Roster.platformUserId` (8527; `@@unique([leagueId, platformUserId])` 8581) | Provider user id; for some providers the team id | Claimer `AppUser.id` or `open-slot-<leagueId>-<n>` | Yes, two-phase |
| `Roster.playerData` JSON (8554) | Provider player ids, plus `source_team_id`, `source_manager_id`, `source_provider`, `import`, `imported_at`, `lineup_draft_session_id` markers | Native ids, no markers | Yes: `translateImportedRosterData` |
| `RedraftRoster.ownerId` (15065; `@@unique([seasonId, ownerId])` 15118) | Provider user id or `LeagueTeam.id` | `AppUser.id` / open-slot key | Yes, for the **current and future** seasons only |
| `RedraftRosterPlayer.playerId` | Provider player id | Native id | Yes, for active rows |
| `FutureDraftPick.originalRosterId/currentOwnerId` (18019/18021; unique 18036) | Provider team id | `Roster.id` | Yes, **in place, all rows** — not "copy traded only" (§5.3) |
| `DraftSession.slotOrder` / `tradedPicks` JSON, `sleeperDraftId` (13232-13253) | Provider roster ids, Sleeper id | `Roster.id`, null | Rewrite or close the session; clear `sleeperDraftId` |
| `DraftPick.rosterId/originalRosterId/playerId` (13365-13375) | Provider ids | `Roster.id` / native player id | Only for a session that stays live. Completed sessions are history (§3.2) |
| `SeasonResult.rosterId` (3509) | Provider roster id | `Roster.id` | Yes (same mapping as copy flow, `copyImportedHistory.ts:166`) |
| `MatchupFact.teamA/teamB/winnerTeamId`, `SeasonStandingFact.teamId`, `RosterSnapshot.teamId`, `LeagueSeason.championTeamId/teamRecords` | Provider team ids | `LeagueTeam.id` (copy flow's convention) | Optional (§3.2) |

Rows FK'd to `Roster.id` or `LeagueTeam.id` survive untouched **because the plan keeps those
rows**. That is the main structural advantage of in-place over copy. They include `WaiverClaim`,
`FantasyStanding`, `AfLeagueTrade`, `AfRosterLineupAssignment`, `TeamCoOwner` and
`TeamPerformance`.

### 3.2 History: rewrite, or leave and teach the readers?

The copy flow remaps team ids in history because it writes new rows anyway. In place, the
**cheaper and safer** choice is:

- **Leave history-fact player ids in the provider namespace**, as the copy flow does on purpose
  (`copyImportedHistory.ts:151`). This covers `DraftFact`, `TransactionFact` (whose
  `managerId`/`rosterId` the copy flow does not remap either) and completed `DraftPick`s.
- **Remap team ids in `MatchupFact`, `SeasonStandingFact`, `RosterSnapshot`, `SeasonResult` and
  `LeagueSeason`** using the same maps. The history tabs join them to current teams, and a dangling
  provider id would orphan a team's past.
- `WeeklyMatchup` and `LeaguePlayerWeeklyScore` (3392ff, 3439ff) are keyed by the **provider
  league id**, not `League.id`, and other users' imports of the same provider league keep writing
  them. They are not ours to rewrite. **Decided 2026-11-26 (Q4): copy** the converted league's past
  weeks into native score tables at the switch, leaving the provider-keyed rows untouched.

### 3.3 Readers that would break if ids were left provider-shaped

| Reader (file:line) | Assumes |
|---|---|
| `lib/league/viewerTeams.ts:104-119,199-205` (`listHeldTeams`, 52 importers) and ~90 direct `platformUserId: userId` lookups | `Roster.platformUserId === AppUser.id` — "which team is mine" |
| Invite/join: `lib/invite-engine/InviteEngine.ts:202,455,1045`, `app/api/leagues/join/route.ts:222`, `lib/league-invite/InviteValidationResolver.ts:235` | Same. Left provider-keyed, a claimed manager reads as a non-member and could be given a **second roster** |
| `startsWith('open-slot-')`: `lib/league/resizeNativeLeague.ts:28,36`, `lib/league/setup-readiness.ts:27`, `lib/mock-draft/native-league.ts:71` | Unclaimed seats carry an open-slot key, or they read as owned |
| `lib/league/leagueSeats.ts:204,279-280,365` | `leagueId_externalId: { externalId: rosterId }`. Its upsert **creates a duplicate team** on a miss |
| Draft/finalize/elimination: `lib/redraft/finalizeDraftToRedraftSeason.ts:270`, `lib/ai/opponents/liveDraftAiAutopick.ts:220`, `lib/survivor-guillotine/live.ts:609,628,808`, `lib/guillotine/GuillotineEliminationEngine.ts:484` | `externalId === Roster.id` |
| `lib/redraft/offseason/renewNativeRedraft.ts:61` | Matches teams by `externalId === roster.id` — the very next step after switchover |
| Future picks: `lib/league-trade-engine/pickTermsService.ts:197-226`, `lib/live-draft-engine/createNextLeagueDraft.ts:443-460` | Owner ids are `Roster.id`. Unconverted ids **block next-draft creation** |
| `lib/core-app/weeklyCapabilities.ts:52-60` | `manual-` prefix (§2.2) |
| Also: `lib/chat-notifications/tradeOfferSources.ts:122,396-401`, `lib/league-chat/chimmyTradeMoment.ts:207`, `lib/scoring-engine/resolveTeamLabels.ts:11`, `lib/salary-cap/ContractMutationGuard.ts:35`, `lib/team-coowners/access.ts:19`, `lib/zombie/renewZombieUniverse.ts:114,258,270` | `externalId === rosterId` |

Readers that serve **imported** leagues and stop applying after the flip are not affected, because
their platform gate stops them first:
- `lib/core-app/rosterIdMatch.ts:30-37`
- `lib/leagues/rosterTeamIdentity.ts:79-95`
- `lib/league-trade-engine/importedFuturePicks.ts:31-34`

That gate is why `translateImportedRosterData`'s stripping of the source markers is safe. It is
safe only because `externalId` becomes `Roster.id` in the same write.

⚠ Census method, per CLAUDE.md: the importer counts above (52, 21, 17, 12) cover all four import
forms — `@/lib/x`, relative, dynamic `await import`, and re-export facades. Example facade:
`lib/decision-os/world/assemble.ts:102` re-exports `matchTeamIdForRoster`. **Re-run the census
before implementing**, because these counts drift with every commit.

## 4. Every sync / cron / worker path after the switch

**Bottom line: nearly everything filters on `platform` and skips a `'manual'` row. There are two
leftovers, and both are closed by the switch itself.**

| Path | Selector | After switch |
|---|---|---|
| fantasy-os exec sync `enumerateConnectedLeagues` | `lib/import-os/collector/enumerate.ts:61-66`: `platform in SYNCABLE_PROVIDERS` | Skips |
| Write-back to League rows | `enumerate.ts:184-191`, `prismaSyncStore.ts:129-132,238-241`: match on `platform: provider` + `platformLeagueId` + season | Skips, even while another user's copy keeps syncing |
| `refreshRedraftRosterPlayersAfterSync` | `refreshRedraftRosterPlayersAfterSync.ts:114,153`: `platform <> ALL(NATIVE)` | Skips |
| `materializeSleeperDraftSessions` | `lib/sleeper/sync/materializeSleeperDraftSessions.ts:43,77` | Skips |
| Matchup parity (ESPN/Yahoo/MFL/Fleaflicker/Fantrax) as a source | `externalMatchupParity.ts:102`, `mflMatchupParity.ts:90`, `fleaflickerMatchupParity.ts:116`, `fantraxMatchupParity.ts:100,300` | Skips |
| Parity team lookups | `mflMatchupParity.ts:127`, `fleaflickerMatchupParity.ts:162`, `fantraxMatchupParity.ts:133`: `league.platformLeagueId` with **no platform check** | Can read the converted league's teams while someone else imports the same league. **Closed by rewriting `platformLeagueId`** |
| Active sync lane, lineup refresh | `activeSyncLane.ts:100,130-131`, `lineupRefresh.ts:85-86` | Skips |
| decision-os activity ingest | `app/api/cron/decision-os-activity-ingest/route.ts:618,655` | Skips |
| import-backfill-sweeper | `app/api/cron/import-backfill-sweeper/route.ts:67,148` | Skips |
| sleeper-historical-refresh / `followRenewedLeagues` | `route.ts:159,173`; `followRenewedLeagues.ts:99,183` | Skips. ⚠ Its renewal dedupe at `:183` will not count the converted row as already held (§6.2) |
| import-players → `providerWaiverRefresh`, `sleeperTradeFactRotation` (dynamic imports at `:465`, `:433`) | `providerWaiverRefresh.ts:41,122`; `sleeperTradeFactRotation.ts:62` | Skips |
| live-score-tick → `liveSleeperPointsSync` | `lib/live/liveSleeperPointsSync.ts:112` | Skips |
| Provider trade sync/notify | `syncProviderTradeOffers.ts:181`, `notifyProviderLeagueTrades.ts:121-122`, `tradeNotifyService.ts:559,1144,1166` | Skips |
| `scanImportedTanking` | `lib/integrity/scanImportedTanking.ts:291` | Skips |
| `seasonOutlookPrewarm` | `lib/core-app/seasonOutlookPrewarm.ts:150-151`: `league.findFirst({ where: { platformLeagueId } })` with no platform check | Could resolve to the converted row. **Closed by the rewrite** |
| 🛑 **draft-tick → `mirrorActiveSleeperDrafts`** | `lib/draft/mirrorActiveSleeperDrafts.ts:48-53`: `sleeperDraftId != null`, **no platform**; `syncDraftFromSleeper` deletes and rewrites picks (`lib/draft/sleeperSync.ts:307`) | **Would touch.** The switch must null `DraftSession.sleeperDraftId` |
| 🛑 **`/api/leagues/[leagueId]/draft/live-sync`** | `mirrorActiveSleeperDrafts.ts:121-129`: only checks `sleeperDraftId` | **Would touch.** Same fix |
| User resync: `/api/core/sync`, `/api/league/refresh`, `/api/league/sync-history`, Fantrax lineups/transactions | `manualRefresh.ts:45-46`, `resyncImportUtility.ts:62`, `refresh/route.ts:45`, `sync-history/route.ts:41` | Skip |
| `/api/league/sync` (`lib/league-sync-core.ts` ~544-625), `/api/league/sleeper-sync` (`lib/sleeper-sync.ts:322-327`) | Upsert on `(userId, platform, platformLeagueId, season)` | Won't match the converted row. **It creates a new imported copy beside it** (§6.2) |
| Native jobs: `rollSeasonWeek`, `teamWorkspaceSweep`, workspace refresh, waivers `discoverDueWaiverLeagues`, scoring worker, weekly-awards native branch | `NATIVE_PLATFORM_VALUES` | **Start including it** — intended |
| `decision-os-snapshot-capture ?discover=1` | `route.ts:81`, status only | Touches it — a local snapshot only; harmless |

**Kill switches, then:**
1. `platform → 'manual'`
2. `platformLeagueId → manual-<uuid>`
3. `DraftSession.sleeperDraftId → null` for every session in the league

`League.lastSyncedAt`, `syncStatus` and `syncError` drive no selection. Set `syncStatus` to
`'manual'`, as native rows carry (`lib/domain/seasonTournamentLeague.ts:38`). The collector's
`LeagueSyncState` row (runKey `<provider>:<externalId>:<season>`, schema 7055) becomes an
orphan: never enumerated, no cost (`enumerate.ts:11-28`).

## 5. What the copy flow already solves, and how to reuse it in place

| Copy-flow piece | Reuse in place |
|---|---|
| `matchImportedRoster` (`carryOverImportedLeague.ts:44-54`): one roster per team via `rosterSourceTeamId`, refuses ambiguity | As is |
| `importedOwnedPlayerIds` (74-88): refuses a lineup player missing from the roster | As is |
| Player translation via `PlayerIdentityMap` + `leagueIdentityColumns` (219-256): NFL → `sleeperId`, else `rollingInsightsId`; Sleeper-NFL direct `Player` fallback; refuses on missing, ambiguous or many-to-one | As is. Extract it into `translateLeaguePlayerIds(tx, sport, platform, ids)` |
| `translateImportedRosterData` (90-109): maps lineup sections, strips source markers, `foundation.openTeam:false` | Reuse, with `openTeam = !claimed` and `foundation.convertedInPlaceFrom` instead of `carriedOverFromLeagueId` |
| Claimer → `Roster.platformUserId`, `RedraftLeagueMember`, `LeagueEntrySlot FILLED` (268-303) | Reuse the logic. In place, the target is the same roster |
| `carryOverImportedFuturePicks` (128-170): `externalId → Roster.id`, skips unmapped, untraded and past-horizon rows | **Change for in place.** Rewrite every row's two owner ids rather than copying traded rows: old provider-keyed rows would otherwise sit beside new ones on the unique key `(leagueId, pickSeason, round, originalRosterId)`. Unmapped → refuse. Past-horizon → leave |
| Scoring: `importedNflScoring` (best effort, never refuses, `:202-203`); `importedMlbScoring`/`importedMlbRoster` (refuse unless `acceptWeeklyLineups`, `:197-201`); `importedNflSettings` (382-403) | As is. The in-place switch carries the same MLB weekly-lineup confirmation |
| `GAMES_PER_WEEK` carry (`:366`) | As is |
| `copyImportedHistory` (`copyImportedHistory.ts:115-169`) | **Not as is**: it copies across leagues. Extract its id-remap functions and run them as `UPDATE`s on the same league |
| `finalizeImportedCarryover` (`finalizeImportedCarryover.ts:178-207`): rebuilds redraft rows via `runPostDraftFinalizationArtifacts` from an `imported_rosters` draft snapshot, then moves the lifecycle | **Pattern reusable; artifact different.** In place, there is no new draft to snapshot. A switch in the offseason hands off to `renewNativeRedraft` or `startDynastyNewSeason` instead (§7, step 6) |

**Proposed refactor (step 0 of implementation).** Split `carryOverImportedLeague` into:
- a pure `planImportedIdentity(source)`, which returns team, roster and player maps plus refusals;
- appliers: `applyAsCopy` (today's behaviour) and `applyInPlace`.

Today's tests in `tests/imported-league-carryover*.test.ts` keep pinning the copy path, and every
refusal is written once. Two implementations of one rule is the bug this repo keeps recording.

## 6. The unique constraint and `platformLeagueId`

`@@unique([userId, platform, platformLeagueId, season])` (`prisma/schema.prisma:6809`).
`platformLeagueId` is NOT NULL (6443).

**Recommendation: set `platformLeagueId = 'manual-' + randomUUID()`, as canonical create does
(`createCanonicalLeagueInTransaction.ts:512`).** Reasons:
1. `nativeWeeklyLeague` requires it (§2.2). Keeping the provider id misroutes every weekly reader.
2. It closes the `platformLeagueId`-only lookups in §4: the parity team lookups and `seasonOutlookPrewarm`.
3. `lib/core-app/platformLinks.ts:107,175` builds "open on <platform>" links from
   `platformLeagueId`. A native league must not link back.
4. The new value cannot collide: the platform changes too, and the uuid is fresh.

### 6.1 Keep the origin somewhere queryable

The provider identity has to survive for three things:
- undo (§8);
- refusing re-import (§6.2);
- the history tab's "previously on Sleeper" line.

Approved by the owner 2026-11-26 (Q5). The original sketch; `prisma/schema.prisma` has the final model:

```prisma
model LeagueNativeConversion {
  id                   String   @id @default(cuid())
  leagueId             String   @unique
  fromPlatform         String   @db.VarChar(24)
  fromPlatformLeagueId String
  fromSeason           Int
  convertedByUserId    String
  convertedAt          DateTime @default(now())
  snapshot             Json     // §8 pre-switch snapshot (or a pointer to it)
  undoneAt             DateTime?
  @@index([fromPlatform, fromPlatformLeagueId])
}
```

The alternative is `League.settings.nativeConversion` JSON: no migration, but it cannot be
indexed for the re-import lookup, and `settings` is rewritten wholesale in many places. The plan
assumes the table.

### 6.2 Re-import has to land on the converted league, not beside it

After the switch:
- `syncLeague`/`syncSleeperLeague` (§4) and the import commit create a **fresh imported row** for
  `(user, oldPlatform, oldId, season)`.
- `followRenewedLeagues.ts:183` does not count the converted row as held.
- Each member who imports the provider league again gets a second, syncing copy, which is exactly
  the duplicate the owner rejected.

Fix: import, resync and renewal-follow consult `LeagueNativeConversion` by
`(fromPlatform, fromPlatformLeagueId)` — and also by the provider's season chain, for the
renewed-league case. When it matches, they **refuse** and send the user to the native league with
a claim flow.

`DeletedLeagueTombstone` (`lib/league-delete/leagueTombstones.ts:127`) already blocks
re-imports at those same entry points, but it means "this user deleted this league". It is
per-user and lifts on confirmation. Reusing it would block only the converting user and say the
wrong thing to everyone else. Model the new check on it rather than reusing it.

## 7. The switchover, as ordered steps

Entry point: `POST /api/leagues/[leagueId]/convert-to-native`, commissioner-only (reuse the
commissioner gate the commissioner workspace uses), with a `dryRun` mode that returns the plan
and refusals without writing.

**Step 1 — Preflight refusals.** Read-only; this is the dry run.

| Refusal | Why |
|---|---|
| Not commissioner | Owner model |
| Already native / already converted | Idempotency |
| Another `League` row exists for the same provider league + season (other users' copies) | Run `duplicateLeagueMerge` first (`scripts/merge-duplicate-imported-leagues.ts`). Report the copies and their members |
| A provider draft is in progress (`DraftSession` mirrorable status with `sleeperDraftId`) | Wait for it to finish, or the board forks |
| Season in progress | Offseason only (Q2) |
| Any team with zero or more than one matching roster (`matchImportedRoster`) | Same refusal the copy flow makes |
| Duplicate player ownership; any unmapped, ambiguous or many-to-one player id | Same refusals |
| A traded future pick naming a team that cannot be mapped | In place cannot skip it: it would stay provider-keyed |
| MLB without `acceptWeeklyLineups` | Same as copy flow |
| Provider not in `leagueIdentityColumns` | Same |
| The last sync is older than N hours | Convert from fresh data. The dry run should prompt "refresh now" |

Team count needs no check in place: there is no target league to mismatch. That is one refusal
fewer than the copy flow.

**Step 2 — Snapshot (outside the transaction).** Write `LeagueNativeConversion` with
`snapshot` = every row the transaction will change, keyed by primary key, plus the provider
identity:
- the League row;
- LeagueTeams and Rosters;
- active RedraftRosters and RedraftRosterPlayers;
- FutureDraftPicks;
- DraftSessions;
- history-fact team ids.

The size is bounded by team count × roster size. Store it inline, or in a sibling row if it grows
large.

**Step 3 — One transaction.** Size the timeout like the carryover's (60s plus 1.5s per team over
32, `executeCanonicalLeagueCreation.ts:146-151`). Order matters because of the unique keys.

1. Lock the league row (`SELECT … FOR UPDATE`). A sync write-back that lands mid-switch would
   rewrite `playerData` with provider ids.
2. Re-run the Step 1 checks inside the transaction, against the locked state.
3. **Rosters.** Two-phase rename on `Roster.platformUserId`: first to `tmp-<rosterId>`, then to the
   claimer's `AppUser.id` or `open-slot-<leagueId>-<n>`. A two-phase rename is needed because
   `@@unique([leagueId, platformUserId])` can collide mid-rewrite, for example when a provider id
   happens to equal another seat's final key. Also:
   - `playerData = translateImportedRosterData(...)`;
   - `settings.openSlot = !claimed`;
   - set `commissioner` correctly.
4. **Teams.** Two-phase rename on `LeagueTeam.externalId`, from provider id to `tmp-…` to
   `Roster.id`. Then set `platformUserId`, `isOrphan = !claimed` and `role`.
   **`teamName`, `avatarUrl` and `ownerName` are left untouched** — that is the owner's
   requirement 3. Unclaimed teams keep their names and logos. `ownerName` on an unclaimed seat
   keeps the provider manager's name (Q3).
5. **Membership.** `RedraftLeagueMember` per claimed manager (commissioner = `COMMISSIONER`).
   `LeagueEntrySlot` per seat, `FILLED` or `OPEN`, `rosterId = Roster.id`. Create only rows that
   are missing.
6. **Redraft season.** For the current `RedraftSeason`:
   - rewrite `RedraftRoster.ownerId` two-phase, to the same keys as `Roster.platformUserId`;
   - translate active `RedraftRosterPlayer.playerId` to native ids (same map);
   - set `acquisitionType` from `imported` to the carried-over marker the redraft engines accept.
     Carried players behave exactly like drafted players (Q6), so use the value a native draft
     writes.

   Completed past seasons stay as history.
7. **Future picks.** Rewrite `originalRosterId`/`currentOwnerId` on every row, provider team id →
   `Roster.id`. Use the two-phase trick if any provider id could equal a `Roster.id`; both are
   strings, and a cuid cannot equal an MFL `0001`, so one phase is probably fine. Assert anyway.
8. **Drafts.** For every `DraftSession`: set `sleeperDraftId = null`. A completed session stays as
   history. A `pre_draft` session for the coming season is rewritten (`slotOrder` → `Roster.id`)
   or deleted, so the native offseason flow creates its own.
9. **History team ids.** `MatchupFact`, `SeasonStandingFact`, `RosterSnapshot`, `SeasonResult`
   and `LeagueSeason.championTeamId/teamRecords` are remapped with the same maps
   `copyImportedHistory` uses.
10. **Missing native scaffolding.** Settings and config rows from §2.3 are created only when
    absent, populated from the imported `settings` through the same converters (scoring, roster,
    games per week). Also create `RedraftLeagueChatRoom` when absent.
11. **The flip, last:**
    - `platform: 'manual'`, `platformLeagueId: manual-<uuid>`, `syncStatus: 'manual'`;
    - `settings.nativeConversion = { conversionId, convertedAt }`, a pointer only;
    - `LeagueNativeConversion.status = applied`.

**Step 4 — Post-commit, best effort and retryable** (the `finalizeImportedCarryover` contract):
- `reconcileRosterRedraftLinks(leagueId)`;
- invalidate the league's caches;
- post a system message in league chat ("This league now runs on AllFantasy").

**Step 5 — Notify managers.** In-app notice to every claimed manager. Open seats get the existing
invite flow (`LeagueInvite`): one link per open seat for the commissioner to share, and no emails
(Q7).

**Step 6 — Hand off to the native offseason.** In the offseason the commissioner continues with
the existing native flows:
- `renewNativeRedraft` (`lib/redraft/offseason/renewNativeRedraft.ts:22-27`, which requires a
  native platform — the flip satisfies it);
- `startDynastyNewSeason` / `ensureDynastyNextSeason` (`lib/redraft/offseason/startDynastyNewSeason.ts`).

Both match teams by `externalId === roster.id` (`renewNativeRedraft.ts:61`), which step 3.4
guarantees. **The switchover itself never creates the next season.** It converts the league as it
stands, and the native renewal does the season, schedule and draft, exactly as for a league born
native.

## 8. Safety: one transaction, snapshot, undo

- **Atomic.** Steps 3.1–3.11 are one transaction. A refusal or error rolls back everything, and
  the league is still a working import.
- **Idempotent.** A retry after a timeout first checks `LeagueNativeConversion`: if applied, it
  returns the receipt; if snapshot-only, it re-runs Step 3.
- **Undo window — decided 2026-11-26: until the league's first native season starts** (Q10).
  `POST …/convert-to-native/undo` restores the snapshot (platform, ids, `playerData`, owner ids,
  picks, `sleeperDraftId`) at any point before then, **even after native activity**. So undo
  discards whatever the league did on AllFantasy since the switch — waiver claims, trades,
  lineup changes, a rookie draft — and it must list what it will throw away and ask the
  commissioner to confirm before it runs. Nothing can be synced back to the provider; nothing is
  `CONNECTED` (`lib/league/write-authority.ts:51`). When the first native season starts,
  `LeagueNativeConversion.undoClosedAt` is stamped, undo is refused from then on, and the
  snapshot may be dropped.
- **Chat, history and the link need no undo**: they never changed.
- **No production run without the owner**, per CLAUDE.md. The first real conversion is a
  supervised one on a league the owner names.

## 9. The mirror phase today — what works and what's missing

**Works today, nothing to build:**
- Sync keeps the imported row current: `Roster.playerData`, FAAB, matchups and transactions
  (§4 sync paths).
- Lineups set on the provider arrive on the next sync. The collector rewrites `playerData`, and
  `refreshRedraftRosterPlayersAfterSync` brings `RedraftRosterPlayer` in line afterwards.
- Imported leagues already render in the native workspace: they have a `RedraftSeason`, linked
  `RedraftRoster`s and materialized players (`canonicalSeasonMaterialization.ts`,
  `materializeRedraftRosterPlayers.ts`).
- Write Authority marks the league SHADOW and labels writes as not reaching the provider
  (`lib/league/write-authority.ts:9-17,136-158`).
- League chat already exists for imported leagues. `LeagueChatMessage` is keyed by `leagueId`
  (schema 8330), and `LeagueConversation` renders imported-league move cards
  (`components/core-app/comms/LeagueConversation.tsx:951`). Because the switch keeps the id, every
  message survives.

**Gaps:**
1. **Duplicates.** One provider league can be several rows (§7 step 1). The mirror phase is only
   "one league" once `duplicateLeagueMerge` has run for it. Recommend merging at import-join time
   going forward, which `claimExistingLeagueForMember` already does for new imports.
2. **Sync is per-season, per-row.** A Sleeper renewal is a new provider league id, and
   `followRenewedLeagues` creates or follows a **new** `League` row per season. "Mirror until
   switchover" across seasons therefore means: the switch converts the **latest** season's row, and
   earlier seasons stay as linked history (`LeagueSeason`/`LeagueDynastySeason`). **Decided
   2026-11-26: latest season only** (Q1).
3. **Unmapped players surface only at switch time.** Add a read-only "native readiness" card in
   the commissioner workspace during the mirror phase. It runs the Step 1 dry run, so a
   commissioner sees in July what would block them in March.
4. **Daily-lineup sports.** MLB native scoring is weekly (`carryOverImportedLeague.ts:198`). The
   mirror phase shows daily provider lineups, and the switch changes the game. This is a
   product-copy gap more than an engineering one.
5. **Settings edited in AF during the mirror phase.** If the commissioner tunes scoring or roster
   settings on the shadow league in AF, step 3.10 must not overwrite them with provider-converted
   values. "Create only when absent" handles the rows. **Decided 2026-11-26: AF edits win** (Q8):
   a settings key the commissioner changed in AF keeps the AF value, and provider-converted values
   fill only keys AF never touched.

## 10. What happens to `/create-league?fromLeague=`

**Decided 2026-11-26: retire it** (Q9).

- **UI:** once in-place ships, "Make it a native league" (`lib/league/makeNativeLeague.ts`, from
  TheCiege23/allfantasy-v2-main#4287) runs the in-place switch, and no entry point leads to the
  copy flow, which creates exactly the second copy the owner rejected.
- **Code:** keep `carryOverImportedLeague` as internal plumbing over the shared planner (§5), with
  its tests pinning the translation rules. No "start a new league from this one" option.
- **Existing copies already made:** leave them. They are independent native leagues now. A
  one-time report listing `settings.importCarryover.sourceLeagueId` pairs where both rows are
  still active tells the owner how many "two copies" exist.

## 11. Test plan — local Postgres only

`vitest.setup.db-guard.ts` pins an unset `DATABASE_URL` to `127.0.0.1:1`. DB suites must
`describe.skipIf(process.env.VITEST_NO_DATABASE === '1')` and run against a throwaway local
cluster (memory: *Local Postgres for DB tests*). Never `.env`, never production.

**Unit (mocked tx, like `tests/imported-league-carryover-transaction.test.ts`):**
- The planner's refusals: every refusal in §7 step 1, one test each. Each test must fail when its
  guard is removed.
- Two-phase renames: a fixture where a provider `platformUserId` equals another seat's final key,
  and a provider `externalId` equal to another `Roster.id`, both complete without a unique
  violation.
- `teamName`/`avatarUrl` are unchanged for claimed **and** unclaimed seats; `open-slot-` keys go to
  unclaimed seats only.
- Future picks: every row rewritten, zero provider-keyed rows left, unmapped → refuse.
- MLB without `acceptWeeklyLineups` refuses; NFL scoring conversion matches the copy flow's output
  for the same fixture. Use the shared planner and assert byte-identical maps.

**DB integration (local Postgres; `CONVERT_NATIVE_DB_SPECS=1`):** seed a real imported Sleeper
NFL dynasty league and a Fantrax MLB points league through the **import commit path**, from
`contracts/*/fixtures` — no provider calls. Then convert and assert:
- `isNativePlatform`, `nativeWeeklyLeague`, `isNativeFuturePickLeague` and `resolveWriteAuthority`
  all read native;
- `listHeldTeams(user)` returns the claimed team; the invite/join preview for a claimed manager
  says "already a member";
- `enumerateConnectedLeagues`, `mirrorActiveSleeperDrafts` and `refreshRedraftRosterPlayersAfterSync`
  select **zero** rows for the league. This is a positive control: run each before the switch and
  confirm it selects the league, so the "after" zero means something;
- `renewNativeRedraft` / `startDynastyNewSeason` succeed afterwards and `createNextLeagueDraft`
  does not refuse on pick owners;
- the chat message count, `LeagueSeason` count and the league URL are unchanged;
- a re-import of the old provider id is refused with a link to the native league;
- undo restores a byte-identical snapshot of every changed row, including after a native waiver
  claim (Q10: it lists the claim as discarded first); undo after the first native season starts is
  refused;
- a sync write-back racing the transaction (two connections) cannot land provider `playerData` on
  the converted row.

**Census guard:** a test that greps for `platformLeagueId`-only league lookups (no `platform` in
the same `where`) and fails on a new one. That shape is what §4's two leftovers have in common.

## 12. Risks

| Risk | Mitigation |
|---|---|
| A reader not in the §3.3 census still assumes provider ids and misreads the converted league silently | Re-run the four-form census at implementation; DB integration covers the top readers; ship behind a per-league admin flag first |
| A sync write lands between snapshot and flip | Row lock + re-check inside the transaction |
| Other users' copies keep syncing and show a diverging league | Refuse until merged (step 1) |
| Re-import creates a new copy | `LeagueNativeConversion` lookup at every import entry point (§6.2) |
| Transaction timeout on big leagues | The carryover's sizing formula; work is linear in teams × players |
| Two `isNativePlatform` predicates drift further | Only `'manual'` is written; consider collapsing them as separate work |
| Mid-season conversion corrupts the current week | Offseason only (Q2); the readiness check blocks it |
| An unmapped history id orphans a team's past | Remap the §3.2 team-id facts; player ids stay provider-namespaced, as the copy flow does |

## 13. Owner decisions (answered 2026-11-26)

All ten questions are answered. Where an answer differs from this doc's recommendation, the row says
so, because the build follows the answer.

| # | Question | Decision |
|---|---|---|
| 1 | Seasons | **Latest season's row only.** Earlier provider seasons stay as linked history |
| 2 | Mid-season | **Offseason only.** The readiness check (#4300) already blocks an in-season switch |
| 3 | Unclaimed seats | **Keep the provider username** as the manager line, with the team name and logo. *(Recommendation was "Open seat".)* |
| 4 | Provider weekly scores | **Copy** the converted league's past weeks into native tables at the switch |
| 5 | Schema | **Add `LeagueNativeConversion`** — step 3, a migration the owner applies |
| 6 | Carried players | **Exactly like drafted players**: same waiver and trade rules |
| 7 | Never-joined managers | **One invite link per open seat** for the commissioner to share; no emails (providers rarely give us addresses) |
| 8 | Settings precedence | **AF edits made during the mirror phase win**; provider values fill only untouched keys |
| 9 | The copy flow | **Retire it.** The button runs the in-place switch |
| 10 | Undo | **Until the first native season starts**, even after native activity, which undo then discards (§8). *(Recommendation was "until the first native action".)* |

## 14. Implementation order

1. ✅ Refactor `carryOverImportedLeague` into planner + copy applier: TheCiege23/allfantasy-v2-main#4296.
2. ✅ The read-only dry-run endpoint and the "native readiness" card: TheCiege23/allfantasy-v2-main#4300.
3. Migration for `LeagueNativeConversion` (owner applies). The model in `prisma/schema.prisma`
   supersedes the §6.1 sketch: it adds `status`, `snapshotVersion`, `undoClosedAt` and
   `undoneByUserId` for the undo window decided in Q10.
4. The in-place applier, split in two:
   - **4a** — `lib/league/convertImportedLeagueInPlace.ts` and `POST /api/leagues/[leagueId]/convert-to-native`:
     the one-transaction switch (lock, re-check, snapshot, two-phase id rewrites, flip last), admin-gated as a
     supervised pilot, with a real-Postgres suite in `.github/workflows/native-conversion-db.yml`.
   - **4b-3** — per-seat invite links (Q7): the invite panel of a switched league lists each open team with its own
     link (`/join?code=…&team=<Roster.id>`), and the join route seats that person on exactly that team through
     `assignLeagueSeat` (refusing a taken team by name instead of swapping). No new permission: the league's code could
     already take any open team. **The AllFantasy-admin gate on the switch route came off here.**
   - **4b-1** — native settings (`lib/league/nativeScaffolding.ts`): the provider's scoring (NFL/MLB) and roster layout
     carried unless the commissioner saved their own in AF (Q8), fill-only waiver and draft-settings rows, and the
     league invite. ⚠ `mapImportedRosterToAF` was found to map nothing for ESPN/Sleeper and `validateRosterConfig` to
     skip unknown keys, so the layout comes from `importedLineupTemplateSlots` with a known-key check.
   - **4b-2** — past provider weeks into native tables (`lib/league/copyProviderWeeklyScores.ts`, Q4): the season's
     `WeeklyMatchup` rows become final `RedraftMatchup`s on its `RedraftRoster`s (playoff weeks typed `playoff`, byes
     one-sided), and `LeaguePlayerWeeklyScore` rows are re-keyed to `League.id` / `source='allfantasy'` / native seat
     and player ids. Provider rows stay; anything unmatched is counted and skipped; a season that already has
     matchups is not copied into. Standings are not recomputed.
   - **4b (original note)** — native settings and scoring scaffolding (§7 step 3.10, AF edits win per Q8), the past-weekly-score
     copy (Q4: `RedraftMatchup` rows plus `LeaguePlayerWeeklyScore` re-keyed to `League.id`, `source='allfantasy'`),
     and per-seat invite links (Q7, which needs new plumbing: `LeagueInvite` has no seat). The admin gate comes off
     with 4b, not before.
5. The re-import refusal at every import entry point (§6.2): `lib/league/nativeConversionLookup.ts`, checked by the
   import commit (also against the league's provider history, so next season's Sleeper league is refused too), the
   two legacy re-syncs, and every Sleeper bulk writer (`processImportJob`, the batch route, `sleeper-import-process`,
   `sleeper-ranking-import`). Routes answer 409 `LEAGUE_NOW_ON_ALLFANTASY` with the league id. Fails open, like the
   deleted-league check beside it. The renewal follower needs nothing: it only reads `platform: 'sleeper'` rows.
6. Undo (`lib/league/undoNativeConversion.ts`, `GET`/`POST /api/leagues/[leagueId]/convert-to-native/undo`, and
   `components/league-home/NativeUndoCard.tsx` in the Commissioner tab of a switched league). Decisions taken
   building it, each the conservative reading of Q10:
   - **"The first native season starts" = the league has a `RedraftSeason` newer than the one it switched in** (a
     renewal or a new-season rollover made it). The new season's rows are keyed to AllFantasy ids the provider never
     saw, so undo stops there. The first preview that finds one stamps `undoClosedAt`; nothing else needs to.
   - **Teams added or removed since the switch close undo too**: the snapshot cannot put back a seat it never saw.
   - **Discarded = deleted**, for what was made since the switch: trades, waiver claims and pickups, players added,
     keeper picks, drafts set up, new future picks, invite links, and managers who joined (their seats go back to
     open). Everything the switch changed is restored from the snapshot, including what a seat claim overwrites
     (team owner, name, logo, commissioner flags), so the snapshot gained those fields here, optional, so a snapshot
     written before them still undoes and says what it could not restore.
   - **Confirm what you saw.** The preview lists every discard with a count and a token; the undo refuses a token
     that no longer matches the league, and answers with the new list.
   - **Left on purpose:** chat; the roster layout and the fill-only waiver / draft-settings rows the switch wrote
     before its transaction (an imported league reads its provider's positions first); and the
     `LeagueNativeConversion` row, now `undone`, which releases the re-import refusal and lets the switch run again.
   - ⚠ Discards are found by `createdAt > convertedAt`. Prisma stamps both on app servers, so clock skew between
     servers of more than the gap between a switch and the first action after it would misfile that action.
7. Repoint the "Make it native" button. Retire or relabel the copy flow per Q9.
