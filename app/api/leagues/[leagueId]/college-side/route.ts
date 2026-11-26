/**
 * The college side of an NFL C2C or devy league (lib/c2c/campusSeason/collegeSideSettings.ts).
 * GET: any league member. PATCH: a commissioner with league rights, while the league's format rules
 * are not locked by a vote.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import type { Prisma } from '@prisma/client'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { assertLeagueMember } from '@/lib/league/league-access'
import { canCommissionerAct } from '@/lib/league/commissionerAccess'
import { formatRulesLockedResponse } from '@/lib/league/formatRulesGuard'
import { campusSport } from '@/lib/c2c/campusLineup'
import { isDevyVariant } from '@/lib/c2c/collegeLineupLeague'
import { planCollegeSidePatch, readCollegeSideSettings, type CollegeSideKind } from '@/lib/c2c/campusSeason/collegeSideSettings'

export const dynamic = 'force-dynamic'

type LeagueRow = { id: string; sport: string | null; leagueVariant: string | null; leagueType: string | null; settings: unknown; leagueSize: number | null }

function kindOf(league: LeagueRow): CollegeSideKind | null {
  if (campusSport(league) === 'football') return 'c2c'
  const devy = isDevyVariant(league.leagueVariant) || String(league.leagueType ?? '').toLowerCase() === 'devy'
  return devy && String(league.sport ?? '').toUpperCase() === 'NFL' ? 'devy' : null
}

async function load(leagueId: string) {
  const league = (await prisma.league.findUnique({
    where: { id: leagueId },
    select: { id: true, sport: true, leagueVariant: true, leagueType: true, settings: true, leagueSize: true },
  })) as LeagueRow | null
  if (!league) return null
  const kind = kindOf(league)
  if (!kind) return { league, kind: null, seasonCreated: false, teamCount: 0 }
  const season = await prisma.redraftSeason.findFirst({ where: { leagueId }, orderBy: { season: 'desc' }, select: { id: true, season: true } })
  const [teams, campus] = await Promise.all([
    season ? prisma.redraftRoster.count({ where: { seasonId: season.id } }) : Promise.resolve(0),
    // Before migration 20261124230000_c2c_campus_season there is no college season table: nothing is set yet.
    season ? prisma.c2CCampusSeason.findUnique({ where: { leagueId_season: { leagueId, season: season.season } }, select: { id: true } }).catch(() => null) : Promise.resolve(null),
  ])
  return { league, kind, seasonCreated: Boolean(campus), teamCount: teams || league.leagueSize || 0 }
}

async function sessionUser(): Promise<string | null> {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  return session?.user?.id ?? null
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ leagueId: string }> }) {
  const userId = await sessionUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { leagueId } = await ctx.params
  const gate = await assertLeagueMember(leagueId, userId)
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: gate.status })
  const state = await load(leagueId)
  if (!state?.kind) return NextResponse.json({ error: 'Not an NFL C2C or devy league' }, { status: 404 })
  return NextResponse.json({
    settings: readCollegeSideSettings(state.league.settings, state.kind),
    seasonCreated: state.seasonCreated,
    teamCount: state.teamCount,
  })
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ leagueId: string }> }) {
  const userId = await sessionUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { leagueId } = await ctx.params
  if (!(await canCommissionerAct(leagueId, userId, 'league'))) return NextResponse.json({ error: 'Commissioner only' }, { status: 403 })
  const state = await load(leagueId)
  if (!state?.kind) return NextResponse.json({ error: 'Not an NFL C2C or devy league' }, { status: 404 })
  const locked = await formatRulesLockedResponse(leagueId)
  if (locked) return locked

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  const plan = planCollegeSidePatch({ kind: state.kind, teamCount: state.teamCount, seasonCreated: state.seasonCreated, patch: body ?? {} })
  if (!plan.ok) return NextResponse.json({ error: plan.error, field: plan.field }, { status: plan.status })

  const current = state.league.settings && typeof state.league.settings === 'object' && !Array.isArray(state.league.settings) ? (state.league.settings as Record<string, unknown>) : {}
  const next = { ...current, ...plan.settingsPatch }
  await prisma.league.update({ where: { id: leagueId }, data: { settings: next as Prisma.InputJsonValue } })
  return NextResponse.json({ settings: readCollegeSideSettings(next, state.kind), seasonCreated: state.seasonCreated, teamCount: state.teamCount })
}
