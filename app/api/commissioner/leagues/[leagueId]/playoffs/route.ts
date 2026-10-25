import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { assertCommissioner } from '@/lib/commissioner/permissions'
import { prisma } from '@/lib/prisma'
import { getPlayoffConfigForLeague } from '@/lib/playoff-defaults/PlayoffConfigResolver'
import { settingsLockedResponse } from '@/lib/league/settingsLockGuard'
import { executeLeagueSettingsPatch } from '@/lib/league/execute-league-settings-patch'
import { commissionerPlayoffsPatch } from '@/lib/league/commissionerPlayoffsPatch'

export async function GET(req: NextRequest, props: { params: Promise<{ leagueId: string }> }) {
  const params = await props.params
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    await assertCommissioner(params.leagueId, userId)
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const type = req.nextUrl.searchParams?.get('type') || 'settings'
  if (type !== 'settings') {
    return NextResponse.json({ error: 'Unsupported type' }, { status: 400 })
  }

  const config = await getPlayoffConfigForLeague(params.leagueId)
  if (!config) return NextResponse.json({ error: 'League or playoff config not found' }, { status: 404 })
  return NextResponse.json(config)
}

export async function PUT(req: NextRequest, props: { params: Promise<{ leagueId: string }> }) {
  const params = await props.params
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    await assertCommissioner(params.leagueId, userId)
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const locked = await settingsLockedResponse(params.leagueId, 'playoffs')
  if (locked) return locked

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const league = await prisma.league.findUnique({
    where: { id: params.leagueId },
    select: { settings: true, playoffTeams: true, playoffLowerBracket: true },
  })
  if (!league) return NextResponse.json({ error: 'League not found' }, { status: 404 })

  // One implementation: the League Settings save (lib/league/commissionerPlayoffsPatch.ts says why).
  const translated = commissionerPlayoffsPatch(body, league)
  if (!translated.ok) return NextResponse.json({ error: translated.error }, { status: translated.status })
  if (Object.keys(translated.patch).length > 0) {
    const res = await executeLeagueSettingsPatch(userId, { leagueId: params.leagueId, ...translated.patch }, { section: 'playoffs' })
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
      return NextResponse.json({ ...data, error: data.error ?? 'Save failed' }, { status: res.status })
    }
  }

  const config = await getPlayoffConfigForLeague(params.leagueId)
  return NextResponse.json(config ?? { ok: true })
}
