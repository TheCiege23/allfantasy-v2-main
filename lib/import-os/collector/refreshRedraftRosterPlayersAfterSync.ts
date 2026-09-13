/**
 * Fantasy OS — bring `RedraftRosterPlayer` in line with the rosters a sync rewrote.
 *
 * 🛑 THE GAP THIS CLOSES. The collector rewrites `Roster.playerData` on every due league, and
 * nothing followed it into `RedraftRosterPlayer`. A player who left a team on the platform kept
 * an active redraft row forever. Measured 2026-09-13: 1,261 active imported rows for players on
 * no list of their roster, 234 of them also active on another team in the same league, which
 * the waiver engine reads as "already rostered in this season" and denies the claim.
 *
 * ⚠ IT RUNS AFTER THE SYNC, BOUNDED, AND IT NEVER FAILS IT. Materializing a league took ~13s in
 * the 2026-09-13 backfill, and the collector gives each connection a 4-minute run inside a 300s
 * invocation. So the store only RECORDS which leagues' rosters changed, and this pass works
 * afterwards, with a league cap and a time budget, swallowing each league's error — the same
 * contract as the profile and matchup passes in the cron route.
 *
 * 🛑 AND IT WORKS ON LEAGUES THAT NEED IT, NOT ON LEAGUES THAT MERELY CHANGED. The first version
 * materialized changed leagues in the order the collector happened to return them. Measured
 * 2026-09-13 17:29Z: one sync changed rosters in ~40 leagues, 11 of which gained stale or missing
 * rows; the cap and budget reach ~5 leagues a run; nothing was dropped or added, and whatever the
 * pass did touch left no trace. A league past the cap was also simply lost until its rosters
 * changed again. So:
 *   - ONE query finds every imported league whose redraft rows disagree with its rosters —
 *     active imported rows the roster no longer lists, or listed players with no active row.
 *     Measured 152ms on production over 3,161 rosters.
 *   - leagues this sync changed AND that disagree go first, largest gap first;
 *   - leagues that disagree but did NOT change this run come next. That is the carry-over: a
 *     league deferred by the cap still disagrees on the next run, so it is found again, with no
 *     state to persist and nothing to go stale;
 *   - a changed league that already agrees is skipped and counted, because materializing it
 *     would spend ~13s of the budget doing nothing.
 * The whole result is reported in the run record, so the next question about this pass is
 * answered by a row rather than by inference.
 */
import { prisma } from '@/lib/prisma'
import { NATIVE_PLATFORM_VALUES } from '@/lib/dashboard/platform-label'
import type { MaterializeResult } from '@/lib/league-runtime/materializeRedraftRosterPlayers'

export interface LeagueNeedingWork {
  leagueId: string
  /** Active imported rows for players the roster no longer lists anywhere. */
  stale: number
  /** Players the roster lists with no active redraft row. */
  missing: number
}

export interface RefreshAfterSyncResult {
  /** Distinct leagues whose rosters the sync changed this run. */
  changedLeagues: number
  /** Imported leagues whose redraft rows disagree with their rosters, or null when discovery failed. */
  needingWork: number | null
  /** Changed this run, but already in agreement — not materialized. */
  skippedClean: number
  /** Needed work without changing this run: picked up from an earlier run's deferral or drift. */
  carriedOver: number
  refreshed: number
  /** Needed work, but past the league cap or the time budget. Found again next run. */
  deferred: number
  playersDropped: number
  playersCreated: number
  playersRepaired: number
  discoveryMs: number
  /** Set when discovery failed and the pass fell back to the changed leagues, in collector order. */
  discoveryError: string | null
  errors: Array<{ leagueId: string; error: string }>
}

export interface RefreshAfterSyncInput {
  results: ReadonlyArray<{ rosterChangedLeagueIds?: readonly string[] }>
  maxLeagues: number
  budgetMs: number
  /** Injectable for tests. Default = the real materializer. */
  materialize?: (leagueId: string) => Promise<Pick<MaterializeResult, 'playersDropped' | 'playersCreated' | 'playersRepaired'>>
  /** Injectable for tests. Default = {@link findLeaguesNeedingWork}. */
  findLeaguesNeedingWork?: () => Promise<LeagueNeedingWork[]>
  /** Injectable for tests. */
  now?: () => number
}

async function defaultMaterialize(leagueId: string) {
  const { materializeRedraftRosterPlayersForLeague } = await import(
    '@/lib/league-runtime/materializeRedraftRosterPlayers'
  )
  return materializeRedraftRosterPlayersForLeague(leagueId)
}

/**
 * Every imported league whose redraft rows disagree with its rosters, largest gap first.
 *
 * ⚠ A SUPERSET OF WHAT THE MATERIALIZER WILL CHANGE, NEVER A SUBSET. "Listed" here is the flat
 * list, starters, reserve and taxi; the materializer also honours every lineup section, so a
 * player kept only by a lineup section is counted here and then correctly left alone there. That
 * errs toward a wasted refresh, never toward a skipped one. Native leagues are excluded by the
 * same platform values `isNativePlatform` uses: their redraft engines own the roster.
 */
export async function findLeaguesNeedingWork(limit = 200): Promise<LeagueNeedingWork[]> {
  const native = [...NATIVE_PLATFORM_VALUES]
  const rows = await prisma.$queryRaw<Array<{ leagueId: string; stale: number; missing: number }>>`
    WITH scope AS (
      SELECT g."leagueId", g."redraftRosterId", g."playerData" AS pd
      FROM rosters g JOIN leagues l ON l.id = g."leagueId"
      WHERE g."redraftRosterId" IS NOT NULL
        AND lower(coalesce(l.platform, 'allfantasy')) <> ALL(${native}::text[])
        AND jsonb_typeof(g."playerData"->'players') = 'array'
        AND jsonb_array_length(g."playerData"->'players') > 0),
    stale AS (
      SELECT s."leagueId", count(*)::int AS n
      FROM scope s JOIN redraft_roster_players p ON p."rosterId" = s."redraftRosterId"
      WHERE p."droppedAt" IS NULL AND p."acquisitionType" = 'imported'
        AND NOT (coalesce(s.pd->'players', '[]'::jsonb) ? p."playerId"
                 OR coalesce(s.pd->'starters', '[]'::jsonb) ? p."playerId"
                 OR coalesce(s.pd->'reserve', '[]'::jsonb) ? p."playerId"
                 OR coalesce(s.pd->'taxi', '[]'::jsonb) ? p."playerId")
      GROUP BY 1),
    missing AS (
      SELECT s."leagueId", count(*)::int AS n
      FROM scope s CROSS JOIN LATERAL jsonb_array_elements_text(s.pd->'players') AS pid
      WHERE NOT EXISTS (
        SELECT 1 FROM redraft_roster_players p
        WHERE p."rosterId" = s."redraftRosterId" AND p."playerId" = pid AND p."droppedAt" IS NULL)
      GROUP BY 1)
    SELECT coalesce(stale."leagueId", missing."leagueId") AS "leagueId",
           coalesce(stale.n, 0) AS stale,
           coalesce(missing.n, 0) AS missing
    FROM stale FULL JOIN missing ON missing."leagueId" = stale."leagueId"
    ORDER BY coalesce(stale.n, 0) + coalesce(missing.n, 0) DESC
    LIMIT ${limit}
  `
  return rows.map((r) => ({ leagueId: r.leagueId, stale: Number(r.stale), missing: Number(r.missing) }))
}

export async function refreshRedraftRosterPlayersAfterSync(
  input: RefreshAfterSyncInput,
): Promise<RefreshAfterSyncResult> {
  const now = input.now ?? Date.now
  const materialize = input.materialize ?? defaultMaterialize
  const discover = input.findLeaguesNeedingWork ?? (() => findLeaguesNeedingWork())
  const changed = [...new Set(input.results.flatMap((r) => r.rosterChangedLeagueIds ?? []))]
  const out: RefreshAfterSyncResult = {
    changedLeagues: changed.length,
    needingWork: null,
    skippedClean: 0,
    carriedOver: 0,
    refreshed: 0,
    deferred: 0,
    playersDropped: 0,
    playersCreated: 0,
    playersRepaired: 0,
    discoveryMs: 0,
    discoveryError: null,
    errors: [],
  }

  const deadline = now() + Math.max(0, input.budgetMs)

  let queue: string[]
  const discoveryStarted = now()
  try {
    const needing = await discover()
    out.discoveryMs = now() - discoveryStarted
    out.needingWork = needing.length
    const gap = (n: LeagueNeedingWork) => n.stale + n.missing
    const changedSet = new Set(changed)
    const needingIds = new Set(needing.map((n) => n.leagueId))
    const changedFirst = needing.filter((n) => changedSet.has(n.leagueId)).sort((a, b) => gap(b) - gap(a))
    const carryOver = needing.filter((n) => !changedSet.has(n.leagueId)).sort((a, b) => gap(b) - gap(a))
    out.skippedClean = changed.filter((id) => !needingIds.has(id)).length
    out.carriedOver = carryOver.length
    queue = [...changedFirst, ...carryOver].map((n) => n.leagueId)
  } catch (err) {
    /*
     * Fail OPEN to the previous behaviour: the changed leagues, in collector order. A broken
     * discovery query must not stop the refresh altogether — and it is reported, not swallowed.
     */
    out.discoveryMs = now() - discoveryStarted
    out.discoveryError = err instanceof Error ? err.message.slice(0, 160) : 'discovery failed'
    queue = changed
  }

  for (const [index, leagueId] of queue.entries()) {
    if (index >= input.maxLeagues || now() >= deadline) {
      out.deferred = queue.length - index
      break
    }
    try {
      const r = await materialize(leagueId)
      out.refreshed += 1
      out.playersDropped += r.playersDropped
      out.playersCreated += r.playersCreated
      out.playersRepaired += r.playersRepaired
    } catch (err) {
      out.errors.push({ leagueId, error: err instanceof Error ? err.message.slice(0, 160) : 'materialize failed' })
    }
  }
  return out
}
