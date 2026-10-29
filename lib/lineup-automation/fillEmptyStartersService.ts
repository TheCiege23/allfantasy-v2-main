import 'server-only'

/**
 * Fill an empty starting spot before lock (`./fillEmptyStarters.ts`): the hourly run.
 *
 * Every in-season league played on AllFantasy with weekly lineups, unless its commissioner switched
 * it off (`League.settings.fill_empty_starters === false`). Same league rules as the bye-week switch
 * (`autoBenchByeLeagueBlock`): an imported league is played on its provider, a daily-lineup league has
 * no weekly lineup, and a best-ball or automatic-lineup league sets its own. A team AllFantasy or
 * Chimmy already manages is left to that run.
 *
 * A lineup saved in the last three hours is left alone — its manager may be mid-change. Every fill is
 * a system save through the lineup engine (`persistRosterLineupWithEngine`) with the starters the run
 * read as the expected lineup, so a manager who saves at the same moment wins, and an audit row. The
 * owner is told what was filled; when a spot cannot be filled, the commissioner is told, once a week
 * per team.
 */
import { prisma } from '@/lib/prisma'
import { getLeagueRole } from '@/lib/league/permissions'
import { leagueWeekFromSettings } from '@/lib/core-app/seasonTimeline'
import { getRosterTemplateForLeague } from '@/lib/multi-sport/MultiSportRosterService'
import { getFormatTypeForVariant } from '@/lib/sport-defaults/LeagueVariantRegistry'
import { resolveLineupStarterSlots } from '@/lib/league/lineupStarterSlots'
import { resolveFullLineupLockContext } from '@/lib/roster-lineup-engine/lineupLockService'
import { persistRosterLineupWithEngine } from '@/lib/roster-lineup-engine/lineupService'
import { getNormalizedPlayerData } from '@/lib/player-data/getNormalizedPlayerData'
import { serializeUnifiedPlayerForApi } from '@/lib/player-data/serializeUnifiedPlayerForApi'
import type { LineupPlayerInfo } from '@/lib/league/native/nativeScreenModels'
import { startersOnBye } from '@/lib/league/native/lineupMoves'
import { readManagedLineups } from '@/lib/inactive-manager/inactiveManagerMode'
import { dispatchNotification } from '@/lib/notifications/NotificationDispatcher'
import { autoBenchByeLeagueBlock } from './autoBenchByeService'
import { FILL_EMPTY_STARTERS_IDLE_MS, FILL_EMPTY_STARTERS_KEY, emptyStarterSlots, fillEmptyStartersOn, planFillEmptyStarters } from './fillEmptyStarters'

export const FILL_EMPTY_STARTERS_ACTION = 'fill_empty_starters.applied'

const settingsObject = (s: unknown): Record<string, unknown> => (s && typeof s === 'object' && !Array.isArray(s) ? (s as Record<string, unknown>) : {})

export type FillEmptyStartersRunResult = {
  leagues: number
  teams: number
  filled: number
  flagged: number
  skipped: Record<string, number>
  failures: { leagueId: string; rosterId?: string; error: string }[]
}

/** Hourly: put the best bench player who can play into each empty starting spot. */
export async function runFillEmptyStarters(opts?: { limit?: number; deadline?: number; now?: Date }): Promise<FillEmptyStartersRunResult> {
  const now = opts?.now ?? new Date()
  const deadline = opts?.deadline ?? Date.now() + 25_000
  const result: FillEmptyStartersRunResult = { leagues: 0, teams: 0, filled: 0, flagged: 0, skipped: {}, failures: [] }
  const skip = (reason: string) => (result.skipped[reason] = (result.skipped[reason] ?? 0) + 1)
  // The order changes every hour, so a run cut short by its deadline does not starve the same leagues.
  const hourKey = now.toISOString().slice(0, 13)
  const ids = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM leagues
    WHERE (LOWER(status) IN ('active', 'in_season') OR (status IS NULL AND "lifecycleState"::text = 'in_season'))
      AND COALESCE(settings ->> ${FILL_EMPTY_STARTERS_KEY}, 'true') <> 'false'
    ORDER BY md5(id || ${hourKey}) LIMIT ${Math.max(1, Math.min(opts?.limit ?? 200, 1000))}`

  for (const { id: leagueId } of ids) {
    if (Date.now() >= deadline) break
    result.leagues += 1
    try {
      const ctx = await loadLeague(leagueId)
      if ('skip' in ctx) {
        skip(ctx.skip ?? 'no_league')
        continue
      }
      const { league, week, season, slots } = ctx
      const managed = readManagedLineups(league.settings)
      const rosters = await prisma.roster.findMany({ where: { leagueId }, select: { id: true, platformUserId: true, playerData: true, updatedAt: true } })
      for (const roster of rosters) {
        if (Date.now() >= deadline) break
        // Cheap check first: almost every lineup is full, and those need no player reads at all.
        if (emptyStarterSlots(roster.playerData, slots.length).length === 0) continue
        result.teams += 1
        try {
          const outcome = await fillOneTeam({ league, week, season, slots, roster, managed: Boolean(managed[roster.id]), now })
          if (outcome === 'filled') result.filled += 1
          else if (outcome === 'flagged') result.flagged += 1
          else if (outcome === 'filled_and_flagged') {
            result.filled += 1
            result.flagged += 1
          } else skip(outcome)
        } catch (e) {
          result.failures.push({ leagueId, rosterId: roster.id, error: e instanceof Error ? e.message : String(e) })
        }
      }
    } catch (e) {
      result.failures.push({ leagueId, error: e instanceof Error ? e.message : String(e) })
    }
  }
  return result
}

type LoadedLeague = Exclude<Awaited<ReturnType<typeof loadLeague>>, { skip: string }>

async function fillOneTeam(args: {
  league: LoadedLeague['league']
  week: number
  season: number
  slots: LoadedLeague['slots']
  roster: { id: string; platformUserId: string | null; playerData: unknown; updatedAt: Date }
  managed: boolean
  now: Date
}): Promise<'filled' | 'flagged' | 'filled_and_flagged' | string> {
  const { league, week, season, slots, roster, now } = args
  const leagueId = league.id
  if (args.managed) return 'managed_by_autopilot'
  if (!roster.platformUserId || /^(orphan-|ai-manager-)/.test(roster.platformUserId)) return 'no_owner'
  if (now.getTime() - roster.updatedAt.getTime() < FILL_EMPTY_STARTERS_IDLE_MS) return 'recently_edited'

  const lock = await resolveFullLineupLockContext({
    leagueId,
    rosterId: roster.id,
    sport: String(league.sport ?? 'NFL'),
    leagueVariant: league.leagueVariant as string | null,
    settings: league.settings,
    leagueWeek: week,
    editingWeek: week,
    season,
    now,
    playerData: roster.playerData,
    lockAllMoves: league.lockAllMoves,
    lifecycleState: league.lifecycleState,
  })
  if (lock.locked) return 'lineup_locked'

  const rows = await getNormalizedPlayerData({ surface: 'roster', leagueId, userId: roster.platformUserId, limit: 200 })
  const players: Record<string, LineupPlayerInfo> = {}
  const names: Record<string, string> = {}
  const byeFacts: Record<string, { byeWeek: number | null }> = {}
  for (const p of rows.map(serializeUnifiedPlayerForApi)) {
    players[p.id] = { position: p.position, projectedPoints: p.projectedPoints }
    names[p.id] = p.name ?? p.id
    byeFacts[p.id] = { byeWeek: p.product?.byeWeek ?? p.nflRedraftGameContext?.byeWeek ?? null }
  }
  const onBye = new Set(startersOnBye(Object.keys(byeFacts), (id) => byeFacts[id], week))
  const locked = new Set(lock.lockedPlayerIds)
  const plan = planFillEmptyStarters({ slots, playerData: roster.playerData, players, isLocked: (id) => locked.has(id), onBye: (id) => onBye.has(id) })
  if (plan.kind === 'skip') return plan.reason

  let filled = false
  if (plan.kind === 'set') {
    const pd = settingsObject(roster.playerData)
    const said = plan.changes.map((c) => `${names[c.in] ?? c.in} at ${c.slot}`)
    const auditId = `fill-empty-starters:${JSON.stringify([leagueId, roster.id, season, week, plan.changes.map((c) => c.in)])}`
    const saved = await persistRosterLineupWithEngine({
      leagueId,
      rosterId: roster.id,
      actorUserId: roster.platformUserId,
      expectedOwnerUserId: roster.platformUserId,
      season,
      week,
      source: 'system',
      nextPlayerData: plan.nextPlayerData,
      ...(Array.isArray(pd.starters) ? { expectedStarters: pd.starters.map(String) } : {}),
      automationAudit: {
        id: auditId,
        action: FILL_EMPTY_STARTERS_ACTION,
        message: `Filled an empty starting spot before lock: ${said.join('; ')}.`,
        metadata: { season, week, changes: plan.changes, unfilled: plan.unfilled },
      },
    })
    if (!saved.ok) return `save_refused:${saved.status ?? 'error'}`
    filled = true
    await dispatchNotification({
      userIds: [roster.platformUserId],
      category: 'autocoach',
      type: 'fill_empty_starters',
      title: `Empty starting spot filled · ${league.name ?? 'your league'}`,
      body: `Your lineup had an empty starting spot, so AllFantasy started ${said.join('; ')}. You can change it any time before lock.`,
      severity: 'low',
      leagueId,
      actionHref: `/league/${leagueId}?tab=team`,
      actionLabel: 'View lineup',
      dedupePrefix: auditId,
      meta: { leagueId, rosterId: roster.id, week },
    }).catch(() => {})
  }

  const unfilled = plan.unfilled
  if (unfilled.length === 0) return 'filled'
  // Nobody on the bench can play these spots: a roster move is needed, which is the commissioner's
  // call (or the manager's), not AllFantasy's. Once a week per team.
  await dispatchNotification({
    userIds: [league.userId],
    category: 'commissioner_alerts',
    type: 'fill_empty_starters_short',
    title: `A team cannot fill its lineup · ${league.name ?? 'your league'}`,
    body: `One team has no bench player who can start at ${unfilled.join(', ')} this week. The spot will score nothing unless the team adds a player.`,
    severity: 'medium',
    leagueId,
    actionHref: `/league/${leagueId}`,
    actionLabel: 'Open league',
    dedupePrefix: `fill-empty-starters-short:${leagueId}:${roster.id}:${season}:${week}`,
    meta: { leagueId, rosterId: roster.id, week, unfilled },
  }).catch(() => {})
  return filled ? 'filled_and_flagged' : 'flagged'
}

async function loadLeague(leagueId: string) {
  const league = await prisma.league.findUnique({ where: { id: leagueId } })
  if (!league) return { skip: 'no_league' as string }
  if (!fillEmptyStartersOn(league.settings)) return { skip: 'switched_off' as string }
  const block = autoBenchByeLeagueBlock(league)
  if (block) return { skip: block as string }
  if (league.lockAllMoves) return { skip: 'moves_locked' as string }
  const week = leagueWeekFromSettings(league.settings)
  if (week == null || !league.season) return { skip: 'no_week' as string }
  const sport = String(league.sport ?? 'NFL')
  const template = await getRosterTemplateForLeague(sport as never, getFormatTypeForVariant(sport, (league.leagueVariant as string | null) ?? undefined), leagueId).catch(() => null)
  const slots = resolveLineupStarterSlots(league as never, template)
  if (slots.length === 0) return { skip: 'no_slots' as string }
  return { league, week, season: league.season, slots }
}

export type FillEmptyStartersView = { supported: true; on: boolean } | { supported: false; reason: string }

/** Commissioner or co-commissioner: whether the run fills empty starting spots in this league. */
export async function readFillEmptyStartersView(leagueId: string, userId: string): Promise<{ ok: true; view: FillEmptyStartersView } | { ok: false; status: 403 | 404 }> {
  const role = await getLeagueRole(leagueId, userId)
  if (role !== 'commissioner' && role !== 'co_commissioner') return { ok: false, status: 403 }
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { platform: true, sport: true, settings: true, leagueType: true, bestBallMode: true } })
  if (!league) return { ok: false, status: 404 }
  const block = autoBenchByeLeagueBlock(league)
  return { ok: true, view: block ? { supported: false, reason: block } : { supported: true, on: fillEmptyStartersOn(league.settings) } }
}
