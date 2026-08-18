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
import { prisma } from '@/lib/prisma'
import type { NormalizedImportResult } from '@/lib/league-import/types'
import {
  bootstrapLeagueFromNormalizedImport,
} from '@/lib/league-import/sleeper/SleeperLeagueCreationBootstrapService'
import {
  buildTier0LeagueColumnPatch,
  buildImportedLeagueSettings,
  persistTradedPicks,
} from '@/lib/league-import/ImportedLeagueCommitService'
import type { ApplyScopeResult, SleeperSyncScope } from './types'
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
  const mergedSettings: Record<string, unknown> = { ...existingSettings, ...freshSettings }
  // Re-assert AF-managed keys the fresh settings don't carry (belt-and-suspenders over the merge order).
  for (const k of AF_MANAGED_SETTINGS_KEYS) {
    if (k in existingSettings && !(k in freshSettings)) mergedSettings[k] = existingSettings[k]
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
    await prisma.leagueSeason.upsert({
      where: { leagueId_season: { leagueId, season: seasonYear } } as never,
      create: {
        leagueId, season: seasonYear,
        platformLeagueId: normalized.source.source_league_id,
        championName: nameForTeamId(topStanding?.source_team_id),
        runnerUpName: nameForTeamId(runnerUp?.source_team_id),
        teamCount: normalized.rosters.length || normalized.league.leagueSize,
        scoringFormat: normalized.scoring?.scoring_format ?? null,
        isDynasty: normalized.league.isDynasty,
        status: 'active',
      },
      update: {
        platformLeagueId: normalized.source.source_league_id,
        championName: nameForTeamId(topStanding?.source_team_id),
        runnerUpName: nameForTeamId(runnerUp?.source_team_id),
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

  const before = await snapshotTeamsRosters(leagueId)

  // REUSE the canonical, claim-preserving upsert (LeagueTeam by [leagueId,externalId] never nulls a
  // claim; Roster keyed by platformUserId with rebuilt lineup_sections; TeamPerformance by [teamId,season,week]).
  await bootstrapLeagueFromNormalizedImport(leagueId, normalized)

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
  // collection. Preserve claimed teams (never delete a user's claimed roster on a mirror refresh); mark
  // a vanished claimed team as orphaned instead so the claim + data survive.
  const authoritative =
    reconcileRemovals &&
    normalized.coverage?.currentRosters?.state === 'full' &&
    normalized.rosters.length > 0
  if (authoritative) {
    const liveTeamIds = new Set(normalized.rosters.map((r) => r.source_team_id))
    const staleTeams = await prisma.leagueTeam.findMany({
      where: { leagueId, externalId: { notIn: Array.from(liveTeamIds) } },
      select: { id: true, externalId: true, platformUserId: true, claimedByUserId: true, isOrphan: true },
    })
    // Index the league's rosters by their canonical source team id (stable across the raw→resolved
    // platformUserId change) so a removed team's roster is found even when Roster.platformUserId holds
    // a RESOLVED AllFantasy id rather than the raw Sleeper manager id.
    const leagueRosters = await prisma.roster.findMany({
      where: { leagueId },
      select: { id: true, platformUserId: true, playerData: true },
    })
    const rosterIdBySourceTeam = new Map<string, string>()
    for (const r of leagueRosters) {
      const st = String(asRecord(r.playerData).source_team_id ?? '')
      if (st) rosterIdBySourceTeam.set(st, r.id)
    }
    for (const t of staleTeams) {
      if (t.claimedByUserId) {
        // A claimed team (and its roster) is NEVER deleted by reconciliation — the user's claim + data
        // survive. If it truly vanished upstream, mark it orphaned so the surface can disclose that.
        if (!t.isOrphan) {
          await prisma.leagueTeam.update({ where: { id: t.id }, data: { isOrphan: true } })
          out.notes.push(`teams_rosters: claimed team ${t.externalId} vanished upstream — marked orphan (preserved, not deleted)`)
        }
        continue
      }
      // Unclaimed + absent from a complete authoritative response → reconcile away (team + its roster).
      const rosterId = rosterIdBySourceTeam.get(t.externalId)
      if (rosterId) {
        await prisma.roster.delete({ where: { id: rosterId } }).catch(() => undefined)
      } else if (t.platformUserId) {
        await prisma.roster.deleteMany({ where: { leagueId, platformUserId: t.platformUserId } }).catch(() => undefined)
      }
      await prisma.leagueTeam.delete({ where: { id: t.id } }).catch(() => undefined)
      out.removed += 1
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
    default:
      return emptyApplyResult()
  }
}
