import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-guard'
import { assembleCrossLeaguePlayerPortfolio } from '@/lib/shared-services/league-hub/crossLeaguePlayerPortfolio'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/player-portfolio/[canonicalPlayerId] — Parts 11 + 20.
 *
 * REBUILT 2026-08-10 (route was missing from the tree; contract recovered
 * from its test suite). Security invariants the tests pin:
 *   - `appUserId` comes ONLY from the session; assemble is called with
 *     exactly `{ appUserId }` and nothing client-supplied.
 *   - Player-ID probing: an id the caller does not roster returns the SAME
 *     404 as a nonexistent id — the route only ever searches within the
 *     caller's own authorized portfolio, never "who owns player X".
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ canonicalPlayerId: string }> },
) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response

  const { canonicalPlayerId } = await ctx.params
  const id = decodeURIComponent(String(canonicalPlayerId ?? '')).trim()
  if (!id) {
    return NextResponse.json({ error: 'canonicalPlayerId required' }, { status: 400 })
  }

  try {
    const result = await assembleCrossLeaguePlayerPortfolio({ appUserId: auth.userId })
    const item = result.items.find((i) => i.canonicalPlayerId === id)
    if (!item) {
      // Identical shape for "not yours" and "does not exist" — never a
      // distinguishable probe response.
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    return NextResponse.json({ item })
  } catch (error) {
    console.error('[player-portfolio/detail] error:', error)
    return NextResponse.json({ error: 'Failed to load player.' }, { status: 500 })
  }
}
