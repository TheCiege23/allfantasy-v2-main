/**
 * Fantasy OS — idempotent canonical updater for the durable Sleeper read-model sync (Batch 2).
 *
 * Applies one fresh, normalized Sleeper payload to ONE existing canonical `League` row, per scope.
 * It never creates a league (the initial import owns creation; the sync only refreshes existing rows,
 * preserving the AllFantasy `League.id`). It REUSES the canonical import persistence primitives —
 * `bootstrapLeagueFromNormalizedImport` (claim-preserving LeagueTeam/Roster upsert + lineup_sections),
 * `persistTradedPicks`, and the shared settings builders — so import and sync can never drift, and
 * adds only what sync additionally requires:
 *   - change classification (imported vs unchanged) so an identical re-sync reports no-ops, not dupes,
 *   - removal reconciliation, GATED on a *complete authoritative* provider response
 *     (`coverage.currentRosters.state === 'full'` and a non-empty roster set),
 *   - empty/failed-response protection so a provider hiccup NEVER erases valid stored data.
 *
 * Read-only against Sleeper. Preserves `League.id`, `LeagueTeam.claimedByUserId`, and canonical
 * `lineup_sections`. Identity contract: `LeagueTeam.platformUserId` retains the RAW Sleeper manager id,
 * while `Roster.platformUserId` may hold the RESOLVED AllFantasy AppUser id (when the manager is linked
 * to an AF account) — the raw Sleeper manager id always remains in `Roster.playerData.source_manager_id`.
 */
import type { Prisma } from '@prisma/client'
import { resolveSeasonPlacement } from '@/lib/league-import/seasonPlacement'
import { prisma } from '@/lib/prisma'
import type { NormalizedImportResult } from '@/lib/league-import/types'
import {
  bootstrapLeagueFromNormalizedImport,
} from '@/lib/league-import/sleeper/SleeperLeagueCreationBootstrapService'
import {
  buildTier0LeagueColumnPatch,
  buildImportedLeagueSettings,
  persistTradedPicks,
  republishCanonicalSettingsForRefresh,
} from '@/lib/league-import/ImportedLeagueCommitService'
import { buildCanonicalImportBundle } from '@/lib/league-import/canonicalImportNormalizer'
import { isAuthoritativeStatus } from '@/lib/league-import/resourceStatus'
import type { ApplyScopeResult, SleeperSyncScope } from './types'
import { persistLiveTrades } from './persistLiveTrades'
import { emptyApplyResult } from './types'

export interface ApplyLeagueSyncOptions {
  /** Reconcile removals only when the provider returns a complete authoritative collection. Default true. */
  reconcileRemovals?: boolean
}

const AF_MANAGED_SETTINGS_KEYS = [
  'historicalBackfillStatus',
  'historicalBackfillStartedAt',
  'historicalBackfillCompletedAt',
  'historicalBackfillError',
  'importCanonical',
  'snapshotVersion',
] as const

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

function seasonYearOf(normalized: NormalizedImportResult): number {
  const s = normalized.league.season
  return typeof s === 'number' && Number.isFinite(s) ? s : new Date().getFullYear()
}

/** Stable per-team fingerprint (excludes updatedAt) — differs iff the mirror actually changed. */
function fingerprintTeam(t: {
  teamName: string
  ownerName: string
  wins: number
  losses: number
  ties: number
  pointsFor: number
  pointsAgainst: number
  currentRank: number | null
  role: string
  isCommissioner: boolean
  isCoCommissioner: boolean
  claimedByUserId: string | null
  platformUserId: string | null
}): string {
  return JSON.stringify([
    t.teamName, t.ownerName, t.wins, t.losses, t.ties, t.pointsFor, t.pointsAgainst,
    t.currentRank, t.role, t.isCommissioner, t.isCoCommissioner, t.claimedByUserId, t.platformUserId,
  ])
}

/** Stable lineup fingerprint from a roster's playerData JSON (order-insensitive per section). */
function fingerprintRoster(playerData: unknown): string {
  const pd = asRecord(playerData)
  const sec = asRecord(pd.lineup_sections)
  const norm = (v: unknown): string[] => (Array.isArray(v) ? v.map(String).sort() : [])
  return JSON.stringify({
    starters: norm(pd.starters),
    players: norm(pd.players),
    reserve: norm(pd.reserve),
    taxi: norm(pd.taxi),
    ls_starters: norm(sec.starters),
    ls_bench: norm(sec.bench),
    ls_ir: norm(sec.ir),
    ls_taxi: norm(sec.taxi),
  })
}

/** Read the current team/roster fingerprints keyed by source_team_id. */
async function snapshotTeamsRosters(
  leagueId: string,
): Promise<{ teams: Map<string, string>; rosters: Map<string, string> }> {
  const [teams, rosters] = await Promise.all([
    prisma.leagueTeam.findMany({
      where: { leagueId },
      select: {
        externalId: true, teamName: true, ownerName: true, wins: true, losses: true, ties: true,
        pointsFor: true, pointsAgainst: true, currentRank: true, role: true, isCommissioner: true,
        isCoCommissioner: true, claimedByUserId: true, platformUserId: true,
      },
    }),
    prisma.roster.findMany({ where: { leagueId }, select: { playerData: true } }),
  ])
  const teamMap = new Map<string, string>()
  for (const t of teams) teamMap.set(t.externalId, fingerprintTeam(t))
  const rosterMap = new Map<string, string>()
  for (const r of rosters) {
    const sourceTeamId = String(asRecord(r.playerData).source_team_id ?? '')
    if (sourceTeamId) rosterMap.set(sourceTeamId, fingerprintRoster(r.playerData))
  }
  return { teams: teamMap, rosters: rosterMap }
}

/**
 * `league_state` — refresh the League row scalar columns + `settings` + the current-season
 * `LeagueSeason`. Existing settings are merged first so AF-managed keys (backfill status, import
 * canonical) survive; fresh Sleeper-derived keys overlay. Absent provider fields never overwrite.
 */
async function applyLeagueState(
  leagueId: string,
  normalized: NormalizedImportResult,
): Promise<ApplyScopeResult> {
  const out = emptyApplyResult()
  const existing = await prisma.league.findUnique({
    where: { id: leagueId },
    select: {
      settings: true, name: true, avatarUrl: true, scoring: true, status: true,
      leagueSize: true, isDynasty: true, rosterSize: true,
    },
  })
  if (!existing) {
    out.notes.push('league_state: league row not found (skipped)')
    return out
  }
  // Empty-response protection: a valid normalized result always carries a real league name.
  if (typeof normalized.league.name !== 'string' || normalized.league.name.trim().length === 0) {
    out.notes.push('league_state: empty/invalid league payload — kept existing data')
    return out
  }

  const freshSettings = buildImportedLeagueSettings(normalized)
  const existingSettings = asRecord(existing.settings)

  /*
   * 🛑 IMP-02 — REBUILD THE CANONICAL SLICES, DO NOT INHERIT THEM.
   *
   * This used to be a plain `{ ...existing, ...fresh }`, and `importCanonical` sat in
   * AF_MANAGED_SETTINGS_KEYS below — so the canonical `scoringSettings` / `rosterSettings` /
   * `playoffSettings` written at IMPORT time were re-asserted on every refresh and could
   * never change. Raw imported values moved; the canonical snapshot every rules consumer
   * reads did not. A league that switched to full PPR in September was still graded on its
   * import-day scoring, silently and indefinitely.
   *
   * ⚠ A THROW HERE MUST NOT COST THE WHOLE REFRESH. The rest of this writer (name, roster
   * size, dynasty flag, lastSyncedAt) is still correct and worth persisting, so a failure to
   * rebuild the bundle degrades to the previous merge rather than dropping the sync.
   */
  let mergedSettings: Record<string, unknown>
  try {
    const bundle = buildCanonicalImportBundle(normalized)
    mergedSettings = republishCanonicalSettingsForRefresh(existingSettings, freshSettings, bundle)
  } catch (e) {
    /*
     * 🛑 PRESERVE, RECORD, AND REFUSE TO CALL IT COMPLETE — IMP-02 false-green.
     *
     * Keeping the previous canonical slices is right: the raw league columns below are
     * still correct and worth persisting, and last-good rules beat no rules. What was
     * WRONG was doing that silently — the scope completed, `lastSuccessfulSyncAt`
     * advanced, and Decision OS was told this league's effective rules were current when
     * they were the rules from whenever the last successful rebuild happened.
     *
     * `incompleteReasons` makes the store throw after these writes land, so the good
     * columns persist, unrelated scopes still run, and the run cannot report success.
     */
    mergedSettings = { ...existingSettings, ...freshSettings }
    const detail = e instanceof Error ? e.message : String(e)
    out.notes.push(`league_state: canonical settings rebuild failed (${detail}) — kept previous canonical slices`)
    out.incompleteReasons = [
      ...(out.incompleteReasons ?? []),
      `canonical settings rebuild failed: ${detail}`,
    ]
  }

  // Re-assert AF-managed keys the fresh settings don't carry (belt-and-suspenders over the merge order).
  for (const k of AF_MANAGED_SETTINGS_KEYS) {
    if (k in existingSettings && !(k in mergedSettings)) mergedSettings[k] = existingSettings[k]
  }

  const rosterPositions = (normalized.league as Record<string, unknown>).roster_positions
  const tier0 = buildTier0LeagueColumnPatch(normalized)
  const data: Prisma.LeagueUpdateInput = {
    name: normalized.league.name,
    avatarUrl: normalized.league_branding?.avatar_url ?? undefined,
    scoring: normalized.league.scoring ?? undefined,
    status: normalized.league.status ?? undefined,
    leagueSize: typeof normalized.league.leagueSize === 'number' ? normalized.league.leagueSize : undefined,
    isDynasty: normalized.league.isDynasty,
    rosterSize: normalized.league.rosterSize ?? undefined,
    starters: (rosterPositions ?? undefined) as Prisma.InputJsonValue | undefined,
    settings: mergedSettings as Prisma.InputJsonValue,
    /*
     * ⚠ NOTHING WAS WRITING THIS COLUMN. Grepped every write across lib/ and
     * app/api: League.lastSyncedAt had no writer anywhere, so it was null on all
     * 98 production leagues — and every surface that reads it ("never synced",
     * the sync-age chip, the dashboard's account-wide notice) reported a sync
     * that had never happened even while this collector ran every 30 minutes.
     * The banner was not describing a broken sync; it was describing a column
     * nobody stamped.
     *
     * Stamped on every successful apply, not only when something CHANGED. "When
     * did we last read this league" and "when did this league last differ" are
     * different questions, and the freshness chip asks the first one — a league
     * that has genuinely not changed in a week is still freshly read.
     *
     * Deliberately NOT part of the change-detection fingerprint below, which
     * compares data-bearing columns only. Including it would make every run look
     * like an import and destroy the unchanged/imported split.
     */
    lastSyncedAt: new Date(),
    ...(tier0 as Prisma.LeagueUpdateInput),
  }

  // Change detection: compare only the data-bearing columns (not updatedAt).
  const beforeFp = JSON.stringify([
    existing.name, existing.avatarUrl, existing.scoring, existing.status,
    existing.leagueSize, existing.isDynasty, existing.rosterSize, JSON.stringify(existingSettings),
  ])
  await prisma.league.update({ where: { id: leagueId }, data })
  const after = await prisma.league.findUnique({
    where: { id: leagueId },
    select: {
      settings: true, name: true, avatarUrl: true, scoring: true, status: true,
      leagueSize: true, isDynasty: true, rosterSize: true,
    },
  })
  const afterFp = JSON.stringify([
    after?.name, after?.avatarUrl, after?.scoring, after?.status,
    after?.leagueSize, after?.isDynasty, after?.rosterSize, JSON.stringify(asRecord(after?.settings)),
  ])
  if (afterFp === beforeFp) out.unchanged += 1
  else out.imported += 1

  // Current-season LeagueSeason (per-[leagueId,season] — never clobbers a different season row).
  try {
    const seasonYear = seasonYearOf(normalized)
    const topStanding = [...normalized.standings].sort((a, b) => a.rank - b.rank)[0] ?? null
    const runnerUp = [...normalized.standings].sort((a, b) => a.rank - b.rank)[1] ?? null
    const nameForTeamId = (id: string | undefined): string | null => {
      if (!id) return null
      const r = normalized.rosters.find((row) => row.source_team_id === id)
      return r?.team_name?.trim() || r?.owner_name?.trim() || null
    }
    /*
     * Rank 1 of the CURRENT table is not the champion until the season is over —
     * see lib/league-import/seasonPlacement.ts. Spread into BOTH branches: writing
     * null on update is what clears the rows this cron already fabricated.
     */
    const placement = resolveSeasonPlacement({
      leagueStatus: normalized.league.status,
      championName: nameForTeamId(topStanding?.source_team_id),
      runnerUpName: nameForTeamId(runnerUp?.source_team_id),
    })
    await prisma.leagueSeason.upsert({
      where: { leagueId_season: { leagueId, season: seasonYear } } as never,
      create: {
        leagueId, season: seasonYear,
        platformLeagueId: normalized.source.source_league_id,
        ...placement,
        teamCount: normalized.rosters.length || normalized.league.leagueSize,
        scoringFormat: normalized.scoring?.scoring_format ?? null,
        isDynasty: normalized.league.isDynasty,
        status: 'active',
      },
      update: {
        platformLeagueId: normalized.source.source_league_id,
        ...placement,
        teamCount: normalized.rosters.length || normalized.league.leagueSize,
        scoringFormat: normalized.scoring?.scoring_format ?? null,
        isDynasty: normalized.league.isDynasty,
      },
    }).catch(() => { /* unique-key name varies by schema — best-effort */ })
  } catch {
    /* non-fatal */
  }

  return out
}

/**
 * `teams_rosters` — refresh LeagueTeam + Roster (+ TeamPerformance) via the canonical, claim-preserving
 * bootstrap, then reconcile removals ONLY from a complete authoritative response. Reports created/changed
 * as `imported` and identical rows as `unchanged`.
 */
async function applyTeamsRosters(
  leagueId: string,
  normalized: NormalizedImportResult,
  reconcileRemovals: boolean,
): Promise<ApplyScopeResult> {
  const out = emptyApplyResult()

  // Empty-response protection: never let a provider hiccup wipe a populated league. `bootstrap` upserts
  // only the incoming rosters, so an empty incoming set is already a no-op for existing rows — but we
  // also skip removal reconciliation below unless the response is authoritatively complete.
  if (!Array.isArray(normalized.rosters) || normalized.rosters.length === 0) {
    out.notes.push('teams_rosters: empty roster response — kept existing data, no reconciliation')
    return out
  }

  /*
   * IMP-04 — teams whose roster could not be read. `bootstrapLeagueFromNormalizedImport`
   * preserves their stored rosters; this scope must then refuse to call itself complete, or
   * `lastSuccessfulSyncAt` advances over a league we did not fully read.
   */
  const unobserved = normalized.rosters.filter((r) => !isAuthoritativeStatus(r.fetch_status))

  const before = await snapshotTeamsRosters(leagueId)

  // REUSE the canonical, claim-preserving upsert (LeagueTeam by [leagueId,externalId] never nulls a
  // claim; Roster keyed by platformUserId with rebuilt lineup_sections; TeamPerformance by [teamId,season,week]).
  await bootstrapLeagueFromNormalizedImport(leagueId, normalized)

  /*
   * ⚠ WRITE THE RESULTS BACK ONTO LeagueTeam. Nothing did, so LeagueTeam carried
   * a result on 0 of 893 production rows — which is why the dashboard has no
   * records, no standings and no "today's record", and why every surface that
   * reads them omits itself. The standings were already being fetched and
   * normalized on every sync; they were written into LeagueSeason and never back
   * onto the teams the app actually reads.
   *
   * Matched on [leagueId, externalId] <- source_team_id, which is the table's own
   * unique key, so a result can never land on the wrong team.
   *
   * Empty-response protection, same rule the roster path above follows: a
   * provider hiccup that returns no standings must not zero a populated league.
   * Absent standings means "we did not learn anything", not "everyone is 0-0".
   */
  if (unobserved.length > 0) {
    out.notes.push(
      `teams_rosters: ${unobserved.length} of ${normalized.rosters.length} rosters were not observed — stored rosters preserved, no reconciliation`,
    )
    out.incompleteReasons = [
      ...(out.incompleteReasons ?? []),
      `${unobserved.length} of ${normalized.rosters.length} team rosters were not observed`,
    ]
  }

  const standings = Array.isArray(normalized.standings) ? normalized.standings : []
  if (standings.length === 0) {
    out.notes.push('teams_rosters: no standings in response — left existing records untouched')
  } else {
    let written = 0
    for (const row of standings) {
      const externalId = String(row.source_team_id ?? '').trim()
      if (!externalId) continue
      const res = await prisma.leagueTeam
        .updateMany({
          where: { leagueId, externalId },
          data: {
            wins: row.wins,
            losses: row.losses,
            ties: row.ties,
            pointsFor: row.points_for,
            // points_against is optional on the normalized entry; leave the
            // stored value alone rather than writing 0 over a real number.
            ...(typeof row.points_against === 'number'
              ? { pointsAgainst: row.points_against }
              : {}),
          },
        })
        .catch(() => ({ count: 0 }))
      written += res.count
    }
    out.notes.push(`teams_rosters: wrote records onto ${written} team row(s)`)
  }

  const after = await snapshotTeamsRosters(leagueId)

  for (const r of normalized.rosters) {
    const teamId = r.source_team_id
    const beforeTeamFp = before.teams.get(teamId)
    const afterTeamFp = after.teams.get(teamId)
    const beforeRosterFp = before.rosters.get(teamId)
    const afterRosterFp = after.rosters.get(teamId)
    const existedBefore = beforeTeamFp !== undefined || beforeRosterFp !== undefined
    const changed =
      beforeTeamFp !== afterTeamFp || beforeRosterFp !== afterRosterFp
    if (!existedBefore || changed) out.imported += 1
    else out.unchanged += 1
  }

  // Removal reconciliation — ONLY when the provider returned an authoritative *complete* current-roster
  // collection, and then it ARCHIVES rather than deletes. A team absent from one complete response is
  // flagged `isOrphan`; nothing about it is destroyed, and a team that reappears is un-flagged by the
  // bootstrap upsert above. Claimed and unclaimed follow the same rule (Batch A.1 item 1).
  const authoritative =
    reconcileRemovals &&
    normalized.coverage?.currentRosters?.state === 'full' &&
    normalized.rosters.length > 0 &&
    /*
     * 🛑 AND EVERY ROSTER MUST ITSELF BE AN OBSERVATION — IMP-04.
     *
     * The coverage check above is an adapter's CLAIM about completeness, and this batch
     * exists because that claim was wrong: Yahoo and ESPN both reported `full` while
     * counting team records rather than successful reads. Both are fixed, and archival made
     * the consequence recoverable, but an orphan flag still hides a team from every active
     * selector — so the gate does not rest on one adapter remembering to be honest. This
     * second test reads the per-team status directly, and a future adapter that forgets its
     * coverage block fails closed here.
     */
    normalized.rosters.every((r) => isAuthoritativeStatus(r.fetch_status))
  if (authoritative) {
    const liveTeamIds = new Set(normalized.rosters.map((r) => r.source_team_id))
    const staleTeams = await prisma.leagueTeam.findMany({
      where: { leagueId, externalId: { notIn: Array.from(liveTeamIds) } },
      select: { id: true, externalId: true, platformUserId: true, claimedByUserId: true, isOrphan: true },
    })
    for (const t of staleTeams) {
      /*
       * 🛑 ARCHIVE, NEVER DELETE — AND THE CLAIMED/UNCLAIMED SPLIT WAS THE BUG.
       *
       * This block used to preserve a CLAIMED team (orphan-flag it) and hard-delete an
       * unclaimed one along with its `Roster`. The asymmetry has no defensible basis: a
       * team's absence from one response is evidence about the ROSTER FEED, not about the
       * value of the team's history. An unclaimed team still carries ownership history,
       * transactions, matchups, draft picks and the external identifiers every later join
       * depends on — and a delete takes all of it, irreversibly, on the strength of one
       * provider response being complete.
       *
       * It is also the single reason a LeagueTeam row could vanish under a foreign key,
       * which is what blocked the Milestone 19 deletion work. Archiving clears that
       * prerequisite without implementing that migration.
       *
       * ⚠ IDEMPOTENT BY CONSTRUCTION: an already-orphaned team is skipped, so repeated
       * reconciliation over an unchanged league writes nothing and reports nothing.
       */
      if (t.isOrphan) continue

      await prisma.leagueTeam.update({ where: { id: t.id }, data: { isOrphan: true } })
      out.removed += 1
      out.notes.push(
        `teams_rosters: team ${t.externalId} absent from a complete authoritative response — archived as orphan (preserved, not deleted)`,
      )
    }
  }

  return out
}

/** `traded_picks` — refresh future_draft_picks via the canonical idempotent upsert. */
async function applyTradedPicks(
  leagueId: string,
  normalized: NormalizedImportResult,
): Promise<ApplyScopeResult> {
  const out = emptyApplyResult()
  const picks = normalized.traded_picks
  if (!Array.isArray(picks) || picks.length === 0) {
    // Absent = provider doesn't expose them; empty = none traded. Either way a no-op (no erasure).
    return out
  }
  const res = await persistTradedPicks(leagueId, picks)
  out.imported += res.written
  out.rejected += res.skipped
  return out
}

/**
 * Apply one scope's fresh normalized data to one canonical League row. Dispatches to the scope handler.
 * `imported` counts new/changed records; `unchanged` counts confirmed no-ops (idempotency proof).
 */
/**
 * `transactions` — write completed trades to `LeagueTrade` so they appear without a manual Sync.
 *
 * ⚠ THE PAYLOAD IS ALREADY IN HAND; THIS ADDS NO PROVIDER CALL. `SleeperLeagueFetchService`
 * fetches the transaction weeks this refresh asked for regardless, and until this scope existed
 * every one of them was discarded. See `persistLiveTrades.ts` for why the scope did not exist
 * before. (That sweep was 18 weeks when this was written; the live path now asks for a window
 * around the current week — see `resolveTransactionWeekWindow`. The "already in hand" property is
 * what matters here and is unchanged.)
 *
 * ⚠ `removed` STAYS 0 AND THAT IS DELIBERATE. Every other scope here reconciles: a row the
 * provider stops returning is retired. A trade is an EVENT, not current state — Sleeper only
 * serves the weeks this sync asked for, so an older trade being absent from the payload means
 * "not in range", never "undone". Reconciling here would delete real history on every sync.
 */
async function applyTransactions(
  normalized: NormalizedImportResult,
): Promise<ApplyScopeResult> {
  const out = emptyApplyResult()
  const platformLeagueId = normalized.source?.source_league_id
  if (!platformLeagueId) {
    out.notes.push('transactions: no source_league_id on payload (skipped)')
    return out
  }

  const result = await persistLiveTrades({
    platformLeagueId,
    season: seasonYearOf(normalized),
    normalized,
  })

  out.imported = result.rowsWritten
  out.rejected = result.skippedNoOwner
  if (result.tradesSeen > 0) {
    out.notes.push(
      `transactions: ${result.tradesSeen} completed trade(s) -> ${result.rowsWritten} row(s)`,
    )
  }
  if (result.skippedNoOwner > 0) {
    out.notes.push(
      `transactions: ${result.skippedNoOwner} trade(s) had no roster matching a known owner`,
    )
  }
  return out
}

export async function applySleeperScopeToLeague(input: {
  leagueId: string
  scope: SleeperSyncScope
  normalized: NormalizedImportResult
  options?: ApplyLeagueSyncOptions
}): Promise<ApplyScopeResult> {
  const reconcileRemovals = input.options?.reconcileRemovals ?? true
  switch (input.scope) {
    case 'league_state':
      return applyLeagueState(input.leagueId, input.normalized)
    case 'teams_rosters':
      return applyTeamsRosters(input.leagueId, input.normalized, reconcileRemovals)
    case 'traded_picks':
      return applyTradedPicks(input.leagueId, input.normalized)
    case 'transactions':
      return applyTransactions(input.normalized)
    default:
      return emptyApplyResult()
  }
}
