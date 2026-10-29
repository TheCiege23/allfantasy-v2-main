/**
 * SportDynastyResolver — sport-aware dynasty horizon and aging logic.
 * Different sports have different peak ages and dynasty relevance.
 */

import { DYNASTY_SPORTS, normalizeSportForDynasty, type DynastySport } from './types'

export function getDynastySports(): readonly DynastySport[] {
  return DYNASTY_SPORTS
}

export function resolveSportForDynasty(sport: string): DynastySport {
  return normalizeSportForDynasty(sport)
}

export type PeakAgeRange = { peakStart: number; peakEnd: number; hardCliff: number }

/**
 * Sports whose aging is modelled on their OWN per-position curves below, rather than borrowed
 * from an NFL archetype. Consumers that historically ran an NFL-shaped curve (NFL archetype
 * mapping, NFL-only position tables) branch on this so NFL output stays byte-identical.
 */
export const SPORTS_WITH_NATIVE_AGING_CURVES: readonly DynastySport[] = ['MLB', 'NBA', 'NHL', 'SOCCER']

export function hasNativeAgingCurve(sport: string): boolean {
  return SPORTS_WITH_NATIVE_AGING_CURVES.includes(normalizeSportForDynasty(sport))
}

/**
 * College sports. Every player is roughly 18-23 and LEAVES the player pool (draft, eligibility
 * exhausted, transfer out of the league's scope) long before any physical decline, so a pro-style
 * peak/decline/cliff curve has nothing to describe. What actually drives a college asset's value is
 * production and remaining eligibility (class year / draft eligibility), and none of the age-only
 * engines here receive class year. So the honest model is: NO AGE EFFECT — consumers apply a flat
 * multiplier of 1 and accrue no aging risk for these sports rather than inventing a curve.
 * (lib/devy/devyOptionValue.ts prices NCAAF prospects for NFL devy leagues from measured draft and
 * arrival rates; that is a different question — value on arrival in the NFL — and is not reused.)
 */
export const COLLEGE_DYNASTY_SPORTS: readonly DynastySport[] = ['NCAAF', 'NCAAB']

export function isCollegeDynastySport(sport: string): boolean {
  return COLLEGE_DYNASTY_SPORTS.includes(normalizeSportForDynasty(sport))
}

const NFL_RANGES: Record<string, PeakAgeRange> = {
  QB: { peakStart: 27, peakEnd: 33, hardCliff: 38 },
  RB: { peakStart: 23, peakEnd: 26, hardCliff: 29 },
  WR: { peakStart: 25, peakEnd: 30, hardCliff: 33 },
  TE: { peakStart: 26, peakEnd: 30, hardCliff: 33 },
  K: { peakStart: 26, peakEnd: 32, hardCliff: 38 },
  DEF: { peakStart: 24, peakEnd: 28, hardCliff: 32 },
}
const NFL_DEFAULT: PeakAgeRange = { peakStart: 25, peakEnd: 29, hardCliff: 32 }

/**
 * NBA. Box-score/BPM aging studies put the league-wide peak around 25–28 with decline from ~30;
 * bigs whose value is rim protection/rebounding hold a little later than ball-handlers whose value
 * is burst. The pre-existing PG/SG/SF vs PF/C split already encodes that, so the values are kept;
 * only the generic slot labels (G, F, G-F, F-C, UTIL) are now resolved to a group instead of all
 * falling back to PG.
 */
const NBA_GUARD_WING: PeakAgeRange = { peakStart: 26, peakEnd: 31, hardCliff: 35 }
const NBA_BIG: PeakAgeRange = { peakStart: 27, peakEnd: 32, hardCliff: 36 }
const NBA_RANGES: Record<string, PeakAgeRange> = {
  PG: NBA_GUARD_WING,
  SG: NBA_GUARD_WING,
  SF: NBA_GUARD_WING,
  G: NBA_GUARD_WING,
  'G-F': NBA_GUARD_WING,
  GF: NBA_GUARD_WING,
  F: NBA_GUARD_WING,
  UTIL: NBA_GUARD_WING,
  PF: NBA_BIG,
  C: NBA_BIG,
  'F-C': NBA_BIG,
  FC: NBA_BIG,
}

/**
 * MLB. Delta-method aging work (FanGraphs / Bill James lineage) has hitters peaking ~26–30 with a
 * steady decline after 30 and a steep one after ~34–35. Catchers age worst of the hitters (squat
 * wear, lost playing time) and are treated as declining ~2 years earlier. Pitchers peak earlier
 * than hitters: velocity loss starts in the late 20s and arm-injury attrition compounds it, so SP
 * decline begins ~29 with a cliff ~34; relievers are the most volatile and get the shortest window.
 */
const MLB_HITTER: PeakAgeRange = { peakStart: 26, peakEnd: 30, hardCliff: 35 }
const MLB_CATCHER: PeakAgeRange = { peakStart: 26, peakEnd: 29, hardCliff: 33 }
const MLB_SP: PeakAgeRange = { peakStart: 25, peakEnd: 29, hardCliff: 34 }
const MLB_RP: PeakAgeRange = { peakStart: 25, peakEnd: 29, hardCliff: 33 }
const MLB_RANGES: Record<string, PeakAgeRange> = {
  C: MLB_CATCHER,
  '1B': MLB_HITTER,
  '2B': MLB_HITTER,
  '3B': MLB_HITTER,
  SS: MLB_HITTER,
  IF: MLB_HITTER,
  MI: MLB_HITTER,
  CI: MLB_HITTER,
  OF: MLB_HITTER,
  LF: MLB_HITTER,
  CF: MLB_HITTER,
  RF: MLB_HITTER,
  DH: MLB_HITTER,
  UTIL: MLB_HITTER,
  SP: MLB_SP,
  P: MLB_SP,
  RP: MLB_RP,
}

/**
 * NHL. Point-production aging curves (Evolving-Hockey, Hockey-Graphs) peak forwards ~24–28 with
 * decline from ~29 and a sharp drop by ~33. Defensemen develop later and hold slightly longer.
 * Goalies are the late bloomers: typical peak ~26–31 and usable into the mid-30s.
 */
const NHL_FORWARD: PeakAgeRange = { peakStart: 24, peakEnd: 28, hardCliff: 33 }
const NHL_DEFENSE: PeakAgeRange = { peakStart: 25, peakEnd: 29, hardCliff: 34 }
const NHL_GOALIE: PeakAgeRange = { peakStart: 26, peakEnd: 31, hardCliff: 36 }
const NHL_RANGES: Record<string, PeakAgeRange> = {
  C: NHL_FORWARD,
  LW: NHL_FORWARD,
  RW: NHL_FORWARD,
  W: NHL_FORWARD,
  F: NHL_FORWARD,
  UTIL: NHL_FORWARD,
  D: NHL_DEFENSE,
  LD: NHL_DEFENSE,
  RD: NHL_DEFENSE,
  G: NHL_GOALIE,
}

/** Legacy flat MLB/NHL range — kept as the fallback for an unrecognised position label. */
const MLB_NHL_UNKNOWN_POSITION: PeakAgeRange = { peakStart: 25, peakEnd: 30, hardCliff: 36 }

/**
 * Soccer. Performance-rating aging work on the top European leagues (e.g. Dendir 2016, Journal of
 * Sports Analytics) puts outfield peaks in the mid-to-late 20s: forwards peak and decline earliest
 * (pace and repeated sprints go first), midfielders slightly later, defenders — whose value leans on
 * positioning — latest of the outfield groups. Goalkeepers are the widely observed outlier, peaking
 * around 27-32 and routinely starting into their mid-30s. Coarse four-group ranges only; the
 * evidence does not support per-role (CB vs FB, DM vs AM) precision.
 */
const SOCCER_FORWARD: PeakAgeRange = { peakStart: 24, peakEnd: 28, hardCliff: 32 }
const SOCCER_MIDFIELDER: PeakAgeRange = { peakStart: 24, peakEnd: 29, hardCliff: 33 }
const SOCCER_DEFENDER: PeakAgeRange = { peakStart: 25, peakEnd: 30, hardCliff: 34 }
const SOCCER_GOALKEEPER: PeakAgeRange = { peakStart: 27, peakEnd: 32, hardCliff: 36 }
const SOCCER_RANGES: Record<string, PeakAgeRange> = {
  FWD: SOCCER_FORWARD,
  FW: SOCCER_FORWARD,
  F: SOCCER_FORWARD,
  ST: SOCCER_FORWARD,
  MID: SOCCER_MIDFIELDER,
  MF: SOCCER_MIDFIELDER,
  M: SOCCER_MIDFIELDER,
  DEF: SOCCER_DEFENDER,
  DF: SOCCER_DEFENDER,
  D: SOCCER_DEFENDER,
  GK: SOCCER_GOALKEEPER,
  GKP: SOCCER_GOALKEEPER,
  G: SOCCER_GOALKEEPER,
}

/**
 * The single range college sports (and soccer's unrecognised positions) always returned. For
 * NCAAF/NCAAB it is NOT an aging curve — see COLLEGE_DYNASTY_SPORTS: no multiplier or risk is derived
 * from it. It is kept only because getPeakAgeRange must return a range (lifecycle labels read it).
 */
const LEGACY_COLLEGE_SOCCER_RANGE: PeakAgeRange = { peakStart: 22, peakEnd: 28, hardCliff: 32 }

/**
 * Peak age range by position (sport-aware; default NFL).
 * Signature and return shape are a public contract (War Room calls this) — keep them stable.
 */
export function getPeakAgeRange(
  sport: string,
  position: string
): { peakStart: number; peakEnd: number; hardCliff: number } {
  const pos = String(position ?? '').toUpperCase().trim()
  const s = normalizeSportForDynasty(sport)
  const pick = (r: PeakAgeRange): PeakAgeRange => ({ ...r })
  if (s === 'NBA') return pick(NBA_RANGES[pos] ?? NBA_RANGES.PG)
  if (s === 'MLB') return pick(MLB_RANGES[pos] ?? MLB_NHL_UNKNOWN_POSITION)
  if (s === 'NHL') return pick(NHL_RANGES[pos] ?? MLB_NHL_UNKNOWN_POSITION)
  if (s === 'SOCCER') return pick(SOCCER_RANGES[pos] ?? LEGACY_COLLEGE_SOCCER_RANGE)
  if (s === 'NCAAB' || s === 'NCAAF') return pick(LEGACY_COLLEGE_SOCCER_RANGE)
  return pick(NFL_RANGES[pos] ?? NFL_DEFAULT)
}

/** Whether the sport/format is typically dynasty-oriented (long-term roster value). */
export function isDynastyRelevant(sport: string): boolean {
  const s = normalizeSportForDynasty(sport)
  return DYNASTY_SPORTS.includes(s)
}
