/**
 * GET/POST /api/cron/compute-projections
 *
 * Phase 2 of the AF Projections Engine: FantasyStatLine (+ weekly logs, depth charts,
 * injuries) -> AFProjectionSnapshot. Runs after import-stat-lines, which supplies the base.
 *
 * Optional query params:
 *   sport         — "NFL" (default)
 *   sourceSeason  — season to read production from (default: newest present)
 *   targetSeason  — season the projection applies to (default: sourceSeason + 1)
 *   format        — ppr | half_ppr | std (default: ppr)
 *   idpPreset     — balanced | tackle_heavy | big_play_heavy (default: balanced)
 *   dryRun        — 1 to compute and report without writing
 *
 * FAILS LOUDLY, same policy as import-stat-lines / import-projections: zero rows written
 * returns ok:false + HTTP 500. A projection job that reports success while writing nothing
 * is the exact failure this engine was built to end.
 */

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

import { requireCronAuth } from '@/app/api/cron/_auth'
import { writeAfProjectionSnapshots } from '@/lib/af-projections/writeAfProjectionSnapshots'
import type { ScoringFormat } from '@/lib/af-projections/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * Above this share of refusals the run is FAILED even though rows were written. Refusing is
 * healthy behaviour — measured baseline is ~15% (251 insufficient_sample + 34 no_scoring_basis
 * of 1,933) — but a sudden jump means an upstream input vanished, and a partial write that
 * reports success would hide it.
 */
const REFUSAL_RATE_FAILURE_THRESHOLD = 0.4

const VALID_FORMATS: ScoringFormat[] = ['ppr', 'half_ppr', 'std']

async function handle(req: NextRequest) {
  const url = new URL(req.url)
  const sport = (url.searchParams.get('sport') ?? 'NFL').toUpperCase()
  const formatParam = (url.searchParams.get('format') ?? 'ppr').toLowerCase()
  const scoringFormat = (VALID_FORMATS as string[]).includes(formatParam)
    ? (formatParam as ScoringFormat)
    : 'ppr'
  const idpPreset = url.searchParams.get('idpPreset') ?? 'balanced'
  const dryRun = ['1', 'true', 'yes'].includes((url.searchParams.get('dryRun') ?? '').toLowerCase())

  const num = (key: string): number | undefined => {
    const raw = url.searchParams.get(key)
    return raw && /^\d{4}$/.test(raw) ? Number(raw) : undefined
  }

  const startedAt = Date.now()
  try {
    const r = await writeAfProjectionSnapshots({
      sport,
      sourceSeason: num('sourceSeason'),
      targetSeason: num('targetSeason'),
      scoringFormat,
      idpPreset,
      dryRun,
    })

    const considered = r.written + r.refused
    const refusalRate = considered > 0 ? r.refused / considered : 1
    const zeroRows = r.written === 0
    const tooManyRefusals = refusalRate > REFUSAL_RATE_FAILURE_THRESHOLD
    const failed = zeroRows || tooManyRefusals

    return NextResponse.json(
      {
        ok: !failed,
        sport,
        dryRun,
        sourceSeason: r.sourceSeason,
        targetSeason: r.targetSeason,
        scoringFormat: r.scoringFormat,
        idpPreset: r.idpPreset,
        statLinesRead: r.statLinesRead,
        written: r.written,
        refused: r.refused,
        refusalRate: Number(refusalRate.toFixed(4)),
        refusalRateThreshold: REFUSAL_RATE_FAILURE_THRESHOLD,
        refusalsByReason: r.refusalsByReason,
        basisCounts: r.basisCounts,
        confidenceCounts: r.confidenceCounts,
        /** Projections carrying the measured (estimated) solo/assist tackle split. */
        usedTackleSplitEstimate: r.usedTackleSplitEstimate,
        /** No sleeperId mapped, so weekly logs were unreachable — expect ~47% for NFL. */
        withoutWeeklyData: r.withoutWeeklyData,
        failureReason: zeroRows
          ? 'zero_rows_written'
          : tooManyRefusals
            ? 'refusal_rate_above_threshold'
            : undefined,
        errors: r.errors.length ? r.errors.slice(0, 10) : undefined,
        durationMs: Date.now() - startedAt,
        timestamp: new Date().toISOString(),
      },
      { status: failed ? 500 : 200 },
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[cron/compute-projections] failed:', message)
    return NextResponse.json(
      { ok: false, sport, error: message.slice(0, 240), durationMs: Date.now() - startedAt },
      { status: 500 },
    )
  }
}

export async function GET(req: NextRequest) {
  if (!requireCronAuth(req, 'CRON_SECRET')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return handle(req)
}

export async function POST(req: NextRequest) {
  if (!requireCronAuth(req, 'CRON_SECRET')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return handle(req)
}
