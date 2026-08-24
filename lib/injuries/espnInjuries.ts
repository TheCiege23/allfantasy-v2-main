import 'server-only'

import { prisma } from '@/lib/prisma'
import { ESPN_SITE_API_BASE } from '@/lib/providers/espnUrls'

/**
 * espnInjuries — ESPN's public injury feed, for both football codes.
 *
 * WHY THIS EXISTS. NCAAF had ONE injury row in the entire database. Rolling
 * Insights, which supplies NFL, answers 304-empty for `injuries/NCAAF`, and
 * TheSportsDB has no injury endpoint at all (404 on lookupinjuries). ESPN
 * publishes one, needs no key, and covers both sports:
 *
 *   verified 2026-08-15   NFL   32 team blocks, 800 injuries
 *                         NCAAF  3 team blocks,   3 injuries (preseason)
 *
 * The college count is small because the season has not started, not because
 * the feed is thin — and a feed that returns three rows in August is still the
 * difference between "no designation on file" and a wrong one.
 *
 * Writes with `source: 'espn'` into sports_injuries. The upsert key is
 * (sport, externalId, source), so ESPN rows sit ALONGSIDE Rolling Insights
 * rather than overwriting it; injuryReadPort already picks one row per player
 * with the freshest source winning, so adding a second NFL feed is corroboration
 * rather than conflict.
 */

const ESPN_PATH: Record<string, string> = {
  NFL: 'football/nfl',
  NCAAF: 'football/college-football',
}

const ESPN_SOURCE = 'espn'

/** Matches the Rolling Insights writer so both feeds age out on the same clock. */
const INJURY_TTL_MS = 6 * 60 * 60 * 1000

export type EspnInjurySyncResult = {
  sport: string
  fetched: number
  written: number
  skippedNoPlayer: number
  errors: string[]
}

const str = (v: unknown): string | null => {
  if (v == null) return null
  const t = String(v).trim()
  return t.length > 0 ? t : null
}

/**
 * ESPN states the designation in several places and they do not always agree;
 * `type.description` is the canonical one, with the top-level status as backup.
 *
 * Returns null rather than a guess when nothing is stated. A null designation is
 * read downstream as "no designation on file", which is NOT the same as healthy
 * — collapsing them would invent availability nobody reported.
 */
function resolveStatus(injury: Record<string, any>): string | null {
  const fromType = str(injury?.type?.description) ?? str(injury?.type?.name)
  const normalized = fromType && fromType.startsWith('INJURY_STATUS_')
    ? fromType.replace('INJURY_STATUS_', '').toLowerCase()
    : fromType
  const raw = normalized ?? str(injury?.status)
  if (!raw) return null
  const t = raw.toLowerCase()
  if (t.includes('out')) return 'Out'
  if (t.includes('doubtful')) return 'Doubtful'
  if (t.includes('questionable')) return 'Questionable'
  if (t.includes('probable')) return 'Probable'
  if (t.includes('injured reserve') || t === 'ir') return 'IR'
  if (t.includes('suspend')) return 'Suspended'
  if (t.includes('day-to-day') || t.includes('day to day')) return 'Day-To-Day'
  // ESPN's injury feed also lists players who have been CLEARED. That is real
  // information for a fantasy decision — "was hurt, is playing" — so the row is
  // kept rather than dropped, with the designation cased like the others.
  if (t === 'active') return 'Active'
  // Preserve anything unexpected verbatim rather than dropping the row: a
  // designation we do not recognise is still a designation ESPN published.
  return raw
}

export async function syncEspnInjuriesToDb(opts: {
  sport: 'NFL' | 'NCAAF'
  now?: Date
}): Promise<EspnInjurySyncResult> {
  const sport = opts.sport
  const result: EspnInjurySyncResult = { sport, fetched: 0, written: 0, skippedNoPlayer: 0, errors: [] }

  const path = ESPN_PATH[sport]
  if (!path) {
    result.errors.push(`no espn path for ${sport}`)
    return result
  }

  let payload: { injuries?: Array<Record<string, any>> } | null = null
  try {
    // This module IS the ingestion boundary: its only job is provider fetch ->
    // sports_injuries upsert, which populates the table every DB-first reader
    // (injuryReadPort) consumes.
    const url = `${ESPN_SITE_API_BASE}/${path}/injuries` // db-first-exception: injury ingestion writer, not a read path
    const res = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(20_000),
    })
    if (!res.ok) {
      result.errors.push(`espn responded ${res.status}`)
      return result
    }
    payload = (await res.json()) as { injuries?: Array<Record<string, any>> }
  } catch (e) {
    result.errors.push(`fetch failed: ${e instanceof Error ? e.message : String(e)}`)
    return result
  }

  const groups = Array.isArray(payload?.injuries) ? payload.injuries : []
  const now = opts.now ?? new Date()
  const expiresAt = new Date(now.getTime() + INJURY_TTL_MS)
  const season = now.getUTCMonth() + 1 >= 8 ? now.getUTCFullYear() : now.getUTCFullYear() - 1

  for (const group of groups) {
    const teamName = str(group?.displayName) ?? str(group?.name)
    const teamId = str(group?.id)
    const rows = Array.isArray(group?.injuries) ? group.injuries : []
    result.fetched += rows.length

    for (const injury of rows) {
      const externalId = str(injury?.id)
      const athlete = injury?.athlete ?? {}
      const playerName = str(athlete?.displayName) ?? str(athlete?.fullName)
      if (!externalId || !playerName) {
        result.skippedNoPlayer += 1
        continue
      }

      const data = {
        playerName,
        // ESPN's athlete id, not a canonical AF id. The read port resolves to
        // canonical players by name; keeping the provider id preserves provenance.
        playerId: str(athlete?.id),
        team: str(athlete?.team?.displayName) ?? teamName,
        teamId,
        position: str(athlete?.position?.abbreviation) ?? str(athlete?.position?.name),
        type: str(injury?.details?.type),
        status: resolveStatus(injury),
        description: str(injury?.shortComment) ?? str(injury?.longComment),
        date: injury?.date ? new Date(injury.date) : null,
        season,
        week: null as number | null,
        fetchedAt: now,
        expiresAt,
        raw: injury as never,
      }

      try {
        await prisma.sportsInjury.upsert({
          where: { sport_externalId_source: { sport, externalId, source: ESPN_SOURCE } },
          update: data,
          create: { sport, externalId, source: ESPN_SOURCE, ...data },
        })
        result.written += 1
      } catch (e) {
        if (result.errors.length < 5) {
          result.errors.push(`upsert ${externalId}: ${e instanceof Error ? e.message : String(e)}`)
        }
      }
    }
  }

  return result
}
