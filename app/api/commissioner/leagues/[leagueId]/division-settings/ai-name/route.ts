/**
 * POST: AI-generate division/tribe names.
 * Commissioner only. Returns an array of creative names for the given count.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { isOwnerOrLeagueCommissioner } from '@/lib/commissioner/leagueCommissionerAccount'

export const dynamic = 'force-dynamic'

// Curated name pools — no AI API call needed, instant and deterministic
const DIVISION_NAME_POOLS = [
  // Sports-themed
  ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel'],
  ['Thunder', 'Lightning', 'Blaze', 'Frost', 'Storm', 'Inferno', 'Cyclone', 'Avalanche'],
  ['East', 'West', 'North', 'South', 'Central', 'Pacific', 'Atlantic', 'Mountain'],
  ['Iron', 'Steel', 'Bronze', 'Gold', 'Silver', 'Platinum', 'Diamond', 'Titanium'],
  ['Lions', 'Eagles', 'Wolves', 'Bears', 'Hawks', 'Sharks', 'Panthers', 'Falcons'],
]

const TRIBE_NAME_POOLS = [
  ['Solana', 'Makani', 'Tembo', 'Nalu', 'Reva', 'Kaimana', 'Tala', 'Hoku'],
  ['Fire', 'Water', 'Earth', 'Wind', 'Spirit', 'Shadow', 'Light', 'Storm'],
  ['Vanguard', 'Horizon', 'Zenith', 'Eclipse', 'Apex', 'Titan', 'Phoenix', 'Odyssey'],
  ['Outcast', 'Rebel', 'Nomad', 'Rogue', 'Pioneer', 'Voyager', 'Maverick', 'Trailblazer'],
  ['Aloha', 'Ohana', 'Mana', 'Kai', 'Pono', 'Lani', 'Mahina', 'Noe'],
]

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ leagueId: string }> }
) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { leagueId } = await params
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { userId: true, leagueVariant: true, settings: true },
  })
  if (!league) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!(await isOwnerOrLeagueCommissioner(league, leagueId, session.user.id))) return NextResponse.json({ error: 'Commissioner only' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const count = typeof body.count === 'number' ? Math.min(8, Math.max(1, body.count)) : 2

  const settings = (league.settings as Record<string, unknown>) ?? {}
  const isSurvivor = (league.leagueVariant ?? '').toLowerCase().includes('survivor')
    || (settings.league_type as string ?? '').toLowerCase().includes('survivor')
    || (settings.leagueType as string ?? '').toLowerCase().includes('survivor')

  const pool = isSurvivor ? TRIBE_NAME_POOLS : DIVISION_NAME_POOLS
  // Pick a random pool and take the first `count` names
  const poolIndex = Math.floor(Math.random() * pool.length)
  const selectedPool = pool[poolIndex]
  const names = selectedPool.slice(0, count)

  return NextResponse.json({ names, isSurvivor })
}
