/**
 * GET: the league's scoring type (points / H2H categories / roto), its category list, and what this
 *      sport can switch to.
 * PUT: switch the scoring type and/or edit the category list (add, remove, reorder).
 *      Body: { mode?, presetId?, categoryIds?, recordMode?, confirmMidSeasonChange? }.
 *
 * The lifecycle rule is the scoring editors' (`decideSettingsEdit`): mid-season needs the explicit
 * confirmation, drafting and archived are refused. What a switch does to weeks already played is in
 * lib/league/scoringTypeSwitch.ts.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import {
  readScoringType,
  scoringTypesForSport,
  validateScoringTypeChange,
  resolveLeagueCategories,
} from '@/lib/category-scoring/leagueScoringType'
import { decideSettingsEdit, recordMidSeasonSettingsChange } from '@/lib/league/settingsLifecycleGate'
import { switchLeagueScoringType } from '@/lib/league/scoringTypeSwitch'

export const dynamic = 'force-dynamic'

type Session = { user?: { id?: string } } | null

function describe(settings: unknown, sport: string) {
  const current = readScoringType(settings)
  const types = scoringTypesForSport(sport)
  const categories = current.mode === 'points' ? [] : resolveLeagueCategories(settings, current.presetId) ?? []
  return {
    sport,
    current: { ...current, categoryIds: categories.map((c) => c.id), customCategories: current.categoryIds != null },
    options: {
      modes: types.modes,
      presets: Object.entries(types.presets).map(([id, list]) => ({ id, categoryIds: list.map((c) => c.id) })),
      rotoPresets: types.rotoPresets ? [...types.rotoPresets] : null,
      catalog: types.catalog.map(({ id, label, description, direction }) => ({ id, label, description: description ?? null, direction })),
    },
  }
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ leagueId: string }> }) {
  const session = (await getServerSession(authOptions as never)) as Session
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { leagueId } = await params
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { userId: true, sport: true, settings: true } })
  if (!league) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ ...describe(league.settings, String(league.sport)), isCommissioner: league.userId === session.user.id })
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ leagueId: string }> }) {
  const session = (await getServerSession(authOptions as never)) as Session
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { leagueId } = await params
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { userId: true, sport: true, settings: true } })
  if (!league) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (league.userId !== session.user.id) return NextResponse.json({ error: 'Commissioner only' }, { status: 403 })

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const input = { mode: body.mode, presetId: body.presetId, categoryIds: body.categoryIds, recordMode: body.recordMode }
  // An invalid request is a 400 whatever the phase — it never needs a confirmation to be refused.
  const check = validateScoringTypeChange(String(league.sport), input, readScoringType(league.settings))
  if (!check.ok) return NextResponse.json({ error: check.error, code: check.code }, { status: 400 })

  const lifecycle = await decideSettingsEdit(leagueId, session.user.id, 'scoring', body)
  if (!lifecycle.ok) return NextResponse.json(lifecycle.body, { status: lifecycle.status })

  const result = await switchLeagueScoringType({ leagueId, userId: session.user.id, input, midSeason: lifecycle.midSeason })
  if (!result.ok) return NextResponse.json({ error: result.error, code: result.code }, { status: result.status })

  if (result.changed) {
    await recordMidSeasonSettingsChange(lifecycle, {
      leagueId,
      userId: session.user.id,
      section: 'scoring',
      source: 'scoring-type',
      detail: { from: result.previous, to: result.next, effectiveFromWeek: result.effectiveFromWeek },
    })
  }
  const updated = await prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true } })
  return NextResponse.json({
    ok: true,
    changed: result.changed,
    effectiveFromWeek: result.effectiveFromWeek,
    ...describe(updated?.settings ?? null, String(league.sport)),
  })
}
