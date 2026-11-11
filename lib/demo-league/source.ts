/**
 * Reads the demo SOURCE league straight from Postgres. Everything returned here is REAL
 * and identifying; it must only ever be handed to `buildDemoLeagueView` (which turns it
 * into fake-named output) and to the redactor (which uses the real values as the list of
 * strings that must never escape).
 *
 * DB-first by construction: no provider is called from here, so a demo request can
 * never trigger a sync, a provider fetch, or a credential on the wire. The source
 * league keeps syncing through its normal crons; the demo just reads the result.
 *
 * Coverage: imported leagues (Sleeper, ESPN, Fantrax, …) get standings and matchups from
 * `WeeklyMatchup`, which is keyed by the PROVIDER's league id, not ours. A league with no
 * weekly results falls back to the W/L columns on `LeagueTeam`.
 */
import 'server-only'
import { prisma } from '@/lib/prisma'
import { rosterPlayerIds } from '@/lib/core-app/myRoster'
import { resolveSleeperPlayers } from '@/lib/core-app/sleeperPlayerRefs'
import { resolveProviderRosterPlayers } from '@/lib/player-identity/resolveProviderRosterPlayers'
import { persistedRecentTrades } from '@/lib/core-app/persistedRecentTrades'
import type { RecentTrade, RecentTradesLeague } from '@/lib/core-app/recentTrades'
import { rosterIdsMatch } from '@/lib/core-app/rosterIdMatch'

export type SourceTeam = {
  /** Stable alias key: our LeagueTeam.id. */
  key: string
  externalId: string
  ownerName: string
  teamName: string
  avatarUrl: string | null
  platformUserId: string | null
  claimedByUserId: string | null
  wins: number
  losses: number
  ties: number
  pointsFor: number
  pointsAgainst: number
  currentRank: number | null
  isOrphan: boolean
}

export type SourcePlayer = { name: string; position: string | null; team: string | null; headshotUrl: string | null }

export type SourceRoster = { teamKey: string; starters: SourcePlayer[]; bench: SourcePlayer[]; emptyStarterSlots: number }

export type SourceWeekRow = { seasonYear: number; week: number; rosterId: string; matchupId: number | null; pointsFor: number; pointsAgainst: number; win: number }

export type SourceLeague = {
  id: string
  name: string | null
  platform: string
  platformLeagueId: string
  sport: string
  season: number
  scoring: string | null
  leagueType: string | null
  isDynasty: boolean
  leagueSize: number | null
  starters: unknown
  playoffTeams: number | null
  playoffStartWeek: number | null
  tradeDeadlineWeek: number | null
  waiverType: string | null
  lastSyncedAt: Date | null
  avatarUrl: string | null
  logoUrl: string | null
  userId: string
}

export type SourceSnapshot = {
  league: SourceLeague
  teams: SourceTeam[]
  /** Every AppUser linked to a team (or the importer) — identifiers only, for the redactor. */
  users: Array<{ id: string; email: string | null; username: string | null; displayName: string | null }>
  weekRows: SourceWeekRow[]
  rosters: SourceRoster[]
  trades: RecentTrade[]
  openAlertHeadlines: string[]
  tradeCountThisSeason: number
}

const TRADE_LOOKBACK_MS = 400 * 24 * 60 * 60 * 1000

function emptyToNull(s: string | null | undefined): string | null {
  const t = (s ?? '').trim()
  return t ? t : null
}

async function resolvePlayers(platform: string, sport: string, ids: string[]): Promise<Map<string, SourcePlayer>> {
  const out = new Map<string, SourcePlayer>()
  if (ids.length === 0) return out
  const p = platform.toLowerCase()
  if (p === 'sleeper' && sport.toUpperCase() === 'NFL') {
    const found = await resolveSleeperPlayers(ids).catch(() => new Map())
    for (const [id, pl] of found) out.set(id, { name: pl.name, position: pl.position, team: pl.team, headshotUrl: pl.imageUrl })
  } else {
    const found = await resolveProviderRosterPlayers(p, ids, sport).catch(() => new Map())
    for (const [id, pl] of found) out.set(id, { name: pl.name, position: pl.position, team: pl.team, headshotUrl: pl.imageUrl })
  }
  return out
}

function metadataName(playerData: unknown, id: string): SourcePlayer | null {
  if (!playerData || typeof playerData !== 'object') return null
  const meta = (playerData as Record<string, unknown>).player_metadata
  if (!meta || typeof meta !== 'object') return null
  const m = (meta as Record<string, unknown>)[id]
  if (!m || typeof m !== 'object') return null
  const o = m as Record<string, unknown>
  const name = typeof o.name === 'string' ? o.name.trim() : ''
  if (!name) return null
  return {
    name,
    position: typeof o.position === 'string' ? o.position : null,
    team: typeof o.team === 'string' ? o.team : null,
    headshotUrl: null,
  }
}

function starterIds(playerData: unknown): string[] {
  if (!playerData || typeof playerData !== 'object') return []
  const s = (playerData as Record<string, unknown>).starters
  return Array.isArray(s) ? s.map((x) => String(x ?? '').trim()) : []
}

export async function loadDemoSource(leagueId: string): Promise<SourceSnapshot | null> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: {
      id: true, name: true, platform: true, platformLeagueId: true, sport: true, season: true, scoring: true,
      leagueType: true, isDynasty: true, leagueSize: true, starters: true, playoffTeams: true,
      playoffStartWeek: true, tradeDeadlineWeek: true, waiverType: true, lastSyncedAt: true,
      avatarUrl: true, logoUrl: true, userId: true,
    },
  })
  if (!league) return null

  const teamRows = await prisma.leagueTeam.findMany({
    where: { leagueId, lifecycleState: { not: 'ARCHIVED' } },
    select: {
      id: true, externalId: true, ownerName: true, teamName: true, avatarUrl: true, platformUserId: true,
      claimedByUserId: true, wins: true, losses: true, ties: true, pointsFor: true, pointsAgainst: true,
      currentRank: true, isOrphan: true,
    },
    orderBy: { id: 'asc' },
  })
  const teams: SourceTeam[] = teamRows.map((t) => ({ key: t.id, ...t }))

  const userIds = [...new Set([league.userId, ...teams.map((t) => t.claimedByUserId)].filter((x): x is string => Boolean(x)))]
  const userRows = userIds.length
    ? await prisma.appUser.findMany({
        where: { id: { in: userIds } },
        select: { id: true, email: true, username: true, displayName: true },
      }).catch(() => [])
    : []

  const pid = league.platformLeagueId
  const weekRowsAll = pid
    ? await prisma.weeklyMatchup.findMany({
        where: { leagueId: pid },
        select: { seasonYear: true, week: true, rosterId: true, matchupId: true, pointsFor: true, pointsAgainst: true, win: true },
      }).catch(() => [])
    : []
  const latestSeason = weekRowsAll.length ? Math.max(...weekRowsAll.map((r) => r.seasonYear)) : null
  const weekRows = latestSeason == null ? [] : weekRowsAll.filter((r) => r.seasonYear === latestSeason)

  // Rosters, joined to teams the way the scoreboard does (platformUserId → claimed user → externalId).
  const rosterRows = await prisma.roster.findMany({ where: { leagueId }, select: { platformUserId: true, playerData: true } })
  const teamForRoster = (platformUserId: string): SourceTeam | undefined =>
    teams.find((t) => t.platformUserId && t.platformUserId === platformUserId) ??
    teams.find((t) => t.claimedByUserId && t.claimedByUserId === platformUserId) ??
    teams.find((t) => rosterIdsMatch(t.externalId, platformUserId))

  const allIds = [...new Set(rosterRows.flatMap((r) => rosterPlayerIds(r.playerData)))]
  const resolved = await resolvePlayers(league.platform, String(league.sport), allIds)
  const rosters: SourceRoster[] = []
  for (const r of rosterRows) {
    const team = teamForRoster(r.platformUserId)
    if (!team) continue
    const ids = rosterPlayerIds(r.playerData)
    const startersRaw = starterIds(r.playerData)
    const starterSet = new Set(startersRaw.filter((s) => s && s !== '0'))
    const toPlayer = (id: string): SourcePlayer => resolved.get(id) ?? metadataName(r.playerData, id) ?? { name: 'Unlisted player', position: null, team: null, headshotUrl: null }
    rosters.push({
      teamKey: team.key,
      starters: startersRaw.filter((s) => s && s !== '0').map(toPlayer),
      bench: ids.filter((id) => !starterSet.has(id)).map(toPlayer),
      emptyStarterSlots: startersRaw.filter((s) => !s || s === '0').length,
    })
  }

  const trades = pid
    ? await persistedRecentTrades(
        [{ id: league.id, name: league.name ?? '', platform: league.platform, platformLeagueId: pid, sport: String(league.sport), avatarUrl: null } satisfies RecentTradesLeague],
        new Date(Date.now() - TRADE_LOOKBACK_MS),
      ).catch(() => [] as RecentTrade[])
    : []

  const alerts = await prisma.aiCommissionerAlert.findMany({
    where: { leagueId, status: 'open' },
    orderBy: { createdAt: 'desc' },
    take: 5,
    select: { headline: true },
  }).catch(() => [])

  const seasonStart = new Date(Date.UTC(league.season, 0, 1))
  const tradeCountThisSeason = trades.filter((t) => new Date(t.acceptedAt) >= seasonStart).length

  return {
    league: { ...league, sport: String(league.sport), platformLeagueId: pid },
    teams,
    users: userRows.map((u) => ({ id: u.id, email: emptyToNull(u.email), username: emptyToNull(u.username), displayName: emptyToNull(u.displayName) })),
    weekRows,
    rosters,
    trades,
    openAlertHeadlines: alerts.map((a) => a.headline),
    tradeCountThisSeason,
  }
}
