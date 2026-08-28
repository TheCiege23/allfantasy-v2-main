import { Prisma } from '@prisma/client'
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
import {
  linkEspnIdentitiesToCanonical,
  type EspnLinkSummary,
} from '@/lib/espn/linkEspnIdentities'

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
 * ⚠ IT LINKS TO OUR CANONICAL PLAYER ONLY THROUGH A MATCHER THAT CAN REFUSE.
 * This file used to leave `playerId` null on principle, because the only signal it
 * kept was a name, and matching a provider id to a canonical player on a name is
 * what put a basketball guard on an NFL draft board. That principle has not moved:
 * `matchProviderAthlete` requires a birthday or a position to corroborate the name,
 * and a name on its own still links nothing.
 *
 * ⚠ FIRST PRODUCTION RUN, 2026-08-27 — 261 rows backfilled, 157 refused, 0 linked,
 * and that is the guard working rather than failing. The v3 athlete document carries
 * `dateOfBirth` and NO position (see `espnAthleteFetch`), while `Player.birthDate` is
 * populated on 0 rows in every sport. So both sides hold a birthday-shaped hole: ESPN
 * supplies one, the canonical record has none to compare it against, nothing
 * corroborates the name, and every candidate is correctly refused.
 *
 * ⚠ THE UNLOCK IS A CANONICAL BIRTHDAY, NOT A LOOSER MATCHER. 309 of these ESPN names
 * already have a birthday in `SportsPlayer` where source = 'thesportsdb'. Populating
 * `Player.birthDate` from there is NOT circular, and the distinction matters: the
 * thesportsdb rows reach `Player` through their own provider-identity links, which are
 * 100% linked already — so the birthday arrives by id, not by the name it would then
 * be used to corroborate. Deriving it through a NAME join instead would launder a name
 * match into a "birthday-verified" one, which is the exact failure this module exists
 * to prevent.
 */

export type EspnIdentityIngestSummary = {
  unknownIds: number
  attempted: number
  resolved: number
  unresolved: number
  defencesWritten: number
  inserted: number
  /** Existing rows given the position/birthday an earlier parser discarded. */
  evidenceBackfilled: number
  /** Null until the linking pass runs; see `linkEspnIdentitiesToCanonical`. */
  link?: EspnLinkSummary
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

/**
 * The corroborating fields, or null when the athlete carried none.
 *
 * Returning null rather than `{}` matters: a row with an empty evidence object looks
 * processed, and the backfill below would skip it for ever.
 */
function espnEvidence(athlete: EspnAthlete | undefined): {
  position?: string
  team?: string
  dob?: string
} | null {
  if (!athlete) return null
  const out: { position?: string; team?: string; dob?: string } = {}
  if (athlete.position) out.position = athlete.position
  if (athlete.team) out.team = athlete.team
  if (athlete.dob) out.dob = athlete.dob
  return Object.keys(out).length > 0 ? out : null
}

/**
 * Give already-stored rows the evidence the previous parser discarded.
 *
 * ⚠ WITHOUT THIS THE MATCHER NEVER FIRES ON A SINGLE EXISTING ROW. All 1,257 ESPN
 * identities were written by a parser that kept only the name, and the ingest above
 * asks exclusively about ids it CANNOT name — so none of them would ever be fetched
 * again, and the linking pass would report "no evidence" for every one of them, for
 * ever. Bounded and resumable: each run shortens the list for the next.
 */
async function backfillEspnEvidence(
  sportKey: string,
  maxRows: number,
  isExhausted?: () => boolean,
): Promise<number> {
  if (maxRows <= 0) return 0
  const stale = await prisma.playerProviderIdentity
    .findMany({
      where: { provider: 'espn', sportKey, playerId: null, rawPayload: { equals: Prisma.DbNull } },
      select: { id: true, providerPlayerId: true },
      take: maxRows,
    })
    .catch(() => [])

  let updated = 0
  for (const row of stale) {
    if (isExhausted?.()) break
    /* Negative ids are derived defences; no athlete document exists for them and
       asking costs a request to learn nothing. */
    if (row.providerPlayerId.startsWith('-')) continue
    try {
      const athlete = await fetchEspnAthleteById(row.providerPlayerId)
      const evidence = espnEvidence(athlete ?? undefined)
      if (!evidence) continue
      await prisma.playerProviderIdentity.update({
        where: { id: row.id },
        data: { rawPayload: evidence },
      })
      updated += 1
    } catch {
      /* One id must not end the pass. */
    }
  }
  return updated
}

/** Insert only what is not already stored. Never throws. */
async function insertIdentities(rows: EspnAthlete[], sportKey: string): Promise<number> {
  const candidates = selectIngestableIdentities(
    rows.map((r) => ({ providerPlayerId: r.id, displayName: r.displayName })),
  )
  /* `selectIngestableIdentities` returns only id and name, so the evidence has to be
     carried alongside rather than through it. */
  const evidenceById = new Map(rows.map((r) => [r.id, r]))
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
          /* Stored so the linking pass need not re-fetch what we already had in
             hand. `null` where the payload did not carry it — an absent field must
             read as "unknown", never as an empty string that could match. */
          /* `Prisma.DbNull`, not `null`: a nullable Json column distinguishes SQL NULL
             from the JSON value `null`, and plain null is not assignable to either. */
          rawPayload: espnEvidence(evidenceById.get(c.providerPlayerId)) ?? Prisma.DbNull,
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
    evidenceBackfilled: 0,
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
      /* The whole athlete, not just its name — the position and birthday on it are
         exactly what the linking pass needs, and dropping them here is what made
         linking impossible before. `id` is forced to the id we asked about. */
      if (athlete) resolved.push({ ...athlete, id: row.pid })
      else summary.unresolved += 1
    } catch (error) {
      /* A provider hiccup on one id must not end the run. */
      summary.unresolved += 1
      summary.error = error instanceof Error ? error.message.slice(0, 120) : 'athlete fetch failed'
    }
  }

  summary.resolved = resolved.length
  summary.inserted += await insertIdentities(resolved, sportKey)

  /* Whatever naming did not spend goes to backfilling evidence onto older rows. */
  if (!options?.isExhausted?.()) {
    summary.evidenceBackfilled = await backfillEspnEvidence(
      sportKey,
      Math.max(0, maxPlayers - summary.attempted),
      options?.isExhausted,
    )
  }

  /*
   * Link last, and always — it is cheap, reads only what is already stored, and a run
   * that fetched nothing new can still link rows whose evidence arrived last time.
   */
  summary.link = await linkEspnIdentitiesToCanonical({
    sportKey,
    isExhausted: options?.isExhausted,
  }).catch(() => undefined)

  return summary
}
