/**
 * User OS League-Specific Intelligence Wiring phase — Part 4.
 *
 * The canonical, server-only context assembler every domain generator reads
 * from. Contains only what's needed to make real decisions — never a raw
 * provider payload, never a credential. Every field is either a real
 * database value or an honest `null`/absence; nothing here is fabricated to
 * fill a gap. When a domain genuinely can't be supported for this league
 * (no claimed roster, missing scoring, etc.), that's recorded in
 * `unavailableDomains` rather than silently producing empty output that
 * looks identical to "nothing to recommend right now."
 */
import { prisma } from '@/lib/prisma'
import { resolveActiveLeagueContext } from './activeLeagueContext'
import { resolveRedraftCurrentWeek } from '@/lib/redraft/resolveRedraftCurrentWeek'
import { isDomainSupportedForSport, NFL_ONLY_DOMAINS_LIST } from './sportSupport'
import type { ActiveLeagueContext, LeagueHubProvider, SyncFreshness } from './types'

export interface RosterPlayerEntry {
  id: string
  name: string
  team: string
  position: string
  opponent: string
  gameTime: string
  projection: number
  actual: number | null
  /** Cached at roster-save time — freshness not guaranteed. Cross-check against `injuryByPlayerId` (live cron-fed) before treating as current. */
  status: string
}

export interface UserOsTeamStanding {
  teamId: string
  teamName: string
  wins: number
  losses: number
  ties: number
  pointsFor: number
  pointsAgainst: number
  currentRank: number | null
  isViewerTeam: boolean
}

export interface UserOsInjuryRecord {
  playerId: string
  status: string
  gameStatus: string | null
  reportDate: string
}

export interface UserOsContext {
  appUserId: string
  canonicalLeagueId: string
  provider: LeagueHubProvider
  sport: string
  season: number | string | null
  isDynasty: boolean
  scoring: string | null
  currentWeek: number
  /** Real `League.playoffTeams`/`playoffStartWeek` — never assumed as 6-team/week-14 defaults by a consumer. */
  playoffTeams: number | null
  playoffStartWeek: number | null
  teamId: string | null
  rosterId: string | null
  isCommissioner: boolean
  /** Null when the viewer has no claimed team on this league — lineup/roster/trade domains must degrade honestly, never fabricate a roster. */
  viewerTeam: UserOsTeamStanding | null
  lineup: {
    starters: RosterPlayerEntry[]
    bench: RosterPlayerEntry[]
    ir: RosterPlayerEntry[]
  } | null
  /** Every team's real standing — used for strategy/playoff-path context, never another team's private roster contents. */
  standings: UserOsTeamStanding[]
  /** Live `InjuryReportRecord` rows for every player id appearing in the viewer's own lineup — keyed for O(1) lookup. */
  injuryByPlayerId: Map<string, UserOsInjuryRecord>
  syncFreshness: SyncFreshness
  /** Cached `SeasonForecastSnapshot` (read-only — this assembler never triggers a new simulation). Null when none exists yet. */
  latestForecastWeek: number | null
  playoffForecastByTeamId: Map<string, { playoffProbability: number; expectedFinalSeed: number }> | null
  /** Real, honest list of domains this context cannot safely support for this specific request — e.g. `['lineup', 'roster']` when the viewer has no claimed team. Domain generators MUST check this before producing output. */
  unavailableDomains: string[]
}

function toRosterPlayerEntry(raw: unknown): RosterPlayerEntry | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (typeof r.id !== 'string') return null
  return {
    id: r.id,
    name: typeof r.name === 'string' ? r.name : '',
    team: typeof r.team === 'string' ? r.team : '',
    position: typeof r.position === 'string' ? r.position : '',
    opponent: typeof r.opponent === 'string' ? r.opponent : '',
    gameTime: typeof r.gameTime === 'string' ? r.gameTime : '',
    projection: typeof r.projection === 'number' ? r.projection : 0,
    actual: typeof r.actual === 'number' ? r.actual : null,
    status: typeof r.status === 'string' ? r.status : '',
  }
}

function extractLineupSection(playerData: unknown, section: 'starters' | 'bench' | 'ir'): RosterPlayerEntry[] {
  if (!playerData || typeof playerData !== 'object') return []
  const sections = (playerData as Record<string, unknown>)['lineup_sections']
  if (!sections || typeof sections !== 'object') return []
  const raw = (sections as Record<string, unknown>)[section]
  if (!Array.isArray(raw)) return []
  return raw.map(toRosterPlayerEntry).filter((p): p is RosterPlayerEntry => p !== null)
}

/**
 * Assembles the User OS context for one (appUserId, canonicalLeagueId) pair.
 * Fails closed identically to `resolveActiveLeagueContext`: returns `null`
 * when the caller has no real relationship to the league (never assumes
 * access from a league id alone).
 */
export async function assembleUserOsContext(args: {
  appUserId: string
  canonicalLeagueId: string
}): Promise<UserOsContext | null> {
  const active: ActiveLeagueContext | null = await resolveActiveLeagueContext({
    leagueId: args.canonicalLeagueId,
    userId: args.appUserId,
  })
  if (!active) return null

  const [league, teams, injuries] = await Promise.all([
    prisma.league.findUnique({
      where: { id: args.canonicalLeagueId },
      select: { isDynasty: true, playoffTeams: true, playoffStartWeek: true },
    }),
    prisma.leagueTeam.findMany({
      where: { leagueId: args.canonicalLeagueId },
      select: {
        id: true,
        teamName: true,
        wins: true,
        losses: true,
        ties: true,
        pointsFor: true,
        pointsAgainst: true,
        currentRank: true,
      },
    }),
    active.teamId
      ? prisma.roster.findFirst({
          where: { leagueId: args.canonicalLeagueId, platformUserId: args.appUserId },
          select: { playerData: true },
        })
      : Promise.resolve(null),
  ])

  const standings: UserOsTeamStanding[] = teams.map((t) => ({
    teamId: t.id,
    teamName: t.teamName,
    wins: t.wins,
    losses: t.losses,
    ties: t.ties,
    pointsFor: t.pointsFor,
    pointsAgainst: t.pointsAgainst,
    currentRank: t.currentRank,
    isViewerTeam: t.id === active.teamId,
  }))
  const viewerTeam = standings.find((s) => s.isViewerTeam) ?? null

  const lineup = injuries
    ? {
        starters: extractLineupSection(injuries.playerData, 'starters'),
        bench: extractLineupSection(injuries.playerData, 'bench'),
        ir: extractLineupSection(injuries.playerData, 'ir'),
      }
    : null

  const lineupPlayerIds = lineup
    ? [...lineup.starters, ...lineup.bench, ...lineup.ir].map((p) => p.id).filter(Boolean)
    : []
  const injuryRows = lineupPlayerIds.length
    ? await prisma.injuryReportRecord
        .findMany({
          where: { playerId: { in: lineupPlayerIds } },
          orderBy: { reportDate: 'desc' },
          select: { playerId: true, status: true, gameStatus: true, reportDate: true },
        })
        .catch(() => [])
    : []
  const injuryByPlayerId = new Map<string, UserOsInjuryRecord>()
  for (const row of injuryRows) {
    // Rows are ordered newest-first; keep only the first (most recent) per player.
    if (!injuryByPlayerId.has(row.playerId)) {
      injuryByPlayerId.set(row.playerId, {
        playerId: row.playerId,
        status: row.status,
        gameStatus: row.gameStatus,
        reportDate: row.reportDate.toISOString(),
      })
    }
  }

  const latestSnapshot = await prisma.seasonForecastSnapshot
    .findFirst({
      where: { leagueId: args.canonicalLeagueId },
      orderBy: { week: 'desc' },
      select: { week: true, teamForecasts: true },
    })
    .catch(() => null)
  let playoffForecastByTeamId: UserOsContext['playoffForecastByTeamId'] = null
  if (latestSnapshot && Array.isArray(latestSnapshot.teamForecasts)) {
    const map = new Map<string, { playoffProbability: number; expectedFinalSeed: number }>()
    for (const entry of latestSnapshot.teamForecasts as Array<Record<string, unknown>>) {
      const teamId = typeof entry?.teamId === 'string' ? entry.teamId : null
      const playoffProbability = typeof entry?.playoffProbability === 'number' ? entry.playoffProbability : null
      if (teamId && playoffProbability !== null) {
        map.set(teamId, {
          playoffProbability,
          expectedFinalSeed: typeof entry.expectedFinalSeed === 'number' ? entry.expectedFinalSeed : 0,
        })
      }
    }
    playoffForecastByTeamId = map
  }

  const unavailableDomains: string[] = []
  if (!active.teamId || !lineup) {
    unavailableDomains.push('lineup', 'roster')
  }
  for (const domain of NFL_ONLY_DOMAINS_LIST) {
    if (!isDomainSupportedForSport(domain, String(active.sport ?? 'NFL'))) {
      unavailableDomains.push(domain)
    }
  }

  return {
    appUserId: args.appUserId,
    canonicalLeagueId: active.canonicalLeagueId,
    provider: active.provider,
    sport: active.sport,
    season: active.season,
    isDynasty: league?.isDynasty ?? false,
    scoring: active.scoring,
    currentWeek: resolveRedraftCurrentWeek({ redraftSeasonCurrentWeek: null, legacySettingsWeek: null }),
    playoffTeams: league?.playoffTeams ?? null,
    playoffStartWeek: league?.playoffStartWeek ?? null,
    teamId: active.teamId,
    rosterId: active.rosterId,
    isCommissioner: active.isCommissioner,
    viewerTeam,
    lineup,
    standings,
    injuryByPlayerId,
    syncFreshness: active.syncFreshness,
    latestForecastWeek: latestSnapshot?.week ?? null,
    playoffForecastByTeamId,
    unavailableDomains: Array.from(new Set(unavailableDomains)),
  }
}
