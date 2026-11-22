/**
 * PROMPT 3: Commissioner — repair duplicate rights conflict (audit and flag; resolution manual or via override).
 */

import { canCommissionerAct } from '@/lib/league/commissionerAccess'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { isDevyLeague, appendDevyLifecycleEvent } from '@/lib/devy'

export const dynamic = 'force-dynamic'

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ leagueId: string }> }
) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await ctx.params
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })

  const commissioner = await canCommissionerAct(leagueId, userId, 'league')
  if (!commissioner) return NextResponse.json({ error: 'Commissioner only' }, { status: 403 })

  const isDevy = await isDevyLeague(leagueId)
  if (!isDevy) return NextResponse.json({ error: 'Not a devy dynasty league' }, { status: 404 })

  const rights = await prisma.devyRights.findMany({ where: { leagueId } })
  const byDevy = new Map<string, typeof rights>()
  for (const r of rights) {
    const list = byDevy.get(r.devyPlayerId) ?? []
    list.push(r)
    byDevy.set(r.devyPlayerId, list)
  }
  const duplicates = [...byDevy.entries()].filter(([, list]) => list.length > 1)

  await appendDevyLifecycleEvent({
    leagueId,
    eventType: 'repair_duplicate_rights',
    payload: {
      triggeredBy: userId,
      at: new Date().toISOString(),
      duplicateCount: duplicates.length,
      pairs: duplicates.map(([devyPlayerId, list]) => ({ devyPlayerId, rightsIds: list.map((x) => x.id) })),
    },
  })

  return NextResponse.json({
    ok: true,
    message: 'Duplicate rights scan completed.',
    duplicateCount: duplicates.length,
    pairs: duplicates.map(([devyPlayerId, list]) => ({ devyPlayerId, rightsIds: list.map((x) => x.id) })),
  })
}
