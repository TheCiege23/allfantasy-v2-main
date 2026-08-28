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
  identityMapRowsUpdated: number
}

const EMPTY: EspnLinkSummary = {
  considered: 0,
  attempted: 0,
  linked: 0,
  refused: 0,
  unmatched: 0,
  noEvidence: 0,
  identityRowsUpdated: 0,
  identityMapRowsUpdated: 0,
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
  const [players, identityMap] = await Promise.all([
    prisma.player
      .findMany({
        where: { sport: sportKey },
        select: { id: true, name: true, position: true, team: true, birthDate: true, sport: true },
      })
      .catch(() => []),
    prisma.playerIdentityMap
      .findMany({
        where: { sport: sportKey, espnId: null },
        select: {
          id: true,
          canonicalName: true,
          position: true,
          currentTeam: true,
          dob: true,
          sport: true,
        },
      })
      .catch(() => []),
  ])

  const playerPool = bucketByName(
    players.map((c) => ({
      id: c.id,
      name: c.name,
      sport: c.sport,
      position: c.position,
      team: c.team,
      dob: c.birthDate,
    })),
  )
  const mapPool = bucketByName(
    identityMap.map((m) => ({
      id: m.id,
      name: m.canonicalName,
      sport: m.sport,
      position: m.position,
      team: m.currentTeam,
      dob: m.dob,
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

    /*
     * Mirror onto PlayerIdentityMap, through the SAME matcher rather than a name
     * lookup — so an ambiguous PIM name is refused here exactly as it is above.
     *
     * Update by id and never upsert: creating a PIM row would invent a canonical
     * identity out of a match rather than an identity source, and a row holding an
     * espnId with no sleeperId is no use to the grader in any case.
     */
    const mapBucket = mapPool.get(key) ?? []
    if (mapBucket.length === 0) continue
    const mapped = matchProviderAthlete(evidence, mapBucket)
    if (!mapped.matched) continue
    try {
      await prisma.playerIdentityMap.updateMany({
        where: { id: mapped.id, espnId: null },
        data: { espnId: row.providerPlayerId },
      })
      summary.identityMapRowsUpdated += 1
      /* Drop it from the pool so two ESPN ids can never claim the same PIM row
         within one batch — the unique-ish invariant this table has no constraint for. */
      mapPool.set(
        key,
        mapBucket.filter((c) => c.id !== mapped.id),
      )
    } catch {
      /* The identity link above is the durable one; this mirror is a bonus. */
    }
  }

  return summary
}
