/**
 * The devy board, valued honestly — one ordering of college players and what
 * each is worth in devy points.
 *
 * ⚠ THIS EXISTS TO REPLACE `DevyPlayer.devyValue`, WHICH IS NOT A VALUATION.
 * Verified against production 2026-08-25. It is written by
 * `calculateQuickDevyValue(position, classYear)` in the legacy cfb-players
 * route, which is a lookup table:
 *
 *     QB 6000  RB 4500  WR 5000  TE 3500 ...   x  { FR 1.4, SO 1.3, JR 1.1, SR 1.0 }
 *
 * There is NO PLAYER-SPECIFIC INPUT in that base. Every freshman quarterback in
 * the country prices at 6000 x 1.4 = 8400, and the production floor of every
 * (position, classYear) group in the table matches the formula exactly — RB/SO
 * is 5850, QB/SO is 7800, WR/JR is 5500. A stats bonus is added later for the
 * minority who have stats, which is where the spread above the floor comes from.
 *
 * ⚠ AND IT IS ZERO FOR 1,455 OF 1,718 PLAYERS — zero, not null. 85% of the board
 * never went through the writer at all, so the live board sorts them last, tiers
 * them "Sleeper" and renders `devyValue / 100` as a flat 0. An absence of data is
 * being shown to managers as a confident statement that the player is worthless.
 *
 * ⚠ AND THE SCALE IS A LIE OF THE MOST EXPENSIVE KIND. 0-10,000 mimics dynasty
 * market units — `computeAvailabilityPct` literally divides by 10,000 to get a
 * percentile — so a college player appears to carry a price comparable to an
 * NFL asset. Nothing measured it. See lib/trade-intel/devyOutlook.ts: no market
 * prices college players at all.
 *
 * So this board never reads `devyValue`. It ranks on the scouting projection,
 * which is the signal that has evidence behind it, and prices that rank on the
 * devy-points curve — which compares devy assets to each other and converts to
 * nothing else.
 */

import { projectDevyOutlook, type DevyOutlook } from '@/lib/trade-intel/devyOutlook'
import { devyAssetValue, type DevyAssetValue } from '@/lib/trade-intel/devyTradeValue'

/**
 * The fields the board needs. Structural rather than the Prisma type so the
 * ranking can be tested without a database.
 */
export type DevyBoardInput = {
  id?: string
  name: string
  position: string | null
  school: string | null
  draftEligibleYear: number | null
  classYear: number | null
  /** The scouting projection. Null when nothing substantive backed it. */
  draftProjectionScore: number | null
  recruitingComposite: number | null
  breakoutAge: number | null
  projectedDraftRound: number | null
  devyAdp: number | null
}

export type DevyBoardEntry = {
  name: string
  position: string | null
  school: string | null
  /** 1 = best devy asset. Null when he could not be ranked at all. */
  devyRank: number | null
  outlook: DevyOutlook
  value: DevyAssetValue
}

export type DevyBoard = {
  entries: DevyBoardEntry[]
  /** How many players carry a rank, and how many could not be ranked. */
  ranked: number
  unranked: number
  /**
   * ⚠ Shown so a consumer cannot mistake a short board for a complete one. When
   * most of the pool is unranked, the board is a partial view of the class.
   */
  coverage: number
  gaps: string[]
}

export const DEVY_BOARD_GAPS = {
  ignoredDevyValue:
    'DevyPlayer.devyValue is not used here — it is a position-and-class-year lookup with no player-specific input, and it is zero for most of the pool',
  partialCoverage:
    'players with no recruiting, production or draft-projection signal are left unranked rather than sorted last, so this board is not the whole class',
} as const

/**
 * Rank and price a pool of college players.
 *
 * ⚠ RANKS ACROSS THE WHOLE POOL, NOT WITHIN A POSITION. Devy drafts are
 * best-player-available, so one ordering is the question managers actually ask.
 * A positional board is a different product and should not be faked by
 * filtering this one — the ranks would still be the global ones.
 *
 * ⚠ UNSCORED PLAYERS ARE UNRANKED, NOT LAST. Sorting them to the bottom states
 * that we know they are the worst assets available; we know nothing about them.
 * They are returned with a null rank and a null value so a caller can show them
 * as unknown rather than worthless.
 */
export function buildDevyValueBoard(
  players: DevyBoardInput[],
  currentSeason: number,
): DevyBoard {
  const withOutlook = players.map((p) => ({
    player: p,
    outlook: projectDevyOutlook({
      player: p,
      draftEligibleYear: p.draftEligibleYear,
      currentSeason,
      name: p.name,
    }),
  }))

  /*
   * Ranked on the STORED scouting projection rather than the outlook score,
   * because the outlook score already has the horizon discount folded in. Rank
   * should say how good a prospect is thought to be; the wait is priced on top
   * of the curve afterwards, and applying it twice would punish a freshman for
   * being a freshman in both terms.
   */
  const rankable = withOutlook
    .filter((x) => x.player.draftProjectionScore != null)
    .sort((a, b) => {
      const byScore =
        (b.player.draftProjectionScore as number) - (a.player.draftProjectionScore as number)
      /* Name breaks ties so the listing is stable run to run; it does NOT
         affect rank, which ties share below. */
      return byScore !== 0 ? byScore : a.player.name.localeCompare(b.player.name)
    })

  /*
   * ⚠ TIES SHARE A RANK (standard competition ranking: 1, 2, 2, 4). Two players
   * with the same projection are indistinguishable to us, and handing them
   * consecutive ranks would price them differently — 750 against 706 on this
   * curve — purely from their order in the array. That difference is not a
   * scouting opinion, it is an artifact of the sort, and it would move whenever
   * the query order did.
   */
  const rankByName = new Map<string, number>()
  let lastScore: number | null = null
  let lastRank = 0
  rankable.forEach((x, i) => {
    const score = x.player.draftProjectionScore as number
    const rank = score === lastScore ? lastRank : i + 1
    rankByName.set(keyFor(x.player), rank)
    lastScore = score
    lastRank = rank
  })

  const entries: DevyBoardEntry[] = withOutlook.map(({ player, outlook }) => {
    const devyRank = rankByName.get(keyFor(player)) ?? null
    return {
      name: player.name,
      position: player.position,
      school: player.school,
      devyRank,
      outlook,
      value: devyAssetValue({ devyRank, outlook, name: player.name }),
    }
  })

  /*
   * ⚠ SORTED BY VALUE, NOT BY RANK, AND THE TWO GENUINELY DISAGREE. Rank says
   * how good a prospect is thought to be; value prices the wait on top of that.
   * A freshman three years from eligibility can out-rank a junior and still be
   * worth less today, so a listing in rank order shows values jumping around and
   * reads as a bug. This is a value board, so value is the ordering — `devyRank`
   * travels with every entry for the scouting view.
   *
   * Name breaks every tie so the same pool always renders the same way, whatever
   * order the query returned it in.
   */
  entries.sort((a, b) => {
    const av = a.value.value
    const bv = b.value.value
    if (av == null && bv == null) return a.name.localeCompare(b.name)
    if (av == null) return 1
    if (bv == null) return -1
    return bv - av || a.name.localeCompare(b.name)
  })

  const ranked = entries.filter((e) => e.devyRank != null).length
  const unranked = entries.length - ranked

  return {
    entries,
    ranked,
    unranked,
    coverage: entries.length === 0 ? 0 : ranked / entries.length,
    gaps: [
      DEVY_BOARD_GAPS.ignoredDevyValue,
      ...(unranked > 0 ? [DEVY_BOARD_GAPS.partialCoverage] : []),
    ],
  }
}

/**
 * Identity for ranking.
 *
 * ⚠ NAME PLUS SCHOOL, NOT NAME ALONE. Two college players share a name often
 * enough that a name-only key would collapse them into one rank and drop the
 * other from the board entirely. `id` is preferred when the caller has it.
 */
function keyFor(p: DevyBoardInput): string {
  return p.id ?? `${p.name.toLowerCase()}|${(p.school ?? '').toLowerCase()}`
}

/**
 * Tier from devy rank, for a board that wants bands rather than numbers.
 *
 * ⚠ BANDS ARE PRESENTATION, NOT MODEL PARAMETERS — the same rule
 * classifyMicrostructure follows in valueLedger.ts. Nothing multiplies by these;
 * they only decide which word sits next to a rank the manager can also see.
 *
 * ⚠ AND AN UNRANKED PLAYER IS NOT A SLEEPER. The live board's assignTier() maps
 * devyValue 0 to "Sleeper", which turns 1,455 players we know nothing about into
 * a scouting opinion. Null here, and the caller must render it as unknown.
 */
export function devyTier(devyRank: number | null): 'Elite' | 'Tier 1' | 'Tier 2' | 'Depth' | null {
  if (devyRank == null) return null
  if (devyRank <= 12) return 'Elite'
  if (devyRank <= 36) return 'Tier 1'
  if (devyRank <= 84) return 'Tier 2'
  return 'Depth'
}
