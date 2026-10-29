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
 * 🛑 PLAYOFF TEAMS WERE ORDERED BY REGULAR-SEASON RANK, NOT BY HOW THE PLAYOFFS ENDED. The top seed was
 * labelled "Champion" and picked last whoever won the title; the dynasty full-season simulation
 * (phase 8, 2026-10-29) caught a 4th seed who won the final picking 6th of 9. For a league played on
 * AllFantasy whose season bracket is complete, the playoff field and its order now come from the
 * bracket's final standings (`RedraftPlayoffBracket.structure.finalStandings`): worst finish first,
 * the runner-up second to last, the champion last. Without a finished bracket (an imported league,
 * a season still being played) the older read stands.
 *
 * AF Commissioner Subscription required.
 */

import { prisma } from '@/lib/prisma'

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
          currentRank: true, isOrphan: true, claimedByUserId: true,
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

  // Determine playoff team count from settings
  const playoffTeamCount = resolvePlayoffTeamCount(settings, activeTeams.length)

  // Sort all teams by wins desc, then points for desc to determine playoff teams
  const sorted = [...activeTeams].sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins
    return (b.pointsFor ?? 0) - (a.pointsFor ?? 0)
  })

  // The finished bracket, when there is one: who made the field, and where each team finished.
  const finish = await loadBracketFinish(leagueId, activeTeams)
  const playoffTeamIds = finish ? new Set(finish.keys()) : new Set(sorted.slice(0, playoffTeamCount).map(t => t.id))

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
  if (finish) {
    // Worst finish first; the champion (finish 1) last.
    playoff.sort((a, b) => finish.get(b.id)!.finish - finish.get(a.id)!.finish)
  } else playoff.sort((a, b) => {
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
    const done = finish?.get(team.id)
    if (done) playoffFinish = done.champion ? 'Champion' : done.runnerUp ? 'Runner-Up' : `Finished ${ordinal(done.finish)}`
    else if (isLast) playoffFinish = 'Champion'
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

const ordinal = (n: number) => {
  const v = n % 100
  const suffix = v >= 11 && v <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'
  return `${n}${suffix}`
}

type BracketFinish = { finish: number; champion: boolean; runnerUp: boolean }

/**
 * League team id → its playoff finish, from the most recent completed season's finished bracket. Null
 * unless EVERY playoff team in the bracket maps to one of this league's teams (by owner) — a partial
 * map would order some playoff teams by the bracket and leave others out of the field.
 */
async function loadBracketFinish(
  leagueId: string,
  teams: ReadonlyArray<{ id: string; claimedByUserId: string | null }>,
): Promise<Map<string, BracketFinish> | null> {
  const season = await prisma.redraftSeason
    .findFirst({
      where: { leagueId, status: 'complete', playoffBracket: { status: 'complete' } },
      orderBy: { season: 'desc' },
      select: { id: true, playoffBracket: { select: { structure: true } } },
    })
    .catch(() => null)
  const rows = (season?.playoffBracket?.structure as { finalStandings?: unknown } | null)?.finalStandings
  if (!season || !Array.isArray(rows) || rows.length === 0) return null
  const rosters = await prisma.redraftRoster.findMany({ where: { seasonId: season.id }, select: { id: true, ownerId: true } })
  const ownerOf = new Map(rosters.map((r) => [r.id, r.ownerId]))
  const teamOfOwner = new Map(teams.filter((t) => t.claimedByUserId).map((t) => [t.claimedByUserId!, t.id]))
  const out = new Map<string, BracketFinish>()
  for (const raw of rows as Array<Record<string, unknown>>) {
    // Only the playoff field: a final standing with a seed. Non-playoff teams keep the record order.
    if (raw.seed == null || typeof raw.rosterId !== 'string' || typeof raw.finish !== 'number') continue
    const teamId = teamOfOwner.get(ownerOf.get(raw.rosterId) ?? '')
    if (!teamId) return null
    out.set(teamId, { finish: raw.finish, champion: raw.champion === true, runnerUp: raw.runnerUp === true })
  }
  return out.size > 0 ? out : null
}
