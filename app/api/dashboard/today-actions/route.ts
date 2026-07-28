import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { runTodayActions } from '@/lib/today-actions-engine'
import { enrichLineupActionsWithLinks } from '@/lib/league-links/enrichDecisionOsActions'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await runTodayActions(userId)
    // Decision OS deep links — resolved SERVER-SIDE from the canonical League row (never a cached/provider
    // URL, never a URL carried by the item). DB-first: no provider fetch on this response path.
    body.lineup.actions = await enrichLineupActionsWithLinks(body.lineup.actions)
    return NextResponse.json(body)
  } catch (err) {
    console.error('[today-actions] runTodayActions failed', err)
    const detail = err instanceof Error ? err.message : 'unknown'
    // Return 503 + structured error so the client can surface "Today Actions temporarily unavailable"
    // without defaulting to a misleading "All clear" zero-state.
    return NextResponse.json(
      {
        error: 'Today Actions pipeline failed',
        detail,
        degraded: true,
      },
      { status: 503 },
    )
  }
}
