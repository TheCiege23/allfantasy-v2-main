/**
 * GET: Guillotine league home summary (survival standings, danger tiers, chopped history, assets).
 * Returns 404 when league is not a guillotine league.
 *
 * PATCH: commissioner-only edit of the first chop week (`{ eliminationStartWeek }`), of the chop
 * schedule and immunity (`{ advanced }`, AF Commissioner — lib/guillotine/chopSchedule.ts), or of the
 * league rules (`{ rules }`, lib/guillotine/guillotineRules.ts; `GET ?view=rules` reads them). It lives on
 * this existing path rather than its own route file because the app is at the route-count ceiling
 * (too_many_routes — see app/api/leagues/join/route.ts). Rules in lib/guillotine/guillotineFirstChopWeek.ts.
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

export const dynamic = 'force-dynamic'

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
  if (!isGuillotine) return NextResponse.json({ error: 'Not a guillotine league' }, { status: 404 })

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

  // No `?week=` means "the current week" — it used to mean week 1, all season.
  const config = await getGuillotineConfig(leagueId)
  const weekParam = req.nextUrl.searchParams?.get('week')
  const weekOrPeriod = weekParam
    ? Math.max(1, parseInt(weekParam, 10)) || 1
    : await resolveGuillotineCurrentWeek(leagueId, config)

  const [summary, myEscapes, myRosterId, home, advanced] = await Promise.all([
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
  ])
  // For the commissioner only: may they change the AF Commissioner guillotine rules? The SAME check
  // the chop-rules and league-rules saves enforce, so no page shows an editor the save will refuse.
  const canEditPaidRules = (await isCommissioner(leagueId, userId).catch(() => false))
    ? await viewerCanEditPaidGuillotineRules(userId)
    : null

  if (!summary) return NextResponse.json({ error: 'Summary not available' }, { status: 500 })

  return NextResponse.json({
    ...summary,
    myEscapes,
    myRosterId,
    home,
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
    return NextResponse.json({ error: 'Not a guillotine league' }, { status: 404 })
  }

  const body = (await req.json().catch(() => null)) as { eliminationStartWeek?: unknown; advanced?: unknown; rules?: unknown } | null
  if (body && 'rules' in body) {
    try {
      const saved = await saveGuillotineRules(leagueId, userId, body.rules)
      if (!saved.ok) {
        return NextResponse.json({ error: saved.error, field: saved.field ?? null, fields: saved.fields ?? [] }, { status: saved.status })
      }
      return NextResponse.json({ ok: true, ...saved.view })
    } catch (e) {
      console.error('[guillotine/summary PATCH rules]', e instanceof Error ? e.message : 'unknown error')
      return NextResponse.json({ error: 'Could not save the league rules' }, { status: 500 })
    }
  }
  if (body && 'advanced' in body) {
    const saved = await saveGuillotineAdvanced(leagueId, userId, body.advanced)
    if (!saved.ok) {
      const status = saved.error === 'not_entitled' ? 402 : saved.error === 'not_found' ? 404 : 400
      const message = saved.error === 'not_entitled' ? 'Chop schedules and immunity are part of AF Commissioner.' : saved.error
      return NextResponse.json({ error: message, code: saved.error }, { status })
    }
    const config = await getGuillotineConfig(leagueId)
    return NextResponse.json({ ok: true, advanced: saved.value, scheduleLines: config ? describeSchedule(saved.value, config.teamsPerChop, config.eliminationStartWeek) : [] })
  }
  if (!body || !('eliminationStartWeek' in body)) {
    return NextResponse.json({ error: 'eliminationStartWeek is required' }, { status: 400 })
  }

  try {
    const result = await updateGuillotineFirstChopWeek(leagueId, body.eliminationStartWeek)
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
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
