/**
 * What a team defense (DEF / DST) is worth — measured, and priced as a POSITION, not ranked.
 *
 * 🛑 WHY THIS EXISTS. FantasyCalc prices no team defenses and the league board priced none either, so
 * `pricePlayer` refused every one ("Our value feed doesn't price team defenses") and ANY trade with a
 * defense in it was not graded at all — the one grade withholds a deal with an unpriced asset rather
 * than counting it as zero. This module is the league's answer, built the way the kicker's is
 * (`lib/kicker-values/leagueKickerValue.ts`), from its own measurement.
 *
 * Measured on production 2026-09-28 over 3,597 Sleeper DEF game rows (2019-2025, 32-33 teams a
 * season, `pts_std`), each season analysed SEPARATELY — pooling rank pairs across seasons
 * manufactures agreement (ranks restart at 1 every season), the trap the kicker study recorded:
 *
 *   RANK PERSISTS YEAR TO YEAR, BUT WEAKLY. Spearman on points per game, same team, next season:
 *     2019->20 +0.385   2020->21 +0.450   2021->22 +0.080
 *     2022->23 +0.155   2023->24 +0.067   2024->25 +0.405
 *     mean +0.257, positive in all six pairs.
 *   WITHIN A SEASON, WEEKS 1-9 AGAINST 10+, EVEN LESS:
 *     +0.069 +0.418 +0.315 +0.146 +0.111 +0.060 +0.239 — mean +0.194.
 *
 *   THE POSITION IS STEEPER THAN KICKER. Share of DEF1's points per game, averaged over 7 seasons:
 *     DEF3 88.7%  DEF6 80.4%  DEF12 70.3%  DEF18 61.0%  DEF24 53.7%  DEF30 39.6%  DEF32 32.3%
 *     (kicker: K12 76.8%, K24 64.7%)
 *
 * ⚠ SO NOT FLAT FOR THE KICKER'S REASON. Kicker rank INVERTS (mean -0.455); defence rank carries a
 * little real signal. But a coefficient of ~0.26 means a ranking by last season would be mostly
 * noise presented as precision — the one-grade letter would move on it — so every defense in a league
 * prices the SAME, and what varies is the LEAGUE: how many DEF slots it starts against the 32 real
 * defenses. A shrunk tilt (mean + 0.26 x deviation) is the measured next step if a surface ever
 * needs to tell defenses apart; it is deliberately not taken here.
 *
 * Pure: no prisma, no fetch, no clock.
 */

/** One defense per NFL team. */
export const DEFENSE_SUPPLY = 32

/**
 * Share of DEF1's points per game by rank, averaged over the seven measured seasons.
 *
 * ⚠ A DESCRIPTION OF THE POSITION, NOT A PRICING LADDER. It sizes how much a league's starters are
 * worth over their replacement — a question about the league's slots — and is never indexed by an
 * individual defense's rank.
 */
const MEASURED_SHARE_BY_RANK: ReadonlyArray<{ rank: number; share: number }> = [
  { rank: 1, share: 1.0 },
  { rank: 3, share: 0.887 },
  { rank: 6, share: 0.804 },
  { rank: 12, share: 0.703 },
  { rank: 18, share: 0.61 },
  { rank: 24, share: 0.537 },
  { rank: 30, share: 0.396 },
  { rank: 32, share: 0.323 },
]

/** Linear read of the measured shares, held flat past the last observation. */
export function defenseShareAtRank(rank: number): number {
  const r = Math.max(1, rank)
  const pts = MEASURED_SHARE_BY_RANK
  if (r >= pts[pts.length - 1].rank) return pts[pts.length - 1].share
  for (let i = 1; i < pts.length; i++) {
    if (r <= pts[i].rank) {
      const a = pts[i - 1]
      const b = pts[i]
      return a.share + (b.share - a.share) * ((r - a.rank) / (b.rank - a.rank))
    }
  }
  return pts[0].share
}

/**
 * The position's ceiling in the trade engine's 0-10000 units — A PRODUCT DECISION, the same one the
 * kicker made (500 dynasty / 650 redraft) and for the same reasons: no market prices defenses, a
 * defense is a slot-filler bought and sold for little, and redraft is HIGHER because dynasty values
 * embed multi-year premiums a team defense cannot earn. The steeper measured curve above is what
 * makes a defense come out a little dearer than a kicker in the same league — not a bigger ceiling.
 */
export const DEFENSE_CEILING_DYNASTY = 500
export const DEFENSE_CEILING_REDRAFT = 650

const DEFENSE_SLOT_NAMES = new Set(['DEF', 'DST', 'D/ST'])

/** How many team-defense starting slots a league's roster demands. */
export function countDefenseSlots(rosterPositions: readonly string[] | null | undefined): number {
  if (!Array.isArray(rosterPositions)) return 0
  return rosterPositions.filter((p) => DEFENSE_SLOT_NAMES.has(String(p).trim().toUpperCase())).length
}

export interface LeagueDefenseValue {
  /** What EVERY rostered team defense in this league is worth; null when the league starts none. */
  value: number | null
  /** The rank a waiver defense occupies in this league. */
  replacementRank: number
  /** How much of the 32-defense supply the league's starting demand uses. */
  scarcity: number
  /** Why the value is what it is, in one line a manager can argue with. */
  basis: string
}

/** Price the team-defense position for one league. Every defense gets the same number (see header). */
export function resolveLeagueDefenseValue(args: {
  rosterPositions: readonly string[] | null | undefined
  numTeams: number
  isDynasty: boolean
}): LeagueDefenseValue {
  const slots = countDefenseSlots(args.rosterPositions)
  const numTeams = Number.isFinite(args.numTeams) && args.numTeams > 0 ? args.numTeams : 12
  if (slots === 0) {
    return {
      value: null,
      replacementRank: 0,
      scarcity: 0,
      basis: 'This league starts no team defense, so a defense is not a tradeable asset in it.',
    }
  }
  const demand = slots * numTeams
  const replacementRank = demand + 1
  const scarcity = Math.max(0, Math.min(1, demand / DEFENSE_SUPPLY))
  const ceiling = args.isDynasty ? DEFENSE_CEILING_DYNASTY : DEFENSE_CEILING_REDRAFT
  const edgeOverReplacement = 1 - defenseShareAtRank(replacementRank)
  const value = Math.max(1, Math.round(ceiling * (0.35 + 0.65 * scarcity) * (0.5 + edgeOverReplacement)))
  return {
    value,
    replacementRank,
    scarcity: Math.round(scarcity * 1000) / 1000,
    basis:
      `Every team defense prices the same here: defense rank barely carries over ` +
      `(year-over-year Spearman +0.26, within a season +0.19). This league starts ${slots} defense` +
      `${slots === 1 ? '' : 's'} across ${numTeams} teams, so replacement is about DEF${replacementRank}.`,
  }
}
