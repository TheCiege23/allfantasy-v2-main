import { prisma } from '@/lib/prisma'
import { ESPN_TEAM_ABBREVIATIONS } from '@/lib/league-import/espn/EspnLeagueFetchService'
import {
  espnDefenseIdentity,
  fetchEspnAthleteById,
  type EspnAthlete,
} from '@/lib/espn/espnAthleteFetch'
import {
  normalizeSportKey,
  selectIngestableIdentities,
} from '@/lib/league-import/providerPlayerIdentities'

/**
 * Give the ESPN player ids we actually hold a name.
 *
 * ⚠ WITHOUT THIS, AN ESPN LEAGUE CAN IMPORT PERFECTLY AND NAME NOBODY. Measured on
 * the first ESPN league ever imported: 252 draft facts, zero rows with
 * `provider = 'espn'` in the identity table, and a draft board of fourteen
 * "(not yet mapped)". The import path cannot fix it — `mRoster` returned bare ids
 * for that league, so the roster directory held `Player <id>` placeholders and
 * there was nothing to harvest.
 *
 * ⚠ IT ASKS ABOUT OUR IDS, NOT ESPN'S CATALOGUE, and that is a correction. The
 * first version walked the athlete LIST, which reports `pageCount: 21` and then
 * serves the same first rows for every page — so it fetched page one twenty-one
 * times and wrote 994 athletes while reporting 20,874 seen. Driving from the ids
 * in our own tables is both correct and smaller: 252 across every imported ESPN
 * league, against a catalogue of 20,277.
 *
 * ⚠ IT DELIBERATELY DOES NOT LINK TO OUR CANONICAL PLAYER. `playerId` stays null.
 * The only signal here is a name, and matching a provider id to a canonical player
 * on a name is what put a basketball guard on an NFL draft board. Provider id ->
 * the provider's own name is a fact; anything beyond that is a guess, and belongs
 * to a matcher that can check a birthday and a position.
 */

export type EspnIdentityIngestSummary = {
  unknownIds: number
  attempted: number
  resolved: number
  unresolved: number
  defencesWritten: number
  inserted: number
  stoppedEarly: boolean
  error?: string
}

/**
 * Every team defence, derived rather than fetched.
 *
 * None resolve as athletes, so without this the humans on a board would all
 * resolve while `-16012` stayed blank.
 */
export function buildEspnDefenceIdentities(): EspnAthlete[] {
  const out: EspnAthlete[] = []
  for (const teamId of Object.keys(ESPN_TEAM_ABBREVIATIONS)) {
    const identity = espnDefenseIdentity(String(-16000 - Number(teamId)), ESPN_TEAM_ABBREVIATIONS)
    if (identity) out.push(identity)
  }
  return out
}

/** Insert only what is not already stored. Never throws. */
async function insertIdentities(rows: EspnAthlete[], sportKey: string): Promise<number> {
  const candidates = selectIngestableIdentities(
    rows.map((r) => ({ providerPlayerId: r.id, displayName: r.displayName })),
  )
  if (candidates.length === 0) return 0

  let inserted = 0
  const CHUNK = 500
  for (let i = 0; i < candidates.length; i += CHUNK) {
    const slice = candidates.slice(i, i + CHUNK)
    try {
      /*
       * ⚠ READ-THEN-INSERT, NOT UPSERT. The compound unique is (provider, sportKey,
       * leagueKey, providerPlayerId) and `leagueKey` is nullable — Postgres does not
       * consider two NULLs equal, so 94,583 rows already sit outside that constraint
       * and an upsert keyed on it would insert a duplicate every run.
       */
      const existing = await prisma.playerProviderIdentity.findMany({
        where: { provider: 'espn', providerPlayerId: { in: slice.map((c) => c.providerPlayerId) } },
        select: { providerPlayerId: true },
      })
      const known = new Set(existing.map((e) => e.providerPlayerId))
      const fresh = slice
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
      if (fresh.length > 0) {
        const written = await prisma.playerProviderIdentity.createMany({
          data: fresh,
          skipDuplicates: true,
        })
        inserted += written.count
      }
    } catch {
      /* One bad chunk must not cost the rest. */
    }
  }
  return inserted
}

/**
 * Resolve the ESPN ids referenced by imported leagues that we cannot yet name.
 *
 * Bounded and resumable: `maxPlayers` and the caller's budget stop it, and a run
 * that stops early is still useful because the next one asks about a shorter list.
 */
export async function ingestEspnAthleteIdentities(options?: {
  maxPlayers?: number
  isExhausted?: () => boolean
}): Promise<EspnIdentityIngestSummary> {
  const maxPlayers = options?.maxPlayers ?? 300
  const sportKey = normalizeSportKey('NFL')

  const summary: EspnIdentityIngestSummary = {
    unknownIds: 0,
    attempted: 0,
    resolved: 0,
    unresolved: 0,
    defencesWritten: 0,
    inserted: 0,
    stoppedEarly: false,
  }

  /* Defences first: free, and they are the ids no fetch could ever answer. */
  summary.defencesWritten = await insertIdentities(buildEspnDefenceIdentities(), sportKey)
  summary.inserted += summary.defencesWritten

  let unknown: Array<{ pid: string }> = []
  try {
    /*
     * ⚠ BOTH SURFACES, BECAUSE A DRAFT IS NOT A ROSTER. Draft facts reported the
     * problem, but a player added off waivers was never drafted and would have
     * stayed nameless on every roster screen. Measured after the draft-only pass
     * landed: 253 distinct ESPN roster ids, 7 of them still unknown — small,
     * because a drafted player is usually still rostered, and precisely the ones a
     * draft-shaped query can never reach.
     */
    unknown = await prisma.$queryRaw<Array<{ pid: string }>>`
      with ids as (
        select distinct d."playerId" as pid
        from dw_draft_facts d
        join leagues l on l.id = d."leagueId"
        where lower(l.platform) = 'espn'
        union
        select distinct jsonb_array_elements_text(r."playerData"->'players') as pid
        from rosters r
        join leagues l on l.id = r."leagueId"
        where lower(l.platform) = 'espn'
          and jsonb_typeof(r."playerData"->'players') = 'array'
      )
      select pid from ids
      where pid !~ '^-'
        and not exists (
          select 1 from sports_core_player_provider_identities i
          where i.provider = 'espn' and i.provider_player_id = ids.pid
        )
      limit ${maxPlayers}
    `
  } catch (error) {
    summary.error = error instanceof Error ? error.message : 'unknown-id query failed'
    return summary
  }

  summary.unknownIds = unknown.length
  const resolved: EspnAthlete[] = []

  for (const row of unknown) {
    if (options?.isExhausted?.()) {
      summary.stoppedEarly = true
      break
    }
    summary.attempted += 1
    try {
      const athlete = await fetchEspnAthleteById(row.pid)
      if (athlete) resolved.push({ id: row.pid, displayName: athlete.displayName })
      else summary.unresolved += 1
    } catch (error) {
      /* A provider hiccup on one id must not end the run. */
      summary.unresolved += 1
      summary.error = error instanceof Error ? error.message.slice(0, 120) : 'athlete fetch failed'
    }
  }

  summary.resolved = resolved.length
  summary.inserted += await insertIdentities(resolved, sportKey)
  return summary
}
