import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-guard'
import { getLeaguePortfolioForUser } from '@/lib/shared-services/league-hub/LeaguePortfolioService'

export const dynamic = 'force-dynamic'

export async function GET() {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response

  try {
    const portfolio = await getLeaguePortfolioForUser(auth.userId)
    return NextResponse.json(portfolio)
  } catch (error: unknown) {
    console.error('[League Hub Portfolio]', error)
    return NextResponse.json({ error: 'Failed to load league portfolio' }, { status: 500 })
  }
}
