import 'server-only'

import { prisma } from '@/lib/prisma'
import { resolveWriteAuthority } from '@/lib/league/write-authority'
import { isElevatedCommissioner } from '@/server/services/permissionService'
import { ownerHasAfCommissionerPlan } from '@/lib/stat-corrections/applyStatCorrections'
import { automaticLineup } from '@/lib/core-app/teamWorkspace'
import { leagueWeekFromSettings } from '@/lib/core-app/seasonTimeline'
import { readPlayoffFormat } from '@/lib/core-app/outlookFormat'
import { getRosterTemplateForLeague } from '@/lib/multi-sport/MultiSportRosterService'
import { getFormatTypeForVariant } from '@/lib/sport-defaults/LeagueVariantRegistry'
import { resolveLineupStarterSlots } from '@/lib/league/lineupStarterSlots'
import { buildLineupListsFromPlayerData } from '@/lib/league/lineup-swap'
import { resolveFullLineupLockContext } from '@/lib/roster-lineup-engine/lineupLockService'
import { persistRosterLineupWithEngine } from '@/lib/roster-lineup-engine/lineupService'
import { getNormalizedPlayerData } from '@/lib/player-data/getNormalizedPlayerData'
import { serializeUnifiedPlayerForApi } from '@/lib/player-data/serializeUnifiedPlayerForApi'
import { planBestLineup, readManagedLineups } from '@/lib/inactive-manager/inactiveManagerMode'
import type { LineupPlayerInfo } from '@/lib/league/native/nativeScreenModels'
import type { WorkspaceTaskCandidate } from '@/lib/commissioner-workspace/taskSources'
import {
  describeShortfall,
  ELIMINATED_LINEUP_RULE_KEY,
  eliminatedTeams,
  failingStarters,
  lineupShortfall,
  meetsMinimum,
  readEliminatedLineupRule,
  type EliminatedLineupRule,
  type EliminationReason,
  type LineupShortfall,
  type LineupStandard,
  type StarterCheck,
} from './eliminatedLineups'

/**
 * Lineup minimums for eliminated teams (./eliminatedLineups.ts): the commissioner's view, the hourly
 * run that fills short lineups and tells their managers, and the Commish OS task.
 *
 * DB-first: standings are `RedraftRoster`, the lineup is `Roster.playerData` (what the lineup screen
 * saves), bye weeks and injury status come through `getNormalizedPlayerData` — the same rows the
 * manager's own lineup screen shows. Nothing here calls a provider.
 *
 * Leagues AllFantasy runs, with weekly lineups: never best ball (no lineup to set) and never guillotine
 * (a chopped team has no games, and a surviving one is never "out of the race" until it is chopped).
 * The rule is the commissioner's; it is enforced only while the league OWNER has AF Commissioner, so a
 * lapsed plan stops the run rather than leaving a paid rule running for free.
 */

export type EliminatedTeamView = {
  rosterId: string
  teamName: string
  reason: EliminationReason
  /** Null when the lineup could not be read (no saved roster, no starter slots). */
  shortfall: LineupShortfall | null
  /** The shortfall in words, players named; null when it meets the standard. */
  text: { en: string; es: string } | null
  managedByAllFantasy: boolean
}

export type EliminatedLineupView =
  | { supported: false; reason: 'not_native' | 'automatic_lineups' | 'guillotine' | 'no_season' | 'no_playoff_size' }
  | {
      supported: true
      rule: EliminatedLineupRule | null
      /** The league owner has AF Commissioner, which the rule needs. */
      available: boolean
      week: number | null
      playoffTeams: number
      teams: EliminatedTeamView[]
    }

type LeagueRow = NonNullable<Awaited<ReturnType<typeof loadLeague>>>

function loadLeague(leagueId: string) {
  return prisma.league.findUnique({
    where: { id: leagueId },
    select: {
      id: true, name: true, userId: true, platform: true, sport: true, season: true, settings: true, status: true,
      lifecycleState: true, leagueType: true, leagueVariant: true, bestBallMode: true, guillotineMode: true,
      lockAllMoves: true, playoffTeams: true,
    },
  })
}

function refusal(league: LeagueRow): Exclude<EliminatedLineupView, { supported: true }>['reason'] | null {
  if (resolveWriteAuthority(league.platform) !== 'NATIVE') return 'not_native'
  if (league.bestBallMode || automaticLineup(league.leagueType, league.settings)) return 'automatic_lineups'
  if (league.guillotineMode || String(league.leagueVariant ?? '').toLowerCase() === 'guillotine') return 'guillotine'
  return null
}

type TeamLineup = {
  rosterId: string
  ownerUserId: string
  teamName: string
  reason: EliminationReason
  playerData: unknown
  starters: string[]
}

type LeagueState = {
  week: number
  playoffTeams: number
  slots: ReturnType<typeof resolveLineupStarterSlots>
  eliminated: TeamLineup[]
}

/** Who is out of the race this week, with each one's saved lineup. */
async function readLeagueState(league: LeagueRow): Promise<LeagueState | 'no_season' | 'no_playoff_size'> {
  const season =
    (await prisma.redraftSeason.findFirst({ where: { leagueId: league.id, season: league.season }, select: { id: true, currentWeek: true, playoffStartWeek: true } })) ??
    (await prisma.redraftSeason.findFirst({ where: { leagueId: league.id }, orderBy: { season: 'desc' }, select: { id: true, currentWeek: true, playoffStartWeek: true } }))
  if (!season) return 'no_season'
  const [standings, rosters] = await Promise.all([
    prisma.redraftRoster.findMany({ where: { seasonId: season.id }, select: { id: true, ownerId: true, teamName: true, ownerName: true, wins: true, losses: true, ties: true, playoffSeed: true } }),
    prisma.roster.findMany({ where: { leagueId: league.id }, select: { id: true, platformUserId: true, redraftRosterId: true, playerData: true } }),
  ])
  const format = readPlayoffFormat(league.settings, standings.length, league.playoffTeams)
  if (format.playoffTeamsSource !== 'league') return 'no_playoff_size'
  const week = leagueWeekFromSettings(league.settings) ?? season.currentWeek

  const out = eliminatedTeams({
    teams: standings.map((r) => ({ rosterId: r.id, wins: r.wins, losses: r.losses, ties: r.ties, playoffSeed: r.playoffSeed })),
    playoffTeams: format.playoffTeams,
    playoffStartWeek: season.playoffStartWeek,
    currentWeek: week,
  })

  const sport = String(league.sport ?? 'NFL')
  const template = await getRosterTemplateForLeague(sport as never, getFormatTypeForVariant(sport, league.leagueVariant ?? undefined), league.id).catch(() => null)
  const slots = resolveLineupStarterSlots(league as never, template)

  // The lineup lives on `Roster`; standings on `RedraftRoster`. The link column first, then the owner.
  const eliminated: TeamLineup[] = []
  for (const r of standings) {
    const reason = out.get(r.id)
    if (!reason) continue
    const roster = rosters.find((x) => x.redraftRosterId === r.id) ?? rosters.find((x) => !x.redraftRosterId && x.platformUserId === r.ownerId)
    if (!roster) continue
    eliminated.push({
      rosterId: roster.id,
      ownerUserId: roster.platformUserId,
      teamName: r.teamName?.trim() || r.ownerName || 'A team',
      reason,
      playerData: roster.playerData,
      starters: buildLineupListsFromPlayerData(roster.playerData, slots.length).starters.filter(Boolean),
    })
  }
  return { week, playoffTeams: format.playoffTeams, slots, eliminated }
}

type PlayerFacts = Record<string, LineupPlayerInfo & { name: string; byeWeek: number | null; injuryStatus: string | null }>

/** The team's players as its own lineup screen shows them. */
async function readPlayers(leagueId: string, ownerUserId: string): Promise<PlayerFacts> {
  const rows = await getNormalizedPlayerData({ surface: 'roster', leagueId, userId: ownerUserId, limit: 200 })
  const out: PlayerFacts = {}
  for (const p of rows.map(serializeUnifiedPlayerForApi)) {
    out[p.id] = { position: p.position, projectedPoints: p.projectedPoints, name: p.name, byeWeek: p.product.byeWeek ?? null, injuryStatus: p.injuryStatus }
  }
  return out
}

async function readLocks(league: LeagueRow, rosterId: string, playerData: unknown, week: number) {
  return resolveFullLineupLockContext({
    leagueId: league.id,
    rosterId,
    sport: String(league.sport ?? 'NFL'),
    leagueVariant: league.leagueVariant,
    settings: league.settings,
    leagueWeek: week,
    editingWeek: week,
    season: league.season,
    now: new Date(),
    playerData,
    lockAllMoves: league.lockAllMoves,
    lifecycleState: league.lifecycleState,
  })
}

function checkStarters(starters: readonly string[], slotCount: number, players: PlayerFacts, locked: ReadonlySet<string>): StarterCheck[] {
  const filled: StarterCheck[] = starters.map((id) => ({
    playerId: id,
    byeWeek: players[id]?.byeWeek ?? null,
    injuryStatus: players[id]?.injuryStatus ?? null,
    started: locked.has(id),
  }))
  return [...filled, ...Array.from({ length: Math.max(0, slotCount - starters.length) }, () => null)]
}

const shortfallSize = (s: LineupShortfall) => s.emptySlots + s.byeStarters.length + s.outStarters.length

function shortfallText(s: LineupShortfall, players: PlayerFacts): { en: string; es: string } | null {
  if (meetsMinimum(s)) return null
  const name = (id: string) => players[id]?.name ?? 'a player'
  return { en: describeShortfall(s, name, 'en'), es: describeShortfall(s, name, 'es') }
}

/** Commissioner or co-commissioner: the rule, and every team it applies to this week. */
export async function readEliminatedLineupView(leagueId: string, userId: string): Promise<{ ok: true; view: EliminatedLineupView } | { ok: false; status: 403 | 404 }> {
  if (!(await isElevatedCommissioner(leagueId, userId))) return { ok: false, status: 403 }
  const league = await loadLeague(leagueId)
  if (!league) return { ok: false, status: 404 }
  const refused = refusal(league)
  if (refused) return { ok: true, view: { supported: false, reason: refused } }
  const state = await readLeagueState(league)
  if (typeof state === 'string') return { ok: true, view: { supported: false, reason: state } }

  const rule = readEliminatedLineupRule(league.settings)
  // Before the rule is on, show what the stricter standard would find.
  const standard: LineupStandard = rule?.standard ?? 'playable'
  const managed = readManagedLineups(league.settings)
  const teams: EliminatedTeamView[] = []
  for (const t of state.eliminated) {
    let shortfall: LineupShortfall | null = null
    let text: EliminatedTeamView['text'] = null
    if (state.slots.length > 0) {
      const [players, lock] = await Promise.all([readPlayers(leagueId, t.ownerUserId).catch(() => ({}) as PlayerFacts), readLocks(league, t.rosterId, t.playerData, state.week).catch(() => null)])
      shortfall = lineupShortfall({ starters: checkStarters(t.starters, state.slots.length, players, new Set(lock?.lockedPlayerIds ?? [])), week: state.week, standard })
      text = shortfallText(shortfall, players)
    }
    teams.push({ rosterId: t.rosterId, teamName: t.teamName, reason: t.reason, shortfall, text, managedByAllFantasy: Boolean(managed[t.rosterId]) })
  }
  return {
    ok: true,
    view: { supported: true, rule, available: await ownerHasAfCommissionerPlan(league.userId), week: state.week, playoffTeams: state.playoffTeams, teams },
  }
}

export type EliminatedLineupRunResult = {
  leagues: number
  teams: number
  filled: number
  notified: number
  skipped: Record<string, number>
  failures: { leagueId: string; rosterId?: string; error: string }[]
}

const DEFAULT_LEAGUE_LIMIT = 20

/** One notice per team per week: its key is the in-app row's `sourceKey`. */
const noticePrefix = (leagueId: string, rosterId: string, season: number, week: number) => `eliminated-lineup:${leagueId}:${rosterId}:${season}:${week}`

/**
 * Hourly: for every league with the rule on, each eliminated team whose lineup misses the standard —
 * fill only the failing slots (when the commissioner chose that), then tell the manager once that
 * week if it still falls short.
 */
export async function runEliminatedLineupMinimums(opts?: { limit?: number; deadline?: number }): Promise<EliminatedLineupRunResult> {
  const deadline = opts?.deadline ?? Date.now() + 25_000
  const result: EliminatedLineupRunResult = { leagues: 0, teams: 0, filled: 0, notified: 0, skipped: {}, failures: [] }
  const skip = (reason: string) => (result.skipped[reason] = (result.skipped[reason] ?? 0) + 1)
  const ids = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM leagues
    WHERE settings -> ${ELIMINATED_LINEUP_RULE_KEY} ->> 'enabled' = 'true'
    ORDER BY id LIMIT ${Math.max(1, Math.min(opts?.limit ?? DEFAULT_LEAGUE_LIMIT, 100))}`

  for (const { id: leagueId } of ids) {
    if (Date.now() >= deadline) break
    result.leagues += 1
    try {
      const league = await loadLeague(leagueId)
      const rule = league ? readEliminatedLineupRule(league.settings) : null
      if (!league || !rule) continue
      const status = String(league.status ?? league.lifecycleState ?? '').toLowerCase()
      const reason = refusal(league) ?? (!['active', 'in_season'].includes(status) ? 'not_in_season' : league.lockAllMoves ? 'moves_locked' : null)
      if (reason) {
        skip(reason)
        continue
      }
      if (!(await ownerHasAfCommissionerPlan(league.userId))) {
        skip('not_entitled')
        continue
      }
      const state = await readLeagueState(league)
      if (typeof state === 'string') {
        skip(state)
        continue
      }
      if (state.slots.length === 0) {
        skip('no_slots')
        continue
      }
      const managed = readManagedLineups(league.settings)

      for (const team of state.eliminated) {
        if (Date.now() >= deadline) break
        result.teams += 1
        try {
          const [players, lock] = await Promise.all([readPlayers(leagueId, team.ownerUserId), readLocks(league, team.rosterId, team.playerData, state.week)])
          if (lock.locked) {
            skip('lineup_locked')
            continue
          }
          const locked = new Set(lock.lockedPlayerIds)
          let shortfall = lineupShortfall({ starters: checkStarters(team.starters, state.slots.length, players, locked), week: state.week, standard: rule.standard })
          if (meetsMinimum(shortfall)) continue

          // Inactive manager mode already sets this team's best lineup every hour; never fight it.
          if (rule.autoFill && !managed[team.rosterId]) {
            const filled = await fillShortSlots(league, team, state, players, locked, shortfall, rule.standard)
            if (filled) {
              result.filled += 1
              shortfall = filled
            }
          }
          if (meetsMinimum(shortfall)) continue
          if (await notifyManager(league, team, state.week, shortfall, players)) result.notified += 1
        } catch (e) {
          result.failures.push({ leagueId, rosterId: team.rosterId, error: e instanceof Error ? e.message : String(e) })
        }
      }
    } catch (e) {
      result.failures.push({ leagueId, error: e instanceof Error ? e.message : String(e) })
    }
  }
  return result
}

/**
 * Seat the bench into the failing slots only: every starter who meets the standard (and everyone whose
 * game has started) is held in place, so the optimiser can move nobody else. Saved only when the
 * lineup it produces falls short by less than the one it replaces. Returns the new shortfall, or null
 * when nothing was saved.
 */
async function fillShortSlots(
  league: LeagueRow,
  team: TeamLineup,
  state: LeagueState,
  players: PlayerFacts,
  locked: ReadonlySet<string>,
  before: LineupShortfall,
  standard: LineupStandard,
): Promise<LineupShortfall | null> {
  const failing = failingStarters(before)
  const hold = new Set([...locked, ...team.starters.filter((id) => !failing.has(id))])
  const plan = planBestLineup({ slots: state.slots, playerData: team.playerData, players, isLocked: (id) => hold.has(id) })
  if (plan.kind !== 'set') return null
  const nextStarters = buildLineupListsFromPlayerData(plan.nextPlayerData, state.slots.length).starters.filter(Boolean)
  const after = lineupShortfall({ starters: checkStarters(nextStarters, state.slots.length, players, locked), week: state.week, standard })
  if (shortfallSize(after) >= shortfallSize(before)) return null

  const pd = team.playerData && typeof team.playerData === 'object' ? (team.playerData as Record<string, unknown>) : {}
  const name = (id: string | null) => (id ? players[id]?.name ?? id : 'empty')
  const saved = await persistRosterLineupWithEngine({
    leagueId: league.id,
    rosterId: team.rosterId,
    actorUserId: team.ownerUserId,
    expectedOwnerUserId: team.ownerUserId,
    season: league.season,
    week: state.week,
    source: 'system',
    nextPlayerData: plan.nextPlayerData,
    ...(Array.isArray(pd.starters) ? { expectedStarters: pd.starters.map(String) } : {}),
    automationAudit: {
      id: `eliminated-lineup-fill:${JSON.stringify([league.id, team.rosterId, league.season, state.week, Date.now()])}`,
      action: 'eliminated_lineup.filled',
      message: `League rule for eliminated teams: AllFantasy filled ${team.teamName}'s short lineup: ${plan.changes.map((c) => `${c.slot} ${name(c.out)} → ${name(c.in)}`).join('; ')}.`,
      metadata: { season: league.season, week: state.week, changes: plan.changes },
    },
  })
  return saved.ok ? after : null
}

async function notifyManager(league: LeagueRow, team: TeamLineup, week: number, shortfall: LineupShortfall, players: PlayerFacts): Promise<boolean> {
  const prefix = noticePrefix(league.id, team.rosterId, league.season, week)
  const sent = await prisma.platformNotification.findFirst({ where: { sourceKey: `${prefix}:${team.ownerUserId}` }, select: { id: true } })
  if (sent) return false
  const text = shortfallText(shortfall, players)
  if (!text) return false
  const { dispatchNotification } = await import('@/lib/notifications/NotificationDispatcher')
  const leagueName = league.name ?? 'your league'
  await dispatchNotification({
    userIds: [team.ownerUserId],
    category: 'league_announcements',
    type: 'eliminated_lineup_minimum',
    title: `Set a full lineup for week ${week}`,
    body: `${leagueName} requires teams out of the playoff race to start a full lineup. Yours has ${text.en}. Fix it before kickoff.`,
    smsBody: `AllFantasy: your ${leagueName} lineup for week ${week} is short. Open the app to fix it before kickoff.`,
    actionHref: `/core/my-team?league=${encodeURIComponent(league.id)}`,
    actionLabel: 'Set lineup',
    leagueId: league.id,
    severity: 'medium',
    dedupePrefix: prefix,
    meta: { week, season: league.season, rosterId: team.rosterId },
  })
  return true
}

/**
 * Commish OS: one task per week naming every eliminated team still short of the league's standard.
 * Keyed by season and week, so the next week's scan closes it; fixing the lineups closes it sooner.
 * Rule off, or the owner's plan lapsed: nothing — the rule is not being enforced, so there is nothing
 * for the commissioner to act on. A failed read throws, as the other task sources do.
 */
export async function readEliminatedLineupTasks(leagueId: string): Promise<WorkspaceTaskCandidate[]> {
  const league = await loadLeague(leagueId)
  const rule = league ? readEliminatedLineupRule(league.settings) : null
  if (!league || !rule || refusal(league)) return []
  if (!(await ownerHasAfCommissionerPlan(league.userId))) return []
  const state = await readLeagueState(league)
  if (typeof state === 'string' || state.slots.length === 0) return []

  const short: string[] = []
  for (const team of state.eliminated) {
    const [players, lock] = await Promise.all([readPlayers(leagueId, team.ownerUserId), readLocks(league, team.rosterId, team.playerData, state.week)])
    if (lock.locked) continue
    const s = lineupShortfall({ starters: checkStarters(team.starters, state.slots.length, players, new Set(lock.lockedPlayerIds)), week: state.week, standard: rule.standard })
    const text = shortfallText(s, players)
    if (text) short.push(`${team.teamName} (${text.en})`)
  }
  if (short.length === 0) return []
  return [
    {
      sourceKey: `eliminated-lineup-minimum:${league.season}:${state.week}:v1`,
      title: short.length === 1 ? 'An eliminated team is short of the lineup minimum' : `${short.length} eliminated teams are short of the lineup minimum`,
      description:
        `Week ${state.week}: ${short.join('; ')}. ` +
        (rule.autoFill
          ? 'AllFantasy fills these from each team’s bench when it can; what is left needs the manager or you.'
          : 'AllFantasy tells each manager once a week. You can set the lineup yourself, or turn on auto-fill.'),
      priority: 'standard',
      // Whether to fill another manager's lineup is the commissioner's rule, already chosen.
      automationCandidate: false,
      relatedLinks: [{ label: 'Commissioner Hub', moduleId: 'managers', href: `/core/commissioner?league=${encodeURIComponent(leagueId)}#ch-eliminated-lineups` }],
    },
  ]
}
