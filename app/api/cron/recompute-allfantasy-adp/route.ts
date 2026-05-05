/**
 * D.5-scheduler — daily AllFantasy AI ADP recompute (Neon + Prisma).
 * Vercel Cron hits `GET /api/cron/recompute-allfantasy-adp` (see `vercel.json`).
 * Auth: `requireCronAuth` (`CRON_SECRET`, `X-Cron-Secret`, or Bearer).
 */

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { requireCronAuth } from '@/app/api/cron/_auth'
import { recomputeAllFantasyAdp } from '@/lib/adp/recomputeAllFantasyAdp'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

async function handle(req: NextRequest) {
  // Vitest passes a standard `Request` (no `nextUrl`); production uses `NextRequest` — both expose `url`.
  const url = new URL(req.url)
  const includeTest = url.searchParams.get('includeTest') === 'true'
  const dryRun = url.searchParams.get('dryRun') === 'true'
  const sportParam = url.searchParams.get('sport')
  const seasonParam = url.searchParams.get('season')

  const sport = sportParam ? sportParam.toUpperCase() : 'NFL'
  const season = seasonParam?.trim() ? seasonParam.trim() : null

  try {
    const report = await recomputeAllFantasyAdp({
      sport,
      season,
      draftMode: 'real',
      includeTest,
      apply: !dryRun,
    })

    const hasErrors = report.errors.length > 0
    const status = hasErrors ? 207 : 200

    return NextResponse.json({ ok: !hasErrors, report }, { status })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  if (!requireCronAuth(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return handle(req)
}

export async function POST(req: NextRequest) {
  if (!requireCronAuth(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return handle(req)
}
