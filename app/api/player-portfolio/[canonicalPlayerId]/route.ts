/**
 * Cross-League Player Intelligence phase — Part 11, the player detail API.
 *
 * Never resolves `canonicalPlayerId` independently — that would let a
 * probed/guessed id reveal whether the authenticated user rosters some
 * arbitrary player, or worse, look the player up across ALL users. Instead
 * this route calls the same authorized, user-scoped coordinator as the list
 * route and only ever searches WITHIN the caller's own already-derived
 * portfolio. A player the caller doesn't roster in any league returns the
 * same 404 as a canonical id that doesn't exist at all — never a
 * distinguishable "you don't have this player" response.
 */
import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-guard'
import { assembleCrossLeaguePlayerPortfolio } from '@/lib/shared-services/league-hub/crossLeaguePlayerPortfolio'

export const dynamic = 'force-dynamic'

export async function GET(req: Request, { params }: { params: Promise<{ canonicalPlayerId: string }> }) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response

  const { canonicalPlayerId } = await params
  if (!canonicalPlayerId) {
    return NextResponse.json({ error: 'canonicalPlayerId is required' }, { status: 400 })
  }

  try {
    const result = await assembleCrossLeaguePlayerPortfolio({ appUserId: auth.userId })
    const item = result.items.find((i) => i.canonicalPlayerId === canonicalPlayerId)

    if (!item) {
      return NextResponse.json({ error: 'Player not found' }, { status: 404 })
    }

    return NextResponse.json({ item, generatedAt: new Date().toISOString() })
  } catch (error: unknown) {
    console.error('[Player Portfolio Detail]', error)
    return NextResponse.json({ error: 'Failed to load player detail' }, { status: 500 })
  }
}
