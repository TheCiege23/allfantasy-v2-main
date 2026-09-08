import 'server-only'

import { prisma } from '@/lib/prisma'
import { normalizeToSupportedSport } from '@/lib/sport-scope'
import { runPsychologicalProfileEngine } from './PsychologicalProfileEngine'
import { backfillTransactionFactsFromTradeHistory } from './TransactionFactBackfill'
import { ingestSleeperTradeFacts } from './SleeperTradeFactIngest'
import { deriveLeagueFormat } from '@/lib/league-runtime/leagueFormat'

/**
 * ProfileRefreshService — generate psychological profiles for a whole league.
 *
 * The engine has existed and been reachable for a while, and `manager_psych_profiles`
 * still held 0 rows, because nothing ever invoked it outside a manual route.
 *
 * DELIBERATELY AFTER SYNC, NOT AT IMPORT. A league that has just been imported
 * has no history until its first sync finishes — profiling at import would
 * characterise every manager from an empty roster and, with the evidence floor
 * in place, simply produce nothing useful while burning the work. Running once
 * the sync has landed real drafts, trades and rosters is what makes a profile
 * mean anything.
 *
 * Bounded and failure-contained: profiling is enrichment, and must never take
 * down the sync it rides along with.
 */

export type LeagueProfileRefreshResult = {
  leagueId: string
  sport: string
  season: number
  managersConsidered: number
  profiled: number
  failed: number
  errors: string[]
}

export async function refreshLeagueProfiles(input: {
  leagueId: string
  sport?: string
  season?: number
  /** Cap managers per run so one large league cannot dominate a cron tick. */
  limit?: number
}): Promise<LeagueProfileRefreshResult> {
  const league = await prisma.league.findUnique({
    where: { id: input.leagueId },
    include: { teams: true },
  })

  const sport = normalizeToSupportedSport(input.sport ?? league?.sport ?? 'NFL')
  /*
   * ⚠ THE FALLBACK STAYS, AND THE INVENTION IS NOW DECLARED (R4b.2).
   *
   * `seasonThrough()` in the aggregator filters `season <= n`, and a dynasty league carries FUTURE
   * draft picks — 2027s and 2028s are routine. Dropping the fallback would pass null, which drops
   * that filter entirely and newly counts them, silently changing every signal. So the current
   * year still bounds the aggregation exactly as it did.
   *
   * 🛑 WHAT CHANGES IS THAT THE ENGINE IS NOW TOLD. It refuses to write a season SNAPSHOT on an
   * invented year — its `season != null` guard was unreachable while this line guaranteed a number,
   * so a league with no recorded season had its cumulative history filed under whatever year the
   * cron happened to fire. For a dynasty league that corrupts the very trajectory the table exists
   * to hold.
   */
  const seasonInferred = input.season == null && league?.season == null
  const season = input.season ?? league?.season ?? new Date().getFullYear()
  // R4b.1 — resolved once per league, same as season/seasonInferred above, and passed to every
  // manager's engine call rather than re-derived per team.
  const format = league ? deriveLeagueFormat(league) : null

  const result: LeagueProfileRefreshResult = {
    leagueId: input.leagueId,
    sport,
    season,
    managersConsidered: 0,
    profiled: 0,
    failed: 0,
    errors: [],
  }
  if (!league) {
    result.errors.push('league not found')
    return result
  }

  const teams = typeof input.limit === 'number' ? league.teams.slice(0, input.limit) : league.teams
  result.managersConsidered = teams.length

  for (const team of teams) {
    const managerId = team.externalId || team.id
    if (!managerId) continue
    try {
      await runPsychologicalProfileEngine({
        leagueId: input.leagueId,
        managerId,
        sport,
        season,
        format,
        // R4b.2 — the engine decides whether to snapshot; it cannot know the year was invented
        // unless this says so.
        seasonInferred,
        sleeperUsername: team.ownerName ?? undefined,
        rosterId: undefined,
      })
      result.profiled += 1
    } catch (e) {
      result.failed += 1
      if (result.errors.length < 5) {
        result.errors.push(
          `${team.ownerName ?? managerId}: ${(e instanceof Error ? e.message : String(e)).slice(0, 90)}`,
        )
      }
    }
  }

  return result
}

/**
 * Refresh profiles for the leagues behind a set of just-synced Sleeper league ids.
 *
 * Sync speaks in EXTERNAL (Sleeper) league ids; the profile engine is keyed by
 * canonical `League.id`. One external league can map to several canonical rows,
 * so every match is profiled rather than the first one found.
 */
export async function refreshProfilesForExternalLeagues(input: {
  externalLeagueIds: string[]
  /** Cap total leagues touched per tick. */
  maxLeagues?: number
  managersPerLeague?: number
}): Promise<{ leaguesProfiled: number; managersProfiled: number; results: LeagueProfileRefreshResult[] }> {
  const ids = [...new Set(input.externalLeagueIds.filter(Boolean))]
  if (ids.length === 0) return { leaguesProfiled: 0, managersProfiled: 0, results: [] }

  const leagues = await prisma.league.findMany({
    where: { platformLeagueId: { in: ids } },
    select: { id: true, sport: true, season: true },
    take: input.maxLeagues ?? 10,
  })

  const results: LeagueProfileRefreshResult[] = []
  for (const league of leagues) {
    const r = await refreshLeagueProfiles({
      leagueId: league.id,
      sport: league.sport ?? undefined,
      season: league.season ?? undefined,
      limit: input.managersPerLeague,
    })
    results.push(r)
  }

  return {
    leaguesProfiled: results.length,
    managersProfiled: results.reduce((a, r) => a + r.profiled, 0),
    results,
  }
}

/**
 * Refresh the least-recently-profiled leagues that actually have something to
 * profile.
 *
 * WHY THIS EXISTS SEPARATELY FROM THE POST-SYNC PATH. Refreshing after a sync is
 * the semantically correct trigger and it stays. It also does not run: the sync
 * cron is gated behind FANTASY_OS_EXEC_SYNC_LIVE, which is not set, and
 * league_sync_state holds 0 rows — the collector has never executed in
 * production. A trigger wired to something that never fires is indistinguishable
 * from no trigger at all, and profiles would have stayed empty in prod while
 * looking wired up in the code.
 *
 * So this rotation rides on a cron that demonstrably does run. Leagues qualify by
 * having draft history, which is the evidence stream that is actually populated;
 * never-profiled leagues go first, then the stalest.
 */
/**
 * ⚠ 2026-09-08 — A FIXED `maxLeagues: 3` WAS THE BINDING CONSTRAINT, MEASURED IN PRODUCTION.
 *
 * Steady-state throughput was 3-13 leagues/day against 287 leagues: a full cycle every ~36
 * days, and 66 leagues with real teams (769 managers) had never been profiled at all. It was
 * briefly invisible because a one-off bulk run wrote 93 leagues on the day it was measured,
 * which dragged average profile age down to 3.3 days and made the fleet look healthy. Read the
 * daily series, not the snapshot.
 *
 * `lib/cron/runBudget.ts` already prescribes the fix in its own header — *"PAIR IT WITH
 * STALENESS ORDERING… order the work list by how stale each unit is, oldest first, and
 * successive runs cover everything without needing a stored cursor."* The ordering below was
 * always there; the budget was the missing half, so the rotation spent a 240s budget doing
 * three leagues and returned.
 *
 * ⚠ `budget` IS CHECKED BETWEEN LEAGUES, NEVER DURING ONE — the same contract `RunBudget`
 * states. A league already started runs to completion.
 *
 * ⚠ AND THE DEFAULT STAYS 3, so every existing caller behaves exactly as before. Only a caller
 * that passes a budget opts into draining, which keeps this change to the one call site that
 * was measured.
 */
export async function refreshStaleLeagueProfiles(input?: {
  maxLeagues?: number
  managersPerLeague?: number
  /**
   * Wall-clock budget from the calling cron. Checked BETWEEN leagues; when it is spent the
   * rotation stops and the next scheduled fire resumes at the next-stalest league.
   */
  budget?: { exhausted(): boolean }
}): Promise<{
  leaguesProfiled: number
  managersProfiled: number
  leagueIds: string[]
  /** True when the budget stopped the run before `picked` was drained — reported, not silent. */
  stoppedEarly: boolean
  /** How many of `picked` were never reached. */
  deferred: number
}> {
  const maxLeagues = input?.maxLeagues ?? 3

  // Leagues with draft history — something to observe.
  const withDrafts = await prisma.draftFact.groupBy({
    by: ['leagueId'],
    _count: { _all: true },
  })
  const candidateIds = withDrafts.map((r) => r.leagueId)
  if (candidateIds.length === 0) {
    return { leaguesProfiled: 0, managersProfiled: 0, leagueIds: [], stoppedEarly: false, deferred: 0 }
  }

  // Staleness by the most recent profile write per league.
  const profiled = await prisma.managerPsychProfile.groupBy({
    by: ['leagueId'],
    where: { leagueId: { in: candidateIds } },
    _max: { updatedAt: true },
  })
  const lastRunByLeague = new Map(profiled.map((p) => [p.leagueId, p._max.updatedAt]))

  const ordered = [...candidateIds].sort((a, b) => {
    const ta = lastRunByLeague.get(a)
    const tb = lastRunByLeague.get(b)
    // Never profiled sorts first; otherwise oldest first.
    if (!ta && !tb) return 0
    if (!ta) return -1
    if (!tb) return 1
    return ta.getTime() - tb.getTime()
  })

  const picked = ordered.slice(0, maxLeagues)

  // Normalise these leagues' trades into the warehouse before profiling them, so
  // the aggregator's PRIMARY path has rows instead of always falling through to
  // the trade-history reader. Bounded to the same leagues this tick touches, so
  // the work stays proportional to the rotation rather than sweeping everything
  // every six hours. Swallowed: a warehouse hiccup must not stop profiling, which
  // still works from the fallback.
  /*
   * 🛑 `maxLeagues` IS PASSED EXPLICITLY, AND OMITTING IT WAS A SILENT TRUNCATION WAITING FOR
   * THIS CHANGE. Both enrichment helpers apply their OWN default cap — `ingestSleeperTradeFacts`
   * takes 25 — so the moment `picked` grew past that, the tail of the rotation would have been
   * profiled from un-enriched data with nothing reporting a shortfall. It was harmless only
   * while `picked` was fixed at 3.
   */
  try {
    await backfillTransactionFactsFromTradeHistory({
      leagueIds: picked,
      maxLeagues: picked.length,
    })
  } catch {
    // fallback path still covers it
  }

  // Then pull trades straight from the provider for the same leagues. The
  // backfill above can only normalise what LeagueTradeHistory already holds,
  // which covered 29 of 57 Sleeper leagues — the rest never had the legacy
  // importer run against them, so no amount of re-normalising reaches them.
  // Trade psychology was thin because the data was never asked for, not because
  // managers had not traded.
  /*
   * ⚠ STILL ONE BATCHED CALL, NOT ONE PER LEAGUE INSIDE THE LOOP. This function resets a
   * MODULE-LEVEL `rateLimitHits = 0` on entry, so invoking it per league would reset its
   * Sleeper backoff state on every iteration and turn a rotation into a hammer.
   */
  try {
    await ingestSleeperTradeFacts({ leagueIds: picked, maxLeagues: picked.length })
  } catch {
    // Enrichment: a provider hiccup must not stop the profile run, which still
    // has draft evidence and whatever trades already landed.
  }

  const results: LeagueProfileRefreshResult[] = []
  const done: string[] = []
  let stoppedEarly = false

  for (const leagueId of picked) {
    /*
     * BETWEEN leagues, before starting the next one — never during. A league already begun runs
     * to completion, which is why `CRON_RUN_BUDGET_MS` leaves 60s of headroom under the 300s
     * edge ceiling rather than treating 240s as padding.
     */
    if (input?.budget?.exhausted()) {
      stoppedEarly = true
      break
    }
    try {
      results.push(await refreshLeagueProfiles({ leagueId, limit: input?.managersPerLeague }))
      done.push(leagueId)
    } catch {
      /*
       * One bad league must not stop the rotation — but it IS counted as reached, or a league
       * that throws every time would be re-picked forever (it sorts first, having never been
       * profiled) and would consume the head of the rotation on every run.
       */
      done.push(leagueId)
    }
  }

  return {
    leaguesProfiled: results.length,
    managersProfiled: results.reduce((a, r) => a + r.profiled, 0),
    /*
     * ⚠ THE LEAGUES ACTUALLY REACHED, NOT `picked`. Returning the full pick list would report
     * work the budget stopped us from doing — the cron's own log would then claim coverage the
     * database does not have, which is the failure mode this whole rotation exists to surface.
     */
    leagueIds: done,
    stoppedEarly,
    deferred: picked.length - done.length,
  }
}
