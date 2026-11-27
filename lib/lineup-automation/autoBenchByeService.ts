import { resolveActingRoster, resolveViewingRoster } from '@/lib/league/viewerTeams'
import 'server-only'

/**
 * The "bench my starters on bye automatically" setting (an AI swap: AF Pro / Supreme, ./aiSwapPolicy.ts) (`./autoBenchByePolicy.ts`): the owner's
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
import { aiSwapAllowedForTeam, isAiSeat } from './aiSwapPolicy'

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
  if (resolveWriteAuthority(league) !== 'NATIVE') return 'not_native'
  if (league.bestBallMode || automaticLineup(league.leagueType ?? null, league.settings)) return 'automatic_lineups'
  if (isDailyLineupScoringEnabled(league.settings, league.sport)) return 'daily_lineups'
  return null
}

/** The owner's switch for their own team in this league. */
export async function readAutoBenchBye(leagueId: string, userId: string, rosterId?: string | null): Promise<{ available: boolean; on: boolean; reason?: string }> {
  const [league, viewing] = await Promise.all([
    prisma.league.findUnique({ where: { id: leagueId }, select: { platform: true, sport: true, settings: true, leagueType: true, bestBallMode: true } }),
    // With several teams: the named one when it is theirs, else their first (lib/league/viewerTeams.ts).
    resolveViewingRoster(leagueId, userId, rosterId, { allowCoOwner: false }),
  ])
  const roster = viewing
    ? await prisma.roster.findFirst({ where: { id: viewing.rosterId, leagueId }, select: { settings: true, platformUserId: true } })
    : null
  if (!league || !roster) return { available: false, on: false, reason: 'no_team' }
  const block = autoBenchByeLeagueBlock(league)
  return { available: !block, on: !block && autoBenchByeOn(roster.settings, roster.platformUserId), ...(block ? { reason: block } : {}) }
}

export async function setAutoBenchBye(
  leagueId: string,
  userId: string,
  on: unknown,
  rosterId?: string | null,
): Promise<{ ok: true; on: boolean } | { ok: false; status: number; error: string }> {
  if (typeof on !== 'boolean') return { ok: false, status: 400, error: 'Send on: true or false.' }
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { platform: true, sport: true, settings: true, leagueType: true, bestBallMode: true } })
  if (!league) return { ok: false, status: 404, error: 'League not found.' }
  const block = autoBenchByeLeagueBlock(league)
  if (block) return { ok: false, status: 409, error: 'This league does not use weekly lineups set on AllFantasy, so there is nothing to bench.' }
  // A manager with several teams must say which one; it is never guessed (lib/league/viewerTeams.ts).
  const acting = await resolveActingRoster(leagueId, userId, rosterId, { allowCoOwner: false })
  if (!acting.ok && acting.code === 'TEAM_REQUIRED') return { ok: false, status: acting.status, error: acting.message }
  const roster = acting.ok
    ? await prisma.roster.findFirst({ where: { id: acting.rosterId, leagueId }, select: { id: true, settings: true } })
    : null
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
      if (ctx.managed.has(rosterId)) {
        skip('managed_by_autopilot')
        continue
      }
      const roster = await prisma.roster.findFirst({ where: { id: rosterId, leagueId } })
      if (!roster?.platformUserId || !autoBenchByeOn(roster.settings, roster.platformUserId)) {
        skip('not_owner_setting')
        continue
      }
      /*
       * 🛑 THIS SWITCH WAS FREE. Benching a starter for the manager is an AI swap, which is an AF Pro /
       * Supreme feature the subscriber turns on and the commissioner can switch off league-wide
       * (owner's rule 2026-11-23, ./aiSwapPolicy.ts). The switch on the team stays where the owner left
       * it; it only RUNS while all three hold. A manager it does not run for is alerted instead, by
       * `runByeStarterSweep`.
       */
      const swap = await aiSwapAllowedForTeam({ roster, league: ctx.league })
      if (!swap.allowed) {
        skip(swap.reason)
        continue
      }
      const outcome = await benchByesForTeam(ctx, roster, { notifyOwner: true })
      if (outcome === 'swapped') result.swapped += 1
      else if (outcome === 'unchanged') result.unchanged += 1
      else skip(outcome)
    } catch (e) {
      result.failures.push({ leagueId, rosterId, error: e instanceof Error ? e.message : String(e) })
    }
  }
  return result
}

type LoadedByeLeague = Exclude<NonNullable<Awaited<ReturnType<typeof loadLeague>>>, { skip: string }>
type ByeTeam = { id: string; platformUserId: string | null; playerData: unknown; settings?: unknown }

/** Swap this team's starters on bye for the best bench players who can play. Returns what happened. */
async function benchByesForTeam(
  ctx: LoadedByeLeague,
  roster: ByeTeam,
  opts: { notifyOwner: boolean },
): Promise<'swapped' | 'unchanged' | string> {
  const { league, week, season, slots } = ctx
  const leagueId = league.id
  const rosterId = roster.id
  const owner = roster.platformUserId
  if (!owner) return 'no_owner'
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
  if (lock.locked) return 'lineup_locked'
  const rows = await getNormalizedPlayerData({ surface: 'roster', leagueId, userId: owner, limit: 200 })
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
  if (plan.kind === 'skip') return plan.reason === 'already_best' || plan.reason === 'no_bye_starters' ? 'unchanged' : plan.reason
  const pd = settingsObject(roster.playerData)
  const said = plan.changes.map((c) => `${c.out ? names[c.out] ?? c.out : 'empty'} (bye) → ${names[c.in] ?? c.in} at ${c.slot}`)
  const auditId = `auto-bench-bye:${JSON.stringify([leagueId, rosterId, season, week, plan.changes.map((c) => c.in)])}`
  const saved = await persistRosterLineupWithEngine({
    leagueId,
    rosterId,
    actorUserId: owner,
    expectedOwnerUserId: owner,
    season,
    week,
    source: 'system',
    nextPlayerData: plan.nextPlayerData,
    ...(Array.isArray(pd.starters) ? { expectedStarters: pd.starters.map(String) } : {}),
    automationAudit: {
      id: auditId,
      action: AUTO_BENCH_BYE_ACTION,
      message: opts.notifyOwner
        ? `Benched a starter on bye, as the manager asked: ${said.join('; ')}.`
        : `Benched a starter on bye for an AI-managed seat: ${said.join('; ')}.`,
      metadata: { season, week, changes: plan.changes },
    },
  })
  if (!saved.ok) return `save_refused:${saved.status ?? 'error'}`
  if (opts.notifyOwner) {
    await dispatchNotification({
      userIds: [owner],
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
  }
  return 'swapped'
}

export type ByeStarterSweepResult = {
  leagues: number
  teams: number
  aiSeatsSwapped: number
  managersAlerted: number
  skipped: Record<string, number>
  failures: { leagueId: string; rosterId?: string; error: string }[]
}

/** The redraft slot types that do not start (lib/redraft/lineupValidation.ts NON_STARTER_SLOTS). */
const NON_STARTING_SLOT_TYPES = ['bench', 'bn', 'ir', 'taxi', 'devy', 'reserve', 'il', 'il_plus', 'na', 'prospect', 'rights', 'minors']

/**
 * Hourly, every hosted weekly-lineup league in season: a team starting a player on bye this week.
 *
 * 🛑 THE BYE RULE WAS ONLY EVER CHECKED WHEN SOMEONE SAVED. `validateRedraftLineup` refuses to START a
 * player on bye, but a lineup set by the draft, or left from an earlier week, walks into the bye week
 * untouched: Zombie Chimmy Test and the 8-team redraft league both started Kyren Williams in week 11
 * (his bye) on 2026-11-22, and ten unclaimed "Open Team" seats started bye players nobody could move.
 *
 * Owner's rule (2026-11-23): an AI-managed or unclaimed seat is fixed — the bye starter benched for the
 * best eligible bench player whose game has not started. A person is ALERTED and nothing moves, unless
 * they have AI swap (AF Pro / Supreme, switched on, league not off) and the bye switch on, in which case
 * `runAutoBenchByes` swaps it. A team the inactive-manager autopilot runs is left to that run.
 */
export async function runByeStarterSweep(opts?: { limit?: number; deadline?: number; now?: Date }): Promise<ByeStarterSweepResult> {
  const now = opts?.now ?? new Date()
  const deadline = opts?.deadline ?? Date.now() + 25_000
  const result: ByeStarterSweepResult = { leagues: 0, teams: 0, aiSeatsSwapped: 0, managersAlerted: 0, skipped: {}, failures: [] }
  const skip = (reason: string) => (result.skipped[reason] = (result.skipped[reason] ?? 0) + 1)
  const hourKey = now.toISOString().slice(0, 13)
  const ids = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM leagues
    WHERE (LOWER(status) IN ('active', 'in_season') OR (status IS NULL AND "lifecycleState"::text = 'in_season'))
    ORDER BY md5(id || ${hourKey}) LIMIT ${Math.max(1, Math.min(opts?.limit ?? 200, 1000))}`

  for (const { id: leagueId } of ids) {
    if (Date.now() >= deadline) break
    try {
      const ctx = await loadLeague(leagueId)
      if (!ctx || 'skip' in ctx) {
        skip((ctx && 'skip' in ctx ? ctx.skip : null) ?? 'no_league')
        continue
      }
      result.leagues += 1
      // Cheap first: the season roster's starters whose bye is this week. Most teams have none.
      const flagged = await prisma.$queryRaw<Array<{ rosterId: string; names: string[] }>>`
        SELECT r.id AS "rosterId", array_agg(p."playerName" ORDER BY p."playerName") AS names
        FROM rosters r JOIN redraft_roster_players p ON p."rosterId" = r."redraftRosterId"
        WHERE r."leagueId" = ${leagueId} AND p."droppedAt" IS NULL AND p."byeWeek" = ${ctx.week}
          AND LOWER(p."slotType") <> ALL(${NON_STARTING_SLOT_TYPES})
        GROUP BY r.id`
      for (const { rosterId, names } of flagged) {
        if (Date.now() >= deadline) break
        result.teams += 1
        try {
          if (ctx.managed.has(rosterId)) {
            skip('managed_by_autopilot')
            continue
          }
          const roster = await prisma.roster.findFirst({ where: { id: rosterId, leagueId } })
          if (!roster) continue
          if (isAiSeat(roster)) {
            const outcome = await benchByesForTeam(ctx, roster, { notifyOwner: false })
            if (outcome === 'swapped') result.aiSeatsSwapped += 1
            else skip(`ai_seat_${outcome}`)
            continue
          }
          if (!roster.platformUserId) {
            skip('no_owner')
            continue
          }
          // The manager's own bye switch with AI swap allowed is `runAutoBenchByes`' job.
          if (autoBenchByeOn(roster.settings, roster.platformUserId) && (await aiSwapAllowedForTeam({ roster, league: ctx.league })).allowed) {
            skip('owner_auto_bench_on')
            continue
          }
          const list = names.join(', ')
          await dispatchNotification({
            userIds: [roster.platformUserId],
            category: 'lineup_alerts',
            type: 'starter_on_bye',
            title: `Starter on bye · ${ctx.league.name ?? 'your league'}`,
            body: `${list} ${names.length === 1 ? 'is' : 'are'} on bye in Week ${ctx.week} and will score 0. Swap ${names.length === 1 ? 'him' : 'them'} out before lineups lock.`,
            severity: 'medium',
            leagueId,
            actionHref: `/league/${encodeURIComponent(leagueId)}?tab=team`,
            actionLabel: 'Fix lineup',
            // Once per team, week and set of players: a new bye starter alerts again, the same one does not.
            dedupePrefix: `bye-starter:${leagueId}:${rosterId}:${ctx.season}:${ctx.week}:${list}`,
            meta: { leagueId, rosterId, week: ctx.week },
          })
          result.managersAlerted += 1
        } catch (e) {
          result.failures.push({ leagueId, rosterId, error: e instanceof Error ? e.message : String(e) })
        }
      }
    } catch (e) {
      result.failures.push({ leagueId, error: e instanceof Error ? e.message : String(e) })
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
