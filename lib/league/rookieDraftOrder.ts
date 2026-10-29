/**
 * lib/league/rookieDraftOrder.ts
 * Computes rookie draft order for dynasty/C2C/devy leagues (future seasons).
 *
 * Two modes:
 * 1. WORST_TO_FIRST: Non-playoff teams by worst record (fewest wins, then fewest PF).
 *    Playoff teams by seeding. Champion picks last, runner-up picks 2nd to last.
 *
 * 2. REVERSE_MAX_PF: Non-playoff teams by lowest Max PF (points for, last week of
 *    regular season). Playoff teams by seeding. Champion last, runner-up 2nd to last.
 *
 * The system auto-calculates using end-of-regular-season data (before playoffs start)
 * for non-playoff teams and playoff seeding/results for playoff teams.
 *
 * 🛑 ONE RULE, THE ENGINE'S (phase 9, 2026-10-29). This file used to sort teams itself, and it disagreed
 * with the live order (`lib/rookie-order/rookieOrderEngine.ts`): it ordered playoff teams by
 * regular-season rank, so the top seed picked last as "Champion" whoever won the title (a 4th seed who
 * won the final picked 6th of 9 in the dynasty full-season simulation). Now, whenever the league has a
 * season to read (`loadRookieOrderInput`, native and imported alike), the order IS the engine's, with
 * `worst_to_first` → reverse record and `reverse_max_pf` → reverse Max PF for the non-playoff teams and
 * the playoff finish, then seed, for the playoff field — the same rule the live order uses by default.
 * The old sort below runs only when there is no season to read, or a team cannot be matched.
 */

import { prisma } from '@/lib/prisma'
import { buildRosterIdResolver } from '@/lib/league/league-settings-draft-sync'
import { computeRookieOrder, type RookieOrderConfig } from '@/lib/rookie-order/rookieOrderEngine'

export type RookieDraftOrderMode = 'worst_to_first' | 'reverse_max_pf'

export interface RookieDraftSlot {
  slot: number
  teamId: string
  teamName: string
  ownerName: string
  avatarUrl: string | null
  /** Stat used for ordering: wins (worst_to_first) or maxPF (reverse_max_pf) */
  orderValue: number
  orderLabel: string
  isPlayoffTeam: boolean
  playoffFinish: string | null // 'Champion', 'Runner-Up', 'Seed 3', etc.
}

export interface RookieDraftOrderResult {
  mode: RookieDraftOrderMode
  season: number // The season this draft order is FOR (next season)
  basedOnSeason: number // The season data is FROM
  slots: RookieDraftSlot[]
  playoffTeamCount: number
  nonPlayoffTeamCount: number
  warning: string | null
}

/**
 * Compute rookie draft order for the next season.
 * Uses current season's data: end-of-regular-season standings for non-playoff,
 * and playoff results for playoff teams.
 */
export async function computeRookieDraftOrder(
  leagueId: string,
  mode: RookieDraftOrderMode
): Promise<RookieDraftOrderResult> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: {
      id: true, season: true, leagueSize: true, settings: true,
      teams: {
        select: {
          id: true, teamName: true, ownerName: true, avatarUrl: true,
          wins: true, losses: true, ties: true, pointsFor: true,
          currentRank: true, isOrphan: true, claimedByUserId: true, externalId: true, platformUserId: true,
        },
        orderBy: { pointsFor: 'desc' },
      },
    },
  })

  if (!league) {
    return emptyResult(mode, 0, 'League not found')
  }

  const currentSeason = league.season ?? new Date().getFullYear()
  const nextSeason = currentSeason + 1
  const settings = (league.settings as Record<string, unknown>) ?? {}

  // Get active (non-orphan) teams
  const activeTeams = league.teams.filter(t => !t.isOrphan)
  if (activeTeams.length === 0) {
    return emptyResult(mode, nextSeason, 'No active teams')
  }

  // The engine's order, whenever there is a season to read — the one rule both orders follow.
  const fromEngine = await engineRookieDraftOrder(leagueId, mode, activeTeams).catch(() => null)
  if (fromEngine) return fromEngine

  // Determine playoff team count from settings
  const playoffTeamCount = resolvePlayoffTeamCount(settings, activeTeams.length)

  // Sort all teams by wins desc, then points for desc to determine playoff teams
  const sorted = [...activeTeams].sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins
    return (b.pointsFor ?? 0) - (a.pointsFor ?? 0)
  })

  const playoffTeamIds = new Set(sorted.slice(0, playoffTeamCount).map(t => t.id))

  // Separate into non-playoff and playoff groups
  const nonPlayoff = activeTeams.filter(t => !playoffTeamIds.has(t.id))
  const playoff = activeTeams.filter(t => playoffTeamIds.has(t.id))

  // ─── Sort non-playoff teams ───
  if (mode === 'worst_to_first') {
    // Worst record first: fewest wins, then fewest PF as tiebreaker
    nonPlayoff.sort((a, b) => {
      if (a.wins !== b.wins) return a.wins - b.wins
      return (a.pointsFor ?? 0) - (b.pointsFor ?? 0)
    })
  } else {
    // Reverse Max PF: lowest points for first (end of regular season)
    nonPlayoff.sort((a, b) => (a.pointsFor ?? 0) - (b.pointsFor ?? 0))
  }

  // ─── Sort playoff teams by seeding (worst seed first, champion last) ───
  // Use currentRank if available, otherwise wins desc
  playoff.sort((a, b) => {
    const rankA = a.currentRank ?? 999
    const rankB = b.currentRank ?? 999
    // Higher rank number = worse seed = picks earlier
    // Reverse: worst playoff seed picks first, champion (rank 1) picks last
    return rankB - rankA
  })

  // ─── Build ordered slots ───
  const slots: RookieDraftSlot[] = []
  let slotNum = 1

  // Non-playoff teams first
  for (const team of nonPlayoff) {
    slots.push({
      slot: slotNum++,
      teamId: team.id,
      teamName: team.teamName,
      ownerName: team.ownerName,
      avatarUrl: team.avatarUrl,
      orderValue: mode === 'worst_to_first' ? team.wins : (team.pointsFor ?? 0),
      orderLabel: mode === 'worst_to_first'
        ? `${team.wins}-${team.losses}${team.ties ? `-${team.ties}` : ''}`
        : `${(team.pointsFor ?? 0).toFixed(1)} PF`,
      isPlayoffTeam: false,
      playoffFinish: null,
    })
  }

  // Playoff teams (champion last, runner-up 2nd to last)
  for (let i = 0; i < playoff.length; i++) {
    const team = playoff[i]
    const isLast = i === playoff.length - 1
    const isSecondLast = i === playoff.length - 2

    let playoffFinish: string
    if (isLast) playoffFinish = 'Champion'
    else if (isSecondLast) playoffFinish = 'Runner-Up'
    else playoffFinish = `Seed ${team.currentRank ?? (playoffTeamCount - i)}`

    slots.push({
      slot: slotNum++,
      teamId: team.id,
      teamName: team.teamName,
      ownerName: team.ownerName,
      avatarUrl: team.avatarUrl,
      orderValue: mode === 'worst_to_first' ? team.wins : (team.pointsFor ?? 0),
      orderLabel: playoffFinish,
      isPlayoffTeam: true,
      playoffFinish,
    })
  }

  return {
    mode,
    season: nextSeason,
    basedOnSeason: currentSeason,
    slots,
    playoffTeamCount: playoff.length,
    nonPlayoffTeamCount: nonPlayoff.length,
    warning: null,
  }
}

/**
 * Save the rookie draft order mode to league settings.
 */
export async function saveRookieDraftOrderConfig(
  leagueId: string,
  config: {
    mode: RookieDraftOrderMode
    enabled: boolean
    userId: string
  }
): Promise<void> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { settings: true },
  })
  const settings = (league?.settings as Record<string, unknown>) ?? {}

  await prisma.league.update({
    where: { id: leagueId },
    data: {
      settings: {
        ...settings,
        rookie_draft_order: {
          mode: config.mode,
          enabled: config.enabled,
          lastUpdatedAt: new Date().toISOString(),
          lastUpdatedBy: config.userId,
        },
      },
    },
  })
}

/**
 * Get saved rookie draft order config from league settings.
 */
export async function getRookieDraftOrderConfig(
  leagueId: string
): Promise<{ mode: RookieDraftOrderMode; enabled: boolean } | null> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { settings: true },
  })
  const settings = (league?.settings as Record<string, unknown>) ?? {}
  const config = settings.rookie_draft_order as { mode?: string; enabled?: boolean } | undefined
  if (!config) return null
  return {
    mode: (config.mode === 'reverse_max_pf' ? 'reverse_max_pf' : 'worst_to_first') as RookieDraftOrderMode,
    enabled: Boolean(config.enabled),
  }
}

// ─── Helpers ───

function resolvePlayoffTeamCount(settings: Record<string, unknown>, teamCount: number): number {
  const explicit = settings.playoff_teams ?? settings.playoffTeamCount ?? settings.playoff_team_count
  if (typeof explicit === 'number' && explicit > 0) return Math.min(explicit, teamCount)
  // Default: top half, max 6
  return Math.min(6, Math.ceil(teamCount / 2))
}

function emptyResult(mode: RookieDraftOrderMode, season: number, warning: string): RookieDraftOrderResult {
  return { mode, season, basedOnSeason: season - 1, slots: [], playoffTeamCount: 0, nonPlayoffTeamCount: 0, warning }
}

type OrderTeamRow = {
  id: string
  teamName: string
  ownerName: string
  avatarUrl: string | null
  wins: number
  losses: number
  ties: number
  pointsFor: number | null
  claimedByUserId: string | null
  externalId: string
  platformUserId: string | null
}

/** The legacy modes as engine settings: they differ only in how the non-playoff teams are ordered. */
export const LEGACY_MODE_ENGINE_CONFIG: Record<RookieDraftOrderMode, RookieOrderConfig> = {
  worst_to_first: { nonPlayoff: 'reverse_record', playoff: 'finish_then_seed', withinRound: 'worse_seed' },
  reverse_max_pf: { nonPlayoff: 'reverse_max_pf', playoff: 'finish_then_seed', withinRound: 'worse_seed' },
}

/**
 * The engine's order as this file's slots, or null when there is no season to read or any engine team
 * cannot be matched to one of the league's teams (a partial order is never returned).
 */
async function engineRookieDraftOrder(
  leagueId: string,
  mode: RookieDraftOrderMode,
  teams: readonly OrderTeamRow[],
): Promise<RookieDraftOrderResult | null> {
  const { loadRookieOrderInput } = await import('@/lib/rookie-order/loadRookieOrderInput')
  const loaded = await loadRookieOrderInput(leagueId)
  if (!loaded || !loaded.input.regularSeasonComplete) return null
  const result = computeRookieOrder({ ...loaded.input, config: LEGACY_MODE_ENGINE_CONFIG[mode] })
  if (result.slots.length !== teams.length) return null

  // Engine team → live-draft roster → this league's team.
  const rosters = await prisma.roster.findMany({ where: { leagueId }, select: { id: true, platformUserId: true } })
  const resolveRosterId = buildRosterIdResolver(rosters, teams)
  const teamByRoster = new Map<string, OrderTeamRow>()
  for (const t of teams) {
    const rosterId = resolveRosterId(t.id)
    if (rosterId) teamByRoster.set(rosterId, t)
  }
  const slots: RookieDraftSlot[] = []
  for (const s of result.slots) {
    const rosterId = loaded.rosterIdForTeam.get(s.teamId)
    const team = rosterId ? teamByRoster.get(rosterId) : undefined
    if (!team) return null
    const playoff = s.group === 'playoff'
    slots.push({
      slot: s.slot,
      teamId: team.id,
      teamName: team.teamName,
      ownerName: team.ownerName,
      avatarUrl: team.avatarUrl,
      orderValue: mode === 'worst_to_first' ? team.wins : (team.pointsFor ?? 0),
      orderLabel: playoff
        ? s.finish ?? 'Playoffs'
        : mode === 'worst_to_first'
          ? `${team.wins}-${team.losses}${team.ties ? `-${team.ties}` : ''}`
          : `${(team.pointsFor ?? 0).toFixed(1)} PF`,
      isPlayoffTeam: playoff,
      playoffFinish: playoff ? s.finish : null,
    })
  }
  if (new Set(slots.map((s) => s.teamId)).size !== slots.length) return null
  const playoffCount = slots.filter((s) => s.isPlayoffTeam).length
  return {
    mode,
    season: loaded.season + 1,
    basedOnSeason: loaded.season,
    slots,
    playoffTeamCount: playoffCount,
    nonPlayoffTeamCount: slots.length - playoffCount,
    warning: result.warnings.length ? result.warnings.join(' ') : null,
  }
}
