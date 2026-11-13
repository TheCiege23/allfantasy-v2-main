/**
 * League dues tracker (lib/dues/duesTracker.ts). TRACKING ONLY — AllFantasy never holds league money.
 *
 *   GET   any member: the tracker, the teams, and which team is the viewer's (`myTeamId`)
 *   PUT   commissioner / co-commissioner: amount, due date, payment links, who has paid
 *   POST  any member, `{ action: 'i_paid', note? }`: "I paid" for their OWN team. A claim the
 *         commissioner confirms; it never marks a team paid.
 *
 * Stored in League.settings.dues_tracker. Every payment link is validated (https, on the service's own
 * host) before it is saved, because every member's screen renders it as a link.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import type { Prisma } from '@prisma/client'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { resolveLeagueMembership } from '@/lib/league-access'
import { getLeagueRole } from '@/lib/league/permissions'
import { notifyCommissionerChange } from '@/lib/commissioner/CommissionerChangeNotifier'
import { applyCommissionerUpdate, applySelfReport, isTracking, readDuesConfig, type DuesConfig } from '@/lib/dues/duesTracker'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ leagueId: string }> }

async function viewer(ctx: Ctx) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) } as const
  const { leagueId } = await ctx.params
  /*
   * 🛑 MEMBER GATE, BEFORE THE READ. This GET once returned any league's settings and team list to any
   * signed-in user. `resolveLeagueMembership` returns 401/404/403 itself, so a missing league and a league
   * that is not yours stay indistinguishable. Writes check the commissioner role on top.
   */
  const membership = await resolveLeagueMembership(leagueId, userId)
  if (!membership.ok) {
    return { error: NextResponse.json({ error: membership.status === 404 ? 'Not found' : 'Forbidden' }, { status: membership.status }) } as const
  }
  const role = await getLeagueRole(leagueId, userId)
  return { leagueId, userId, isCommissioner: role === 'commissioner' || role === 'co_commissioner' } as const
}

/** Locked read-modify-write of the tracker, so a member's "I paid" and a commissioner's save cannot lose each other. */
async function updateTracker(leagueId: string, mutate: (c: DuesConfig) => DuesConfig | null): Promise<DuesConfig | null> {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.$queryRaw`SELECT id FROM leagues WHERE id = ${leagueId} FOR UPDATE`
    const league = await tx.league.findUnique({ where: { id: leagueId }, select: { settings: true } })
    if (!league) return null
    const settings = (league.settings as Record<string, unknown>) ?? {}
    const next = mutate(readDuesConfig(settings.dues_tracker))
    if (!next) return null
    await tx.league.update({ where: { id: leagueId }, data: { settings: { ...settings, dues_tracker: next } as Prisma.InputJsonValue } })
    return next
  })
}

function isMultiSeason(league: { isDynasty: boolean | null; leagueVariant: string | null; settings: unknown }): boolean {
  const settings = (league.settings as Record<string, unknown>) ?? {}
  const type = String(settings.league_type ?? settings.leagueType ?? '').toLowerCase()
  const variant = String(league.leagueVariant ?? '').toLowerCase()
  return Boolean(league.isDynasty) || ['dynasty', 'c2c', 'devy', 'keeper'].some((k) => type.includes(k) || variant.includes(k))
}

export async function GET(_req: NextRequest, ctx: Ctx) {
  const v = await viewer(ctx)
  if ('error' in v) return v.error
  const league = await prisma.league.findUnique({
    where: { id: v.leagueId },
    select: {
      name: true, sport: true, season: true, settings: true, leagueVariant: true, isDynasty: true,
      teams: { select: { id: true, teamName: true, ownerName: true, avatarUrl: true, claimedByUserId: true } },
    },
  })
  if (!league) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const config = readDuesConfig(((league.settings as Record<string, unknown>) ?? {}).dues_tracker)
  // Whose team is whose stays on the server: the client learns only which team is the viewer's.
  const myTeamId = league.teams.find((t) => t.claimedByUserId === v.userId)?.id ?? null
  return NextResponse.json({
    config,
    isCommissioner: v.isCommissioner,
    myTeamId,
    teams: league.teams.map(({ claimedByUserId: _c, ...t }) => t), // eslint-disable-line @typescript-eslint/no-unused-vars
    currentSeason: league.season,
    isMultiSeason: isMultiSeason(league),
    sport: league.sport,
    leagueName: league.name,
  })
}

const UPDATE_ERROR: Record<string, string> = {
  invalid_payment_link: 'A payment link must be an https link on that service’s own site (venmo.com, cash.app, paypal.me, leaguesafe.com, fancred.app).',
  invalid_due_date: 'Pick a valid due date.',
  invalid_amount: 'Dues must be a number from 0 to 100,000.',
  too_many_links: 'Add up to four payment links.',
}

export async function PUT(req: NextRequest, ctx: Ctx) {
  const v = await viewer(ctx)
  if ('error' in v) return v.error
  if (!v.isCommissioner) return NextResponse.json({ error: 'Commissioner only' }, { status: 403 })
  const body = ((await req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>

  let before: DuesConfig | null = null
  let refusal: string | null = null
  const updated = await updateTracker(v.leagueId, (existing) => {
    before = existing
    const r = applyCommissionerUpdate(existing, body, { userId: v.userId, now: new Date() })
    if (!r.ok) {
      refusal = r.error
      return null
    }
    return r.config
  })
  if (refusal) return NextResponse.json({ error: UPDATE_ERROR[refusal] ?? refusal, code: refusal }, { status: 400 })
  if (!updated || !before) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const prev = before as DuesConfig
  const changes: { field: string; oldValue: string; newValue: string }[] = []
  if (prev.enabled !== updated.enabled) changes.push({ field: 'Dues Tracking', oldValue: prev.enabled ? 'On' : 'Off', newValue: updated.enabled ? 'On' : 'Off' })
  if (prev.amount !== updated.amount) changes.push({ field: 'Dues Amount', oldValue: prev.amount != null ? `$${prev.amount}` : '(none)', newValue: updated.amount != null ? `$${updated.amount}` : '(none)' })
  if (prev.dueDate !== updated.dueDate) changes.push({ field: 'Dues Due Date', oldValue: prev.dueDate ?? '(none)', newValue: updated.dueDate ?? '(none)' })
  const oldPaid = new Set(prev.entries.filter((e) => e.paid).map((e) => e.teamId))
  const newlyPaid = updated.entries.filter((e) => e.paid && !oldPaid.has(e.teamId))
  if (newlyPaid.length > 0) changes.push({ field: 'Dues Paid', oldValue: '', newValue: `${newlyPaid.length} member(s) marked as paid` })
  if (changes.length > 0) await notifyCommissionerChange(v.leagueId, v.userId, 'League Dues Tracker', changes).catch(() => {})

  return NextResponse.json({ ok: true, config: updated })
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const v = await viewer(ctx)
  if ('error' in v) return v.error
  const body = ((await req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>
  if (body.action !== 'i_paid') return NextResponse.json({ error: 'invalid_action' }, { status: 400 })

  const league = await prisma.league.findUnique({ where: { id: v.leagueId }, select: { userId: true, name: true, teams: { select: { id: true, teamName: true, claimedByUserId: true } } } })
  const team = league?.teams.find((t) => t.claimedByUserId === v.userId)
  if (!league || !team) return NextResponse.json({ error: 'You do not have a team in this league.' }, { status: 403 })

  const updated = await updateTracker(v.leagueId, (c) => (isTracking(c) ? applySelfReport(c, team.id, body.note, new Date()) : null))
  if (!updated) return NextResponse.json({ error: 'Dues are not being tracked in this league.' }, { status: 409 })

  try {
    const { dispatchNotification } = await import('@/lib/notifications/NotificationDispatcher')
    await dispatchNotification({
      userIds: [league.userId].filter((u): u is string => Boolean(u)),
      category: 'commissioner_alerts',
      productType: 'app',
      type: 'dues_self_reported',
      title: `Dues reported paid · ${league.name ?? 'your league'}`,
      body: `${team.teamName ?? 'A team'} says they paid. Confirm it in the dues tracker once the money has arrived.`,
      actionHref: `/league/${encodeURIComponent(v.leagueId)}`,
      actionLabel: 'Open the dues tracker',
      meta: { leagueId: v.leagueId, teamId: team.id },
      severity: 'low',
    } as never)
  } catch (e) {
    console.warn('[dues] self-report notify failed', e instanceof Error ? e.message : e)
  }
  return NextResponse.json({ ok: true, config: updated })
}
