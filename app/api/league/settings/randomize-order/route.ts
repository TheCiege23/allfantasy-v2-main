import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { Prisma } from '@prisma/client'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { requireCommissionerRole } from '@/lib/league/permissions'
import { syncDraftSessionFromLeagueSettings } from '@/lib/league/league-settings-draft-sync'
import { CURRENT_DRAFT_SESSION_ORDER } from '@/lib/draft-room/currentDraftSession'

export const dynamic = 'force-dynamic'

function fisherYates<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j]!, a[i]!]
  }
  return a
}

export async function POST(req: NextRequest) {
  try {
    const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
    const userId = session?.user?.id
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    let body: { leagueId?: string; count?: number }
    try {
      body = (await req.json()) as { leagueId?: string; count?: number }
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }

    const leagueId = typeof body.leagueId === 'string' ? body.leagueId.trim() : ''
    const count = Number(body.count)
    if (!leagueId) {
      return NextResponse.json({ error: 'leagueId required' }, { status: 400 })
    }
    if (!Number.isFinite(count) || count < 1 || count > 50) {
      return NextResponse.json({ error: 'count must be 1–50' }, { status: 400 })
    }

    await requireCommissionerRole(leagueId, userId)

    const league = await prisma.league.findFirst({
      where: { id: leagueId },
      include: { teams: { orderBy: { externalId: 'asc' } } },
    })
    if (!league) {
      return NextResponse.json({ error: 'League not found' }, { status: 404 })
    }

    // A reshuffle is a pre-draft action. It used to check neither the lock nor the draft's
    // status, so a live draft's order could be reshuffled under the managers on the clock.
    const [lockRow, currentDraft] = await Promise.all([
      prisma.leagueSettings.findUnique({ where: { leagueId }, select: { draftOrderLocked: true } }),
      prisma.draftSession.findFirst({
        where: { leagueId },
        orderBy: CURRENT_DRAFT_SESSION_ORDER,
        select: { status: true },
      }),
    ])
    if (lockRow?.draftOrderLocked) {
      return NextResponse.json({ error: 'The draft order is locked. Unlock it to randomize.' }, { status: 409 })
    }
    if (currentDraft && !['pre_draft', 'configuring', 'configured'].includes(currentDraft.status)) {
      return NextResponse.json({ error: 'The draft has already started; its order can no longer change.' }, { status: 409 })
    }

    let order = [...league.teams]
    for (let i = 0; i < count; i++) {
      order = fisherYates(order)
    }

    const slots = order.map((t, idx) => ({
      slot: idx + 1,
      ownerId: t.id,
      ownerName: t.teamName?.trim() || t.ownerName?.trim() || 'Team',
      avatarUrl: t.avatarUrl ?? null,
    }))

    const existing = await prisma.leagueSettings.findUnique({ where: { leagueId } })
    let history: unknown[] = []
    if (existing?.randomizeHistory != null) {
      const h = existing.randomizeHistory
      history = Array.isArray(h) ? [...h] : []
    }
    history.push({
      count,
      performedAt: new Date().toISOString(),
      performedBy: userId,
    })

    const updated = await prisma.leagueSettings.upsert({
      where: { leagueId },
      create: {
        leagueId,
        draftOrderMethod: 'randomized',
        draftOrderSlots: slots as unknown as Prisma.InputJsonValue,
        randomizeHistory: history as unknown as Prisma.InputJsonValue,
        updatedBy: userId,
      },
      update: {
        draftOrderMethod: 'randomized',
        draftOrderSlots: slots as unknown as Prisma.InputJsonValue,
        randomizeHistory: history as unknown as Prisma.InputJsonValue,
        updatedBy: userId,
      },
    })

    try {
      await syncDraftSessionFromLeagueSettings(
        leagueId,
        updated,
        league.leagueSize ?? league.teams.length,
        new Set(['draftOrderSlots']),
      )
    } catch (e) {
      console.warn('[randomize-order] syncDraftSessionFromLeagueSettings', e)
    }

    return NextResponse.json({
      slots,
      history: updated.randomizeHistory,
      settings: {
        ...updated,
        draftDateUtc: updated.draftDateUtc?.toISOString() ?? null,
        updatedAt: updated.updatedAt.toISOString(),
      },
    })
  } catch (err) {
    if (err instanceof Response) return err
    console.error('[randomize-order]', err)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
