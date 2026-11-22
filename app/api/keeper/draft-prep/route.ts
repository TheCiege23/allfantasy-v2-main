import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { assertLeagueMember } from '@/lib/league/league-access'
import { requireCommissionerRole } from '@/lib/league/permissions'
import { getKeeperDraftOrder, prepareKeeperDraft } from '@/lib/keeper/draftIntegration'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const leagueId = req.nextUrl.searchParams?.get('leagueId')?.trim()
  const seasonId = req.nextUrl.searchParams?.get('seasonId')?.trim()
  if (!leagueId || !seasonId) {
    return NextResponse.json({ error: 'leagueId and seasonId required' }, { status: 400 })
  }

  const gate = await assertLeagueMember(leagueId, userId)
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: gate.status })

  const prep = await prepareKeeperDraft(leagueId, seasonId)
  const order = await getKeeperDraftOrder(leagueId, seasonId)
  return NextResponse.json({ prep, order })
}

export async function POST(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { leagueId?: string; seasonId?: string }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const leagueId = body.leagueId?.trim()
  const seasonId = body.seasonId?.trim()
  if (!leagueId || !seasonId) {
    return NextResponse.json({ error: 'leagueId and seasonId required' }, { status: 400 })
  }

  try {
    await requireCommissionerRole(leagueId, userId, 'rosters')
  } catch (err) {
    if (err instanceof Response) return err
    throw err
  }

  const prep = await prepareKeeperDraft(leagueId, seasonId)
  return NextResponse.json({ prep })
}

