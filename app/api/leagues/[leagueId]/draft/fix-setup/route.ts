/**
 * POST /api/leagues/[leagueId]/draft/fix-setup
 * Commissioner-only: apply default roster/scoring rows for pre-draft checklist.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { assertCommissioner } from '@/lib/commissioner/permissions'
import { ensureLeagueDraftSetupDefaults } from '@/lib/league/ensureLeagueDraftSetupDefaults'

export async function POST(req: NextRequest, ctx: { params: Promise<{ leagueId: string }> }) {
  try {
    const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
    const userId = session?.user?.id
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { leagueId } = await ctx.params
    if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })

    try {
      await assertCommissioner(leagueId, userId)
    } catch {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    let body: { scope?: 'roster' | 'scoring' | 'both' } = {}
    try {
      body = (await req.json()) as typeof body
    } catch {
      body = {}
    }
    const scope = body.scope ?? 'both'

    const result = await ensureLeagueDraftSetupDefaults(leagueId, { scope })
    return NextResponse.json(result)
  } catch (err) {
    console.error('[fix-setup] error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Fix failed' },
      { status: 500 },
    )
  }
}
