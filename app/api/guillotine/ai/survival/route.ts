import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { generateSurvivalAnalysis } from '@/lib/guillotine/ai/survivalAssistant'
import { findViewerRosterId } from '@/lib/guillotine/guillotineCurrentWeek'
import { canAccessLeagueDraft } from '@/lib/live-draft-engine/auth'
import { requireAfSub } from '@/lib/redraft/ai/requireAfSub'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

/**
 * A team's survival analysis for the week being played (lib/guillotine/ai/survivalAnalysis.ts).
 *
 * Body: `{ seasonId, scoringPeriod, rosterId? }`. `rosterId` defaults to the viewer's own team. Any team in the
 * league may be asked about: every member already sees every team's odds on the Chop page.
 *
 * 🛑 THE LEAGUE CHECK IS NEW. Before, any paying user could pass any season and roster id and get an answer
 * (a fixed number, so nothing leaked). Now the answer is real standings, so the asker must be in the league.
 */
export async function POST(req: NextRequest) {
  const gate = await requireAfSub()
  if (gate instanceof Response) return gate
  const userId = gate

  let body: { rosterId?: unknown; seasonId?: unknown; scoringPeriod?: unknown }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  if (typeof body.seasonId !== 'string' || !body.seasonId || !Number.isInteger(body.scoringPeriod)) {
    return NextResponse.json({ error: 'seasonId and scoringPeriod required' }, { status: 400 })
  }

  const season = await prisma.guillotineSeason.findFirst({ where: { id: body.seasonId }, select: { leagueId: true } })
  // Not found and not yours read the same, so a season id cannot be probed.
  if (!season || !(await canAccessLeagueDraft(season.leagueId, userId).catch(() => false))) {
    return NextResponse.json({ error: 'Season not found' }, { status: 404 })
  }
  const rosterId = typeof body.rosterId === 'string' && body.rosterId ? body.rosterId : await findViewerRosterId(season.leagueId, userId).catch(() => null)
  if (!rosterId) return NextResponse.json({ error: 'You have no team in this league; send rosterId.' }, { status: 400 })

  const result = await generateSurvivalAnalysis({ leagueId: season.leagueId, seasonId: body.seasonId, rosterId, scoringPeriod: body.scoringPeriod as number })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ analysis: result.analysis })
}
