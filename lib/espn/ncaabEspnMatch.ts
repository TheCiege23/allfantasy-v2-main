/**
 * Pure matching for the ESPN NCAAB source: ESPN schools -> our Rolling Insights schools, and
 * ESPN roster athletes -> our Rolling Insights player rows on THAT school.
 *
 * 🛑 A MISSING LINK IS HONEST; A WRONG ONE PUTS SOMEONE ELSE'S FACE ON A PLAYER CARD. Every rule
 * here refuses rather than guesses: ties are refused, a candidate claimed twice is refused for
 * both claimants, and nothing is ever matched across schools.
 *
 * Measured against real data before this was written (contracts/espn GAPS M-03): on Duke,
 * Belmont and New Haven, same-school name + jersey matched 35 of 49 ESPN athletes with ZERO
 * cases of a name matching under a different jersey.
 */

import { normalizePlayerName } from '@/lib/player-assets/headshotCandidateMatch'

// ---------------------------------------------------------------------------
// Schools
// ---------------------------------------------------------------------------

/** Words that distinguish nothing between two schools' names. */
const SCHOOL_FILLER = new Set(['university', 'of', 'the', 'college', 'at'])

export function schoolTokens(name: string | null | undefined): string[] {
  return String(name ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter((t) => t && !SCHOOL_FILLER.has(t))
}

export const schoolKey = (name: string | null | undefined): string => schoolTokens(name).join(' ')

export type RiSchool = { externalId: string; name: string; shortName: string | null }
export type EspnSchool = { id: string; location: string; abbreviation: string | null }

export type SchoolMatch = {
  espnId: string
  riExternalId: string
  rule: 'alias' | 'exact' | 'subset+abbreviation' | 'abbreviation'
}

/**
 * Hand-reviewed links for schools no rule reaches — renamed programs and names that share no
 * word with ESPN's. Keyed by RI TEAM ID, not name: RI carries two rows for UMKC that differ
 * only in a dash, and only 347 has players. Each entry was checked against ESPN's teams list
 * on 2026-10-01. Bypasses the rules, so keep it small and keep it reviewed.
 *
 * Deliberately ABSENT, and why: Saint Francis (PA) left D1 in 2026 — a substring search
 * offers "San Francisco", which is a different school; "Holy Cross College (IN)" is not
 * ESPN's Holy Cross (that is RI's "College of the Holy Cross", already an exact match);
 * Hartford, Savannah State, Queens, Lindenwood and Southern Indiana have no ESPN entry.
 */
export const SCHOOL_ALIASES: Readonly<Record<string, string>> = {
  '1': '399', //     University at Albany                               -> UAlbany
  '43': '152', //    North Carolina State University                    -> NC State
  '116': '2239', //  California State University, Fullerton             -> Cal State Fullerton
  '117': '2463', //  California State University, Northridge            -> Cal State Northridge
  '122': '27', //    University of California, Riverside                -> UC Riverside
  '316': '85', //    Indiana University – Purdue University Indianapolis -> IU Indianapolis (renamed 2024)
  '344': '2934', //  California State University, Bakersfield           -> Cal State Bakersfield
  '347': '140', //   University of Missouri–Kansas City                 -> Kansas City
  '140': '2429', //  University of North Carolina at Charlotte          -> Charlotte
  '233': '2046', //  Austin Peay State University                       -> Austin Peay
  '293': '2277', //  Houston Baptist University                         -> Houston Christian (renamed 2022)
  '296': '2377', //  McNeese State University                           -> McNeese
  '297': '2443', //  University of New Orleans                          -> LSU New Orleans (ESPN's name; the only NOLA D1 program)
  '328': '309', //   University of Louisiana at Lafayette               -> Louisiana
  '350': '292', //   University of Texas Rio Grande Valley              -> UT Rio Grande Valley
  '212': '2005', //  United States Air Force Academy                    -> Air Force
  '281': '236', //   University of Tennessee at Chattanooga             -> Chattanooga
  '325': '2031', //  University of Arkansas at Little Rock              -> Little Rock
  '187': '2084', //  The State University of New York at Buffalo        -> Buffalo
  // Pairs whose names reduce to the SAME key ("college"/"university" are filler), so the
  // exact rule correctly refuses both — the reviewed id is the only safe way through.
  '35': '103', //    Boston College                                     -> Boston College
  '259': '104', //   Boston University                                  -> Boston University
  '41': '2390', //   University of Miami                                -> Miami (FL)
  '181': '193', //   Miami University                                   -> Miami (OH)
}

/**
 * Match each RI school to at most one ESPN school.
 *   1. a reviewed alias;
 *   2. exact school key (RI "Duke University" == ESPN "Duke");
 *   3. ESPN's tokens a subset of RI's AND the abbreviations agree
 *      ("University of Texas at Austin"/TEX -> "Texas"/TEX);
 *   4. for what is left, the abbreviation alone — but only when it is unique on BOTH sides
 *      and the ESPN school is unclaimed (RI uses `UNH` for New Hampshire AND New Haven, `MER`
 *      for Mercer AND Merrimack). Reaches ESPN's initialism names: UCLA, LSU, UConn, Ole Miss.
 * Then 1:1 — an ESPN school claimed by two RI schools is refused for both.
 *
 * Why rule 4 is safe enough: a school link alone writes only a logo. A player still has to
 * match on name AND jersey on that school's roster, so a wrong school yields no players.
 */
export function matchSchools(
  riSchools: readonly RiSchool[],
  espnSchools: readonly EspnSchool[],
  aliases: Readonly<Record<string, string>> = SCHOOL_ALIASES,
): { matches: SchoolMatch[]; unmatched: RiSchool[]; ambiguous: RiSchool[] } {
  const espnById = new Map(espnSchools.map((e) => [e.id, e]))
  const byKey = new Map<string, EspnSchool[]>()
  for (const e of espnSchools) {
    const k = schoolKey(e.location)
    byKey.set(k, [...(byKey.get(k) ?? []), e])
  }

  const proposals: SchoolMatch[] = []
  const unmatched: RiSchool[] = []
  const ambiguous: RiSchool[] = []

  for (const r of riSchools) {
    const alias = aliases[r.externalId]
    if (alias && espnById.has(alias)) {
      proposals.push({ espnId: alias, riExternalId: r.externalId, rule: 'alias' })
      continue
    }
    const exact = byKey.get(schoolKey(r.name)) ?? []
    if (exact.length === 1) {
      proposals.push({ espnId: exact[0]!.id, riExternalId: r.externalId, rule: 'exact' })
      continue
    }
    if (exact.length > 1) {
      ambiguous.push(r)
      continue
    }
    const rTokens = new Set(schoolTokens(r.name))
    const abbr = r.shortName?.trim().toUpperCase()
    const subset = espnSchools.filter((e) => {
      const t = schoolTokens(e.location)
      return t.length > 0 && t.every((x) => rTokens.has(x)) && !!abbr && e.abbreviation?.toUpperCase() === abbr
    })
    const longest = Math.max(0, ...subset.map((e) => schoolTokens(e.location).length))
    const best = subset.filter((e) => schoolTokens(e.location).length === longest)
    if (best.length === 1) proposals.push({ espnId: best[0]!.id, riExternalId: r.externalId, rule: 'subset+abbreviation' })
    else if (best.length > 1) ambiguous.push(r)
    else unmatched.push(r)
  }

  // Rule 4 — abbreviation alone, unique on both sides, ESPN school not already proposed.
  const abbr = (s: string | null | undefined) => s?.trim().toUpperCase() || null
  const riAbbrCount = new Map<string, number>()
  for (const r of riSchools) {
    const a = abbr(r.shortName)
    if (a) riAbbrCount.set(a, (riAbbrCount.get(a) ?? 0) + 1)
  }
  const espnByAbbr = new Map<string, EspnSchool[]>()
  for (const e of espnSchools) {
    const a = abbr(e.abbreviation)
    if (a) espnByAbbr.set(a, [...(espnByAbbr.get(a) ?? []), e])
  }
  const proposed = new Set(proposals.map((p) => p.espnId))
  for (let i = unmatched.length - 1; i >= 0; i--) {
    const r = unmatched[i]!
    const a = abbr(r.shortName)
    const hits = a ? espnByAbbr.get(a) ?? [] : []
    if (a && riAbbrCount.get(a) === 1 && hits.length === 1 && !proposed.has(hits[0]!.id)) {
      proposals.push({ espnId: hits[0]!.id, riExternalId: r.externalId, rule: 'abbreviation' })
      proposed.add(hits[0]!.id)
      unmatched.splice(i, 1)
    }
  }

  const claims = new Map<string, number>()
  for (const p of proposals) claims.set(p.espnId, (claims.get(p.espnId) ?? 0) + 1)
  const riById = new Map(riSchools.map((r) => [r.externalId, r]))
  const matches: SchoolMatch[] = []
  for (const p of proposals) {
    if (claims.get(p.espnId) === 1) matches.push(p)
    else ambiguous.push(riById.get(p.riExternalId)!)
  }
  return { matches, unmatched, ambiguous }
}

// ---------------------------------------------------------------------------
// Players
// ---------------------------------------------------------------------------

export type RiPlayer = { externalId: string; name: string; number: number | null }
export type EspnAthleteLite = { id: string; fullName: string; jersey: string | null }
export type PlayerMatch = { athleteId: string; riExternalId: string }

/**
 * Match ONE school's ESPN roster to that SAME school's RI rows. Name AND jersey must both
 * agree; exactly one candidate; and each RI row may be claimed once.
 *
 * ⚠ The RI rows include former players (RI NCAAB `ACT` is not "current roster" — GAPS M-01),
 * so a jersey number alone repeats across seasons (Duke #2 x3) and a name alone is not
 * unique either. The PAIR is what is safe, measured at 0 conflicts on the probed teams.
 * ⚠ `jersey` is a string on the wire and `number` an int here; compare as strings.
 */
export function matchRoster(
  athletes: readonly EspnAthleteLite[],
  riPlayers: readonly RiPlayer[],
): { matches: PlayerMatch[]; noCandidate: number; refused: number } {
  const proposals: PlayerMatch[] = []
  let noCandidate = 0
  let refused = 0
  for (const a of athletes) {
    const name = normalizePlayerName(a.fullName)
    if (!name || a.jersey == null) {
      noCandidate += 1
      continue
    }
    const hits = riPlayers.filter(
      (r) => r.number != null && String(r.number) === a.jersey && normalizePlayerName(r.name) === name,
    )
    if (hits.length === 1) proposals.push({ athleteId: a.id, riExternalId: hits[0]!.externalId })
    else if (hits.length > 1) refused += 1
    else noCandidate += 1
  }
  const claims = new Map<string, number>()
  for (const p of proposals) claims.set(p.riExternalId, (claims.get(p.riExternalId) ?? 0) + 1)
  const matches = proposals.filter((p) => claims.get(p.riExternalId) === 1)
  refused += proposals.length - matches.length
  return { matches, noCandidate, refused }
}
