import 'server-only'

import { prisma } from '@/lib/prisma'
import { getTheSportsDbApiKeyOrFallback } from '@/lib/env/sports-media-keys'

/**
 * TheSportsDB ingestion — everything the provider actually serves.
 *
 * WHAT WAS ALREADY INGESTED, before this module: rosters for NFL/NBA/NHL/MLB
 * (five fields per player) and ad-hoc reads for schedules and headshots. Nothing
 * wrote teams, nothing wrote games, nothing wrote player statistics, and no sport
 * outside those four was covered.
 *
 * The provider surface was probed endpoint by endpoint against a live key rather
 * than taken from the docs, because the docs list endpoints this key does not
 * serve and omit the quirks that decide whether a call returns rows:
 *
 *   - `lookup_all_teams.php` is DEAD. It answers HTML, not JSON, for every league
 *     tried. The live equivalent is `search_all_teams.php?l=<league NAME>`. Two
 *     call sites in this repo still reach for the dead one; the roster script only
 *     survives because it tries the live one first and treats the dead one as a
 *     fallback, so it silently never contributes.
 *   - Season strings are NOT uniform. NFL and MLB use "2025"; NBA, NHL, NCAAB and
 *     soccer use "2025-2026". Asking NFL for "2025-2026" returns `events: null` —
 *     a well-formed empty answer that looks like "no games exist".
 *   - `eventsround.php` answers HTML for every league tried.
 *   - `lookuptable.php` (standings) returns an EMPTY BODY for all five US leagues
 *     and real rows only for soccer. Standings are therefore a soccer-only
 *     capability here, not a gap in this code.
 *   - College has teams and schedules but no real ROSTERS. Sampling ten blue-blood
 *     programmes per sport, 6 of 10 NCAAF and 2 of 10 NCAAB returned anything at
 *     all, and it was 1-2 entries: head coaches plus the odd famous alumnus filed
 *     under his alma mater (Alabama returns Kalen DeBoer and Trevon Diggs — Diggs
 *     plays for Dallas). One NFL team returns 45. So college is ingested but marked
 *     `rosterQuality: 'sparse'`, and coaches are dropped rather than written as
 *     players. Devy still needs CFBD; this is not a substitute.
 *   - NCAAF teams cannot be listed by name at all (`search_all_teams` returns
 *     null), so its 231 teams are recovered from the season schedule's team ids
 *     and looked up individually.
 *
 * Everything here upserts on (sport, externalId, source) so re-running is safe.
 */

const V1 = 'https://www.thesportsdb.com/api/v1/json'
const V2 = 'https://www.thesportsdb.com/api/v2/json'
const SOURCE = 'thesportsdb'

/** Premium tier allows 100 req/min; stay comfortably under it. */
const CALL_DELAY_MS = 700

const TTL_DAYS = 7
const ttl = (now: Date) => new Date(now.getTime() + TTL_DAYS * 24 * 60 * 60 * 1000)

export type IngestSport = 'NFL' | 'NCAAF' | 'MLB' | 'NBA' | 'NHL' | 'NCAAB' | 'SOCCER'

type LeagueConfig = {
  leagueId: string
  /** Exact league name `search_all_teams.php?l=` expects. Null when unsupported. */
  teamListName: string | null
  /** Season format differs per league — see the module note. */
  seasonStyle: 'single' | 'split'
  /**
   * Whether this league has real, current ROSTERS.
   *
   * College is `false` — but not because the endpoint is empty, which is what an
   * earlier version of this file claimed. Sampling ten blue-blood programmes per
   * sport: 6 of 10 NCAAF and 2 of 10 NCAAB returned anything at all, and what came
   * back was 1-2 entries — head coaches (`strPosition: "Manager"`) plus the odd
   * famous alumnus filed under his alma mater. Alabama returns Kalen DeBoer and
   * Trevon Diggs; Diggs is a Dallas Cowboy. One NFL team returns 45 players.
   *
   * So college entries are real records but NOT a current roster, and writing them
   * as one would put an NFL cornerback on Alabama's depth chart. They are ingested
   * with `rosterQuality: 'sparse'` handling instead — coaches dropped, players kept.
   */
  hasPlayers: boolean
  /** Only soccer returns standings rows. */
  hasStandings: boolean
  v2LiveSport: string | null
}

export const LEAGUES: Record<IngestSport, LeagueConfig> = {
  NFL: { leagueId: '4391', teamListName: 'NFL', seasonStyle: 'single', hasPlayers: true, hasStandings: false, v2LiveSport: 'american_football' },
  // 4479 is NCAA Division 1 Football. The existing roster script used 4368, which
  // is a different competition entirely — one reason college never yielded rows.
  NCAAF: { leagueId: '4479', teamListName: null, seasonStyle: 'single', hasPlayers: false, hasStandings: false, v2LiveSport: 'american_football' },
  MLB: { leagueId: '4424', teamListName: 'MLB', seasonStyle: 'single', hasPlayers: true, hasStandings: false, v2LiveSport: 'baseball' },
  NBA: { leagueId: '4387', teamListName: 'NBA', seasonStyle: 'split', hasPlayers: true, hasStandings: false, v2LiveSport: 'basketball' },
  NHL: { leagueId: '4380', teamListName: 'NHL', seasonStyle: 'split', hasPlayers: true, hasStandings: false, v2LiveSport: 'ice_hockey' },
  NCAAB: { leagueId: '4607', teamListName: 'NCAA Division I Basketball Mens', seasonStyle: 'split', hasPlayers: false, hasStandings: false, v2LiveSport: 'basketball' },
  SOCCER: { leagueId: '4328', teamListName: 'English Premier League', seasonStyle: 'split', hasPlayers: true, hasStandings: true, v2LiveSport: 'soccer' },
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const str = (v: unknown): string | null => {
  if (v == null) return null
  const t = String(v).trim()
  return t.length > 0 && t.toLowerCase() !== 'null' ? t : null
}

const intOf = (v: unknown): number | null => {
  const s = str(v)
  if (!s) return null
  const n = Number.parseInt(s.replace(/[^0-9-]/g, ''), 10)
  return Number.isFinite(n) ? n : null
}

async function v1<T>(path: string, params: Record<string, string>): Promise<T | null> {
  const key = getTheSportsDbApiKeyOrFallback()
  const qs = new URLSearchParams(params).toString()
  try {
    // db-first-exception: provider ingestion writer — fetch -> sports_* tables, not a read path
    const url = `${V1}/${key}/${path}?${qs}`
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) })
    if (!res.ok) return null
    const text = await res.text()
    // Dead endpoints answer an HTML error page with a 200, which JSON.parse would
    // throw on — treat it as "no data" rather than crashing the whole sweep.
    if (!text.trim() || text.trimStart().startsWith('<')) return null
    return JSON.parse(text) as T
  } catch {
    return null
  }
}

async function v2Json<T>(path: string): Promise<T | null> {
  const key = getTheSportsDbApiKeyOrFallback()
  try {
    // db-first-exception: provider ingestion writer — fetch -> sports_* tables, not a read path
    const url = `${V2}/${path}`
    const res = await fetch(url, { headers: { 'X-API-KEY': key }, signal: AbortSignal.timeout(30_000) })
    if (!res.ok) return null
    const text = await res.text()
    if (!text.trim() || text.trimStart().startsWith('<')) return null
    return JSON.parse(text) as T
  } catch {
    return null
  }
}

/**
 * The season string this league is currently publishing.
 *
 * Derived from the next-events feed rather than from the calendar, because the
 * provider rolls a league into its next season as soon as fixtures are loaded,
 * and guessing from `new Date()` puts NFL a year out for half the year.
 */
export async function resolveCurrentSeason(sport: IngestSport): Promise<string> {
  const cfg = LEAGUES[sport]
  const next = await v1<{ events?: Array<{ strSeason?: string }> }>('eventsnextleague.php', { id: cfg.leagueId })
  const fromFeed = str(next?.events?.[0]?.strSeason)
  if (fromFeed) return fromFeed
  const y = new Date().getUTCFullYear()
  return cfg.seasonStyle === 'single' ? String(y) : `${y}-${y + 1}`
}

// ── Teams ──────────────────────────────────────────────────────────────

type TsdbTeam = Record<string, unknown>

async function listTeams(sport: IngestSport, season: string): Promise<TsdbTeam[]> {
  const cfg = LEAGUES[sport]
  if (cfg.teamListName) {
    const data = await v1<{ teams?: TsdbTeam[] }>('search_all_teams.php', { l: cfg.teamListName })
    if (data?.teams?.length) return data.teams
  }

  // NCAAF has no name-listable team index. Its teams are still real and fully
  // populated — they are just only reachable through the ids its own schedule
  // hands out, so recover them from there.
  const sched = await v1<{ events?: Array<{ idHomeTeam?: string; idAwayTeam?: string }> }>('eventsseason.php', {
    id: cfg.leagueId,
    s: season,
  })
  const ids = new Set<string>()
  for (const e of sched?.events ?? []) {
    const h = str(e.idHomeTeam)
    const a = str(e.idAwayTeam)
    if (h) ids.add(h)
    if (a) ids.add(a)
  }

  const out: TsdbTeam[] = []
  for (const id of ids) {
    const t = await v1<{ teams?: TsdbTeam[] }>('lookupteam.php', { id })
    if (t?.teams?.[0]) out.push(t.teams[0])
    await sleep(CALL_DELAY_MS)
  }
  return out
}

export async function ingestTeams(sport: IngestSport, opts?: { season?: string }): Promise<{ fetched: number; written: number }> {
  const season = opts?.season ?? (await resolveCurrentSeason(sport))
  const teams = await listTeams(sport, season)
  const now = new Date()
  let written = 0

  for (const t of teams) {
    const externalId = str(t.idTeam)
    const name = str(t.strTeam)
    if (!externalId || !name) continue

    const data = {
      name,
      shortName: str(t.strTeamShort) ?? str(t.strTeamAlternate),
      city: str(t.strLocation),
      conference: str(t.strLeague),
      division: str(t.strDivision),
      logo: str(t.strBadge) ?? str(t.strLogo),
      primaryColor: str(t.strColour1),
      fetchedAt: now,
      expiresAt: ttl(now),
    }

    try {
      await prisma.sportsTeam.upsert({
        where: { sport_externalId_source: { sport, externalId, source: SOURCE } },
        update: data,
        create: { sport, externalId, source: SOURCE, ...data },
      })
      written += 1
    } catch {
      // one bad row must not abort a 389-team sweep
    }
  }

  return { fetched: teams.length, written }
}

// ── Players (rosters) ──────────────────────────────────────────────────

/**
 * TheSportsDB returns 70 fields per player; the previous sync persisted five.
 * These are the ones with a column to land in, plus the cross-provider ids, which
 * are the most valuable thing here — `idESPN` and `idAPIfootball` let a canonical
 * player be joined to other feeds without name matching.
 */
export async function ingestRosters(sport: IngestSport, opts?: { season?: string; maxTeams?: number }): Promise<{
  teams: number
  players: number
  skippedNoPlayers: number
  coachesDropped: number
  rosterQuality: 'full' | 'sparse'
}> {
  const cfg = LEAGUES[sport]
  const result = {
    teams: 0,
    players: 0,
    skippedNoPlayers: 0,
    coachesDropped: 0,
    rosterQuality: (cfg.hasPlayers ? 'full' : 'sparse') as 'full' | 'sparse',
  }

  const season = opts?.season ?? (await resolveCurrentSeason(sport))
  const teams = await listTeams(sport, season)
  const now = new Date()

  for (const team of teams.slice(0, opts?.maxTeams ?? teams.length)) {
    const teamId = str(team.idTeam)
    if (!teamId) continue
    result.teams += 1

    const roster = await v1<{ player?: Array<Record<string, unknown>> }>('lookup_all_players.php', { id: teamId })
    await sleep(CALL_DELAY_MS)

    const players = roster?.player ?? []
    if (players.length === 0) {
      result.skippedNoPlayers += 1
      continue
    }

    for (const p of players) {
      const externalId = str(p.idPlayer)
      const name = str(p.strPlayer)
      if (!externalId || !name) continue

      // A head coach is not a player. TheSportsDB files them in the same roster
      // array with strPosition "Manager", and for college they are the MAJORITY
      // of what comes back — so letting them through would fill a devy player
      // pool with coaching staff.
      if ((str(p.strPosition) ?? '').toLowerCase() === 'manager') {
        result.coachesDropped += 1
        continue
      }

      const born = str(p.dateBorn)
      const age = (() => {
        if (!born) return null
        const d = new Date(born)
        if (Number.isNaN(d.getTime())) return null
        const years = (now.getTime() - d.getTime()) / (365.25 * 24 * 3600 * 1000)
        return years > 0 && years < 120 ? Math.floor(years) : null
      })()

      const data = {
        name,
        position: str(p.strPosition),
        team: str(p.strTeam) ?? str(team.strTeam),
        teamId: str(p.idTeam) ?? teamId,
        number: intOf(p.strNumber),
        age,
        height: str(p.strHeight),
        weight: str(p.strWeight),
        college: str(p.strCollege),
        // Prefer the cutout (transparent background) for lineup cards, then the
        // posed thumb; render/poster are stylised and read badly at small sizes.
        imageUrl: str(p.strCutout) ?? str(p.strThumb) ?? str(p.strRender),
        dob: born,
        status: str(p.strStatus),
        fetchedAt: now,
        expiresAt: ttl(now),
      }

      try {
        await prisma.sportsPlayer.upsert({
          where: { sport_externalId_source: { sport, externalId: `tsdb_${externalId}`, source: SOURCE } },
          update: data,
          create: { sport, externalId: `tsdb_${externalId}`, source: SOURCE, ...data },
        })
        result.players += 1
      } catch {
        // keep sweeping
      }
    }
  }

  return result
}

// ── Games (schedule + results) ─────────────────────────────────────────

function parseKickoff(e: Record<string, unknown>): Date | null {
  const ts = str(e.strTimestamp)
  if (ts) {
    const d = new Date(ts.endsWith('Z') || ts.includes('+') ? ts : `${ts}Z`)
    if (!Number.isNaN(d.getTime())) return d
  }
  const date = str(e.dateEvent)
  if (!date) return null
  const time = str(e.strTime) ?? '00:00:00'
  const d = new Date(`${date}T${time}Z`)
  return Number.isNaN(d.getTime()) ? null : d
}

export async function ingestSchedule(sport: IngestSport, opts?: { season?: string }): Promise<{
  season: string
  fetched: number
  written: number
}> {
  const cfg = LEAGUES[sport]
  const season = opts?.season ?? (await resolveCurrentSeason(sport))
  const data = await v1<{ events?: Array<Record<string, unknown>> }>('eventsseason.php', {
    id: cfg.leagueId,
    s: season,
  })
  const events = data?.events ?? []
  const now = new Date()
  let written = 0

  for (const e of events) {
    const externalId = str(e.idEvent)
    const home = str(e.strHomeTeam)
    const away = str(e.strAwayTeam)
    if (!externalId || !home || !away) continue

    const row = {
      homeTeam: home,
      awayTeam: away,
      homeTeamId: str(e.idHomeTeam),
      awayTeamId: str(e.idAwayTeam),
      homeScore: intOf(e.intHomeScore),
      awayScore: intOf(e.intAwayScore),
      // strStatus is often blank on unplayed fixtures; a scored game is finished
      // unless the provider says otherwise. Never invent "Final" for 0-0 games
      // that simply have not kicked off.
      status: str(e.strStatus) ?? (e.intHomeScore != null ? 'Match Finished' : 'Not Started'),
      startTime: parseKickoff(e),
      venue: str(e.strVenue),
      week: intOf(e.intRound),
      season: intOf(season.slice(0, 4)),
      fetchedAt: now,
      expiresAt: ttl(now),
      raw: e as never,
    }

    try {
      await prisma.sportsGame.upsert({
        where: { sport_externalId_source: { sport, externalId, source: SOURCE } },
        update: row,
        create: { sport, externalId, source: SOURCE, ...row },
      })
      written += 1
    } catch {
      // keep sweeping
    }
  }

  return { season, fetched: events.length, written }
}

// ── Player season statistics ───────────────────────────────────────────

/**
 * `lookupplayerstats.php` returns one row per (season, statistic) as a
 * strStatistic/strValue pair — 16 rows for a sampled NFL lineman covering several
 * seasons. Folded into one PlayerSeasonStats row per (player, season) so the
 * stats JSON reads as a stat line rather than a list of pairs.
 *
 * One call per player, so this is the expensive pass: it is separate from roster
 * ingestion on purpose and takes a bounded player list.
 */
export async function ingestPlayerStats(
  sport: IngestSport,
  opts?: { maxPlayers?: number }
): Promise<{ playersQueried: number; playersWithStats: number; seasonRowsWritten: number }> {
  const result = { playersQueried: 0, playersWithStats: 0, seasonRowsWritten: 0 }

  /*
   * ⚠ ORDERING IS LOAD-BEARING FOR SCHEDULED RUNS.
   *
   * This was `orderBy: { updatedAt: 'desc' }`, which is fine for a one-off but
   * broken as a cron: a stats run writes to player_season_stats and does NOT
   * touch sports_players, so the ordering never changes and every run would
   * re-fetch the same first N players forever, never reaching the rest. At one
   * API call per player and ~5,000 players, the tail would simply never be
   * ingested.
   *
   * Players with NO stats row yet are taken first, then the least recently
   * fetched, so successive bounded runs cycle through the whole population.
   */
  const alreadyHaveStats = await prisma.playerSeasonStats.findMany({
    where: { sport, source: SOURCE },
    select: { playerId: true, fetchedAt: true },
    orderBy: { fetchedAt: 'asc' },
  })
  const staleFirst = alreadyHaveStats.map((r) => r.playerId)
  const covered = new Set(staleFirst)

  const limit = opts?.maxPlayers ?? 250

  const uncovered = await prisma.sportsPlayer.findMany({
    where: {
      sport,
      source: SOURCE,
      ...(covered.size > 0 ? { externalId: { notIn: [...covered] } } : {}),
    },
    select: { externalId: true, name: true, position: true, team: true },
    take: limit,
  })

  // Only top up with already-covered players when there is room left, so a
  // never-seen player always outranks a refresh.
  const topUp =
    uncovered.length < limit
      ? await prisma.sportsPlayer.findMany({
          where: { sport, source: SOURCE, externalId: { in: staleFirst.slice(0, limit) } },
          select: { externalId: true, name: true, position: true, team: true },
          take: limit - uncovered.length,
        })
      : []

  const players = [...uncovered, ...topUp]

  for (const p of players) {
    const tsdbId = p.externalId.replace(/^tsdb_/, '')
    result.playersQueried += 1

    const data = await v1<{ playerstats?: Array<Record<string, unknown>> }>('lookupplayerstats.php', { id: tsdbId })
    await sleep(CALL_DELAY_MS)

    const rows = data?.playerstats ?? []
    if (rows.length === 0) continue
    result.playersWithStats += 1

    const bySeason = new Map<string, Record<string, string>>()
    for (const r of rows) {
      const season = str(r.strSeason)
      const stat = str(r.strStatistic)
      const value = str(r.strValue)
      if (!season || !stat) continue
      const bucket = bySeason.get(season) ?? {}
      bucket[stat] = value ?? ''
      bySeason.set(season, bucket)
    }

    for (const [season, stats] of bySeason) {
      const now = new Date()
      try {
        // Composite unique is (sport, playerId, season, seasonType, source) — the
        // upsert must name seasonType explicitly or it will not match the row it
        // just wrote and every re-run duplicates.
        await prisma.playerSeasonStats.upsert({
          where: {
            sport_playerId_season_seasonType_source: {
              sport,
              playerId: `tsdb_${tsdbId}`,
              season,
              seasonType: 'regular',
              source: SOURCE,
            },
          },
          update: {
            stats: stats as never,
            playerName: p.name,
            position: p.position,
            team: p.team,
            fetchedAt: now,
            expiresAt: ttl(now),
          },
          create: {
            sport,
            playerId: `tsdb_${tsdbId}`,
            playerName: p.name,
            season,
            seasonType: 'regular',
            position: p.position,
            team: p.team,
            stats: stats as never,
            source: SOURCE,
            fetchedAt: now,
            // Required, no default — omitting it threw "Argument `expiresAt` is
            // missing" on every row while the pass still reported success.
            expiresAt: ttl(now),
          },
        })
        result.seasonRowsWritten += 1
      } catch {
        // keep sweeping
      }
    }
  }

  return result
}

// ── Live scores (v2) ───────────────────────────────────────────────────

/**
 * v2 livescore is the only in-play feed here. It updates games already ingested
 * rather than creating them, so a live row can never introduce a fixture the
 * schedule pass has not seen.
 */
export async function ingestLiveScores(sport: IngestSport): Promise<{ received: number; updated: number }> {
  const cfg = LEAGUES[sport]
  if (!cfg.v2LiveSport) return { received: 0, updated: 0 }

  const data = await v2Json<{ livescore?: Array<Record<string, unknown>> }>(`livescore/${cfg.v2LiveSport}`)
  const rows = (data?.livescore ?? []).filter((r) => str(r.idLeague) === cfg.leagueId)
  let updated = 0

  for (const r of rows) {
    const externalId = str(r.idEvent)
    if (!externalId) continue
    try {
      await prisma.sportsGame.updateMany({
        where: { sport, externalId, source: SOURCE },
        data: {
          homeScore: intOf(r.intHomeScore),
          awayScore: intOf(r.intAwayScore),
          status: str(r.strStatus) ?? str(r.strProgress),
          fetchedAt: new Date(),
        },
      })
      updated += 1
    } catch {
      // keep sweeping
    }
  }

  return { received: data?.livescore?.length ?? 0, updated }
}

// ── Orchestration ──────────────────────────────────────────────────────

export type SportIngestSummary = {
  sport: IngestSport
  season: string
  teams: { fetched: number; written: number }
  schedule: { fetched: number; written: number }
  rosters: { teams: number; players: number; skippedNoPlayers: number }
  note?: string
}

export async function ingestSport(
  sport: IngestSport,
  opts?: { includeRosters?: boolean }
): Promise<SportIngestSummary> {
  const season = await resolveCurrentSeason(sport)
  const teams = await ingestTeams(sport, { season })
  const schedule = await ingestSchedule(sport, { season })
  // College is attempted too. It yields little, but "little" is not "nothing" and
  // skipping outright is how the earlier version came to report zero.
  const rosters =
    opts?.includeRosters !== false
      ? await ingestRosters(sport, { season })
      : { teams: 0, players: 0, skippedNoPlayers: 0, coachesDropped: 0, rosterQuality: 'full' as const }

  return {
    sport,
    season,
    teams: { fetched: teams.fetched, written: teams.written },
    schedule: { fetched: schedule.fetched, written: schedule.written },
    rosters,
    note:
      rosters.rosterQuality === "sparse"
        ? `sparse: provider has no current rosters here (coaches + alumni only); ${rosters.coachesDropped} coaches dropped`
        : undefined,
  }
}
