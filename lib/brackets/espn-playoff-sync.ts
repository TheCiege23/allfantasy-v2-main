import 'server-only'

import type { LeagueSport } from '@prisma/client'
import { normalizeToSupportedSport, type SupportedSport } from '@/lib/sport-scope'
import { normalizeTeamAbbrev } from '@/lib/team-abbrev'
import { ESPN_SPORT_SITE_PATH, getLiveScoresForSport } from '@/lib/sports-live-scores-service'
import { ensureChallengeTournament } from '@/lib/brackets/PlayoffChallengeTournamentService'
import { resolveDefaultPlayoffConfig } from '@/lib/sport-defaults/DefaultPlayoffConfigResolver'
import type { SportType } from '@/lib/sport-defaults/types'
import { ESPN_SITE_API_BASE } from '@/lib/providers/espnUrls'
import {
  applySeededTeamsToPlayoffBracket,
  linkRoundOneNodesToSportsGames,
} from '@/lib/brackets/teamImport'

export type PlayoffStandingsTeam = {
  seed: number
  abbrev: string
  wins: number
  losses: number
  record: string
}

function normTeam(s: string | null | undefined): string {
  if (!s) return ''
  return (normalizeTeamAbbrev(s.trim()) || s.trim()).toUpperCase()
}

/** Map DB / legacy bracket sport strings to `LeagueSport`. */
export function bracketSportToLeagueSport(raw: string | null | undefined): LeagueSport {
  const u = String(raw ?? '')
    .trim()
    .toLowerCase()
  if (u === 'ncaam' || u === 'mens_ncaa') return 'NCAAB'
  return normalizeToSupportedSport(u)
}

/** Matches `buildPlayoffNodes` team count (incl. 16‑team NCAA tournament challenge). */
export function playoffTeamCapForTournament(tournament: {
  name: string
  sport: string
}): number {
  const sport = bracketSportToLeagueSport(tournament.sport)
  if (sport === 'NCAAB' && tournament.name.includes('NCAA Basketball Bracket Challenge')) {
    return 16
  }
  const cfg = resolveDefaultPlayoffConfig(sport as SportType)
  const n = Number(cfg.playoff_team_count || 8)
  return Math.min(16, Math.max(4, n))
}

function statNumber(stats: Array<{ name?: string; type?: string; value?: unknown }>, keys: string[]): number {
  for (const s of stats) {
    const key = String(s.name ?? s.type ?? '').toLowerCase()
    if (!keys.some((k) => key.includes(k))) continue
    const v = s.value
    if (typeof v === 'number' && Number.isFinite(v)) return v
    const n = Number.parseInt(String(v ?? ''), 10)
    if (Number.isFinite(n)) return n
  }
  return 0
}

function walkEspnStandings(node: unknown, out: Array<{ team: any; stats: any[] }>): void {
  if (!node || typeof node !== 'object') return
  const n = node as Record<string, unknown>
  const entries = (n.standings as { entries?: unknown[] } | undefined)?.entries
  if (Array.isArray(entries)) {
    for (const e of entries) {
      if (e && typeof e === 'object' && 'team' in (e as object)) {
        const row = e as { team: unknown; stats?: unknown[] }
        out.push({
          team: row.team,
          stats: Array.isArray(row.stats) ? (row.stats as any[]) : [],
        })
      }
    }
  }
  const children = n.children
  if (Array.isArray(children)) {
    for (const c of children) walkEspnStandings(c, out)
  }
}

/**
 * Fetch ESPN standings for a sport and return teams ordered by seed (1 = best).
 * Uses wins/losses and optional rank when present (college polls).
 */
export async function fetchEspnPlayoffStandings(
  sport: LeagueSport,
): Promise<PlayoffStandingsTeam[]> {
  const path = ESPN_SPORT_SITE_PATH[sport]
  if (!path) return []

  const url = `${ESPN_SITE_API_BASE}/${path}/standings`
  try {
    const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(15000) })
    if (!res.ok) return []
    const data = await res.json()
    const rawRows: Array<{ team: any; stats: any[] }> = []
    walkEspnStandings(data, rawRows)

    type Row = {
      abbrev: string
      wins: number
      losses: number
      rank: number
    }
    const byAbbrev = new Map<string, Row>()

    for (const { team, stats } of rawRows) {
      if (!team || typeof team !== 'object') continue
      const abbrRaw = (team as { abbreviation?: string; shortDisplayName?: string }).abbreviation
      if (!abbrRaw) continue
      const abbrev = normTeam(abbrRaw)
      if (!abbrev) continue
      const wins = statNumber(stats, ['wins', 'total wins'])
      const losses = statNumber(stats, ['losses', 'loss', 'total losses'])
      let rank = statNumber(stats, ['rank', 'playoff', 'ap ', 'cfp'])
      if (rank <= 0) {
        rank = statNumber(stats, ['standing', 'overall'])
      }
      const cur = byAbbrev.get(abbrev)
      const row: Row = {
        abbrev,
        wins,
        losses,
        rank: rank > 0 ? rank : 999,
      }
      if (!cur || row.wins > cur.wins || (row.wins === cur.wins && row.losses < cur.losses)) {
        byAbbrev.set(abbrev, row)
      }
    }

    let rows = Array.from(byAbbrev.values())
    const hasRealRank = rows.some((r) => r.rank > 0 && r.rank < 400)
    if (hasRealRank) {
      rows.sort((a, b) => {
        if (a.rank !== b.rank) return a.rank - b.rank
        const pct = (x: Row) => x.wins / Math.max(1, x.wins + x.losses)
        return pct(b) - pct(a)
      })
    } else {
      rows.sort((a, b) => {
        const pct = (x: Row) => x.wins / Math.max(1, x.wins + x.losses)
        const d = pct(b) - pct(a)
        if (Math.abs(d) > 1e-6) return d
        return b.wins - a.wins
      })
    }

    return rows.map((r, i) => ({
      seed: i + 1,
      abbrev: r.abbrev,
      wins: r.wins,
      losses: r.losses,
      record: `${r.wins}-${r.losses}`,
    }))
  } catch (e) {
    console.warn('[espn-playoff-sync] standings fetch failed', sport, e)
    return []
  }
}

export type SyncPlayoffBracketResult = {
  ok: boolean
  sport: SupportedSport
  season: number
  tournamentId: string
  teamsApplied: number
  gamesLinked: number
  warnings: string[]
  liveScoresRefreshed: boolean
}

/**
 * Ensure the playoff-challenge tournament exists, pull standings from ESPN, seed round 1,
 * refresh live scores into `SportsGame`, and link round‑1 nodes to matching games.
 */
export async function syncPlayoffBracketFromApis(options: {
  sport: string
  season?: number
}): Promise<SyncPlayoffBracketResult> {
  const warnings: string[] = []
  const leagueSport = bracketSportToLeagueSport(options.sport)
  const season =
    typeof options.season === 'number' && Number.isFinite(options.season)
      ? Math.floor(options.season)
      : new Date().getFullYear()

  const tournament = await ensureChallengeTournament({
    sport: leagueSport,
    season,
    challengeType: leagueSport === 'NCAAB' ? 'mens_ncaa' : 'playoff_challenge',
  })

  const standingsFull = await fetchEspnPlayoffStandings(leagueSport)
  if (standingsFull.length === 0) {
    warnings.push(`No standings rows parsed from ESPN for ${leagueSport}.`)
  }

  const cap = playoffTeamCapForTournament(tournament)
  const standings = standingsFull.slice(0, cap).map((t, i) => ({ ...t, seed: i + 1 }))

  const seedResult = await applySeededTeamsToPlayoffBracket(tournament.id, standings)
  warnings.push(...seedResult.warnings)

  let liveScoresRefreshed = false
  try {
    const live = await getLiveScoresForSport({
      sport: leagueSport,
      forceRefresh: true,
    })
    liveScoresRefreshed = live.refreshed
  } catch (e) {
    warnings.push(`Live scores refresh failed: ${e instanceof Error ? e.message : String(e)}`)
  }

  const link = await linkRoundOneNodesToSportsGames({
    tournamentId: tournament.id,
    sport: leagueSport,
    season,
  })
  warnings.push(...link.warnings)

  return {
    ok: seedResult.seeded > 0 || standings.length > 0,
    sport: leagueSport,
    season,
    tournamentId: tournament.id,
    teamsApplied: seedResult.seeded,
    gamesLinked: link.linked,
    warnings,
    liveScoresRefreshed,
  }
}
