import 'server-only'

/**
 * ESPN standings ingestion — NFL and NCAAF, no API key required.
 *
 * WHY THIS EXISTS
 * `/api/cron/import-standings` runs every four hours and had written nothing since
 * **2026-04-25**. Measured 2026-08-30: every `*:standings:*` row in `SportsDataCache` was for
 * the 2025 season, written in April, and every one of them EXPIRED on 2026-07-24. So the cache
 * was not merely stale, it was empty of anything a reader would accept — while the cron reported
 * itself healthy on every run.
 *
 * The cause is not a bug in that job. It called `syncAPISportsStandingsToDb`, and the API-Sports
 * account is on the **Free** plan, which answers every current-season request with:
 *
 *     {"plan":"Free plans do not have access to this season, try from 2022 to 2024."}
 *
 * That is already documented for two other feeds — `lib/scores/gameScoreProviders.ts` and
 * `app/api/cron/import-injuries/route.ts` both record it, and both migrated away. Standings was
 * the one that never did.
 *
 * ⚠ WHY IT MATTERED, from the route's own header: standings freshness drives the admin Sport
 * Import Matrix's `currentFactsStatus` column AND the Power Rankings / Matchup Prep AI tools.
 * Those tools were reading an empty cache and producing output anyway.
 *
 * WHY ESPN
 * Verified live 2026-08-30: `/apis/v2/sports/football/nfl/standings` returns season 2026, two
 * conference groups, 32 team entries with real stats. No key, no plan tier, and the same provider
 * the injuries feed already falls back to for exactly this reason. `lib/brackets/espn-playoff-sync.ts`
 * has been reading this endpoint successfully for the playoff bracket all along — the data was
 * always reachable, it just was not wired to the cron.
 *
 * ⚠ WRITES THE SAME CACHE KEYS AND THE SAME PAYLOAD SHAPE as the API-Sports writer it replaces:
 * `${SPORT}:standings:${season}:${TEAM_ABBREV}`. Every consumer — the grounding packet, Chimmy's
 * digest, the admin health services, fantasyDataEvidence — matches on that key prefix and reads
 * those fields. Changing either would have been a silent break in six modules that do not import
 * this one.
 */
import { prisma } from '@/lib/prisma'

/**
 * ⚠ STANDINGS LIVE UNDER `/apis/v2`, NOT the `/apis/site/v2` every other ESPN call here uses.
 *
 * Written out rather than derived from `ESPN_SITE_API_BASE` with a `.replace()`. A string
 * substitution against a constant this module does not own is silent when that constant changes
 * shape — it would keep producing a URL, just the wrong one, and a 404 here degrades to "no
 * standings", which is precisely the failure state this file exists to end. Both
 * `site.web.api.espn.com` and `site.api.espn.com` answer 200 on this path (verified 2026-08-30);
 * the `site.web` host is used for consistency with `espnUrls.ts`.
 */
const ESPN_V2_API_BASE = 'https://site.web.api.espn.com/apis/v2/sports'

/** ESPN's v2 standings path per sport. v2 (not the site v2 used elsewhere) is where groups live. */
const ESPN_STANDINGS_PATH: Record<string, string> = {
  NFL: 'football/nfl',
  NCAAF: 'football/college-football',
  MLB: 'baseball/mlb',
}

/**
 * How to decide which season a payload belongs to. This is NOT cosmetic — it is
 * the cache key, so getting it wrong files this season's standings where
 * nothing will look for them.
 *
 * `payload` — trust `payload.season.year`. Correct for the football codes,
 * whose season is named for the year it kicks off in and spans into the next
 * calendar year; deriving it locally in January would write next season's key
 * over this season's data.
 *
 * 🛑 `current-with-fallback` — DO NOT trust the payload. Measured 2026-09-19:
 * the un-parameterised MLB endpoint returns `season.year = 2027` while serving
 * the **2026** standings that are still being played (Tampa Bay 93-60, 2,310
 * wins across 30 clubs — a 162-game season in its final week). Trusting it
 * would have filed live 2026 standings under `MLB:standings:2027:*`.
 *
 * The fallback half exists because the obvious repair — "baseball seasons sit
 * inside one calendar year, so use the clock" — is also wrong, just later in
 * the year. `?season=2027` returns **zero rows**, so from November to February
 * a clock-derived season would write nothing and trip this job's
 * zero-rows-is-a-failure rule on every fire. An alarm that is red for a third
 * of the year is one nobody reads. So: ask for this calendar year, and if it
 * is empty fall back to the previous one, which is the most recent real
 * standings and exactly what a postseason seeding source wants anyway.
 */
const SEASON_SOURCE: Record<string, 'payload' | 'current-with-fallback'> = {
  NFL: 'payload',
  NCAAF: 'payload',
  MLB: 'current-with-fallback',
}

export function espnHasStandings(sport: string): boolean {
  return ESPN_STANDINGS_PATH[sport.trim().toUpperCase()] != null
}

/** Matches the API-Sports writer this replaces, so a stale row ages out on the same clock. */
const STANDINGS_TTL_MS = 6 * 60 * 60 * 1000

export type EspnStandingsSyncResult = {
  sport: string
  fetched: number
  written: number
  skipped: number
  errors: string[]
}

type EspnStatEntry = { name?: unknown; value?: unknown; displayValue?: unknown }

/**
 * ESPN reports each figure as a `{name, value}` entry rather than a field, and the set present
 * varies by sport and by week. Missing is returned as `null` rather than 0 — a team with no
 * recorded losses in week 0 has not "lost zero", we simply have no figure, and a reader that
 * cannot tell those apart will render a standings table that looks authoritative in preseason.
 */
function stat(stats: EspnStatEntry[], ...names: string[]): number | null {
  for (const want of names) {
    const hit = stats.find((s) => String(s?.name ?? '').toLowerCase() === want.toLowerCase())
    if (hit && typeof hit.value === 'number' && Number.isFinite(hit.value)) return hit.value
  }
  return null
}

/**
 * ESPN nests standings differently per sport — NFL is conference → division, college is
 * conference → (sometimes) division — so the entries are collected by walking rather than by
 * assuming a depth. `espn-playoff-sync.ts` learned the same lesson and walks too.
 */
function collectEntries(node: unknown, out: Array<{ team: any; stats: EspnStatEntry[]; group: string | null }>, group: string | null): void {
  if (!node || typeof node !== 'object') return
  const n = node as Record<string, any>

  const groupName = typeof n.name === 'string' ? n.name : group

  const entries = n.standings?.entries
  if (Array.isArray(entries)) {
    for (const e of entries) {
      if (e?.team) out.push({ team: e.team, stats: Array.isArray(e.stats) ? e.stats : [], group: groupName })
    }
  }
  for (const child of Array.isArray(n.children) ? n.children : []) {
    collectEntries(child, out, groupName)
  }
}

/**
 * Fetch and persist standings for one sport.
 *
 * Returns counts rather than throwing on a provider miss: the caller decides whether zero rows is
 * a failure, and for standings it always is — see the route.
 */
export async function syncEspnStandingsToDb(opts: {
  sport: string
  season?: string
  now?: Date
}): Promise<EspnStandingsSyncResult> {
  const sport = opts.sport.trim().toUpperCase()
  const result: EspnStandingsSyncResult = { sport, fetched: 0, written: 0, skipped: 0, errors: [] }

  const path = ESPN_STANDINGS_PATH[sport]
  if (!path) {
    result.errors.push(`no espn standings path for ${sport}`)
    return result
  }

  const now = opts.now ?? new Date()
  const expiresAt = new Date(now.getTime() + STANDINGS_TTL_MS)

  /* This module IS the ingestion boundary: provider fetch -> SportsDataCache upsert. */
  async function fetchStandings(season?: string | number): Promise<Record<string, any> | null> {
    // db-first-exception: standings ingestion writer, not a read path
    const url = new URL(`${ESPN_V2_API_BASE}/${path}/standings`)
    /*
     * ⚠ THE PARAMETER IS ONLY EVER ADDED WHEN A SEASON IS ASKED FOR, so the
     * football request stays byte-identical to the one verified live.
     */
    if (season != null) url.searchParams.set('season', String(season))
    try {
      const res = await fetch(url.toString(), {
        headers: { accept: 'application/json' },
        cache: 'no-store',
        signal: AbortSignal.timeout(20_000),
      })
      if (!res.ok) {
        result.errors.push(`espn responded ${res.status}${season != null ? ` for season ${season}` : ''}`)
        return null
      }
      return (await res.json()) as Record<string, any>
    } catch (e) {
      result.errors.push(`fetch failed: ${e instanceof Error ? e.message : String(e)}`)
      return null
    }
  }

  function entriesOf(payload: Record<string, any> | null) {
    const out: Array<{ team: any; stats: EspnStatEntry[]; group: string | null }> = []
    if (payload) collectEntries(payload, out, null)
    return out
  }

  const seasonSource = SEASON_SOURCE[sport] ?? 'payload'
  let payload: Record<string, any> | null
  let rows: Array<{ team: any; stats: EspnStatEntry[]; group: string | null }>
  let season: string

  if (opts.season != null) {
    // An explicit season always wins, for every sport — this is the backfill path.
    payload = await fetchStandings(opts.season)
    rows = entriesOf(payload)
    season = String(opts.season)
  } else if (seasonSource === 'current-with-fallback') {
    const currentYear = now.getUTCFullYear()
    payload = await fetchStandings(currentYear)
    rows = entriesOf(payload)
    season = String(currentYear)
    if (rows.length === 0) {
      /*
       * Empty is the OFFSEASON signal, not an error — see SEASON_SOURCE. The
       * previous season is the most recent real standings, and the one a
       * postseason seeding source wants.
       */
      const previousYear = currentYear - 1
      const fallback = await fetchStandings(previousYear)
      const fallbackRows = entriesOf(fallback)
      if (fallbackRows.length > 0) {
        payload = fallback
        rows = fallbackRows
        season = String(previousYear)
      }
    }
  } else {
    payload = await fetchStandings()
    rows = entriesOf(payload)
    season = String(payload?.season?.year ?? now.getUTCFullYear())
  }

  if (!payload) return result
  result.fetched = rows.length

  for (const row of rows) {
    const abbrev = typeof row.team?.abbreviation === 'string' ? row.team.abbreviation.toUpperCase() : null
    const teamName = row.team?.displayName ?? row.team?.name ?? null
    if (!abbrev || !teamName) {
      result.skipped += 1
      continue
    }

    const data = {
      team: abbrev,
      teamName,
      logo: row.team?.logos?.[0]?.href ?? null,
      position: stat(row.stats, 'playoffSeed', 'rank'),
      won: stat(row.stats, 'wins'),
      lost: stat(row.stats, 'losses'),
      tied: stat(row.stats, 'ties'),
      pointsFor: stat(row.stats, 'pointsFor', 'points for'),
      pointsAgainst: stat(row.stats, 'pointsAgainst', 'points against'),
      conference: row.group,
      division: row.group,
      season,
      sport,
      source: 'espn',
    }

    try {
      const cacheKey = `${sport}:standings:${season}:${abbrev}`
      await (prisma.sportsDataCache as any).upsert({
        where: { cacheKey },
        update: { data: data as object, expiresAt },
        create: { cacheKey, data: data as object, expiresAt },
      })
      result.written += 1
    } catch (e) {
      if (result.errors.length < 5) {
        result.errors.push(`upsert ${abbrev}: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
  }

  return result
}
