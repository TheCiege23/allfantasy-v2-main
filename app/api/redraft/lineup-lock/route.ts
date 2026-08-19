import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { toPrismaJsonInput } from '@/lib/prisma-json'
import { readLineupLockSettings, type LineupLockMode } from '@/lib/redraft/lineupLock'
import { parseOptionalRedraftPositiveInteger } from '@/lib/redraft/betaRouteInput'

export const dynamic = 'force-dynamic'

/**
 * Commissioner control surface for lineup locking (G1).
 *
 *   GET  ?seasonId=… → current { mode, manualLockedWeeks, overrides }
 *   POST { seasonId, action, … }
 *     action: 'set_mode'              { mode }
 *             'manual_lock_week'      { week }
 *             'manual_unlock_week'    { week }
 *             'emergency_unlock'      { week?, rosterId?, playerId? }  // unlock
 *             'clear_emergency_unlock'{ week?, rosterId?, playerId? }
 *
 * All writes land in `League.settings.sportConfig` (the same blob the lock engine
 * reads) and are audited to `RedraftLeagueTransaction`. The lock itself is derived
 * at request time from the schedule, so these settings take effect immediately.
 */

async function canManageLeague(leagueId: string, userId: string): Promise<boolean> {
  const league = await prisma.league.findFirst({
    where: { id: leagueId },
    select: {
      userId: true,
      teams: { where: { claimedByUserId: userId }, select: { isCommissioner: true, isCoCommissioner: true } },
    },
  })
  if (!league) return false
  if (league.userId === userId) return true
  return league.teams.some((t: { isCommissioner: boolean; isCoCommissioner: boolean }) => t.isCommissioner || t.isCoCommissioner)
}

type LockOverride = { week?: number; rosterId?: string; playerId?: string }

function sameOverride(a: LockOverride, b: LockOverride): boolean {
  return (a.week ?? null) === (b.week ?? null) && (a.rosterId ?? null) === (b.rosterId ?? null) && (a.playerId ?? null) === (b.playerId ?? null)
}

const VALID_MODES: LineupLockMode[] = ['per_player_kickoff', 'first_game_of_week', 'manual']

export async function GET(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const seasonId = req.nextUrl.searchParams?.get('seasonId')?.trim()
  if (!seasonId) return NextResponse.json({ error: 'seasonId required' }, { status: 400 })

  const season = await prisma.redraftSeason.findFirst({ where: { id: seasonId }, select: { leagueId: true } })
  if (!season) return NextResponse.json({ error: 'Season not found' }, { status: 404 })
  if (!(await canManageLeague(season.leagueId, userId))) {
    return NextResponse.json({ error: 'Forbidden — commissioner only' }, { status: 403 })
  }

  const league = await prisma.league.findUnique({ where: { id: season.leagueId }, select: { settings: true } })
  const { mode, manualLockedWeeks, overrides } = readLineupLockSettings(league?.settings ?? null)
  return NextResponse.json({ mode, manualLockedWeeks: [...manualLockedWeeks], overrides })
}

export async function POST(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { seasonId?: string; action?: string; mode?: string; week?: number; rosterId?: string; playerId?: string }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const seasonId = body.seasonId?.trim()
  const action = body.action?.trim()
  if (!seasonId || !action) return NextResponse.json({ error: 'seasonId and action required' }, { status: 400 })

  const season = await prisma.redraftSeason.findFirst({ where: { id: seasonId }, select: { id: true, leagueId: true } })
  if (!season) return NextResponse.json({ error: 'Season not found' }, { status: 404 })
  if (!(await canManageLeague(season.leagueId, userId))) {
    return NextResponse.json({ error: 'Forbidden — commissioner only' }, { status: 403 })
  }

  const league = await prisma.league.findUnique({ where: { id: season.leagueId }, select: { settings: true } })
  const settings = (league?.settings ?? {}) as Record<string, unknown>
  const sportConfig = { ...((settings.sportConfig as Record<string, unknown>) ?? {}) }

  const manualWeeks = new Set<number>(
    Array.isArray(sportConfig.lineupLockManualWeeks)
      ? (sportConfig.lineupLockManualWeeks as unknown[]).map((w) => Number(w)).filter((w) => Number.isFinite(w))
      : [],
  )
  let overrides: LockOverride[] = Array.isArray(sportConfig.lineupLockOverrides)
    ? (sportConfig.lineupLockOverrides as LockOverride[])
    : []

  const parsedWeek = parseOptionalRedraftPositiveInteger(body.week, 'week')
  if (!parsedWeek.ok) {
    return NextResponse.json({ error: parsedWeek.error }, { status: 400 })
  }
  const week = parsedWeek.value ?? undefined
  const needsWeek = ['manual_lock_week', 'manual_unlock_week'].includes(action)
  if (needsWeek && week == null) {
    return NextResponse.json({ error: 'week must be a positive integer' }, { status: 400 })
  }

  switch (action) {
    case 'set_mode': {
      const mode = String(body.mode ?? '') as LineupLockMode
      if (!VALID_MODES.includes(mode)) {
        return NextResponse.json({ error: `mode must be one of ${VALID_MODES.join(', ')}` }, { status: 400 })
      }
      sportConfig.lineupLockType = mode
      break
    }
    case 'manual_lock_week':
      manualWeeks.add(week as number)
      sportConfig.lineupLockManualWeeks = [...manualWeeks].sort((a, b) => a - b)
      break
    case 'manual_unlock_week':
      manualWeeks.delete(week as number)
      sportConfig.lineupLockManualWeeks = [...manualWeeks].sort((a, b) => a - b)
      break
    case 'emergency_unlock': {
      const ov: LockOverride = {
        ...(week != null ? { week } : {}),
        ...(body.rosterId ? { rosterId: body.rosterId } : {}),
        ...(body.playerId ? { playerId: body.playerId } : {}),
      }
      if (!overrides.some((o) => sameOverride(o, ov))) overrides = [...overrides, ov]
      sportConfig.lineupLockOverrides = overrides
      break
    }
    case 'clear_emergency_unlock': {
      const ov: LockOverride = {
        ...(week != null ? { week } : {}),
        ...(body.rosterId ? { rosterId: body.rosterId } : {}),
        ...(body.playerId ? { playerId: body.playerId } : {}),
      }
      overrides = overrides.filter((o) => !sameOverride(o, ov))
      sportConfig.lineupLockOverrides = overrides
      break
    }
    default:
      return NextResponse.json({ error: 'Unsupported action' }, { status: 400 })
  }

  await prisma.league.update({
    where: { id: season.leagueId },
    data: { settings: toPrismaJsonInput({ ...settings, sportConfig }) },
  })

  // Audit roster-scoped changes (emergency unlock/clear). RedraftLeagueTransaction
  // requires a rosterId, so league-wide mode/week changes are recorded by the
  // persisted settings themselves rather than a transaction row.
  if (body.rosterId) {
    const rosterExists = await prisma.redraftRoster.findFirst({
      where: { id: body.rosterId, seasonId: season.id },
      select: { id: true },
    })
    if (rosterExists) {
      await prisma.redraftLeagueTransaction
        .create({
          data: {
            leagueId: season.leagueId,
            seasonId: season.id,
            rosterId: body.rosterId,
            type: 'lineup_lock_change',
            metadata: { action, mode: body.mode ?? null, week: week ?? null, playerId: body.playerId ?? null, actorUserId: userId },
          },
        })
        .catch(() => null)
    }
  }

  const { mode, manualLockedWeeks, overrides: nextOverrides } = readLineupLockSettings({ sportConfig })
  return NextResponse.json({ ok: true, action, mode, manualLockedWeeks: [...manualLockedWeeks], overrides: nextOverrides })
}
