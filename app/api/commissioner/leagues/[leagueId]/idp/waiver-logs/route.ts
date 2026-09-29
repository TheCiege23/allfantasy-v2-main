/**
 * GET: Waiver/claim logs for the league involving defenders (IDP).
 * Commissioner only. Resolves add/drop player IDs to position when possible (SportsPlayer).
 */

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { assertCommissioner } from '@/lib/commissioner/permissions'
import { isIdpLeague } from '@/lib/idp'
import { indexBySleeperId, sleeperIdWhere } from '@/lib/player-identity/externalIdNamespace'
import { isIdpPosition } from '@/lib/idp-kicker-values'
import { prisma } from '@/lib/prisma'

const IDP_POSITIONS = new Set(['DE', 'DT', 'LB', 'CB', 'S', 'SS', 'FS', 'DL', 'DB'])

function isIdpPositionString(pos: string | null): boolean {
  if (!pos) return false
  return IDP_POSITIONS.has(pos.toUpperCase()) || isIdpPosition(pos)
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ leagueId: string }> }
) {
  const { leagueId } = await params
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    await assertCommissioner(leagueId, session.user.id)
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const isIdp = await isIdpLeague(leagueId)
  if (!isIdp) return NextResponse.json({ error: 'Not an IDP league' }, { status: 404 })

  const { searchParams } = new URL(req.url)
  const limit = Math.min(Number(searchParams?.get('limit')) || 50, 100)

  const [claims, transactions] = await Promise.all([
    prisma.waiverClaim.findMany({
      where: { leagueId },
      orderBy: { createdAt: 'desc' },
      take: limit * 2,
      select: {
        id: true,
        rosterId: true,
        addPlayerId: true,
        dropPlayerId: true,
        status: true,
        processedAt: true,
        createdAt: true,
      },
    }),
    prisma.waiverTransaction.findMany({
      where: { leagueId },
      orderBy: { processedAt: 'desc' },
      take: limit * 2,
      select: {
        id: true,
        rosterId: true,
        addPlayerId: true,
        dropPlayerId: true,
        processedAt: true,
      },
    }),
  ])

  const allPlayerIds = new Set<string>()
  for (const c of claims) {
    allPlayerIds.add(c.addPlayerId)
    if (c.dropPlayerId) allPlayerIds.add(c.dropPlayerId)
  }
  for (const t of transactions) {
    allPlayerIds.add(t.addPlayerId)
    if (t.dropPlayerId) allPlayerIds.add(t.dropPlayerId)
  }
  const playerPositions = new Map<string, string>()
  const idList = Array.from(allPlayerIds)
  if (idList.length > 0) {
    /*
     * 🛑 By Sleeper id only — never a bare id against `externalId`, where Rolling Insights keeps its
     * own numbers: an RI defensive back sharing a Sleeper receiver's number would put that receiver's
     * claim in this IDP log (and hide a real defender's). externalIdNamespace.ts.
     */
    const players = await prisma.sportsPlayer.findMany({
      where: sleeperIdWhere(idList, 'NFL'),
      select: { sleeperId: true, source: true, position: true },
    })
    for (const [sleeperId, p] of indexBySleeperId(players)) {
      playerPositions.set(sleeperId, p.position ?? '')
    }
  }

  const withDefender = (addId: string, dropId: string | null) =>
    isIdpPositionString(playerPositions.get(addId) ?? null) || isIdpPositionString(dropId ? playerPositions.get(dropId) ?? null : null)

  const claimLogs = claims
    .filter((c) => withDefender(c.addPlayerId, c.dropPlayerId))
    .slice(0, limit)
    .map((c) => ({
      id: c.id,
      rosterId: c.rosterId,
      addPlayerId: c.addPlayerId,
      dropPlayerId: c.dropPlayerId,
      addPosition: playerPositions.get(c.addPlayerId) ?? null,
      dropPosition: c.dropPlayerId ? playerPositions.get(c.dropPlayerId) ?? null : null,
      status: c.status,
      processedAt: c.processedAt?.toISOString() ?? null,
      createdAt: c.createdAt.toISOString(),
    }))
  const transactionLogs = transactions
    .filter((t) => withDefender(t.addPlayerId, t.dropPlayerId))
    .slice(0, limit)
    .map((t) => ({
      id: t.id,
      rosterId: t.rosterId,
      addPlayerId: t.addPlayerId,
      dropPlayerId: t.dropPlayerId,
      addPosition: playerPositions.get(t.addPlayerId) ?? null,
      dropPosition: t.dropPlayerId ? playerPositions.get(t.dropPlayerId) ?? null : null,
      processedAt: t.processedAt.toISOString(),
    }))

  return NextResponse.json({
    claimsInvolvingDefenders: claimLogs,
    transactionsInvolvingDefenders: transactionLogs,
  })
}
