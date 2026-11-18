import { NextRequest, NextResponse } from 'next/server'
import { swapTeamsInWeek } from '@/lib/schedule-runtime/matchupSwapService'
import { applyRivalryWeek, previewRivalryWeek } from '@/lib/schedule-runtime/rivalryWeekService'
import { keepWeekAsCustom, randomizeSchedule, setCustomWeek } from '@/lib/schedule-runtime/scheduleToolsService'
import { readCustomWeeks, type CustomPair } from '@/lib/schedule-runtime/customWeeks'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { assertLeagueCommissioner, assertLeagueMember } from '@/lib/league/league-access'
import { parseOptionalRedraftPositiveInteger } from '@/lib/redraft/betaRouteInput'
import { updateStandings } from '@/lib/redraft/standingsEngine'
import {
  advanceNflRedraftScheduleWeek,
  buildScheduleRuntimeEvent,
  generateNflRedraftScheduleForSeason,
  resolveNflRedraftScheduleRuntime,
} from '@/lib/schedule-runtime'
import { createLeagueOsLoaders } from '@/lib/decision-os/league-os'
import { emitFeedOutcomes } from '@/lib/decision-os/core/parity'

export const dynamic = 'force-dynamic'

type ScheduleAction =
  | 'generate'
  | 'regenerate'
  | 'open_week'
  | 'complete_week'
  | 'advance_week'
  | 'lock_schedule'
  | 'recalculate_standings'
  | 'swap_teams'
  | 'rivalry_week_preview'
  | 'rivalry_week_apply'
  // Commissioner Hub schedule tools (lib/schedule-runtime/scheduleToolsService.ts, Phase C3).
  | 'randomize'
  | 'set_custom_week'
  | 'clear_custom_week'

async function resolveSeasonGate(input: {
  seasonId?: string | null
  leagueId?: string | null
  userId: string
}) {
  const season = await prisma.redraftSeason.findFirst({
    where: input.seasonId ? { id: input.seasonId } : { leagueId: input.leagueId ?? undefined },
    orderBy: input.seasonId ? undefined : { createdAt: 'desc' },
    select: { id: true, leagueId: true, currentWeek: true, season: true },
  })
  if (!season) return { ok: false as const, response: NextResponse.json({ error: 'Season not found' }, { status: 404 }) }

  const gate = await assertLeagueMember(season.leagueId, input.userId)
  if (!gate.ok) return { ok: false as const, response: NextResponse.json({ error: 'Forbidden' }, { status: gate.status }) }

  return { ok: true as const, season }
}

export async function GET(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const seasonId = req.nextUrl.searchParams?.get('seasonId')?.trim()
  const leagueId = req.nextUrl.searchParams?.get('leagueId')?.trim()
  if (!seasonId && !leagueId) {
    return NextResponse.json({ error: 'seasonId or leagueId required' }, { status: 400 })
  }

  const gate = await resolveSeasonGate({ seasonId, leagueId, userId })
  if (!gate.ok) return gate.response

  // League OS supplies the ruleset from maintained state when it is under 60s old.
  // ⚠ GET ONLY. The second call site in POST re-resolves after `updateStandings` to return the
  // state the caller just produced; it keeps live rules deliberately, because "show me the result
  // of what I just did" is the one place a cached input is most likely to be read as a bug.
  // Built ONCE per request so drainOutcomes() sees every fact this request resolved.
  const { loadRules, drainOutcomes } = createLeagueOsLoaders()
  const resolved = await resolveNflRedraftScheduleRuntime({ seasonId: gate.season.id }, { loadRules })
  emitFeedOutcomes('league', drainOutcomes())
  if (!resolved.ok) return NextResponse.json({ error: resolved.reason }, { status: 409 })

  // The weeks a commissioner set by hand, which every regeneration keeps (lib/schedule-runtime/customWeeks.ts).
  const league = await prisma.league.findUnique({ where: { id: gate.season.leagueId }, select: { settings: true } }).catch(() => null)
  const customWeeks = Object.keys(readCustomWeeks(league?.settings, gate.season.season)).map(Number).sort((a, b) => a - b)

  return NextResponse.json({
    seasonId: gate.season.id,
    schedule: resolved.state,
    coverage: resolved.coverage,
    customWeeks,
  })
}

export async function POST(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: {
    seasonId?: string
    leagueId?: string
    action?: ScheduleAction
    week?: number | string
    regenerate?: boolean
    commissionerOverride?: boolean
    confirmMidSeasonChange?: boolean
    rosterA?: string
    rosterB?: string
    times?: number | string
    pairs?: Array<{ home?: unknown; away?: unknown }>
  }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const action = body.action ?? 'generate'
  if (!body.seasonId?.trim() && !body.leagueId?.trim()) {
    return NextResponse.json({ error: 'seasonId or leagueId required' }, { status: 400 })
  }
  const gate = await resolveSeasonGate({
    seasonId: body.seasonId?.trim(),
    leagueId: body.leagueId?.trim(),
    userId,
  })
  if (!gate.ok) return gate.response

  const commissionerGate = await assertLeagueCommissioner(gate.season.leagueId, userId, 'league')
  if (!commissionerGate.ok) {
    return NextResponse.json({ error: 'Forbidden' }, { status: commissionerGate.status })
  }

  if (action === 'generate' || action === 'regenerate') {
    const generated = await generateNflRedraftScheduleForSeason({
      seasonId: gate.season.id,
      regenerate: action === 'regenerate' || body.regenerate === true,
      commissionerOverride: body.commissionerOverride === true,
      confirmMidSeasonChange: body.confirmMidSeasonChange === true,
      actorUserId: userId,
    })
    if (!generated.ok) return NextResponse.json({ error: generated.message, code: generated.code }, { status: 409 })
    return NextResponse.json(generated)
  }

  // Randomize N times (1–25): every draw posted to league chat, the last one saved.
  if (action === 'randomize') {
    const out = await randomizeSchedule({
      seasonId: gate.season.id,
      times: Number(body.times),
      actorUserId: userId,
      confirmMidSeasonChange: body.confirmMidSeasonChange === true,
    })
    if (!out.ok) return NextResponse.json({ error: out.message, code: out.code }, { status: out.status })
    return NextResponse.json(out)
  }

  // Set one week's pairings by hand, or clear it back to the generator's.
  if (action === 'set_custom_week' || action === 'clear_custom_week') {
    const parsedWeek = parseOptionalRedraftPositiveInteger(body.week, 'week')
    if (!parsedWeek.ok || parsedWeek.value == null) return NextResponse.json({ error: parsedWeek.ok ? 'week required' : parsedWeek.error }, { status: 400 })
    let pairs: CustomPair[] | null = null
    if (action === 'set_custom_week') {
      if (!Array.isArray(body.pairs) || body.pairs.length === 0 || body.pairs.length > 64) {
        return NextResponse.json({ error: 'pairs required' }, { status: 400 })
      }
      pairs = []
      for (const p of body.pairs) {
        if (typeof p?.home !== 'string' || !(p.away === null || typeof p.away === 'string')) {
          return NextResponse.json({ error: 'Each matchup needs a home team and an away team (or the bye).' }, { status: 400 })
        }
        pairs.push({ home: p.home, away: p.away as string | null })
      }
    }
    const out = await setCustomWeek({ seasonId: gate.season.id, week: parsedWeek.value, pairs, actorUserId: userId })
    if (!out.ok) return NextResponse.json({ error: out.message, code: out.code }, { status: out.status })
    const resolved = await resolveNflRedraftScheduleRuntime({ seasonId: gate.season.id })
    return NextResponse.json({ ok: true, seasonId: gate.season.id, week: out.week, cleared: out.cleared, schedule: resolved.ok ? resolved.state : null })
  }

  // Rivalry week: pair each team with its biggest rival for one week (lib/schedule-runtime/rivalryWeekService.ts).
  if (action === 'rivalry_week_preview' || action === 'rivalry_week_apply') {
    const parsedWeek = parseOptionalRedraftPositiveInteger(body.week, 'week')
    if (!parsedWeek.ok || parsedWeek.value == null) return NextResponse.json({ error: parsedWeek.ok ? 'week required' : parsedWeek.error }, { status: 400 })
    const out = action === 'rivalry_week_preview'
      ? await previewRivalryWeek({ seasonId: gate.season.id, week: parsedWeek.value })
      : await applyRivalryWeek({ seasonId: gate.season.id, week: parsedWeek.value, actorUserId: userId })
    if (!out.ok) return NextResponse.json({ error: out.message, code: out.code }, { status: out.status })
    // An applied Rivalry Week is kept as a custom week, so a later rebuild does not undo it.
    if (action === 'rivalry_week_apply') await keepWeekAsCustom({ seasonId: gate.season.id, week: out.week })
    return NextResponse.json({ ok: true, seasonId: gate.season.id, week: out.week, pairs: out.pairs, applied: action === 'rivalry_week_apply' })
  }

  // Two teams trade places in one week that has not started (lib/schedule-runtime/matchupSwapService.ts).
  if (action === 'swap_teams') {
    const parsedWeek = parseOptionalRedraftPositiveInteger(body.week, 'week')
    if (!parsedWeek.ok || parsedWeek.value == null) return NextResponse.json({ error: parsedWeek.ok ? 'week required' : parsedWeek.error }, { status: 400 })
    const rosterA = typeof body.rosterA === 'string' ? body.rosterA.trim() : ''
    const rosterB = typeof body.rosterB === 'string' ? body.rosterB.trim() : ''
    const swapped = await swapTeamsInWeek({ seasonId: gate.season.id, week: parsedWeek.value, rosterA, rosterB, actorUserId: userId })
    if (!swapped.ok) return NextResponse.json({ error: swapped.message, code: swapped.code }, { status: swapped.status })
    // A swap inside a custom week updates that week's kept pairings.
    await keepWeekAsCustom({ seasonId: gate.season.id, week: swapped.week, onlyIfCustom: true })
    const resolved = await resolveNflRedraftScheduleRuntime({ seasonId: gate.season.id })
    return NextResponse.json({ ok: true, seasonId: gate.season.id, week: swapped.week, schedule: resolved.ok ? resolved.state : null })
  }

  if (action === 'recalculate_standings') {
    const parsedWeek = parseOptionalRedraftPositiveInteger(body.week ?? gate.season.currentWeek, 'week')
    if (!parsedWeek.ok) return NextResponse.json({ error: parsedWeek.error }, { status: 400 })
    const week = parsedWeek.value ?? gate.season.currentWeek
    await updateStandings(gate.season.id, week)
    const resolved = await resolveNflRedraftScheduleRuntime({ seasonId: gate.season.id })
    return NextResponse.json({
      ok: true,
      seasonId: gate.season.id,
      schedule: resolved.ok ? resolved.state : null,
      events: [
        buildScheduleRuntimeEvent({
          leagueId: gate.season.leagueId,
          type: 'standings.recalculated',
          actorUserId: userId,
          payload: { seasonId: gate.season.id, throughWeek: week },
        }),
      ],
    })
  }

  const parsedWeek = parseOptionalRedraftPositiveInteger(body.week, 'week')
  if (!parsedWeek.ok) return NextResponse.json({ error: parsedWeek.error }, { status: 400 })
  const advanced = await advanceNflRedraftScheduleWeek({
    seasonId: gate.season.id,
    action,
    week: parsedWeek.value ?? undefined,
    actorUserId: userId,
    commissionerOverride: body.commissionerOverride === true,
  })
  if (!advanced.ok) return NextResponse.json({ error: advanced.message, code: advanced.code }, { status: 409 })
  return NextResponse.json(advanced)
}
