import { assertCommissionerAccess } from '@/lib/league/commissionerAccess'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { ensureAICommissionerConfig, toConfigView, updateAICommissionerConfig } from '@/lib/ai-commissioner'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ leagueId: string }> }
) {
  const { leagueId } = await ctx.params
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })

  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    await assertCommissionerAccess(leagueId, userId, 'view')
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const config = await ensureAICommissionerConfig({ leagueId })
  return NextResponse.json(toConfigView(config))
}

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ leagueId: string }> }
) {
  const { leagueId } = await ctx.params
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })

  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    await assertCommissionerAccess(leagueId, userId, 'league')
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = (await req.json().catch(() => ({}))) as Partial<{
    sport: string
    remindersEnabled: boolean
    disputeAnalysisEnabled: boolean
    collusionMonitoringEnabled: boolean
    voteSuggestionEnabled: boolean
    inactivityMonitoringEnabled: boolean
    commissionerNotificationMode: 'off' | 'in_app' | 'chat' | 'both'
  }>

  const updated = await updateAICommissionerConfig(leagueId, body)
  return NextResponse.json(toConfigView(updated))
}
