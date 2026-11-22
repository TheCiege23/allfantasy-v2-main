import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { resolveLeagueMembership } from '@/lib/league-access'
import { getLeagueRole } from '@/lib/league/permissions'
import { isLeaguePrefEnabled, parseLeagueNotificationPrefs } from '@/lib/league/league-notification-prefs'
import { importedRuleSnapshot, isImportedRulesLeague, isRulesExplainerLeague } from '@/lib/league-rules-explainer/snapshot'
import { loadRuleSnapshot, loadSettingsChangeEvents } from '@/lib/league-rules-explainer/load'
import { getLeagueRulesSeen, setLeagueRulesSeen } from '@/lib/league-rules-explainer/seenStore'
import { buildRulesExplainerView, nextLeagueRulesSeen } from '@/lib/league-rules-explainer/view'

/**
 * GET  /api/leagues/:leagueId/rules-explainer — the league rules popup and "What changed" cards
 *      for the signed-in member (lib/league-rules-explainer/view.ts).
 * POST /api/leagues/:leagueId/rules-explainer — `{ kind: 'rules' }` (the full popup was closed) or
 *      `{ kind: 'changes', eventId }` (a "What changed" card was dismissed).
 *
 * Served through the [section] dispatcher (no new route file — the route-count ceiling).
 * Members only; database only — no provider is called on this path. An imported league gets the
 * rules its import carries (snapshot.ts `importedRuleSnapshot`) and never a change card.
 */

export const dynamic = 'force-dynamic'

type Session = { user?: { id?: string } } | null

const LEAGUE_SELECT = {
  id: true,
  platform: true,
  sport: true,
  leagueSize: true,
  scoring: true,
  leagueType: true,
  leagueVariant: true,
  guillotineMode: true,
  guillotineEndgame: true,
  isDynasty: true,
  bestBallMode: true,
  survivorMode: true,
  medianGame: true,
  playoffTeams: true,
  playoffStartWeek: true,
  playoffWeeksPerRound: true,
  tradeDeadlineWeek: true,
  tradeReviewHours: true,
  waiverType: true,
  waiverBudget: true,
  waiverMinBid: true,
  waiverHours: true,
  keeperCount: true,
  keeperCostSystem: true,
  keeperMaxYears: true,
  draftPickTrading: true,
  settings: true,
} as const

async function authorize(leagueId: string): Promise<{ userId: string } | Response> {
  const session = (await getServerSession(authOptions as never)) as Session
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })
  const membership = await resolveLeagueMembership(leagueId, userId)
  if (!membership.ok) {
    return NextResponse.json({ error: membership.status === 404 ? 'Not found' : 'Forbidden' }, { status: membership.status })
  }
  return { userId }
}

export async function GET(_req: Request, ctx: { params: Promise<{ leagueId: string }> }) {
  const { leagueId } = await ctx.params
  const auth = await authorize(leagueId)
  if (auth instanceof Response) return auth

  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: LEAGUE_SELECT })
  if (!league) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  // An imported league's rules change on its platform: the rules it carries, and never a change card.
  const imported = !isRulesExplainerLeague(league) && isImportedRulesLeague(league)
  if (!imported && !isRulesExplainerLeague(league)) return NextResponse.json({ supported: false })

  const [snapshot, events, seen, role] = await Promise.all([
    imported ? importedRuleSnapshot(league) : loadRuleSnapshot(leagueId, league),
    imported ? [] : loadSettingsChangeEvents(leagueId).catch(() => []),
    getLeagueRulesSeen(auth.userId, leagueId),
    getLeagueRole(leagueId, auth.userId).catch(() => null),
  ])
  const view = buildRulesExplainerView({
    snapshot,
    events,
    seen,
    viewerUserId: auth.userId,
    isCommissioner: role === 'commissioner' || role === 'co_commissioner',
    broadcastsEnabled: isLeaguePrefEnabled(parseLeagueNotificationPrefs(league.settings), 'commissionerBroadcasts'),
  })
  return NextResponse.json(view)
}

export async function POST(req: Request, ctx: { params: Promise<{ leagueId: string }> }) {
  const { leagueId } = await ctx.params
  const auth = await authorize(leagueId)
  if (auth instanceof Response) return auth

  const body = (await req.json().catch(() => null)) as { kind?: unknown; eventId?: unknown } | null
  const kind = body?.kind
  if (kind !== 'rules' && kind !== 'changes') return NextResponse.json({ error: 'kind must be rules or changes' }, { status: 400 })

  const current = await getLeagueRulesSeen(auth.userId, leagueId)
  let next
  if (kind === 'rules') {
    const latest = await prisma.leagueEvent.findFirst({
      where: { leagueId, eventType: 'settings_changed' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { id: true, createdAt: true },
    })
    next = nextLeagueRulesSeen(current, {
      kind: 'rules',
      now: new Date().toISOString(),
      latestEvent: latest ? { id: latest.id, createdAt: latest.createdAt.toISOString() } : null,
    })
  } else {
    const eventId = typeof body?.eventId === 'string' ? body.eventId.trim() : ''
    if (!eventId || eventId.length > 64) return NextResponse.json({ error: 'eventId required' }, { status: 400 })
    // The event must be this league's settings event — a foreign id moves nothing.
    const event = await prisma.leagueEvent.findFirst({
      where: { id: eventId, leagueId, eventType: 'settings_changed' },
      select: { id: true, createdAt: true },
    })
    if (!event) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    next = nextLeagueRulesSeen(current, { kind: 'changes', event: { id: event.id, createdAt: event.createdAt.toISOString() } })
  }

  try {
    await setLeagueRulesSeen(auth.userId, leagueId, next)
  } catch (e) {
    console.error('[rules-explainer POST]', e instanceof Error ? e.message : 'unknown error')
    return NextResponse.json({ error: 'Could not save' }, { status: 500 })
  }
  return NextResponse.json({ ok: true, seen: next })
}
