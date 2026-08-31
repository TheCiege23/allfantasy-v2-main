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

  let payload: Record<string, any> | null = null
  try {
    /* This module IS the ingestion boundary: provider fetch -> SportsDataCache upsert. */
    const url = `${ESPN_V2_API_BASE}/${path}/standings` // db-first-exception: standings ingestion writer, not a read path
    const res = await fetch(url, {
      headers: { accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(20_000),
    })
    if (!res.ok) {
      result.errors.push(`espn responded ${res.status}`)
      return result
    }
    payload = (await res.json()) as Record<string, any>
  } catch (e) {
    result.errors.push(`fetch failed: ${e instanceof Error ? e.message : String(e)}`)
    return result
  }

  /*
   * Season comes from the PAYLOAD, not from a clock. ESPN's football season is named for the year
   * it kicks off in and spans into the next calendar year, so deriving it locally in January
   * would write next season's key over this season's data.
   */
  const season = String(opts.season ?? payload?.season?.year ?? new Date(now).getUTCFullYear())

  const rows: Array<{ team: any; stats: EspnStatEntry[]; group: string | null }> = []
  collectEntries(payload, rows, null)
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
