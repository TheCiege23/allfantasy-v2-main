import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { assertCommissioner } from '@/lib/commissioner/permissions'
import { prisma } from '@/lib/prisma'
import { getPlayoffConfigForLeague } from '@/lib/playoff-defaults/PlayoffConfigResolver'

function hasOwn(obj: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key)
}

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

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const league = await (prisma as any).league.findUnique({
    where: { id: params.leagueId },
    select: { settings: true },
  })
  if (!league) return NextResponse.json({ error: 'League not found' }, { status: 404 })

  const settings = (league.settings as Record<string, unknown>) ?? {}
  const currentStructure =
    settings.playoff_structure && typeof settings.playoff_structure === 'object'
      ? (settings.playoff_structure as Record<string, unknown>)
      : {}
  const nextStructure: Record<string, unknown> = { ...currentStructure }
  const nextSettings: Record<string, unknown> = { ...settings }

  const map: Array<[string, string]> = [
    ['playoffTeamCount', 'playoff_team_count'],
    ['playoffWeeks', 'playoff_weeks'],
    ['playoffStartWeek', 'playoff_start_week'],
    ['playoffStartPoint', 'playoff_start_point'],
    ['firstRoundByes', 'first_round_byes'],
    ['matchupLength', 'matchup_length'],
    ['totalRounds', 'total_rounds'],
    ['seedingRules', 'seeding_rules'],
    ['tiebreakerRules', 'tiebreaker_rules'],
    ['byeRules', 'bye_rules'],
    ['reseedBehavior', 'reseed_behavior'],
    ['consolationBracketEnabled', 'consolation_bracket_enabled'],
    ['thirdPlaceGameEnabled', 'third_place_game_enabled'],
    ['toiletBowlEnabled', 'toilet_bowl_enabled'],
    ['championshipLength', 'championship_length'],
    ['consolationPlaysFor', 'consolation_plays_for'],
  ]

  for (const [incoming, target] of map) {
    if (hasOwn(body, incoming)) {
      nextStructure[target] = body[incoming] as unknown
    }
  }

  if (hasOwn(body, 'playoffTeamCount')) {
    nextSettings.playoff_team_count = body.playoffTeamCount as unknown
  }
  if (hasOwn(body, 'standingsTiebreakers')) {
    nextSettings.standings_tiebreakers = body.standingsTiebreakers as unknown
  }
  nextSettings.playoff_structure = nextStructure

  await (prisma as any).league.update({
    where: { id: params.leagueId },
    data: { settings: nextSettings },
  })

  const config = await getPlayoffConfigForLeague(params.leagueId)
  return NextResponse.json(config ?? { ok: true })
}
