import { NextRequest, NextResponse } from 'next/server'
import { requireCronAuth } from '@/app/api/cron/_auth'
import { withSyncJobRun } from '@/lib/production-health/syncJobRunTelemetry'
import { ingestSGProviderData } from '@/lib/survivor-guillotine/providerIngestion'
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 240
export async function GET(request: NextRequest) {
  if (!requireCronAuth(request, 'CRON_SECRET')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (process.env.SG_PROVIDER_INGEST_ENABLED !== 'true') return NextResponse.json({ ok: false, error: 'Live provider ingestion is not enabled' }, { status: 503 })
  const query = request.nextUrl.searchParams, sport = query.get('sport')
  const season = query.has('season') ? Number(query.get('season')) : undefined, week = query.has('week') ? Number(query.get('week')) : undefined
  const date = query.get('date') ?? undefined
  if ((sport !== null && !['NFL', 'NBA'].includes(sport)) || (sport === null && (season !== undefined || week !== undefined || date !== undefined)) ||
    (season !== undefined && (!Number.isInteger(season) || season < 2020 || season > 2100)) ||
    (week !== undefined && (!Number.isInteger(week) || week < 1 || week > 18)) ||
    (date !== undefined && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date))))) {
    return NextResponse.json({ ok: false, error: 'Use a valid sport, season, week, and game date' }, { status: 400 })
  }
  const run = (selected: 'NFL' | 'NBA') => withSyncJobRun(
    { jobName: `cron-survivor-guillotine-provider-${selected.toLowerCase()}`, trigger: 'cron' },
    () => ingestSGProviderData({ sport: selected, season, week, date }),
    result => ({ status: result.ok ? 'success' : 'failed', ...(result.ok ? {} : { errors: [('error' in result ? result.error : undefined) ?? 'Provider ingestion failed'] }) }),
  )
  if (sport) {
    const result = await run(sport as 'NFL' | 'NBA')
    return NextResponse.json(result, { status: result.ok ? 200 : 503 })
  }
  // One scheduler slot covers both independent feeds, with separate leases and telemetry.
  const combined = await withSyncJobRun(
    { jobName: 'cron-survivor-guillotine-provider', trigger: 'cron' },
    async () => {
      const results = await Promise.allSettled([run('NFL'), run('NBA')])
      return { ok: results.every(result => result.status === 'fulfilled' && result.value.ok), feeds: results.map((result, index) =>
        result.status === 'fulfilled' ? result.value : { ok: false, sport: index === 0 ? 'NFL' : 'NBA', error: 'Provider ingestion failed' }) }
    },
    result => ({ status: result.ok ? 'success' : 'failed', ...(result.ok ? {} : { errors: ['One or more Survivor provider feeds failed'] }) }),
  )
  return NextResponse.json(combined, { status: combined.ok ? 200 : 503 })
}
export const POST = GET
