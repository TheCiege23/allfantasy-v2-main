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
  /** Carried through so a caller can join back to its own rows by id. */
  id?: string
  name: string
  position: string | null
  school: string | null
  /** 1 = best devy asset, on the SCOUTING ordering. Null when he could not be ranked. */
  devyRank: number | null
  /**
   * Where real drafters put him: rank among the players carrying a Fantrax NCAAF ADP,
   * lowest ADP first. Null when he has none — coverage is ~337 of 1,720.
   */
  adpRank: number | null
  /**
   * How the two orderings compare for this player. Null when only one exists, because
   * one opinion cannot corroborate itself and reporting agreement would invent it.
   */
  corroboration: DevyCorroboration | null
  outlook: DevyOutlook
  value: DevyAssetValue
}

/**
 * Agreement between the scouting ordering and the ADP ordering, for one player.
 *
 * 🛑 REPORTED, NEVER BLENDED — AND THE DIFFERENCE IS THE WHOLE POINT. `lib/trade-intel/
 * afValue.ts` blends FantasyCalc against DynastyProcess in rank space, and it is honest
 * there because those two agree on ORDER at Spearman 0.939 and differ only in scale.
 *
 * These two do not. Measured on production 2026-08-29 across the 327 players carrying both
 * signals: Spearman 0.380 overall (WR 0.348, RB 0.333, TE 0.328, QB 0.580), median rank gap
 * 71 of 327, p90 176, max 282. Dylan Raiola is 33rd on scouting and 315th on ADP.
 *
 * Averaging orderings that disagree that much produces a number neither source supports, so
 * the board keeps the scouting rank for pricing and hands the disagreement to the manager
 * instead. "Scouting says 33rd, drafters say 315th" is the most useful true thing we can say
 * about that player; a confident 174th would not be.
 */
export type DevyCorroboration = {
  /**
   * The two ranks being compared, BOTH over the commonly-signalled pool.
   *
   * ⚠ RENDER THESE, NOT `devyRank` NEXT TO `adpRank`. `devyRank` is a rank over everyone with
   * a scouting score (~1,279); putting it beside a rank over the ~327 rated players invites
   * the exact subtraction this type exists to prevent, and makes an agreeing player look like
   * a disagreeing one.
   */
  scoutRankInPool: number
  adpRankInPool: number
  /** Absolute distance between the two orderings, over the commonly-signalled pool. */
  rankGap: number
  /**
   * How much the two agree about him. Thresholds come from the measured distribution above:
   * the median gap is 71 and the 90th percentile is 176, so inside 35 is genuine agreement
   * and beyond 176 the two are telling different stories.
   */
  confidence: 'corroborated' | 'mixed' | 'contested'
  /** One line a manager can act on. */
  note: string
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
  /** How many players carry a real draft-behaviour signal to check the scouting against. */
  adpCoverage: number
  /**
   * How many players the two orderings genuinely disagree about. A surface should say this
   * out loud: it is the honest headline of a board built on one weak signal and one partial
   * one.
   */
  contested: number
  gaps: string[]
}

export const DEVY_BOARD_GAPS = {
  ignoredDevyValue:
    'DevyPlayer.devyValue is not used here — it is a position-and-class-year lookup with no player-specific input, and it is zero for most of the pool',
  partialCoverage:
    'players with no recruiting, production or draft-projection signal are left unranked rather than sorted last, so this board is not the whole class',
  adpDisagrees:
    'the scouting ordering and real draft behaviour agree only weakly (Spearman 0.380 over the 327 players carrying both, measured 2026-08-29), so ranks are reported with their disagreement rather than averaged into one number',
  adpPartial:
    'Fantrax NCAAF ADP covers roughly 337 of 1,720 players, and the gap is which schools are ingested rather than player quality — a player without an ADP is unmeasured, not worse',
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

  /*
   * The second opinion: where real drafters actually take him.
   *
   * ⚠ RANKED AMONG ADP-CARRYING PLAYERS ONLY, AND NEVER MERGED INTO THE SCOUTING ORDER.
   * Coverage is partial by SCHOOL rather than by quality — Fantrax rates all of college
   * football and this pool ingests a subset — so a player without an ADP is not worse than
   * one with it, he is unmeasured. Concatenating the two boards would assert exactly that
   * falsehood, and stacking 337 rated players above 942 unrated ones is a big lie to tell
   * silently.
   */
  const adpRankByKey = new Map<string, number>()
  withOutlook
    .filter((x) => typeof x.player.devyAdp === 'number' && Number.isFinite(x.player.devyAdp))
    .sort((a, b) => (a.player.devyAdp as number) - (b.player.devyAdp as number))
    .forEach((x, i) => adpRankByKey.set(keyFor(x.player), i + 1))

  /*
   * The scouting rank has to be re-expressed over the SAME population before the two can be
   * compared. `devyRank` is a rank over everyone with a scouting score (~1,279); `adpRank` is
   * over the ~337 with an ADP. Subtracting one from the other directly would report a gap of
   * hundreds for a player both sources actually like, purely because the boards are different
   * sizes — the same class of error as comparing ranks across seasons.
   */
  const common = withOutlook.filter(
    (x) => adpRankByKey.has(keyFor(x.player)) && x.player.draftProjectionScore != null,
  )
  const commonScoutRank = new Map<string, number>()
  ;[...common]
    .sort(
      (a, b) =>
        (b.player.draftProjectionScore as number) - (a.player.draftProjectionScore as number) ||
        a.player.name.localeCompare(b.player.name),
    )
    .forEach((x, i) => commonScoutRank.set(keyFor(x.player), i + 1))

  /*
   * ⚠ ADP IS RE-RANKED OVER THE COMMON POOL TOO, NOT REUSED FROM `adpRankByKey`. That map is
   * ranked over everyone carrying an ADP (~337), while the scouting side above can only rank
   * those who ALSO have a score (~327). Comparing across the two would inject a drift of up
   * to the ten players in one set and not the other — small, but it is the same
   * different-sized-boards error in miniature, and there is no reason to accept any of it.
   */
  const commonAdpRank = new Map<string, number>()
  ;[...common]
    .sort((a, b) => (a.player.devyAdp as number) - (b.player.devyAdp as number))
    .forEach((x, i) => commonAdpRank.set(keyFor(x.player), i + 1))

  const entries: DevyBoardEntry[] = withOutlook.map(({ player, outlook }) => {
    const key = keyFor(player)
    const devyRank = rankByName.get(key) ?? null
    const adpRank = adpRankByKey.get(key) ?? null
    return {
      id: player.id,
      name: player.name,
      position: player.position,
      school: player.school,
      devyRank,
      adpRank,
      corroboration: buildCorroboration(
        player.name,
        commonScoutRank.get(key) ?? null,
        commonAdpRank.get(key) ?? null,
      ),
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
      ...(adpRankByKey.size > 0
        ? [DEVY_BOARD_GAPS.adpDisagrees, DEVY_BOARD_GAPS.adpPartial]
        : []),
    ],
    adpCoverage: adpRankByKey.size,
    contested: entries.filter((e) => e.corroboration?.confidence === 'contested').length,
  }
}

/**
 * Compare the two orderings over the population that carries both.
 *
 * Returns null unless BOTH exist: one opinion cannot corroborate itself, and reporting
 * agreement from a single source would manufacture confidence — the same rule afValue.ts
 * applies when it refuses to call a lone source 'high'.
 */
function buildCorroboration(
  name: string,
  scoutRankInCommonPool: number | null,
  adpRankInCommonPool: number | null,
): DevyCorroboration | null {
  if (scoutRankInCommonPool == null || adpRankInCommonPool == null) return null
  const adpRank = adpRankInCommonPool
  const rankGap = Math.abs(scoutRankInCommonPool - adpRank)
  const confidence: DevyCorroboration['confidence'] =
    rankGap <= CORROBORATION_AGREE ? 'corroborated' : rankGap >= CORROBORATION_CONTEST ? 'contested' : 'mixed'
  const note =
    confidence === 'corroborated'
      ? `Scouting and real draft behaviour agree on ${name} (both around ${Math.round((scoutRankInCommonPool + adpRank) / 2)} of the rated pool).`
      : `Scouting has ${name} ${scoutRankInCommonPool} of the rated pool; drafters take him ${adpRank}. These disagree, so treat his rank as unsettled rather than precise.`
  return {
    scoutRankInPool: scoutRankInCommonPool,
    adpRankInPool: adpRank,
    rankGap,
    confidence,
    note,
  }
}

/**
 * Agreement thresholds, read off the measured distribution rather than chosen.
 * Median gap 71, p90 176 across the 327 commonly-signalled players (2026-08-29).
 */
const CORROBORATION_AGREE = 35
const CORROBORATION_CONTEST = 176

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
