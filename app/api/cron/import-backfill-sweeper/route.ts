import { NextResponse, type NextRequest } from 'next/server'

import { requireCronAuth } from '@/app/api/cron/_auth'
import { prisma } from '@/lib/prisma'
import { createRunBudget, rotateForFairness } from '@/lib/cron/runBudget'
import { readBackfillOutcome, backfillSettingsPatch } from '@/lib/league-import/backfillOutcome'
import type { ImportProvider } from '@/lib/league-import/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * GET /api/cron/import-backfill-sweeper
 * Auth: `Authorization: Bearer ${CRON_SECRET}`.
 *
 * ── THE THING THAT MAKES A LOST BACKFILL RECOVERABLE ────────────────────────────────
 *
 * `ImportedLeagueCommitService` stamps a league `historicalBackfillStatus: 'pending'`
 * BEFORE it starts the multi-year history walk, then runs that walk in the background.
 * Until now that background work was a bare floating promise, which Vercel is free to
 * kill the moment the import response is returned — so a league could sit at `'pending'`
 * forever, with nothing on the platform that would ever notice or retry.
 *
 * That has been fixed at the source: the commit path and the manual retry route both
 * register their work with `waitUntil` now. This sweeper is the second half, and it is
 * not redundant with the fix:
 *
 *   - `waitUntil` extends the invocation; it does not make the work immortal. A backfill
 *     that outlives `maxDuration`, hits an unhandled crash, or is cut off by a deploy
 *     still dies mid-walk with the league left at `'pending'`.
 *   - Every league imported BEFORE the `waitUntil` fix is already stuck. Those rows do
 *     not repair themselves, and nothing else in the product walks them.
 *
 * 🛑 THE STALENESS THRESHOLD IS THE WHOLE SAFETY ARGUMENT. A league that is legitimately
 * mid-backfill also reads `'pending'` — the status cannot tell "working" from "dead", which
 * is exactly the defect this exists to cover. Re-running a live backfill concurrently would
 * have two writers on the same fact tables, and those tables are delete-then-insert with no
 * unique constraint (see the import audit, F9), so a double run is not merely wasteful —
 * it can interleave a delete with the other run's insert and leave a season half-written.
 *
 * So a league is only eligible once its `historicalBackfillStartedAt` is older than any
 * plausible run. 45 minutes against a 300s `maxDuration` is deliberately far outside it:
 * the cost of sweeping too late is a league that waits another half hour, and the cost of
 * sweeping too early is corrupted history.
 *
 * ⚠ A league with `'pending'` and NO `historicalBackfillStartedAt` is treated as stale.
 * That combination means the stamp was written by a code path that never recorded a start
 * time, so there is no clock to wait on — and it cannot be a run in flight, because every
 * writer sets both fields together.
 */

/** Only these have a backfill service; `runHistoricalBackfill` returns null for the rest. */
const BACKFILLABLE: readonly ImportProvider[] = ['sleeper', 'yahoo', 'espn', 'mfl', 'fantrax']

/**
 * How long a `'pending'` stamp must sit before we treat it as abandoned rather than
 * in flight. See the note above — this is a correctness bound, not a tuning knob.
 */
const STALE_AFTER_MS = 45 * 60 * 1000

/** Leagues re-driven per fire. Bounded so one sweep cannot fan out unboundedly. */
const MAX_LEAGUES_PER_RUN = 8

type SweepOutcome = {
  leagueId: string
  provider: string
  status: string
  seasonsImported: number | null
  error?: string
}

async function runBackfillForProvider(args: {
  provider: string
  leagueId: string
  userId: string
  isDynasty: boolean
}): Promise<unknown> {
  const { provider, leagueId, userId, isDynasty } = args
  if (provider === 'sleeper') {
    const { syncSleeperHistoricalBackfillAfterImport } = await import(
      '@/lib/league-import/sleeper/SleeperHistoricalBackfillService'
    )
    return syncSleeperHistoricalBackfillAfterImport({ leagueId, isDynasty })
  }
  if (provider === 'yahoo') {
    const { syncYahooHistoricalBackfillAfterImport } = await import(
      '@/lib/league-import/yahoo/YahooHistoricalBackfillService'
    )
    return syncYahooHistoricalBackfillAfterImport({ leagueId, userId })
  }
  if (provider === 'espn') {
    const { syncEspnHistoricalBackfillAfterImport } = await import(
      '@/lib/league-import/espn/EspnHistoricalBackfillService'
    )
    return syncEspnHistoricalBackfillAfterImport({ leagueId, userId })
  }
  if (provider === 'mfl') {
    const { syncMflHistoricalBackfillAfterImport } = await import(
      '@/lib/league-import/mfl/MflHistoricalBackfillService'
    )
    return syncMflHistoricalBackfillAfterImport({ leagueId, userId })
  }
  if (provider === 'fantrax') {
    const { syncFantraxHistoricalBackfillAfterImport } = await import(
      '@/lib/league-import/fantrax/FantraxHistoricalBackfillService'
    )
    return syncFantraxHistoricalBackfillAfterImport({ leagueId, userId })
  }
  return null
}

function toTimestamp(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

export async function GET(req: NextRequest) {
  if (!requireCronAuth(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const budget = createRunBudget()
  const now = Date.now()

  /*
   * `historicalBackfillStatus` lives inside the `settings` JSON blob rather than in a
   * column, so the status cannot be a `where` clause without a JSON path filter whose
   * shape varies by provider. Narrowing on `platform` first keeps the scan bounded, and
   * the staleness test runs in memory over that set.
   */
  const candidates = await prisma.league
    .findMany({
      where: { platform: { in: [...BACKFILLABLE] } },
      select: { id: true, userId: true, platform: true, settings: true, importedAt: true },
      orderBy: { importedAt: 'desc' },
      take: 500,
    })
    .catch(() => [])

  const stale = candidates.filter((league) => {
    const settings = (league.settings as Record<string, unknown> | null) ?? {}
    if (settings.historicalBackfillStatus !== 'pending') return false
    const startedAt = toTimestamp(settings.historicalBackfillStartedAt)
    /* No start time recorded — see the header: there is no clock to wait on, and no
       writer produces that combination for a run that is actually in flight. */
    if (startedAt == null) return true
    return now - startedAt >= STALE_AFTER_MS
  })

  /*
   * Rotate, for the reason `runBudget` documents: a fixed order plus a budget does the
   * head of the list forever and never reaches the tail. A stuck league at position 40
   * would otherwise stay stuck permanently while the first eight got swept repeatedly.
   */
  const queue = rotateForFairness(stale).slice(0, MAX_LEAGUES_PER_RUN)

  const outcomes: SweepOutcome[] = []

  for (const league of queue) {
    if (budget.exhausted()) break
    const provider = String(league.platform ?? '').toLowerCase()
    const settings = (league.settings as Record<string, unknown> | null) ?? {}
    const isDynasty = Boolean(settings.isDynasty ?? settings.is_dynasty)

    /*
     * Re-stamp the start time BEFORE running. Two sweeps overlapping is the one thing
     * this must not do, and without this the next fire would see the same original
     * timestamp and consider the league stale all over again.
     */
    await prisma.league
      .update({
        where: { id: league.id },
        data: {
          settings: {
            ...settings,
            historicalBackfillStatus: 'pending',
            historicalBackfillStartedAt: new Date().toISOString(),
            historicalBackfillSweptAt: new Date().toISOString(),
          } as never,
        },
      })
      .catch(() => null)

    try {
      const result = await runBackfillForProvider({
        provider,
        leagueId: league.id,
        userId: league.userId,
        isDynasty,
      })
      const outcome = readBackfillOutcome(result)
      const fresh = await prisma.league
        .findUnique({ where: { id: league.id }, select: { settings: true } })
        .catch(() => null)
      await prisma.league
        .update({
          where: { id: league.id },
          data: {
            settings: {
              ...((fresh?.settings as Record<string, unknown> | null) ?? {}),
              ...backfillSettingsPatch(outcome, new Date().toISOString()),
            } as never,
          },
        })
        .catch(() => null)
      outcomes.push({
        leagueId: league.id,
        provider,
        status: outcome.status,
        seasonsImported: outcome.seasonsImported ?? null,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown'
      const fresh = await prisma.league
        .findUnique({ where: { id: league.id }, select: { settings: true } })
        .catch(() => null)
      await prisma.league
        .update({
          where: { id: league.id },
          data: {
            settings: {
              ...((fresh?.settings as Record<string, unknown> | null) ?? {}),
              historicalBackfillStatus: 'failed',
              historicalBackfillError: message,
            } as never,
          },
        })
        .catch(() => null)
      /* One league's failure must not sink the sweep — the next one may well work. */
      outcomes.push({
        leagueId: league.id,
        provider,
        status: 'failed',
        seasonsImported: null,
        error: message,
      })
    }
  }

  return NextResponse.json({
    ok: true,
    scanned: candidates.length,
    stale: stale.length,
    attempted: outcomes.length,
    /* `stale > attempted` is normal and expected — it is the backlog draining a
       bounded number per fire, not a failure. */
    remaining: Math.max(0, stale.length - outcomes.length),
    elapsedMs: budget.elapsedMs(),
    outcomes,
  })
}
