import { CURRENT_DRAFT_SESSION_ORDER } from '@/lib/draft-room/currentDraftSession'
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { resolveSurvivorAccessContext } from '@/lib/survivor/survivorAccessControl'
import { normalizeSurvivorFoundationSettings, buildSurvivorSettingsSnapshotPatch } from '@/lib/survivor/survivorSettings'
import { validateTribeSlots } from '@/lib/survivor/survivorTribeIdentity'
import { withSurvivorSetupTransaction } from '@/lib/survivor/survivorSetupTransaction'
import type { Prisma } from '@prisma/client'
import { normalizeTribePlan } from '@/lib/survivor/survivorTribePlan'
import { loadTribePlanParticipants, lockSurvivorTribePlan, readStoredTribePlan } from '@/lib/survivor/survivorTribePlanServer'
import { createLeagueChatMessage } from '@/lib/league-chat/LeagueChatMessageService'

export const dynamic = 'force-dynamic'
type Context = { params: Promise<{ leagueId: string }> }
async function viewer(ctx: Context) {
  const session = await getServerSession(authOptions as never) as { user?: { id?: string } } | null
  const { leagueId } = await ctx.params
  const userId = session?.user?.id
  return { leagueId, userId, access: userId ? await resolveSurvivorAccessContext(leagueId, userId) : null }
}
export async function GET(_req: NextRequest, ctx: Context) {
  const { leagueId, userId, access } = await viewer(ctx)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!access?.isLeagueMember) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true, sport: true, userId: true } })
  const settings = normalizeSurvivorFoundationSettings(league?.settings as Record<string, unknown>)
  /* Handoff §5.4 tribe plan (additive): the cast with DB-first AF strength, and any saved/locked plan. */
  const plan = readStoredTribePlan(league?.settings)
  const participants = access.decisions.canUpdateSettings
    ? await loadTribePlanParticipants(leagueId, {
        sport: String(league?.sport ?? 'NFL'),
        excludeUserId: settings.commissionerParticipationMode === 'non_participating_host' ? league?.userId ?? null : null,
      }).catch(() => [])
    : []
  const draft = await prisma.draftSession.findFirst({ where: { leagueId, sessionKind: 'live' }, orderBy: CURRENT_DRAFT_SESSION_ORDER, select: { status: true } })
  const assigned = await prisma.survivorTribeMember.count({ where: { tribe: { leagueId } } })
  return NextResponse.json({ sport: league?.sport, managers: settings.defaultTeamCount, tribeCount: settings.tribeCount,
    slots: settings.survivorTribeSlots, locked: Boolean((draft && ['in_progress', 'paused', 'completed'].includes(draft.status)) || assigned || plan?.lockedAt), canEdit: access.decisions.canUpdateSettings,
    participants, plan, planLocked: Boolean(plan?.lockedAt) })
}
export async function PUT(req: NextRequest, ctx: Context) {
  const { leagueId, userId, access } = await viewer(ctx)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!access?.isLeagueMember || !access.decisions.canUpdateSettings) return NextResponse.json({ error: 'Commissioner access required' }, { status: 403 })
  const body = await req.json().catch(() => null)
  if (!body || !Number.isInteger(body.tribeCount) || body.tribeCount < 2 || body.tribeCount > 5) return NextResponse.json({ error: 'Choose between 2 and 5 tribes.' }, { status: 400 })
  return withSurvivorSetupTransaction(leagueId, async db => {
    const league = await db.league.findUnique({ where: { id: leagueId }, select: { settings: true, leagueVariant: true, survivorMode: true } })
    if (!league || (!league.survivorMode && league.leagueVariant !== 'survivor')) return NextResponse.json({ error: 'Survivor league required' }, { status: 404 })
    const snapshot = (league.settings ?? {}) as Record<string, unknown>
    const settings = normalizeSurvivorFoundationSettings(snapshot)
    const invalid = validateTribeSlots(body.slots, settings.defaultTeamCount, body.tribeCount)
    if (invalid) return NextResponse.json({ error: invalid }, { status: 422 })
    await db.$queryRaw`SELECT id FROM draft_sessions WHERE "leagueId" = ${leagueId} AND "sessionKind" = 'live' FOR UPDATE`
    const draft = await db.draftSession.findFirst({ where: { leagueId, sessionKind: 'live' }, orderBy: CURRENT_DRAFT_SESSION_ORDER, select: { status: true } })
    const assigned = await db.survivorTribeMember.count({ where: { tribe: { leagueId } } })
    if ((draft && ['in_progress', 'paused', 'completed'].includes(draft.status)) || assigned) return NextResponse.json({ error: 'Tribe identities and capacities are locked once drafting or tribe assignment starts.' }, { status: 409 })
    if (readStoredTribePlan(snapshot)?.lockedAt) return NextResponse.json({ error: 'Tribes are locked and announced. They can no longer change.' }, { status: 409 })
    const next = { ...settings, tribeCount: body.tribeCount, survivorTribeSlots: body.slots }
    /* An unlocked draft of the tribe plan rides along when the panel saves (handoff §5.4). */
    const draftPlan = body.plan === undefined ? undefined : normalizeTribePlan(body.plan)
    await db.league.update({ where: { id: leagueId }, data: {
      survivorTribeCount: body.tribeCount, survivorTribeSize: Math.max(...body.slots.map((s: { managerCount: number }) => s.managerCount)),
      settings: { ...snapshot, ...buildSurvivorSettingsSnapshotPatch(next), ...(draftPlan ? { survivorTribePlan: draftPlan } : {}) } as Prisma.InputJsonValue,
    } })
    await db.survivorLeagueConfig.upsert({ where: { leagueId },
      create: { leagueId, tribeCount: body.tribeCount, tribeSize: Math.max(...body.slots.map((s: { managerCount: number }) => s.managerCount)), tribeFormation: settings.tribeAssignmentMode },
      update: { tribeCount: body.tribeCount, tribeSize: Math.max(...body.slots.map((s: { managerCount: number }) => s.managerCount)) } })
    await db.survivorAuditEntry.create({ data: { leagueId, actorUserId: userId, category: 'tribe', action: 'tribe_setup_saved',
      data: { tribeCount: body.tribeCount, slots: body.slots }, isVisibleToPublic: true, isVisibleToCommissioner: true } })
    return NextResponse.json({ ok: true, slots: body.slots })
  })
}

/**
 * POST — "Lock tribes & announce" (handoff §5.4). Commissioner only, before the draft starts. The
 * plan is validated server-side against the current cast and saved capacities (4–6 per tribe), then
 * frozen in league settings; the post-draft setup assigns tribes from it. Optionally announces the
 * tribes in league chat.
 */
export async function POST(req: NextRequest, ctx: Context) {
  const { leagueId, userId, access } = await viewer(ctx)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!access?.isLeagueMember || !access.decisions.canUpdateSettings) return NextResponse.json({ error: 'Commissioner access required' }, { status: 403 })
  const body = await req.json().catch(() => null)
  const plan = normalizeTribePlan(body?.plan)
  if (!plan) return NextResponse.json({ error: 'Send the tribe plan to lock.' }, { status: 400 })
  return withSurvivorSetupTransaction(leagueId, async db => {
    const league = await db.league.findUnique({ where: { id: leagueId }, select: { settings: true, sport: true, userId: true, leagueVariant: true, survivorMode: true } })
    if (!league || (!league.survivorMode && league.leagueVariant !== 'survivor')) return NextResponse.json({ error: 'Survivor league required' }, { status: 404 })
    const snapshot = (league.settings ?? {}) as Record<string, unknown>
    if (readStoredTribePlan(snapshot)?.lockedAt) return NextResponse.json({ error: 'Tribes are already locked.' }, { status: 409 })
    await db.$queryRaw`SELECT id FROM draft_sessions WHERE "leagueId" = ${leagueId} AND "sessionKind" = 'live' FOR UPDATE`
    const draft = await db.draftSession.findFirst({ where: { leagueId, sessionKind: 'live' }, orderBy: CURRENT_DRAFT_SESSION_ORDER, select: { status: true } })
    const assigned = await db.survivorTribeMember.count({ where: { tribe: { leagueId } } })
    if ((draft && ['in_progress', 'paused', 'completed'].includes(draft.status)) || assigned) return NextResponse.json({ error: 'Tribes lock before the draft starts.' }, { status: 409 })
    const settings = normalizeSurvivorFoundationSettings(snapshot)
    const participants = await loadTribePlanParticipants(leagueId, {
      sport: String(league.sport ?? 'NFL'),
      excludeUserId: settings.commissionerParticipationMode === 'non_participating_host' ? league.userId : null,
      db,
    })
    const outcome = await lockSurvivorTribePlan({
      db, leagueId, actorUserId: userId, plan, participants,
      managers: settings.defaultTeamCount, slots: settings.survivorTribeSlots, settingsSnapshot: snapshot,
      postAnnouncement: text => createLeagueChatMessage(leagueId, league.userId, text, {
        type: 'system', metadata: { isSystem: true, survivorTribesLocked: true },
      }),
    })
    if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: outcome.status })
    return NextResponse.json({ ok: true, plan: outcome.plan, announced: outcome.announced })
  })
}
