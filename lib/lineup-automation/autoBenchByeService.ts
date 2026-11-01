import 'server-only'

/**
 * The free "bench my starters on bye automatically" setting (`./autoBenchByePolicy.ts`): the owner's
 * switch, and the hourly run that applies it.
 *
 * Leagues played on AllFantasy with weekly lineups only. An imported league is played on its provider;
 * a daily-lineup league has days without games rather than bye weeks; a best-ball or automatic-lineup
 * league sets its own lineup; and a team AllFantasy or Chimmy already manages gets byes benched by that
 * run (`lib/inactive-manager`), so it is left to it.
 *
 * Every swap is a system save through the lineup engine (`persistRosterLineupWithEngine`) on the
 * owner's behalf, with the starters the run read as the expected lineup — a manager who saves at the
 * same moment wins — and an audit row. The owner is told what moved.
 */
import { prisma } from '@/lib/prisma'
import { resolveWriteAuthority } from '@/lib/league/write-authority'
import { automaticLineup } from '@/lib/core-app/teamWorkspace'
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
import { isDailyLineupScoringEnabled } from '@/lib/redraft/dailyLineups'
import { readManagedLineups } from '@/lib/inactive-manager/inactiveManagerMode'
import { dispatchNotification } from '@/lib/notifications/NotificationDispatcher'
import { AUTO_BENCH_BYE_KEY, autoBenchByeOn, planAutoBenchBye, withAutoBenchBye } from './autoBenchByePolicy'

export const AUTO_BENCH_BYE_ACTION = 'auto_bench_bye.applied'

const settingsObject = (s: unknown): Record<string, unknown> => (s && typeof s === 'object' && !Array.isArray(s) ? (s as Record<string, unknown>) : {})

/** Why this league cannot use the setting, or null. */
export function autoBenchByeLeagueBlock(league: {
  platform: string | null
  sport: string | null
  settings: unknown
  leagueType?: string | null
  bestBallMode?: boolean | null
}): string | null {
  if (resolveWriteAuthority(league.platform) !== 'NATIVE') return 'not_native'
  if (league.bestBallMode || automaticLineup(league.leagueType ?? null, league.settings)) return 'automatic_lineups'
  if (isDailyLineupScoringEnabled(league.settings, league.sport)) return 'daily_lineups'
  return null
}

/** The owner's switch for their own team in this league. */
export async function readAutoBenchBye(leagueId: string, userId: string): Promise<{ available: boolean; on: boolean; reason?: string }> {
  const [league, roster] = await Promise.all([
    prisma.league.findUnique({ where: { id: leagueId }, select: { platform: true, sport: true, settings: true, leagueType: true, bestBallMode: true } }),
    prisma.roster.findFirst({ where: { leagueId, platformUserId: userId }, select: { settings: true, platformUserId: true } }),
  ])
  if (!league || !roster) return { available: false, on: false, reason: 'no_team' }
  const block = autoBenchByeLeagueBlock(league)
  return { available: !block, on: !block && autoBenchByeOn(roster.settings, roster.platformUserId), ...(block ? { reason: block } : {}) }
}

export async function setAutoBenchBye(
  leagueId: string,
  userId: string,
  on: unknown,
): Promise<{ ok: true; on: boolean } | { ok: false; status: number; error: string }> {
  if (typeof on !== 'boolean') return { ok: false, status: 400, error: 'Send on: true or false.' }
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { platform: true, sport: true, settings: true, leagueType: true, bestBallMode: true } })
  if (!league) return { ok: false, status: 404, error: 'League not found.' }
  const block = autoBenchByeLeagueBlock(league)
  if (block) return { ok: false, status: 409, error: 'This league does not use weekly lineups set on AllFantasy, so there is nothing to bench.' }
  const roster = await prisma.roster.findFirst({ where: { leagueId, platformUserId: userId }, select: { id: true, settings: true } })
  if (!roster) return { ok: false, status: 403, error: 'Only a team’s owner can change this.' }
  await prisma.roster.update({ where: { id: roster.id }, data: { settings: withAutoBenchBye(roster.settings, on, userId) as object } })
  return { ok: true, on }
}

export type AutoBenchByeRunResult = {
  teams: number
  swapped: number
  unchanged: number
  skipped: Record<string, number>
  failures: { leagueId: string; rosterId?: string; error: string }[]
}

/** Hourly: for each team with the switch on, swap any starter on bye for the best bench player who can play. */
export async function runAutoBenchByes(opts?: { limit?: number; deadline?: number }): Promise<AutoBenchByeRunResult> {
  const deadline = opts?.deadline ?? Date.now() + 20_000
  const result: AutoBenchByeRunResult = { teams: 0, swapped: 0, unchanged: 0, skipped: {}, failures: [] }
  const skip = (reason: string) => (result.skipped[reason] = (result.skipped[reason] ?? 0) + 1)
  const teams = await prisma.$queryRaw<Array<{ id: string; leagueId: string }>>`
    SELECT id, "leagueId" FROM rosters
    WHERE settings -> ${AUTO_BENCH_BYE_KEY} ->> 'on' = 'true'
    ORDER BY "leagueId", id LIMIT ${Math.max(1, Math.min(opts?.limit ?? 200, 1000))}`

  const leagueCache = new Map<string, Awaited<ReturnType<typeof loadLeague>>>()
  for (const { id: rosterId, leagueId } of teams) {
    if (Date.now() >= deadline) break
    result.teams += 1
    try {
      if (!leagueCache.has(leagueId)) leagueCache.set(leagueId, await loadLeague(leagueId))
      const ctx = leagueCache.get(leagueId)
      if (!ctx || 'skip' in ctx) {
        skip((ctx && 'skip' in ctx ? ctx.skip : null) ?? 'no_league')
        continue
      }
      const { league, week, season, slots, managed } = ctx
      if (managed.has(rosterId)) {
        skip('managed_by_autopilot')
        continue
      }
      const roster = await prisma.roster.findFirst({ where: { id: rosterId, leagueId } })
      if (!roster?.platformUserId || !autoBenchByeOn(roster.settings, roster.platformUserId)) {
        skip('not_owner_setting')
        continue
      }
      const lock = await resolveFullLineupLockContext({
        leagueId,
        rosterId,
        sport: String(league.sport ?? 'NFL'),
        leagueVariant: league.leagueVariant as string | null,
        settings: league.settings,
        leagueWeek: week,
        editingWeek: week,
        season,
        now: new Date(),
        playerData: roster.playerData,
        lockAllMoves: league.lockAllMoves,
        lifecycleState: league.lifecycleState,
      })
      if (lock.locked) {
        skip('lineup_locked')
        continue
      }
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
      const plan = planAutoBenchBye({ slots, playerData: roster.playerData, players, isLocked: (id) => locked.has(id), onBye: (id) => onBye.has(id) })
      if (plan.kind === 'skip') {
        if (plan.reason === 'already_best' || plan.reason === 'no_bye_starters') result.unchanged += 1
        else skip(plan.reason)
        continue
      }
      const pd = settingsObject(roster.playerData)
      const said = plan.changes.map((c) => `${c.out ? names[c.out] ?? c.out : 'empty'} (bye) → ${names[c.in] ?? c.in} at ${c.slot}`)
      const auditId = `auto-bench-bye:${JSON.stringify([leagueId, rosterId, season, week, plan.changes.map((c) => c.in)])}`
      const saved = await persistRosterLineupWithEngine({
        leagueId,
        rosterId,
        actorUserId: roster.platformUserId,
        expectedOwnerUserId: roster.platformUserId,
        season,
        week,
        source: 'system',
        nextPlayerData: plan.nextPlayerData,
        ...(Array.isArray(pd.starters) ? { expectedStarters: pd.starters.map(String) } : {}),
        automationAudit: {
          id: auditId,
          action: AUTO_BENCH_BYE_ACTION,
          message: `Benched a starter on bye, as the manager asked: ${said.join('; ')}.`,
          metadata: { season, week, changes: plan.changes },
        },
      })
      if (!saved.ok) {
        skip(`save_refused:${saved.status ?? 'error'}`)
        continue
      }
      result.swapped += 1
      await dispatchNotification({
        userIds: [roster.platformUserId],
        category: 'autocoach',
        type: 'auto_bench_bye',
        title: `Bye week swap · ${league.name ?? 'your league'}`,
        body: said.join('; '),
        severity: 'low',
        leagueId,
        actionHref: `/league/${leagueId}?tab=team`,
        actionLabel: 'View lineup',
        dedupePrefix: auditId,
        meta: { leagueId, rosterId, week },
      }).catch(() => {})
    } catch (e) {
      result.failures.push({ leagueId, rosterId, error: e instanceof Error ? e.message : String(e) })
    }
  }
  return result
}

async function loadLeague(leagueId: string) {
  const league = await prisma.league.findUnique({ where: { id: leagueId } })
  if (!league) return null
  const block = autoBenchByeLeagueBlock(league)
  if (block) return { skip: block }
  const status = String(league.status ?? league.lifecycleState ?? '').toLowerCase()
  if (!['active', 'in_season'].includes(status)) return { skip: 'not_in_season' }
  if (league.lockAllMoves) return { skip: 'moves_locked' }
  const week = leagueWeekFromSettings(league.settings)
  if (week == null || !league.season) return { skip: 'no_week' }
  const sport = String(league.sport ?? 'NFL')
  const template = await getRosterTemplateForLeague(sport as never, getFormatTypeForVariant(sport, (league.leagueVariant as string | null) ?? undefined), leagueId).catch(() => null)
  return {
    league,
    week,
    season: league.season,
    slots: resolveLineupStarterSlots(league as never, template),
    managed: new Set(Object.keys(readManagedLineups(league.settings))),
  }
}
