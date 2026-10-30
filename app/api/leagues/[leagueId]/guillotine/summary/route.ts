/**
 * GET: Guillotine league home summary (survival standings, danger tiers, chopped history, assets).
 * Returns 404 when league is not a guillotine league.
 *
 * PATCH: commissioner-only edit of the first chop week (`{ eliminationStartWeek }`), of the chop
 * schedule and immunity (`{ advanced }`, AF Commissioner — lib/guillotine/chopSchedule.ts), or of the
 * league rules (`{ rules }`, lib/guillotine/guillotineRules.ts; `GET ?view=rules` reads them). It lives on
 * this existing path rather than its own route file because the app is at the route-count ceiling
 * (too_many_routes — see app/api/leagues/join/route.ts). Rules in lib/guillotine/guillotineFirstChopWeek.ts.
 *
 * POST: a chopped manager's "Who's next?" pick (`{ action: 'next_chop_pick', week, rosterId }`,
 * lib/guillotine/nextChopPick.ts). Any member; the store refuses a manager who is still alive.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { canAccessLeagueDraft } from '@/lib/live-draft-engine/auth'
import { isGuillotineLeague } from '@/lib/guillotine/GuillotineLeagueConfig'
import { buildWeeklySummary } from '@/lib/guillotine/GuillotineWeeklySummaryService'
import { getGuillotineConfig } from '@/lib/guillotine/GuillotineLeagueConfig'
import { getGuillotineEscapesForUser } from '@/lib/share/guillotineEscape'
import { findViewerRosterId, resolveGuillotineCurrentWeek } from '@/lib/guillotine/guillotineCurrentWeek'
import { assertCommissioner, isCommissioner } from '@/lib/commissioner/permissions'
import { updateGuillotineFirstChopWeek } from '@/lib/guillotine/guillotineFirstChopWeek'
import { buildGuillotineHomeExtras } from '@/lib/league-specialty/guillotineHome'
import { readGuillotineAdvanced, saveGuillotineAdvanced } from '@/lib/guillotine/guillotineAdvancedSettings'
import { describeSchedule } from '@/lib/guillotine/chopSchedule'
import { readGuillotineRules, saveGuillotineRules, viewerCanEditPaidGuillotineRules } from '@/lib/guillotine/guillotineRulesSave'
import { loadChopPreview } from '@/lib/guillotine/chopPreviewLoad'
import { loadChopWatch } from '@/lib/guillotine/chopWatchLoad'
import { loadNextChopPickState, saveNextChopPick } from '@/lib/guillotine/nextChopPickStore'
import { guillotineAdvancedSnapshot, guillotineRulesSnapshot } from '@/lib/league-rules-explainer/snapshot'
import { diffRuleSnapshots } from '@/lib/league-rules-explainer/changeKeys'
import { publishRuleChangesEvent } from '@/lib/league-rules-explainer/publishRuleChanges'

export const dynamic = 'force-dynamic'

/** A "before" read for the What-changed event: any failure means no event, never a failed save. */
async function bestEffort<T>(read: () => Promise<T> | T): Promise<T | null> {
  try {
    return (await read()) ?? null
  } catch {
    return null
  }
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ leagueId: string }> }
) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await ctx.params
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })

  const allowed = await canAccessLeagueDraft(leagueId, userId)
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const isGuillotine = await isGuillotineLeague(leagueId)
  if (!isGuillotine) return NextResponse.json({ error: 'Not a Guilly league' }, { status: 404 })

  // `?view=rules`: the commissioner's "League rules" page (lib/guillotine/guillotineRules.ts).
  if (req.nextUrl.searchParams?.get('view') === 'rules') {
    try {
      await assertCommissioner(leagueId, userId)
    } catch {
      return NextResponse.json({ error: 'Only the commissioner can edit league rules.' }, { status: 403 })
    }
    const view = await readGuillotineRules(leagueId, userId)
    return view ? NextResponse.json(view) : NextResponse.json({ error: 'Not a guillotine league' }, { status: 404 })
  }

  // `?view=preview`: the commissioner's chop-week preview (lib/guillotine/chopPreview.ts). AF Commissioner,
  // by the same check as the paid league rules. Reads only — nothing is chopped, moved or posted.
  if (req.nextUrl.searchParams?.get('view') === 'preview') {
    try {
      await assertCommissioner(leagueId, userId)
    } catch {
      return NextResponse.json({ error: 'Only the commissioner can preview the chop.' }, { status: 403 })
    }
    if (!(await viewerCanEditPaidGuillotineRules(userId))) {
      return NextResponse.json({ error: 'The chop preview is part of AF Commissioner.', code: 'feature_not_entitled', upgradePath: '/commissioner-upgrade' }, { status: 402 })
    }
    const preview = await loadChopPreview(leagueId)
    return 'error' in preview ? NextResponse.json(preview, { status: 409 }) : NextResponse.json(preview)
  }

  // No `?week=` means "the current week" — it used to mean week 1, all season.
  const config = await getGuillotineConfig(leagueId)
  const weekParam = req.nextUrl.searchParams?.get('week')
  const weekOrPeriod = weekParam
    ? Math.max(1, parseInt(weekParam, 10)) || 1
    : await resolveGuillotineCurrentWeek(leagueId, config)

  const [summary, myEscapes, myRosterId, home, advanced, watch] = await Promise.all([
    buildWeeklySummary({ leagueId, weekOrPeriod, includeDanger: true }),
    // Your escapes from chops that happened — shareable moments (2026-09-14). Never fails the summary.
    getGuillotineEscapesForUser(leagueId, userId).catch(() => []),
    // So a surface can say "you" without a second request. Never fails the summary.
    findViewerRosterId(leagueId, userId).catch(() => null),
    // The specialty home's hero/chop-line extras (presentation only). Never fails the summary.
    config
      ? Promise.resolve()
          .then(() => buildGuillotineHomeExtras(leagueId, String(config.sport), weekOrPeriod))
          .catch(() => null)
      : Promise.resolve(null),
    readGuillotineAdvanced(leagueId).catch(() => null),
    // Chop Watch (lib/guillotine/chopWatch.ts): this week's chop line, live, by the chop's own rules.
    // The current week only — a past week's line is the one its chop already settled.
    weekParam ? Promise.resolve(null) : loadChopWatch(leagueId, weekOrPeriod),
  ])
  // For the commissioner only: may they change the AF Commissioner guillotine rules? The SAME check
  // the chop-rules and league-rules saves enforce, so no page shows an editor the save will refuse.
  const canEditPaidRules = (await isCommissioner(leagueId, userId).catch(() => false))
    ? await viewerCanEditPaidGuillotineRules(userId)
    : null

  if (!summary) return NextResponse.json({ error: 'Summary not available' }, { status: 500 })

  // "Who's next?" for chopped managers. Never fails the summary.
  const nextChopPick = await loadNextChopPickState(leagueId, myRosterId).catch(() => null)

  return NextResponse.json({
    ...summary,
    nextChopPick,
    ...(watch ? { dangerTiers: watch.dangerTiers } : {}),
    chopWatch: watch ? { live: true, week: watch.week, chopCount: watch.chopCount, chopLine: watch.chopLine } : null,
    myEscapes,
    myRosterId,
    home: home && watch ? { ...home, scores: watch.scores } : home,
    config: config
      ? {
          eliminationStartWeek: config.eliminationStartWeek,
          eliminationEndWeek: config.eliminationEndWeek,
          teamsPerChop: config.teamsPerChop,
          tiebreakerOrder: config.tiebreakerOrder,
          dangerMarginPoints: config.dangerMarginPoints,
          rosterReleaseTiming: config.rosterReleaseTiming,
          advanced,
          scheduleLines: advanced ? describeSchedule(advanced, config.teamsPerChop, config.eliminationStartWeek) : [],
          canEditPaidRules,
        }
      : null,
  })
}

const PICK_MESSAGES: Record<'not_chopped' | 'closed' | 'not_alive', { status: number; error: string }> = {
  not_chopped: { status: 403, error: 'Only a manager whose team has been chopped can pick.' },
  closed: { status: 409, error: 'That week has started, so picks for it are closed.' },
  not_alive: { status: 400, error: 'Pick a team that is still alive.' },
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ leagueId: string }> }
) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await ctx.params
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })
  if (!(await canAccessLeagueDraft(leagueId, userId))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!(await isGuillotineLeague(leagueId))) return NextResponse.json({ error: 'Not a Guilly league' }, { status: 404 })

  const body = (await req.json().catch(() => null)) as { action?: unknown; week?: unknown; rosterId?: unknown } | null
  if (body?.action !== 'next_chop_pick' || typeof body.rosterId !== 'string' || !body.rosterId || !Number.isInteger(body.week)) {
    return NextResponse.json({ error: 'Send { action: "next_chop_pick", week, rosterId }.' }, { status: 400 })
  }
  const viewerRosterId = await findViewerRosterId(leagueId, userId).catch(() => null)
  const saved = await saveNextChopPick({ leagueId, viewerRosterId, userId, week: body.week as number, pickedRosterId: body.rosterId })
  if (!saved.ok) return NextResponse.json({ error: PICK_MESSAGES[saved.reason].error, code: saved.reason }, { status: PICK_MESSAGES[saved.reason].status })
  return NextResponse.json({ ok: true, nextChopPick: await loadNextChopPickState(leagueId, viewerRosterId) })
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ leagueId: string }> }
) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await ctx.params
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })

  try {
    await assertCommissioner(leagueId, userId)
  } catch {
    return NextResponse.json({ error: 'Only the commissioner can change the first chop week.' }, { status: 403 })
  }

  if (!(await isGuillotineLeague(leagueId))) {
    return NextResponse.json({ error: 'Not a Guilly league' }, { status: 404 })
  }

  const body = (await req.json().catch(() => null)) as { eliminationStartWeek?: unknown; advanced?: unknown; rules?: unknown } | null
  if (body && 'rules' in body) {
    try {
      const before = await bestEffort(() => readGuillotineRules(leagueId, userId))
      const saved = await saveGuillotineRules(leagueId, userId, body.rules)
      if (!saved.ok) {
        return NextResponse.json({ error: saved.error, field: saved.field ?? null, fields: saved.fields ?? [] }, { status: saved.status })
      }
      // Before/after for the league home's "What changed" card (lib/league-rules-explainer).
      if (before) {
        await publishRuleChangesEvent({
          leagueId,
          actorUserId: userId,
          section: 'guillotine-rules',
          changes: diffRuleSnapshots(guillotineRulesSnapshot(before.rules), guillotineRulesSnapshot(saved.view.rules)),
        })
      }
      return NextResponse.json({ ok: true, ...saved.view })
    } catch (e) {
      console.error('[guillotine/summary PATCH rules]', e instanceof Error ? e.message : 'unknown error')
      return NextResponse.json({ error: 'Could not save the league rules' }, { status: 500 })
    }
  }
  if (body && 'advanced' in body) {
    const before = await bestEffort(() => readGuillotineAdvanced(leagueId))
    const saved = await saveGuillotineAdvanced(leagueId, userId, body.advanced)
    if (!saved.ok) {
      const status = saved.error === 'not_entitled' ? 402 : saved.error === 'not_found' ? 404 : 400
      const message = saved.error === 'not_entitled' ? 'Chop schedules and immunity are part of AF Commissioner.' : saved.error
      return NextResponse.json({ error: message, code: saved.error }, { status })
    }
    if (before) {
      await publishRuleChangesEvent({
        leagueId,
        actorUserId: userId,
        section: 'guillotine-chop-rules',
        changes: diffRuleSnapshots(guillotineAdvancedSnapshot(before), guillotineAdvancedSnapshot(saved.value)),
      })
    }
    const config = await getGuillotineConfig(leagueId)
    return NextResponse.json({ ok: true, advanced: saved.value, scheduleLines: config ? describeSchedule(saved.value, config.teamsPerChop, config.eliminationStartWeek) : [] })
  }
  if (!body || !('eliminationStartWeek' in body)) {
    return NextResponse.json({ error: 'eliminationStartWeek is required' }, { status: 400 })
  }

  try {
    const beforeConfig = await bestEffort(() => getGuillotineConfig(leagueId))
    const result = await updateGuillotineFirstChopWeek(leagueId, body.eliminationStartWeek)
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
    if (beforeConfig) {
      await publishRuleChangesEvent({
        leagueId,
        actorUserId: userId,
        section: 'guillotine-first-chop',
        changes: diffRuleSnapshots(
          { chopStartWeek: beforeConfig.eliminationStartWeek, chopEndWeek: beforeConfig.eliminationEndWeek ?? null },
          { chopStartWeek: result.eliminationStartWeek, chopEndWeek: result.eliminationEndWeek ?? null },
        ),
      })
    }
    return NextResponse.json({
      ok: true,
      config: {
        eliminationStartWeek: result.eliminationStartWeek,
        eliminationEndWeek: result.eliminationEndWeek,
      },
    })
  } catch (e) {
    console.error('[guillotine/summary PATCH]', e)
    return NextResponse.json({ error: 'Could not save the first chop week' }, { status: 500 })
  }
}
