import { prisma } from '@/lib/prisma'
import { ESPN_TEAM_ABBREVIATIONS } from '@/lib/league-import/espn/EspnLeagueFetchService'
import {
  espnDefenseIdentity,
  fetchEspnAthletePage,
  type EspnAthlete,
} from '@/lib/espn/espnAthleteFetch'
import {
  normalizeSportKey,
  selectIngestableIdentities,
} from '@/lib/league-import/providerPlayerIdentities'

/**
 * Give ESPN player ids names.
 *
 * ⚠ WITHOUT THIS, AN ESPN LEAGUE CAN IMPORT PERFECTLY AND NAME NOBODY. Measured on
 * the first ESPN league ever imported: 252 draft facts, 0 rows in the identity
 * table with `provider = 'espn'`, and a draft board of fourteen "(not yet mapped)".
 * The import path cannot fix it — `mRoster` returns bare ids for that league, so
 * the roster directory holds `Player <id>` placeholders and there is nothing to
 * harvest.
 *
 * ⚠ IT DELIBERATELY DOES NOT LINK TO OUR CANONICAL PLAYER. `playerId` is left
 * null. The only signal here is a name, and matching a provider id to a canonical
 * player on a name is precisely what put a basketball guard on an NFL draft board
 * an hour before this was written. Provider id -> provider's own name is a fact;
 * anything further is a guess, and belongs to a matcher that can check a birthday
 * and a position.
 */

export type EspnIdentityIngestSummary = {
  pagesFetched: number
  athletesSeen: number
  defencesSeen: number
  inserted: number
  alreadyKnown: number
  stoppedEarly: boolean
  error?: string
}

/**
 * Every team defence, derived rather than fetched.
 *
 * None of them appear in ESPN's athlete list, so without this the humans on a
 * board would all resolve while `-16012` stayed blank forever.
 */
export function buildEspnDefenceIdentities(): EspnAthlete[] {
  const out: EspnAthlete[] = []
  for (const teamId of Object.keys(ESPN_TEAM_ABBREVIATIONS)) {
    const id = String(-16000 - Number(teamId))
    const identity = espnDefenseIdentity(id, ESPN_TEAM_ABBREVIATIONS)
    if (identity) out.push(identity)
  }
  return out
}

/**
 * Walk the athlete list and store the names we do not already hold.
 *
 * ⚠ READ-THEN-INSERT, NOT UPSERT, and the reason is a real trap rather than a
 * preference. The unique key is (provider, sportKey, leagueKey, providerPlayerId)
 * and `leagueKey` is nullable — Postgres does not consider two NULLs equal, so
 * 94,583 rows in this table already sit outside that constraint and an upsert
 * keyed on it would insert a duplicate every run rather than matching. Reading the
 * ids we hold and inserting only the remainder is idempotent regardless.
 *
 * Bounded and resumable: the caller supplies the page budget, and a failure
 * partway keeps whatever landed rather than rolling the run back. The next run
 * simply sees fewer unknown ids.
 */
export async function ingestEspnAthleteIdentities(options?: {
  maxPages?: number
  pageSize?: number
  isExhausted?: () => boolean
}): Promise<EspnIdentityIngestSummary> {
  const pageSize = options?.pageSize ?? 1000
  const maxPages = options?.maxPages ?? 25
  const sportKey = normalizeSportKey('NFL')

  const summary: EspnIdentityIngestSummary = {
    pagesFetched: 0,
    athletesSeen: 0,
    defencesSeen: 0,
    inserted: 0,
    alreadyKnown: 0,
    stoppedEarly: false,
  }

  const collected: EspnAthlete[] = buildEspnDefenceIdentities()
  summary.defencesSeen = collected.length

  try {
    let page = 1
    let pageCount = 1
    while (page <= pageCount && page <= maxPages) {
      if (options?.isExhausted?.()) {
        summary.stoppedEarly = true
        break
      }
      const result = await fetchEspnAthletePage(page, pageSize)
      summary.pagesFetched += 1
      summary.athletesSeen += result.items.length
      collected.push(...result.items)
      pageCount = result.pageCount
      page += 1
    }
    if (page <= pageCount) summary.stoppedEarly = true
  } catch (error) {
    /* Keep what was collected. A partial name map beats none, and the next run
       resumes from whatever is still unknown. */
    summary.stoppedEarly = true
    summary.error = error instanceof Error ? error.message : 'ESPN athlete fetch failed'
  }

  const candidates = selectIngestableIdentities(
    collected.map((a) => ({ providerPlayerId: a.id, displayName: a.displayName })),
  )
  if (candidates.length === 0) return summary

  /* Chunked so one enormous IN () does not go to the database as a single clause. */
  const CHUNK = 500
  for (let i = 0; i < candidates.length; i += CHUNK) {
    const slice = candidates.slice(i, i + CHUNK)
    try {
      const existing = await prisma.playerProviderIdentity.findMany({
        where: {
          provider: 'espn',
          providerPlayerId: { in: slice.map((c) => c.providerPlayerId) },
        },
        select: { providerPlayerId: true },
      })
      const known = new Set(existing.map((e) => e.providerPlayerId))
      summary.alreadyKnown += known.size

      const rows = slice
        .filter((c) => !known.has(c.providerPlayerId))
        .map((c) => ({
          provider: 'espn',
          providerPlayerId: c.providerPlayerId,
          sportKey,
          displayName: c.displayName,
          source: 'espn-core-athletes',
          confidence: 1,
          /* verified:false — nothing was verified. No canonical player was matched
             and none was attempted; see the note at the top of this file. */
          verified: false,
        }))
      if (rows.length > 0) {
        const written = await prisma.playerProviderIdentity.createMany({
          data: rows,
          skipDuplicates: true,
        })
        summary.inserted += written.count
      }
    } catch (error) {
      summary.error = error instanceof Error ? error.message : 'identity write failed'
    }
  }

  return summary
}
