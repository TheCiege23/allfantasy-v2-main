/**
 * GET /api/leagues/[leagueId]/guillotine/imported — the Guilly tab for an IMPORTED league, read from the
 * provider's own weekly scores (lib/guillotine/importedGuillyView.ts). A native Guilly league uses
 * ../summary instead; this answers 404 for it, and for a league that is not Guilly.
 *
 * Read-only and member-gated the same way ../summary is.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { canAccessLeagueDraft } from '@/lib/live-draft-engine/auth'
import { loadImportedGuillyTab } from '@/lib/guillotine/importedGuillyHealthLoad'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, ctx: { params: Promise<{ leagueId: string }> }) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await ctx.params
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })
  if (!(await canAccessLeagueDraft(leagueId, userId))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    const data = await loadImportedGuillyTab(leagueId)
    if (!data) return NextResponse.json({ error: 'Not an imported Guilly league' }, { status: 404 })
    return NextResponse.json(data)
  } catch (e) {
    console.error('[guillotine/imported GET]', e instanceof Error ? e.message : 'unknown error')
    return NextResponse.json({ error: 'Could not load the Guilly standings' }, { status: 500 })
  }
}
