import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import {
  archiveLeague,
  manualRunAutomation,
  runWaiversNow,
  setEmergencyPause,
  setLeagueLocked,
} from '@/server/services/commissionerService'

export const dynamic = 'force-dynamic'

type Body = {
  action:
    | 'lock'
    | 'unlock'
    | 'emergency_pause_on'
    | 'emergency_pause_off'
    | 'run_waivers'
    | 'run_automation'
    | 'archive'
  forceAutomation?: boolean
  automationWeek?: number | null
  automationSeason?: number
}

export async function POST(
  req: NextRequest,
  { params }: { params: { leagueId: string } },
) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: Body
  try {
    body = (await req.json()) as Body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const leagueId = params.leagueId

  try {
    switch (body.action) {
      case 'lock':
        return NextResponse.json({ ok: true, league: await setLeagueLocked(leagueId, userId, true) })
      case 'unlock':
        return NextResponse.json({ ok: true, league: await setLeagueLocked(leagueId, userId, false) })
      case 'emergency_pause_on':
        return NextResponse.json({ ok: true, league: await setEmergencyPause(leagueId, userId, true) })
      case 'emergency_pause_off':
        return NextResponse.json({ ok: true, league: await setEmergencyPause(leagueId, userId, false) })
      case 'run_waivers':
        return NextResponse.json({ ok: true, results: await runWaiversNow(leagueId, userId) })
      case 'run_automation':
        return NextResponse.json({
          ok: true,
          out: await manualRunAutomation(leagueId, userId, {
            season: body.automationSeason,
            week: body.automationWeek,
            force: Boolean(body.forceAutomation),
          }),
        })
      case 'archive':
        return NextResponse.json({ ok: true, league: await archiveLeague(leagueId, userId) })
      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
    }
  } catch (e) {
    const err = e as Error & { status?: number }
    const status = typeof err.status === 'number' ? err.status : 500
    return NextResponse.json({ error: err.message || 'Server error' }, { status })
  }
}
