import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-guard'
import { resolveActiveLeagueContext } from '@/lib/shared-services/league-hub/activeLeagueContext'

export const dynamic = 'force-dynamic'

export async function GET(_req: Request, { params }: { params: Promise<{ leagueId: string }> }) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response

  const { leagueId } = await params
  if (!leagueId) {
    return NextResponse.json({ error: 'leagueId is required' }, { status: 400 })
  }

  try {
    const context = await resolveActiveLeagueContext({ leagueId, userId: auth.userId })
    if (!context) {
      return NextResponse.json({ error: 'League not found or not accessible' }, { status: 404 })
    }
    return NextResponse.json(context)
  } catch (error: unknown) {
    console.error('[League Hub Context]', error)
    return NextResponse.json({ error: 'Failed to resolve league context' }, { status: 500 })
  }
}
