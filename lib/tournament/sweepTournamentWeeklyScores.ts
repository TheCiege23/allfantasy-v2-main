/**
 * Ingest one week of per-player scores for every league in every active tournament.
 *
 * 🛑 THE SCHEDULED WRITER IS THE PART THAT IS EASY TO SKIP AND FATAL TO SKIP.
 * A read layer pointed at a table nothing refreshes fails silently and looks
 * correct — which is exactly the state `WeeklyScore` was already in for imported
 * leagues. The reader (`topPerformers`) and this sweep land together or not at
 * all.
 *
 * ⚠ ONE LEAGUE'S FAILURE DOES NOT STOP THE SWEEP. Twenty leagues means twenty
 * chances for a provider hiccup, and a throw on the third would leave seventeen
 * unwritten with nothing recorded about why.
 */
import 'server-only'
import { prisma } from '@/lib/prisma'
import { ingestLeagueWeeklyPlayerScores } from '@/lib/tournament/ingestWeeklyPlayerScores'

export type SweepResult = {
  season: number
  week: number
  leaguesTried: number
  leaguesWritten: number
  rowsWritten: number
  skipped: Array<{ leagueId: string; reason: string }>
  failed: Array<{ leagueId: string; error: string }>
  dryRun: boolean
}

export async function sweepTournamentWeeklyScores(args: {
  season: number
  week: number
  dryRun?: boolean
  /** Limit to one tournament; omit to sweep every active one. */
  tournamentId?: string
}): Promise<SweepResult> {
  const out: SweepResult = {
    season: args.season,
    week: args.week,
    leaguesTried: 0,
    leaguesWritten: 0,
    rowsWritten: 0,
    skipped: [],
    failed: [],
    dryRun: Boolean(args.dryRun),
  }

  const tournamentLeagues = await prisma.tournamentLeague.findMany({
    where: {
      leagueId: { not: null },
      ...(args.tournamentId
        ? { tournamentId: args.tournamentId }
        : /* A finished tournament's weeks do not change; sweeping them every
             night is spend with no answer attached to it. */
          { tournament: { status: { notIn: ['complete', 'archived'] } } }),
    },
    select: { leagueId: true },
  })

  const leagueIds = [...new Set(tournamentLeagues.map((t) => t.leagueId!).filter(Boolean))]
  out.leaguesTried = leagueIds.length

  for (const leagueId of leagueIds) {
    if (out.dryRun) continue
    try {
      const result = await ingestLeagueWeeklyPlayerScores({
        leagueId,
        season: args.season,
        week: args.week,
      })
      if (result.skippedReason) {
        out.skipped.push({ leagueId, reason: result.skippedReason })
        continue
      }
      out.leaguesWritten += 1
      out.rowsWritten += result.written
      if (result.unmappedRosterIds.length > 0) {
        /* Not a failure — but a roster we could not map is a manager whose week
           is missing, and that must be visible rather than inferred later. */
        out.skipped.push({
          leagueId,
          reason: `unmapped rosters: ${result.unmappedRosterIds.join(', ')}`,
        })
      }
    } catch (e) {
      out.failed.push({ leagueId, error: e instanceof Error ? e.message : 'ingest failed' })
    }
  }

  return out
}
