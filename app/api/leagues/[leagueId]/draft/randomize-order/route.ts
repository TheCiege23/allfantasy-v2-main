/**
 * POST /api/leagues/[leagueId]/draft/randomize-order
 * Body: { times?: number }  — 1..100, AF Commissioner only; everyone else gets one shuffle.
 *
 * Shuffles the current teams `times` times (Fisher–Yates each pass), saves the final order to
 * `LeagueSettings.draftOrderSlots` (+ `randomizeHistory`), pushes it onto a not-yet-started draft
 * session, and posts the run into league chat so every manager can see how the order was set.
 *
 * Commissioner only. Refused when the order is locked or the draft has started — same guards as
 * `/api/league/settings/randomize-order`.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import type { Prisma } from '@prisma/client'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { assertCommissioner } from '@/lib/commissioner/permissions'
import { isSeasonTournamentDraft, SEASON_DRAFT_MUTATION_BLOCKED } from '@/lib/tournament/seasonDraftMutationGate'
import { CURRENT_TEAMS } from '@/lib/leagues/leagueTeamLifecycle'
import { CURRENT_DRAFT_SESSION_ORDER } from '@/lib/draft-room/currentDraftSession'
import { syncDraftSessionFromLeagueSettings } from '@/lib/league/league-settings-draft-sync'
import { EntitlementResolver } from '@/lib/subscription/EntitlementResolver'
import { createLeagueChatMessage } from '@/lib/league-chat/LeagueChatMessageService'
import { buildRandomizeChatMessage, clampRandomizeTimes, shuffleTimes } from '@/lib/draft/draftSettingsPolicy'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, ctx: { params: Promise<{ leagueId: string }> }) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await ctx.params
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })

  try {
    await assertCommissioner(leagueId, userId)
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (await isSeasonTournamentDraft(leagueId)) {
    return NextResponse.json({ error: SEASON_DRAFT_MUTATION_BLOCKED, code: 'TOURNAMENT_RULES_FROZEN' }, { status: 409 })
  }

  const body = (await req.json().catch(() => ({}))) as { times?: unknown }
  const entitlement = await new EntitlementResolver()
    .resolveForUser(userId, 'commissioner_ai_tools')
    .catch(() => ({ hasAccess: false }))
  const hasSub = Boolean(entitlement.hasAccess)
  const times = clampRandomizeTimes(body.times, hasSub)
  if (times == null) {
    return NextResponse.json({ error: 'Randomize count must be a whole number from 1 to 100.' }, { status: 400 })
  }

  try {
    const [league, lockRow, currentDraft, teams] = await Promise.all([
      prisma.league.findUnique({ where: { id: leagueId }, select: { leagueSize: true } }),
      prisma.leagueSettings.findUnique({ where: { leagueId }, select: { draftOrderLocked: true, randomizeHistory: true } }),
      prisma.draftSession.findFirst({ where: { leagueId }, orderBy: CURRENT_DRAFT_SESSION_ORDER, select: { status: true } }),
      // A departed franchise is not dealt a draft slot.
      prisma.leagueTeam.findMany({
        where: { leagueId, ...CURRENT_TEAMS },
        select: { id: true, teamName: true, ownerName: true, avatarUrl: true },
        orderBy: { externalId: 'asc' },
      }),
    ])
    if (!league) return NextResponse.json({ error: 'League not found' }, { status: 404 })
    if (lockRow?.draftOrderLocked) {
      return NextResponse.json({ error: 'The draft order is locked. Unlock it to randomize.' }, { status: 409 })
    }
    if (currentDraft && !['pre_draft', 'configuring', 'configured'].includes(currentDraft.status)) {
      return NextResponse.json({ error: 'The draft has already started; its order can no longer change.' }, { status: 409 })
    }
    if (teams.length === 0) return NextResponse.json({ error: 'No teams found to randomize' }, { status: 400 })

    const order = shuffleTimes(teams, times)
    const nameOf = (t: (typeof teams)[number], i: number) => t.teamName?.trim() || t.ownerName?.trim() || `Team ${i + 1}`
    const slots = order.map((t, i) => ({ slot: i + 1, ownerId: t.id, ownerName: nameOf(t, i), avatarUrl: t.avatarUrl ?? null }))

    const history = Array.isArray(lockRow?.randomizeHistory) ? [...(lockRow!.randomizeHistory as unknown[])] : []
    history.push({ count: times, performedAt: new Date().toISOString(), performedBy: userId, source: 'draft_settings' })

    const updated = await prisma.leagueSettings.upsert({
      where: { leagueId },
      create: {
        leagueId,
        draftOrderMethod: 'randomized',
        randomizeCount: times,
        draftOrderSlots: slots as unknown as Prisma.InputJsonValue,
        randomizeHistory: history as unknown as Prisma.InputJsonValue,
        updatedBy: userId,
      },
      update: {
        draftOrderMethod: 'randomized',
        randomizeCount: times,
        draftOrderSlots: slots as unknown as Prisma.InputJsonValue,
        randomizeHistory: history as unknown as Prisma.InputJsonValue,
        updatedBy: userId,
      },
    })

    try {
      await syncDraftSessionFromLeagueSettings(leagueId, updated, league.leagueSize ?? teams.length, new Set(['draftOrderSlots']))
    } catch (e) {
      console.warn('[draft/randomize-order] draft session sync failed', e)
    }

    const names = slots.map((s) => s.ownerName)
    let chatPosted = false
    try {
      const msg = await createLeagueChatMessage(leagueId, userId, buildRandomizeChatMessage(times, names), {
        type: 'text',
        source: null,
        messageSubtype: 'commissioner_change',
        metadata: { category: 'Draft order', randomizeTimes: times, order: names, isSystemMessage: true },
      })
      chatPosted = Boolean(msg)
    } catch {
      // Non-fatal: the order is saved whether or not chat accepts the notice.
      console.warn('[draft/randomize-order] league chat notice failed')
    }

    const size = typeof league.leagueSize === 'number' && league.leagueSize > slots.length ? league.leagueSize : slots.length
    const teamsOut = [
      ...order.map((t, i) => ({ position: i + 1, teamName: t.teamName ?? null, ownerName: t.ownerName ?? null, avatarUrl: t.avatarUrl ?? null, isEmpty: false })),
      ...Array.from({ length: size - slots.length }, (_, k) => ({ position: slots.length + k + 1, teamName: null, ownerName: null, avatarUrl: null, isEmpty: true })),
    ]

    return NextResponse.json({ ok: true, times, teams: teamsOut, chatPosted })
  } catch (e) {
    console.error('[draft/randomize-order]', e)
    return NextResponse.json({ error: 'Failed to randomize draft order' }, { status: 500 })
  }
}
