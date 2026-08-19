/**
 * Lineup lock resolution: weekly/daily policies + league flags + optional per-player kickoff heuristic.
 */
import { evaluateLineupLock, type LineupLockResult } from '@/lib/league/lineup-lock'
import { getSpecialtySpecByVariant } from '@/lib/specialty-league/registry'
import { getNormalizedLineupSections, type RosterSectionKey } from '@/lib/roster/LineupTemplateValidation'
import { resolveConceptRosterLineupRules } from './conceptRosterRules'
import type { LineupLockContext } from './types'
import { prisma } from '@/lib/prisma'
import { toPrismaNullableJsonInput } from '@/lib/prisma-json'

export type LineupLockResolveArgs = {
  leagueId: string
  rosterId: string
  sport: string
  leagueVariant: string | null | undefined
  settings: unknown
  leagueWeek: number
  editingWeek: number
  season: number
  now?: Date
  playerData: unknown
  lockAllMoves?: boolean | null
  lifecycleState?: string
}

function weekFromSettings(settings: unknown): number {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return 1
  const o = settings as Record<string, unknown>
  const w = o.currentWeek ?? o.current_week ?? o.week
  if (typeof w === 'number' && Number.isFinite(w)) return Math.max(1, w)
  if (typeof w === 'string') {
    const n = parseInt(w, 10)
    return Number.isFinite(n) ? Math.max(1, n) : 1
  }
  return 1
}

/**
 * Best-effort per-player lock when `gameTime` parses to a time in the past.
 */
export function computePerPlayerKickoffLocks(
  playerData: unknown,
  now: Date,
): { lockedPlayerIds: string[]; reasons: Record<string, string> } {
  const sections = getNormalizedLineupSections(playerData)
  const lockedPlayerIds: string[] = []
  const reasons: Record<string, string> = {}
  const keys: RosterSectionKey[] = ['starters', 'bench', 'ir', 'taxi', 'devy']
  for (const section of keys) {
    for (const row of sections[section]) {
      const o = row as Record<string, unknown>
      const id = String(o.id ?? '').trim()
      if (!id) continue
      const gtRaw = String(o.gameTime ?? o.game_time ?? '').trim()
      if (!gtRaw || gtRaw === '—' || gtRaw === '-') continue
      const t = Date.parse(gtRaw)
      if (!Number.isNaN(t) && t <= now.getTime()) {
        lockedPlayerIds.push(id)
        reasons[id] = 'Player is locked (game time in the past).'
      }
    }
  }
  return { lockedPlayerIds, reasons }
}

export async function resolveSpecialtyLineupGuard(
  leagueId: string,
  rosterId: string,
  leagueVariant: string | null | undefined,
): Promise<{ blocked: boolean; reason?: string }> {
  const spec = getSpecialtySpecByVariant(leagueVariant ?? null)
  if (!spec?.rosterGuard) return { blocked: false }
  try {
    const canAct = await spec.rosterGuard(leagueId, rosterId)
    if (canAct) return { blocked: false }
    return {
      blocked: true,
      reason: 'Specialty league rules prevent lineup changes right now.',
    }
  } catch {
    return { blocked: false }
  }
}

/**
 * Persist lock snapshot for roster/week (cache for clients and audits).
 */
export async function upsertAfLineupLockState(input: {
  leagueId: string
  rosterId: string
  season: number
  week: number
  globalLocked: boolean
  lockedPlayerIds: string[]
  policy: string
  reason?: string | null
  metadata?: Record<string, unknown>
}): Promise<void> {
  await prisma.afLineupLockState.upsert({
    where: {
      rosterId_season_week: {
        rosterId: input.rosterId,
        season: input.season,
        week: input.week,
      },
    },
    create: {
      leagueId: input.leagueId,
      rosterId: input.rosterId,
      season: input.season,
      week: input.week,
      globalLocked: input.globalLocked,
      lockedPlayerIds: input.lockedPlayerIds,
      policy: input.policy,
      reason: input.reason ?? null,
      metadata: toPrismaNullableJsonInput(input.metadata),
    },
    update: {
      globalLocked: input.globalLocked,
      lockedPlayerIds: input.lockedPlayerIds,
      policy: input.policy,
      reason: input.reason ?? null,
      metadata: toPrismaNullableJsonInput(input.metadata),
      computedAt: new Date(),
    },
  })
}

export async function resolveFullLineupLockContext(args: LineupLockResolveArgs): Promise<LineupLockContext> {
  const now = args.now ?? new Date()
  const base: LineupLockResult = evaluateLineupLock({
    sport: args.sport,
    now,
    leagueWeek: args.leagueWeek,
    editingWeek: args.editingWeek,
  })

  const concept = resolveConceptRosterLineupRules(args.settings)
  let locked = base.locked
  let reason = base.reason
  let policy: string = base.policy

  if (args.lifecycleState === 'archived' || args.lifecycleState === 'completed') {
    locked = true
    reason = 'League season is complete.'
    policy = 'lifecycle'
  }

  if (args.lockAllMoves) {
    locked = true
    reason = 'All roster moves are locked by the commissioner.'
    policy = 'league_lock_all'
  }

  if (concept.freezeStarters) {
    locked = true
    reason = reason ?? 'Starters are frozen for this specialty phase.'
    policy = 'concept_freeze'
  }

  const specialty = await resolveSpecialtyLineupGuard(args.leagueId, args.rosterId, args.leagueVariant)
  let specialtyBlocksMoves = false
  if (specialty.blocked) {
    specialtyBlocksMoves = true
    locked = true
    reason = specialty.reason ?? reason
    policy = 'specialty_guard'
  }

  const kick = computePerPlayerKickoffLocks(args.playerData, now)

  return {
    locked,
    reason,
    policy,
    globalLocked: locked,
    lockedPlayerIds: kick.lockedPlayerIds,
    perPlayerReasons: kick.reasons,
    leagueBlocksMoves: Boolean(args.lockAllMoves) || args.lifecycleState === 'archived',
    specialtyBlocksMoves,
  }
}

export async function loadLeagueWeekContext(leagueId: string, settings: unknown, seasonFallback: number) {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { season: true, settings: true },
  })
  const season = league?.season ?? seasonFallback
  const week = weekFromSettings(settings ?? league?.settings)
  return { season, week }
}
