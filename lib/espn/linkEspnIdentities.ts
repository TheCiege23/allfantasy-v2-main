/**
 * Turn ESPN player ids into canonical players, so an imported ESPN league can be
 * named, valued and graded like a Sleeper one.
 *
 * ⚠ THE GAP THIS CLOSES, MEASURED 2026-08-27 against production: every provider in
 * `sports_core_player_provider_identities` is 100% linked to a canonical player —
 * rolling_insights, sleeper, cfbd, thesportsdb, api_football — except ESPN, which is
 * 0% linked across all 1,257 of its rows. `PlayerIdentityMap.espnId` exists as a
 * column and has never held a value, in any sport. So ESPN ids reach every read
 * surface as bare numbers: that is why a draft board reads "Player 2577417", and why
 * the draft grader cannot score an ESPN league at all.
 *
 * ⚠ WHY `PlayerIdentityMap.espnId` IS WORTH FILLING. That row already carries
 * `sleeperId`, and the draft grader scores against a stats board keyed on Sleeper
 * player ids. Writing `espnId` onto a row that has a `sleeperId` IS the ESPN ->
 * Sleeper crosswalk — no new table, and `resolveCanonicalPlayerId` reads it already.
 *
 * ⚠ WHAT THIS WILL NOT DO — measured before it was written, not discovered after.
 * Matching all 1,257 ESPN names against each candidate table:
 *
 *     SportsPlayer(source=sleeper, NFL)  738 unique   30 ambiguous   489 no hit
 *     Player(NFL)                        704 unique   82 ambiguous   471 no hit
 *     PlayerIdentityMap(NFL)             371 unique    2 ambiguous   884 no hit
 *
 * The no-hits are overwhelmingly retired players reached by historical draft boards —
 * Dave Ball, Jon Asamoah, Ray Austin — plus the derived `KC D/ST` rows, which have no
 * athlete counterpart anywhere. They are correctly unmatchable, and this reports them
 * unmatched rather than forcing a link. A run that links about half is this working.
 */

import { prisma } from '@/lib/prisma'
import {
  matchProviderAthlete,
  type AthleteEvidence,
  type CanonicalCandidate,
} from '@/lib/player-identity/matchProviderAthlete'
import { normalizePlayerName } from '@/lib/player-identity/playerIdentityResolution'
import { buildSleeperDobMap } from '@/lib/espn/sleeperDobMap'

export type EspnLinkSummary = {
  considered: number
  /** Rows carrying enough evidence for a match to be attempted at all. */
  attempted: number
  linked: number
  /** Name agreed, but nothing corroborated it — or two candidates tied. */
  refused: number
  /** No candidate agreed on name. Usually a retired player or a D/ST. */
  unmatched: number
  /** Rows skipped because no ingest has captured position or birthday for them yet. */
  noEvidence: number
  identityRowsUpdated: number
}

export type EspnIdentityMapSummary = {
  /** ESPN identity rows already linked to a canonical player. */
  linkedEspnRows: number
  /** Of those, the ones whose player also has a Sleeper identity. */
  reachedSleeperId: number
  /** Of those, the ones whose Sleeper id reaches a PlayerIdentityMap row. */
  reachedIdentityMap: number
  written: number
  /** Skipped because the hop was not one-to-one, or the row already had an id. */
  skippedAmbiguous: number
  skippedAlreadySet: number
}

const EMPTY: EspnLinkSummary = {
  considered: 0,
  attempted: 0,
  linked: 0,
  refused: 0,
  unmatched: 0,
  noEvidence: 0,
  identityRowsUpdated: 0,
}

/** Evidence captured onto the identity row by a previous ingest, if any. */
function evidenceFromRow(raw: unknown): { position?: string; team?: string; dob?: string } {
  if (!raw || typeof raw !== 'object') return {}
  const r = raw as Record<string, unknown>
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined)
  return { position: str(r.position), team: str(r.team), dob: str(r.dob) }
}

/** Bucket candidates by the SAME normalizer the matcher compares with. */
function bucketByName(rows: CanonicalCandidate[]): Map<string, CanonicalCandidate[]> {
  const out = new Map<string, CanonicalCandidate[]>()
  for (const row of rows) {
    const key = normalizePlayerName(row.name)
    if (!key) continue
    const bucket = out.get(key)
    if (bucket) bucket.push(row)
    else out.set(key, [row])
  }
  return out
}

/**
 * `Player.id` → a birthday reached through that player's Sleeper identity.
 *
 * Two bounded reads for the whole batch, matching how the candidate pools above
 * are loaded: a per-candidate lookup would be thousands of round trips inside a
 * cron budget.
 *
 * ⚠ A PLAYER WITH TWO SLEEPER IDENTITIES IS SKIPPED, NOT GUESSED. Production
 * currently shows exactly one per player, but if that ever stops being true the
 * two rows point at different athletes and picking whichever returned first
 * would feed the matcher a birthday belonging to somebody else — which is worse
 * than no birthday, because it can produce a confident wrong link rather than a
 * refusal.
 */
async function loadSleeperDobs(sportKey: string): Promise<Map<string, string>> {
  const out = new Map<string, string>()

  const identities = await prisma.playerProviderIdentity
    .findMany({
      where: { provider: 'sleeper', sportKey, playerId: { not: null } },
      select: { playerId: true, providerPlayerId: true },
    })
    .catch(() => [])
  if (identities.length === 0) return out

  const sleeperIds = [...new Set(identities.map((i) => i.providerPlayerId).filter(Boolean))]
  if (sleeperIds.length === 0) return out

  const dobRows = await prisma.sportsPlayer
    .findMany({
      where: { sport: sportKey, sleeperId: { in: sleeperIds }, dob: { not: null } },
      select: { sleeperId: true, dob: true },
    })
    .catch(() => [])

  /* The composing rules, and the two-identities guard, live in a pure module so
     they can be tested without loading prisma. */
  return buildSleeperDobMap(identities, dobRows)
}

/**
 * Link the ESPN identity rows that carry enough evidence to be linked safely.
 *
 * Bounded and resumable in the same shape as the ingest that calls it: a run that
 * stops early is still progress, because the next one starts from a shorter list.
 */
export async function linkEspnIdentitiesToCanonical(options?: {
  maxRows?: number
  sportKey?: string
  isExhausted?: () => boolean
}): Promise<EspnLinkSummary> {
  const maxRows = options?.maxRows ?? 400
  const sportKey = options?.sportKey ?? 'NFL'
  const summary: EspnLinkSummary = { ...EMPTY }

  const rows = await prisma.playerProviderIdentity
    .findMany({
      where: { provider: 'espn', sportKey, playerId: null },
      select: { id: true, providerPlayerId: true, displayName: true, rawPayload: true },
      take: maxRows,
    })
    .catch(() => [])
  summary.considered = rows.length
  if (rows.length === 0) return summary

  /*
   * Both candidate pools are loaded once for the whole batch.
   *
   * Per-row queries would be hundreds of round trips inside a cron budget, and these
   * pools are small — ~13k and ~3.3k NFL rows. Both are bucketed with
   * `normalizePlayerName` rather than read from a stored `normalizedName` column,
   * which matters: PIM stores "a.j. bouye" with its punctuation intact while the
   * canonical normalizer produces "aj bouye". Querying that column with a normalized
   * string finds nothing, silently, for every punctuated name in the league.
   */
  const players = await prisma.player
    .findMany({
      where: { sport: sportKey },
      select: { id: true, name: true, position: true, team: true, birthDate: true, sport: true },
    })
    .catch(() => [])

  /*
   * ── The birthdays the candidate pool was missing ───────────────────────
   *
   * ⚠ `Player.birthDate` IS NOT WHERE THIS APP KEEPS BIRTHDAYS, and matching
   * against it alone is why so little linked. Measured on production
   * 2026-08-29: `Player(NFL)` carries a birthDate on 1,546 of 13,010 rows
   * (12%), while `SportsPlayer(NFL)` holds 15,777 of them —
   * `matchProviderAthlete`'s own header already says the only birthday in the
   * database is `SportsPlayer.dob`, and its `dob?: string | Date` signature
   * exists to accept exactly that string.
   *
   * ESPN evidence is a name and a birthday and nothing else (its athlete
   * document has no position field), so a candidate with no birthday can never
   * be corroborated — the matcher correctly refuses on name alone. That was
   * the outcome for 471 of 1,163 attempted rows: "only the name agreed".
   *
   * The chain is all ids, no matching: Player -> its SLEEPER provider identity
   * -> that identity's providerPlayerId IS the Sleeper id -> SportsPlayer.dob.
   * It reaches 4,071 players that have no `birthDate` of their own, taking
   * corroborable coverage from 12% to roughly 43%.
   *
   * ⚠ IT NEVER OVERRIDES A BIRTHDATE WE ALREADY HOLD. `birthDate` wins where it
   * is set; this only fills a null. A provider disagreeing with our own
   * canonical record is a conflict to investigate, not one to silently resolve
   * in the provider's favour inside a matcher.
   */
  const sleeperDobByPlayerId = await loadSleeperDobs(sportKey)

  const playerPool = bucketByName(
    players.map((c) => ({
      id: c.id,
      name: c.name,
      sport: c.sport,
      position: c.position,
      team: c.team,
      dob: c.birthDate ?? sleeperDobByPlayerId.get(c.id) ?? null,
    })),
  )

  for (const row of rows) {
    if (options?.isExhausted?.()) break

    const stored = evidenceFromRow(row.rawPayload)

    /* No corroborating evidence means the matcher would refuse anyway, and counting
       that as a refusal would hide the real cause: nothing has captured this
       athlete's position yet. Its own bucket, so the summary stays honest. */
    if (!stored.position && !stored.dob) {
      summary.noEvidence += 1
      continue
    }

    const evidence: AthleteEvidence = {
      name: row.displayName,
      sport: sportKey,
      position: stored.position ?? null,
      team: stored.team ?? null,
      dob: stored.dob ?? null,
    }
    summary.attempted += 1

    const key = normalizePlayerName(row.displayName)
    const bucket = playerPool.get(key) ?? []
    const result = matchProviderAthlete(evidence, bucket)
    if (!result.matched) {
      if (bucket.length === 0) summary.unmatched += 1
      else summary.refused += 1
      continue
    }

    try {
      await prisma.playerProviderIdentity.update({
        where: { id: row.id },
        data: {
          playerId: result.id,
          confidence: result.confidence,
          /* `verified` means a human or a shared id confirmed it. A corroborated
             inference is not that, however confident, so it stays false. */
          verified: false,
          source: 'espn-identity-matcher',
        },
      })
      summary.identityRowsUpdated += 1
      summary.linked += 1
    } catch {
      /* One row must not cost the batch. */
      continue
    }

  }

  return summary
}

/**
 * Fill `PlayerIdentityMap.espnId` by COMPOSING ESTABLISHED ID LINKS — no matching.
 *
 * ⚠ WHY THIS REPLACED A MATCHER-BASED MIRROR. The first version resolved the PIM row
 * with `matchProviderAthlete`, and measured against production it linked exactly
 * nothing, for a structural reason rather than a tuning one: PIM rows carry a
 * position and no birthday, while ESPN evidence carries a birthday and no position
 * (its athlete document has no position field at all). Nothing could ever
 * corroborate, so every candidate was correctly refused, for ever. Two mechanisms
 * where one is permanently inert is worse than one, so that path is gone.
 *
 * The chain here needs no matching at all, because every hop is an id:
 *
 *   espn identity.playerId  ->  the same player's SLEEPER identity
 *                           ->  its providerPlayerId IS the Sleeper id
 *                           ->  PlayerIdentityMap.sleeperId (a UNIQUE column)
 *
 * The result is the ESPN -> Sleeper crosswalk on a single PIM row, which is what the
 * draft grader needs, and it inherits the confidence of the espn->player link rather
 * than inventing a new one.
 *
 * ⚠ EVERY HOP IS CHECKED FOR FAN-OUT even though production currently shows none
 * (exactly one Sleeper identity per linked player). A second Sleeper row on one
 * player would otherwise pick whichever came back first and write a crosswalk to the
 * wrong athlete — silently, and to the one table a live resolver already reads.
 */
export async function linkEspnIdentityMapByIdChain(options?: {
  sportKey?: string
  maxWrites?: number
  isExhausted?: () => boolean
}): Promise<EspnIdentityMapSummary> {
  const sportKey = options?.sportKey ?? 'NFL'
  const maxWrites = options?.maxWrites ?? 500
  const summary: EspnIdentityMapSummary = {
    linkedEspnRows: 0,
    reachedSleeperId: 0,
    reachedIdentityMap: 0,
    written: 0,
    skippedAmbiguous: 0,
    skippedAlreadySet: 0,
  }

  const espnRows = await prisma.playerProviderIdentity
    .findMany({
      where: { provider: 'espn', sportKey, playerId: { not: null } },
      select: { providerPlayerId: true, playerId: true },
    })
    .catch(() => [])
  summary.linkedEspnRows = espnRows.length
  if (espnRows.length === 0) return summary

  /* Two ESPN ids resolving to one player is a contradiction, not a choice. Both are
     dropped rather than letting one win by ordering. */
  const espnByPlayer = new Map<string, string[]>()
  for (const row of espnRows) {
    if (!row.playerId) continue
    const bucket = espnByPlayer.get(row.playerId)
    if (bucket) bucket.push(row.providerPlayerId)
    else espnByPlayer.set(row.playerId, [row.providerPlayerId])
  }

  const sleeperRows = await prisma.playerProviderIdentity
    .findMany({
      where: { provider: 'sleeper', sportKey, playerId: { in: [...espnByPlayer.keys()] } },
      select: { providerPlayerId: true, playerId: true },
    })
    .catch(() => [])

  const sleeperByPlayer = new Map<string, string[]>()
  for (const row of sleeperRows) {
    if (!row.playerId) continue
    const bucket = sleeperByPlayer.get(row.playerId)
    if (bucket) bucket.push(row.providerPlayerId)
    else sleeperByPlayer.set(row.playerId, [row.providerPlayerId])
  }

  /* playerId -> the one Sleeper id, where both sides are unambiguous. */
  const resolved = new Map<string, string>()
  for (const [playerId, espnIds] of espnByPlayer) {
    const sleeperIds = sleeperByPlayer.get(playerId)
    if (!sleeperIds) continue
    summary.reachedSleeperId += 1
    if (espnIds.length !== 1 || sleeperIds.length !== 1) {
      summary.skippedAmbiguous += 1
      continue
    }
    resolved.set(sleeperIds[0]!, espnIds[0]!)
  }
  if (resolved.size === 0) return summary

  const mapRows = await prisma.playerIdentityMap
    .findMany({
      where: { sport: sportKey, sleeperId: { in: [...resolved.keys()] } },
      select: { id: true, sleeperId: true, espnId: true },
    })
    .catch(() => [])
  summary.reachedIdentityMap = mapRows.length

  for (const mapRow of mapRows) {
    if (summary.written >= maxWrites) break
    if (options?.isExhausted?.()) break
    if (!mapRow.sleeperId) continue
    const espnId = resolved.get(mapRow.sleeperId)
    if (!espnId) continue
    if (mapRow.espnId) {
      /* Never overwrite. A row that already names a different ESPN id is a
         disagreement to surface, not to silently resolve. */
      summary.skippedAlreadySet += 1
      continue
    }
    try {
      await prisma.playerIdentityMap.update({
        where: { id: mapRow.id },
        data: { espnId },
      })
      summary.written += 1
    } catch {
      /* One row must not cost the batch. */
    }
  }

  return summary
}
