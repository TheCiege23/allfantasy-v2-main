import { NextRequest, NextResponse } from 'next/server'
import { getGuillotineDraftRecommendation, type DraftPlayer, type DraftedPlayer } from '@/lib/guillotine/ai/draftAssistant'
import { requireAfSub } from '@/lib/redraft/ai/requireAfSub'

export const dynamic = 'force-dynamic'
export const maxDuration = 15

export async function POST(req: NextRequest) {
  const gate = await requireAfSub()
  if (gate instanceof Response) return gate

  let body: {
    currentRoster: DraftedPlayer[]
    /** Optional adp/team/byeWeek/projectedPoints per player sharpen the engine's ranking. */
    availablePlayers: DraftPlayer[]
    sport?: string
    draftSlot?: number
    pickNumber?: number
    leagueSize?: number
  }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const rec = await getGuillotineDraftRecommendation(
    body.currentRoster ?? [],
    body.availablePlayers ?? [],
    body.sport ?? 'NFL',
    body.draftSlot ?? 1,
    body.pickNumber ?? 1,
    body.leagueSize ?? 12,
  )
  return NextResponse.json({ recommendation: rec })
}
