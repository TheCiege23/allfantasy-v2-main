import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { calculateLeagueStandings } from '@/lib/tournament/advancementEngine'
import { handleRoundTransition } from '@/lib/tournament/redraftScheduler'
import { requireCronAuth } from '@/app/api/cron/_auth'
import { withSyncJobRun } from '@/lib/production-health/syncJobRunTelemetry'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * Heartbeat job name, probed by scripts/cron-freshness-check.mjs.
 *
 * This job is CONDITIONAL: it only acts on shells that are neither in setup nor complete, so
 * with no tournament running it correctly touches nothing and tournament_audit_logs never
 * moves. Only the SCHEDULED GET records a run; POST is the admin path.
 */
const JOB = 'cron-tournament-automation'

/**
 * Cron / admin: sync shell league standings and optional round transitions.
 * Set TOURNAMENT_AUTOMATION_CURRENT_WEEK (integer) to evaluate weekEnd against shell rounds.
 */
export async function GET(req: NextRequest) {
  if (!requireCronAuth(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  /*
   * The row is written before the sweep runs, so an hour with no live tournament — or a run
   * the platform kills at maxDuration, which executes no user code afterwards and so never
   * closes the row — still leaves a usable started_at for the freshness probe.
   */
  const summary = await withSyncJobRun(
    { jobName: JOB, trigger: 'cron' },
    () => runAutomation(),
    (r) => ({
      rowsWritten: r.processed + r.legacyTournamentsProcessed,
      // Per-shell failures are collected rather than thrown; the sweep still covered the rest.
      status: r.errors.length > 0 ? 'partial' : 'success',
      errors: r.errors.slice(0, 10).map((e) => `${e.id}: ${e.message}`),
      metadata: {
        shellsProcessed: r.processed,
        legacyTournamentsProcessed: r.legacyTournamentsProcessed,
        errorCount: r.errors.length,
      },
    }),
  )
  return NextResponse.json(summary)
}

export async function POST(req: NextRequest) {
  if (!requireCronAuth(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return NextResponse.json(await runAutomation())
}

async function runAutomation() {
  const processed: string[] = []
  const legacyProcessed: string[] = []
  const errors: { id: string; message: string }[] = []

  const shells = await prisma.tournamentShell.findMany({
    where: { status: { notIn: ['setup', 'complete'] } },
    include: { rounds: { orderBy: { roundNumber: 'asc' } } },
  })

  const envWeek = process.env.TOURNAMENT_AUTOMATION_CURRENT_WEEK
  const currentWeek = envWeek ? parseInt(envWeek, 10) : NaN

  for (const shell of shells) {
    try {
      const activeRound = shell.rounds.find((r) => r.roundNumber === shell.currentRoundNumber) ?? shell.rounds[0]
      const tls = await prisma.tournamentLeague.findMany({
        where: {
          tournamentId: shell.id,
          leagueId: { not: null },
          status: { not: 'archived' },
        },
      })
      for (const tl of tls) {
        try {
          await calculateLeagueStandings(tl.id)
        } catch {
          // Bubble / transition windows may briefly lack underlying leagues
        }
      }
      processed.push(shell.id)

      if (Number.isFinite(currentWeek) && activeRound) {
        if (
          currentWeek > activeRound.weekEnd &&
          (shell.status === 'active' || shell.status === 'bubble')
        ) {
          await handleRoundTransition(shell.id, activeRound.roundNumber)
        }
      }

      await prisma.tournamentAnnouncement.updateMany({
        where: {
          tournamentId: shell.id,
          isPosted: false,
          scheduledFor: { lte: new Date() },
        },
        data: { isPosted: true, postedAt: new Date() },
      })
    } catch (e) {
      errors.push({
        id: shell.id,
        message: e instanceof Error ? e.message : String(e),
      })
    }
  }

  const legacyTournaments = await prisma.legacyTournament.findMany({
    where: { status: { notIn: ['completed', 'setup'] } },
    select: { id: true, settings: true },
  })

  for (const lt of legacyTournaments) {
    try {
      const prev = (typeof lt.settings === 'object' && lt.settings !== null ? lt.settings : {}) as Record<string, unknown>
      await prisma.legacyTournament.update({
        where: { id: lt.id },
        data: {
          settings: {
            ...prev,
            lastOverallStandingsRefreshAt: new Date().toISOString(),
          },
        },
      })
      legacyProcessed.push(lt.id)
    } catch (e) {
      errors.push({
        id: lt.id,
        message: e instanceof Error ? e.message : String(e),
      })
    }
  }

  return {
    processed: processed.length,
    legacyTournamentsProcessed: legacyProcessed.length,
    errors,
  }
}
