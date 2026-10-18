import { survivorHostGuard } from '@/lib/survivor/survivorHostGuard'
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { assertLeagueCommissioner, assertLeagueMember } from '@/lib/league/league-access'
import { assignPlayersToTribes, executeMerge, executeTribeSwap, rebalanceTribes } from '@/lib/survivor/tribeEngine'
import { castMergeNameVote, getTribeShuffleView, nameMergedTribe, revealDueTribeSwap } from '@/lib/survivor/tribeSwapService'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { leagueId?: string; action?: string; week?: number; swapType?: string; name?: string }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  if (!body.leagueId) return NextResponse.json({ error: 'leagueId required' }, { status: 400 })

  // Remaining managers vote on the merged tribe's name (when the league uses a manager vote).
  if (body.action === 'merge_name_vote') {
    const member = await assertLeagueMember(body.leagueId, userId)
    if (!member.ok) return NextResponse.json({ error: 'Forbidden' }, { status: member.status })
    const result = await castMergeNameVote(body.leagueId, userId, String(body.name ?? ''))
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 409 })
    return NextResponse.json({ ok: true, named: result.named })
  }

  const gate = await assertLeagueCommissioner(body.leagueId, userId)
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const hostDenied = await survivorHostGuard(body.leagueId, userId)
  if (hostDenied) return hostDenied

  try {
    switch (body.action) {
      case 'assign':
        await assignPlayersToTribes(body.leagueId, 'auto')
        break
      case 'rebalance':
        await rebalanceTribes(body.leagueId)
        break
      case 'swap':
        await executeTribeSwap(body.leagueId, body.week ?? 1, body.swapType ?? 'random_shuffle')
        break
      case 'merge':
        await executeMerge(body.leagueId, body.week ?? 1)
        break
      case 'reveal_swap': {
        const revealed = await revealDueTribeSwap(body.leagueId, { force: true, actorUserId: userId })
        if (!revealed.revealed) return NextResponse.json({ error: 'There is no sealed tribe swap to reveal.' }, { status: 409 })
        break
      }
      case 'name_merge': {
        const named = await nameMergedTribe(body.leagueId, String(body.name ?? ''), userId)
        if (!named.ok) return NextResponse.json({ error: named.error }, { status: 409 })
        break
      }
      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Failed'
    return NextResponse.json({ error: msg }, { status: 400 })
  }

  return NextResponse.json({ ok: true })
}

export async function GET(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const leagueId = req.nextUrl.searchParams?.get('leagueId')?.trim()
  if (!leagueId) return NextResponse.json({ error: 'leagueId required' }, { status: 400 })

  const gate = await assertLeagueMember(leagueId, userId)
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: gate.status })

  // Tribe swap + merge screen. A sealed swap's draw never leaves the server before the reveal.
  if (req.nextUrl.searchParams?.get('view') === 'shuffle') {
    return NextResponse.json({ view: await getTribeShuffleView(leagueId, userId) })
  }

  const tribes = await prisma.survivorTribe.findMany({
    where: { leagueId },
    include: { members: true },
    orderBy: { slotIndex: 'asc' },
  })

  return NextResponse.json({ tribes })
}

