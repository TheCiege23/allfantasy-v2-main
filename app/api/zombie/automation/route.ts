import { NextRequest, NextResponse } from 'next/server'
import { requireCronAuth } from '@/app/api/cron/_auth'
import { stagingRehearsalEnabled } from '@/lib/zombie/stagingRehearsalGuard'
import { runZombieAutomationTick } from '@/lib/zombie/zombieAutomation'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

async function run(req: NextRequest) {
  const force =
    req.nextUrl.searchParams?.get('force') === '1' ||
    req.nextUrl.searchParams?.get('force') === 'true'
  const result = await runZombieAutomationTick({ force })
  return NextResponse.json({
    processed: result.leaguesProcessed,
    errors: result.errors,
    skippedIdempotent: result.skippedIdempotent,
    skippedIncomplete: result.skippedIncomplete,
    announcementsPosted: result.announcementsPosted,
  })
}

/** Vercel Cron uses GET; internal jobs may POST with optional `?force=1`. */
export async function GET(req: NextRequest) {
  if (!requireCronAuth(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return run(req)
}

export async function POST(req: NextRequest) {
  if (!requireCronAuth(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const rehearsal = req.nextUrl.searchParams.get('rehearsal')
  if (rehearsal !== null) {
    if (rehearsal !== 'prepare-phone' || !stagingRehearsalEnabled(process.env)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    const body = await req.json().catch(() => null)
    if (!body || Object.keys(body).some(key => key !== 'sport') || !['NFL', 'NBA', 'NHL', 'MLB'].includes(body.sport)) {
      return NextResponse.json({ error: 'One supported sport is required' }, { status: 400 })
    }
    try {
      const { preparePhoneRehearsal } = await import('@/lib/zombie/stagingRehearsal')
      return NextResponse.json({ ok: true, ...await preparePhoneRehearsal(body.sport) })
    } catch {
      console.error('[zombie-rehearsal] fixture preparation failed')
      return NextResponse.json({ ok: false, error: 'fixture_prepare_failed' }, { status: 503 })
    }
  }
  return run(req)
}

