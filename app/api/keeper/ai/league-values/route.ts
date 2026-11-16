import { canCommissionerAct } from '@/lib/league/commissionerAccess'
import { NextRequest, NextResponse } from 'next/server'
import { analyzeLeagueKeeperValues } from '@/lib/keeper/ai/keeperValueAnalyzer'
import { requireAfSub } from '@/lib/redraft/ai/requireAfSub'
import { getLeagueRole } from '@/lib/league/permissions'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: NextRequest) {
  const gate = await requireAfSub()
  if (gate instanceof Response) return gate

  let body: { leagueId?: string; outgoingSeasonId?: string }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!body.leagueId || !body.outgoingSeasonId) {
    return NextResponse.json({ error: 'leagueId and outgoingSeasonId required' }, { status: 400 })
  }

  const role = await getLeagueRole(body.leagueId, gate)
  if (!(await canCommissionerAct(body.leagueId, gate, 'rosters'))) {
    return NextResponse.json({ error: 'Commissioner only' }, { status: 403 })
  }

  const out = await analyzeLeagueKeeperValues(body.leagueId, body.outgoingSeasonId)
  return NextResponse.json(out)
}
