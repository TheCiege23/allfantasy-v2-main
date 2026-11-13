import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getLiveDraftRecommendation } from '@/lib/bestball/ai/draftAssistant'
import { requireAfSub } from '@/lib/redraft/ai/requireAfSub'
import { normalizeToSupportedSport } from '@/lib/sport-scope'
import { assertLeagueMember } from '@/lib/league/league-access'

export const dynamic = 'force-dynamic'
export const maxDuration = 15

export async function POST(req: NextRequest) {
  const gate = await requireAfSub()
  if (gate instanceof Response) return gate
  const userId = gate

  let body: {
    currentRoster: { playerId: string; name: string; pos: string; team?: string }[]
    availablePlayers: { playerId: string; name: string; pos: string; adp?: number; team?: string }[]
    sport?: string
    variant?: string
    draftSlot?: number
    pickNumber?: number
    leagueId?: string
    contestId?: string
    entryId?: string
  }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const sport = normalizeToSupportedSport(body.sport ?? 'NFL')

  if (body.leagueId) {
    const leagueGate = await assertLeagueMember(body.leagueId, userId)
    if (!leagueGate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: leagueGate.status })
  }
  if (body.entryId) {
    const entry = await prisma.bestBallEntry.findFirst({
      where: {
        id: body.entryId,
        userId,
        ...(body.contestId ? { contestId: body.contestId } : {}),
      },
      select: { id: true },
    })
    if (!entry) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  } else if (body.contestId) {
    const contest = await prisma.bestBallContest.findFirst({
      where: {
        id: body.contestId,
        entries: { some: { userId } },
      },
      select: { id: true },
    })
    if (!contest) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const variant = body.variant ?? 'standard'
  const template = await prisma.bestBallSportTemplate.findUnique({
    where: { sport_variant: { sport, variant: templateVariant(variant) } },
  })
  if (!template) {
    return NextResponse.json({ error: 'Template not found' }, { status: 400 })
  }

  const rec = await getLiveDraftRecommendation(
    body.currentRoster ?? [],
    body.availablePlayers ?? [],
    sport,
    variant,
    body.draftSlot ?? 1,
    body.pickNumber ?? 1,
    template,
  )
  return NextResponse.json({ recommendation: rec })
}

function templateVariant(v: string): string {
  if (v === 'private' || v === 'private_league') return 'private_league'
  return v
}
