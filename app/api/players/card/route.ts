/**
 * GET: a player card's bio (age, height, weight, experience, college) and latest news, from Postgres
 * only (lib/players/playerCardBio.ts). Query: sport, playerId, name, position, team. Public player
 * facts; signed-in users only, like the rest of the draft room.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { loadPlayerCard } from '@/lib/players/playerCardBio'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const q = req.nextUrl.searchParams
  const sport = (q.get('sport') ?? '').trim()
  const name = (q.get('name') ?? '').trim()
  const playerId = (q.get('playerId') ?? '').trim()
  if (!sport || (!name && !playerId)) return NextResponse.json({ error: 'sport and a player are required' }, { status: 400 })

  try {
    const card = await loadPlayerCard({ sport, playerId, name, position: q.get('position'), team: q.get('team') })
    return NextResponse.json(card, { headers: { 'Cache-Control': 'private, max-age=300' } })
  } catch {
    return NextResponse.json({ error: 'Could not read this player' }, { status: 500 })
  }
}
