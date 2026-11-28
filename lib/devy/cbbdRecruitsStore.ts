/**
 * Stored college basketball recruiting classes — the DENOMINATOR of the basketball devy measurement
 * (`contracts/cbbd/GAPS.md` B-02 item 1, B-04). Read side only.
 *
 * 🛑 NOTHING WRITES THIS KEY YET, AND NOTHING MAY UNTIL THE ENDPOINT IS CAPTURED. CBBD's recruiting endpoint is
 * unverified (`contracts/cbbd/ENDPOINTS.yaml` `recruiting_players`, confidence none): its path, its field names
 * and whether its rows carry CBBD's `athleteId` are all unknown. The writer — fetch, map wire fields to
 * `StoredBasketballRecruit`, store — is written FROM `fixtures/recruiting-<YEAR>.json` once
 * `contracts/cbbd/scripts/probe.sh recruiting <YEAR>` has captured one, and not before.
 *
 * What is defined here needs no wire field name: OUR stored shape and its key. `StoredBasketballRecruit` is the
 * contract the future writer must FILL, not a description of what CBBD sends:
 *
 *   athleteId     the id that joins a recruit to `cbbd:draft-history:v1:<year>` picks (CBBD's athlete id).
 *                 If the captured rows carry no such id, the join must be redesigned from the fixture —
 *                 do NOT fall back to names (B-01: picks are linked by id, never by name).
 *   nationalRank  the recruit's national rank in his class (1 = best), or null when unranked.
 *   position      G / F / C, the draft feed's own vocabulary, mapped by the writer; null when unmappable.
 *
 * Stored under `cbbd:recruits:v1:<classYear>` as `StoredBasketballRecruitClass`. A class year is the high-school
 * graduating class: the 2019 class enrolled in the fall of 2019 and was first draft-eligible in June 2020.
 */

export const CBBD_RECRUITS_KEY_PREFIX = 'cbbd:recruits:v1:'

export type BasketballPosition = 'G' | 'F' | 'C'

export type StoredBasketballRecruit = {
  athleteId: number | null
  name: string
  position: BasketballPosition | null
  nationalRank: number | null
}

export type StoredBasketballRecruitClass = {
  classYear: number
  fetchedAt: string
  /** The endpoint the writer read, e.g. the captured path. Recorded so a stored class names its source. */
  source: string
  recruits: StoredBasketballRecruit[]
}

const POSITIONS = new Set<BasketballPosition>(['G', 'F', 'C'])

/** A stored class read back, or null when absent or not this shape. Rows that are not this shape are dropped, never coerced. */
export function parseStoredRecruitClass(data: unknown): StoredBasketballRecruitClass | null {
  const d = data as Partial<StoredBasketballRecruitClass> | null
  if (!d || typeof d.classYear !== 'number' || typeof d.fetchedAt !== 'string' || !Array.isArray(d.recruits)) return null
  const recruits = d.recruits.filter(
    (r): r is StoredBasketballRecruit =>
      !!r &&
      typeof r.name === 'string' &&
      (r.athleteId === null || Number.isInteger(r.athleteId)) &&
      (r.nationalRank === null || (Number.isInteger(r.nationalRank) && r.nationalRank >= 1)) &&
      (r.position === null || POSITIONS.has(r.position)),
  )
  return { classYear: d.classYear, fetchedAt: d.fetchedAt, source: String(d.source ?? ''), recruits }
}

/** Every stored class among `years`. Missing years are absent from the map. */
export async function readRecruitClasses(
  years: readonly number[],
  db: { sportsDataCache: { findMany(args: { where: { cacheKey: { in: string[] } }; select: { data: true } }): Promise<Array<{ data: unknown }>> } },
): Promise<Map<number, StoredBasketballRecruitClass>> {
  const rows = await db.sportsDataCache.findMany({ where: { cacheKey: { in: years.map((y) => `${CBBD_RECRUITS_KEY_PREFIX}${y}`) } }, select: { data: true } })
  const out = new Map<number, StoredBasketballRecruitClass>()
  for (const r of rows) {
    const c = parseStoredRecruitClass(r.data)
    if (c) out.set(c.classYear, c)
  }
  return out
}
