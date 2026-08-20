import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getLeagueContext } from '@/lib/league-context/leagueContextService'
import { getSeasonBoard, type MarketPlayer } from '@/lib/sports-data/sleeperMarketService'

export const dynamic = 'force-dynamic'

/**
 * Live roster (draft-aware): the viewer's CURRENT roster straight from
 * Sleeper, merged with in-progress draft picks — so during a redraft's live
 * draft the roster reflects every pick the moment it's made, and dynasty
 * rosters show returning players plus fresh rookies (rookie-flagged).
 *
 * Starters are slotted greedily against the league's REAL roster shape (IDP
 * and superflex slots included). Everything is labeled by source: `live` =
 * roster feed, `drafted` = a pick from the in-progress draft not yet merged
 * into the roster feed.
 */

const SLEEPER = 'https://api.sleeper.app/v1'

async function j<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${SLEEPER}${path}`, { cache: 'no-store' })
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  }
}

type WireRoster = { roster_id: number; owner_id: string | null; players?: string[] | null; starters?: string[] | null }
type WireDraft = { draft_id: string; status: string }
type WireDraftPick = { player_id?: string | null; picked_by?: string | null; round: number; pick_no: number }

const SLOT_ACCEPTS: Record<string, string[]> = {
  QB: ['QB'], RB: ['RB'], WR: ['WR'], TE: ['TE'], K: ['K'], DEF: ['DEF'],
  DL: ['DL', 'DE', 'DT'], LB: ['LB', 'ILB', 'OLB'], DB: ['DB', 'CB', 'S', 'FS', 'SS'],
  FLEX: ['RB', 'WR', 'TE'], WRRB_FLEX: ['RB', 'WR'], REC_FLEX: ['WR', 'TE'],
  SUPER_FLEX: ['QB', 'RB', 'WR', 'TE'],
  IDP_FLEX: ['DL', 'DE', 'DT', 'LB', 'ILB', 'OLB', 'DB', 'CB', 'S', 'FS', 'SS'],
}

export type LiveRosterPlayer = {
  playerId: string
  name: string
  position: string | null
  team: string | null
  rookie: boolean
  source: 'live' | 'drafted'
  draftedAt: string | null
}

export async function GET(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const leagueId = req.nextUrl.searchParams?.get('leagueId')?.trim()
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })

  const league = await prisma.league.findFirst({
    where: {
      id: leagueId,
      OR: [{ userId: userId }, { teams: { some: { claimedByUserId: userId } } }],
    },
    select: { platform: true, platformLeagueId: true },
  })
  if (!league) return NextResponse.json({ error: 'League not found' }, { status: 404 })
  if (league.platform !== 'sleeper' || !league.platformLeagueId) {
    return NextResponse.json({ supported: false as const, platform: league.platform })
  }
  const sid = league.platformLeagueId

  const profile = await prisma.userProfile
    .findUnique({ where: { userId }, select: { sleeperUserId: true } })
    .catch(() => null)
  if (!profile?.sleeperUserId) {
    return NextResponse.json({ supported: true as const, linked: false as const })
  }

  const context = await getLeagueContext(sid)
  if (!context) {
    return NextResponse.json(
      { supported: true as const, linked: true as const, error: 'League settings unavailable' },
      { status: 502 },
    )
  }

  const [rosters, drafts, board] = await Promise.all([
    j<WireRoster[]>(`/league/${sid}/rosters`),
    j<WireDraft[]>(`/league/${sid}/drafts`),
    getSeasonBoard(context.season),
  ])
  if (!rosters) {
    return NextResponse.json(
      { supported: true as const, linked: true as const, error: 'Roster feed unavailable' },
      { status: 502 },
    )
  }
  const myRoster = rosters.find((r) => r.owner_id === profile.sleeperUserId) ?? null
  if (!myRoster) {
    return NextResponse.json({ supported: true as const, linked: true as const, inLeague: false as const })
  }

  // In-progress draft picks by the viewer (not yet merged into the roster feed).
  const liveDraft = (drafts ?? []).find((d) => d.status === 'drafting' || d.status === 'paused') ?? null
  const draftLive = Boolean(liveDraft && liveDraft.status === 'drafting')
  const draftedIds = new Map<string, string>() // playerId → pick label
  if (liveDraft) {
    const picks = await j<WireDraftPick[]>(`/draft/${liveDraft.draft_id}/picks`)
    for (const p of picks ?? []) {
      if (p.picked_by === profile.sleeperUserId && p.player_id) {
        draftedIds.set(p.player_id, `pick ${p.round}.${String(p.pick_no).padStart(2, '0')}`)
      }
    }
  }

  const rosterIds = (myRoster.players ?? []).filter((p) => p && p !== '0')
  const allIds = [...new Set([...rosterIds, ...draftedIds.keys()])]
  const meta = (id: string): MarketPlayer | undefined => board?.players[id]
  const players: LiveRosterPlayer[] = allIds.map((id) => {
    const m = meta(id)
    return {
      playerId: id,
      name: m?.name ?? `Player ${id}`,
      position: m?.position ?? null,
      team: m?.team ?? null,
      rookie: m?.yearsExp === 0,
      source: rosterIds.includes(id) ? 'live' : 'drafted',
      draftedAt: draftedIds.get(id) ?? null,
    }
  })

  // Greedy starter slotting against the league's real shape (best names first
  // by simple position-relevance; order players by rookie last within position
  // for stability, but slotting uses list order — sort by name for determinism).
  const bySlot: { slot: string; player: LiveRosterPlayer | null }[] = []
  const remaining = [...players].sort((a, b) => a.name.localeCompare(b.name))
  const slotEntries: [string, number][] = Object.entries(context.roster.starters)
  const dedicated = slotEntries.filter(([label]) => (SLOT_ACCEPTS[label] ?? []).length <= 5)
  const flexes = slotEntries.filter(([label]) => !dedicated.some(([d]) => d === label))
  for (const [label, count] of [...dedicated, ...flexes]) {
    for (let i = 0; i < count; i += 1) {
      const idx = remaining.findIndex((p) => (SLOT_ACCEPTS[label] ?? []).includes(p.position ?? ''))
      if (idx >= 0) {
        bySlot.push({ slot: label, player: remaining.splice(idx, 1)[0] })
      } else {
        bySlot.push({ slot: label, player: null })
      }
    }
  }

  return NextResponse.json({
    supported: true as const,
    linked: true as const,
    inLeague: true as const,
    fetchedAt: new Date().toISOString(),
    dynasty: context.variant.dynasty || context.variant.keeper,
    draftLive,
    draftedCount: draftedIds.size,
    starters: bySlot,
    bench: remaining,
    totalPlayers: players.length,
    note: board
      ? null
      : 'Player metadata board didn’t sync — names may show as ids until it refreshes.',
  })
}
