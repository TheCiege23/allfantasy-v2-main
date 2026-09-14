import { NextResponse, type NextRequest } from 'next/server'
import { requireCronAuth } from '@/app/api/cron/_auth'
import { runActiveSyncHeartbeat } from '@/lib/import-os/collector/runActiveSyncHeartbeat'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function GET(request: NextRequest) {
  if (!requireCronAuth(request, 'CRON_SECRET')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(request.url)
  const rawLimit = Number(url.searchParams.get('limit'))
  const limitPerProvider = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.floor(rawLimit), 50) : 4

  try {
    return NextResponse.json({ ok: true, ...(await runActiveSyncHeartbeat(limitPerProvider)) })
  } catch (error) {
    return NextResponse.json(
      { ok: false, executed: false, error: error instanceof Error ? error.message : 'active sync failed' },
      { status: 500 },
    )
  }
}
