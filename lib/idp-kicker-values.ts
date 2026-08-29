/*
 * ⚠ `import type`, AND THE KEYWORD IS LOad-BEARING. `league-rankings-v2.ts` is 3,500 lines
 * and imports this module back (for `buildIdpKickerValueMap`), so a value import here is a
 * genuine cycle AND drags the whole rankings engine into the runtime graph of anything that
 * only wants the IDP curve. Measured when the trade evaluator first pulled this chain in:
 * the route's test transform cost went from 14s to 47s and pushed its contract tests past
 * their timeout. Only the TYPE was ever used.
 */
import type { PlayerValueMap } from './rankings-engine/league-rankings-v2'

const IDP_POSITION_MAP: Record<string, string> = {
  LB: 'LB',
  ILB: 'LB',
  OLB: 'LB',
  DL: 'DL',
  DE: 'DL',
  DT: 'DL',
  DB: 'DB',
  CB: 'DB',
  SS: 'DB',
  FS: 'DB',
  S: 'DB',
}

export function normalizeIdpPosition(pos: string): string | null {
  return IDP_POSITION_MAP[pos.toUpperCase()] || null
}

export function isIdpPosition(pos: string): boolean {
  return normalizeIdpPosition(pos) !== null
}

export function isKickerPosition(pos: string): boolean {
  return pos.toUpperCase() === 'K'
}

interface SleeperPlayerInfo {
  player_id: string
  full_name: string
  position: string
  team: string | null
  age: number | null
  years_exp: number | null
  fantasy_positions?: string[]
  search_rank?: number | null
}

/**
 * How value decays down a position board, measured from the market rather than drawn by hand.
 *
 * ⚠ THE HAND-BUILT LADDER WAS TOO FLAT EVERYWHERE, NOT JUST AT THE TOP. As shares of the
 * position-1 value, the old dynasty rungs against the FantasyCalc board measured on
 * 2026-08-25 (398 players, pooled across QB/RB/WR/TE and normalised per position):
 *
 *   rank      3      8     15     25     40     60     90    130
 *   ladder 1.000  0.764  0.582  0.436  0.327  0.218  0.145  0.091
 *   market 0.714  0.499  0.343  0.244  0.124  0.066  0.049  0.016
 *
 * Every rung over-priced depth, by 2.6x at rank 40 and 5.7x at rank 130. And the top rung was
 * literally flat — ranks 1, 2 and 3 all at the ceiling — which no market does: the real RB
 * board that day ran 10,729 / 10,167 / 8,897, a 17% drop by the third name.
 *
 * The CEILING is left alone. What a top defender is worth against a top wide receiver is a
 * product decision nobody has validated and it is not this table's business to move it. The
 * SHAPE below the ceiling is not a product decision — it is an observable property of how
 * fantasy markets price scarcity, and it was wrong.
 *
 * Pooled across the four offensive positions rather than mapped position-by-position: LB is
 * not "the RB of defence", and pretending otherwise would smuggle in an arbitrary pairing.
 */
const MARKET_DECAY_DYNASTY: ReadonlyArray<{ rank: number; share: number }> = [
  { rank: 1, share: 1.0 },
  { rank: 2, share: 0.883 },
  { rank: 3, share: 0.714 },
  { rank: 5, share: 0.597 },
  { rank: 8, share: 0.499 },
  { rank: 15, share: 0.343 },
  { rank: 25, share: 0.244 },
  { rank: 40, share: 0.124 },
  { rank: 60, share: 0.066 },
  { rank: 90, share: 0.049 },
  { rank: 130, share: 0.016 },
]

/** Redraft decays harder in the tail — there is no future value holding the bottom up. */
const MARKET_DECAY_REDRAFT: ReadonlyArray<{ rank: number; share: number }> = [
  { rank: 1, share: 1.0 },
  { rank: 2, share: 0.947 },
  { rank: 3, share: 0.883 },
  { rank: 5, share: 0.785 },
  { rank: 8, share: 0.626 },
  { rank: 15, share: 0.422 },
  { rank: 25, share: 0.237 },
  { rank: 40, share: 0.085 },
  { rank: 60, share: 0.022 },
]

/**
 * What the best defender in a league is worth against the offensive board.
 *
 * ⚠ THIS IS THE ONE NUMBER IN THE IDP STACK THAT IS NOT MEASURED, AND IT CANNOT BE. Everything
 * beneath it is: who outranks whom comes from value over replacement against the league's own
 * starting slots, the decay down the board comes from the FantasyCalc curve, the projections
 * underneath are backtested. This sets the exchange rate between defence and offence, and no
 * market prices defenders — three independent routes to measuring it were tried and closed
 * (no vendor sells it; VORP ranks but does not price; and revealed preference explains 0.1% of
 * trade imbalance). It is a product decision, and as of 2026-08-25 it is a MADE one rather
 * than an inherited default.
 *
 * DYNASTY 5500 — confirmed deliberately. On the board of 2026-08-25 that puts the top defender
 * beside Josh Allen and James Cook, overall #17-19 of 398, above 95% of offensive assets. The
 * stance: in an IDP league with real defensive starting requirements, an elite defender IS a
 * core asset.
 *
 * REDRAFT 5300 — confirmed 2026-08-27, replacing an unconfirmed 3500. The old value sat above
 * only 79.2% of its own board (overall #42 of 202, beside Zay Flowers, 33% of the #1 player),
 * so this codebase valued defenders MORE generously in dynasty than in redraft. That is
 * backwards: dynasty offensive values embed a multi-year and youth premium that redraft values
 * do not, so relative to offence a defender should be worth at LEAST as much in redraft.
 *
 * ⚠ IT IS SET BY THE SHARE OF THE #1 PLAYER, NOT BY PERCENTILE, AND THE TWO DISAGREE BY 2,700.
 * Dynasty 5500 is 49% of the top offensive asset and above 95.8% of its board. Matching the
 * SHARE gives 0.49 x 10,738 = ~5,300 (redraft #24, 88th percentile). Matching the PERCENTILE
 * gives ~8,000 (redraft #9) — the reading behind the 7,800 this comment used to suggest. They
 * diverge because the redraft board is less than half as deep (202 priced players against 450),
 * so the same percentile is a very different rank. Share wins: these are ratio scales, and a
 * trade compares magnitudes rather than ranks. If you revisit this, revisit that choice — the
 * number follows from it.
 *
 * ⚠ MEASURED AGAINST THE OFFENSIVE MARKET, NOT AGAINST REDRAFT IDP TRADES, BECAUSE THERE ARE
 * NONE. Checked on 2026-08-27, and worth knowing before anyone tries again: all 10 IDP leagues
 * in production are dynasty (`leagueType` and `isDynasty` agree on every one), so no redraft IDP
 * trade exists; `PlayerValueSnapshot` carries 7,043 rows and zero defenders, so no vendor prices
 * them in either format; and the dynasty IDP trades that do exist cannot be priced, because
 * `SportsPlayer.externalId` mixes at least three id namespaces (`tsdb_*`, `sleeper:*`, and bare
 * numerics that COLLIDE with the Sleeper space — id 8144 is John Rhys Plumlee there and Chris
 * Olave in the value table). Join by name or by bare id and you will get a confident, wrong
 * answer rather than an empty one.
 *
 * ⚠ NOTHING USER-VISIBLE MOVED WHEN THIS CHANGED, AND THAT IS NOT A SIGN IT DOES NOT MATTER.
 * Both call sites resolve `isDynasty` from the league, and every IDP league is dynasty, so the
 * redraft curve is unreachable today. It goes live the moment the first redraft IDP league is
 * imported, which is exactly why it was worth setting properly while the blast radius was zero.
 *
 * ⚠ AND THE TWO CURVES ARE NEVER COMPARED, WHICH IS EASY TO GET WRONG WHILE READING THIS.
 * `waiver-intelligence.ts` does `Math.max(value, redraftValue)`, which looks like it prices a
 * defender both ways and takes the better one. It does not: `buildIdpKickerValueMap` writes
 * `value: isDynasty ? value : 0` and `redraftValue: isDynasty ? 0 : value`, so exactly one is
 * ever populated and the max only selects the one that was computed. That matters here because
 * the redraft decay is FLATTER at the top (0.947/0.883/0.785 against dynasty's
 * 0.883/0.714/0.597), so at these two ceilings the redraft curve is the higher of the two
 * between ranks 2 and 20. If anyone ever makes that `Math.max` compare real numbers instead of
 * a number against zero, a dynasty league would silently start pricing its best defenders off
 * the redraft curve.
 */
const IDP_CEILING_DYNASTY = 5500
const IDP_CEILING_REDRAFT = 5300

function decayToTiers(
  decay: ReadonlyArray<{ rank: number; share: number }>,
  ceiling: number,
): { maxRank: number; value: number }[] {
  const tiers = decay.map((d) => ({ maxRank: d.rank, value: Math.round(ceiling * d.share) }))
  // Past the measured board the market is thinner than anything observed; hold the floor
  // rather than extrapolate a curve nobody sampled.
  tiers.push({ maxRank: Infinity, value: Math.max(1, tiers[tiers.length - 1].value) })
  return tiers
}

const DYNASTY_IDP_TIERS = decayToTiers(MARKET_DECAY_DYNASTY, IDP_CEILING_DYNASTY)
const REDRAFT_IDP_TIERS = decayToTiers(MARKET_DECAY_REDRAFT, IDP_CEILING_REDRAFT)

/**
 * 🛑 THESE KICKER TIERS ARE CONTRADICTED BY MEASUREMENT AND ARE NOT USED FOR TRADES.
 *
 * `lib/kicker-values/leagueKickerValue.ts` measured the position on production 2026-08-29
 * across 4,482 kicker game rows (2019-2025) and found two things that make this ladder
 * indefensible:
 *
 *   - RANK DOES NOT PERSIST. Year over year the correlation is NEGATIVE in all six season
 *     pairs (mean -0.455); within a season it is ~0. Ranking by Sleeper's `search_rank`, as
 *     `rankKickers` below does, orders by POPULARITY and predicts nothing at all.
 *   - THE POSITION IS FLAT. K24 scores 65% of K1's points per game, a 1.55x spread. This
 *     ladder runs 1200 down to 100 — a 12x spread, overstating reality by roughly eight
 *     times.
 *
 * The TRADE path no longer reads this: `loadLeagueTradeValues` gives every kicker in a
 * league one measured value. These tiers still feed `buildIdpKickerValueMap`, whose
 * consumers are waiver intelligence, the IDP Chimmy grounding and league-rankings-v2 —
 * surfaces where a kicker ORDERING is used for suggestion ranking rather than for pricing an
 * asset, and where changing the numbers would move behaviour that was never in scope here.
 *
 * Migrating those three is worthwhile and deliberately not done in the same change as the
 * trade wiring. Do not add a NEW consumer of these tiers.
 */
const DYNASTY_KICKER_TIERS: { maxRank: number; value: number }[] = [
  { maxRank: 3, value: 1200 },
  { maxRank: 8, value: 800 },
  { maxRank: 15, value: 500 },
  { maxRank: 25, value: 300 },
  { maxRank: Infinity, value: 100 },
]

const REDRAFT_KICKER_TIERS: { maxRank: number; value: number }[] = [
  { maxRank: 3, value: 900 },
  { maxRank: 8, value: 600 },
  { maxRank: 15, value: 350 },
  { maxRank: 25, value: 200 },
  { maxRank: Infinity, value: 50 },
]

function getTierValue(rank: number, tiers: { maxRank: number; value: number }[]): number {
  for (const tier of tiers) {
    if (rank <= tier.maxRank) return tier.value
  }
  return tiers[tiers.length - 1].value
}

/**
 * The same ladder, read continuously instead of in steps.
 *
 * ⚠ THE STEPS ARE AN ARTEFACT OF THE TABLE, NOT A FACT ABOUT FOOTBALL. On the tiered read,
 * rank 3 is worth 5,500 and rank 4 is worth 4,200 — a 24% cliff between two players who are
 * next to each other on the board, and no cliff at all between rank 4 and rank 8. Interpolating
 * between the same anchors keeps the currency exactly where it was (same ceiling, same floor,
 * same shape) while spacing adjacent players by the distance actually between them.
 */
function interpolatedTierValue(
  rank: number,
  tiers: { maxRank: number; value: number }[],
): number {
  const r = Math.max(1, rank)
  let prevRank = 1
  let prevValue = tiers[0].value
  for (const tier of tiers) {
    if (r <= tier.maxRank) {
      if (!Number.isFinite(tier.maxRank) || tier.maxRank === prevRank) return tier.value
      const t = (r - prevRank) / (tier.maxRank - prevRank)
      return Math.round(prevValue + (tier.value - prevValue) * Math.max(0, Math.min(1, t)))
    }
    prevRank = tier.maxRank
    prevValue = tier.value
  }
  return tiers[tiers.length - 1].value
}

/**
 * Rank within an IDP position group -> value, on the market-shaped curve.
 *
 * ⚠ PURE AND NETWORK-FREE, WHICH IS THE WHOLE REASON IT IS SEPARATE FROM
 * `buildIdpKickerValueMap`. That function fetches Sleeper's player index to resolve names and
 * ages; the Decision OS enrichment port forbids live provider calls outright, so it needs the
 * curve without the fetch. One curve, two callers, no second copy to drift.
 */
export function idpValueForRank(rank: number, isDynasty: boolean): number {
  return interpolatedTierValue(rank, isDynasty ? DYNASTY_IDP_TIERS : REDRAFT_IDP_TIERS)
}

/** Top of the IDP tier curve — for normalizing tier values onto 0–100 scales. */
export function idpTierValueCeiling(isDynasty: boolean): number {
  return (isDynasty ? DYNASTY_IDP_TIERS : REDRAFT_IDP_TIERS)[0].value
}

const IDP_AGE_PEAKS: Record<string, number> = {
  LB: 26,
  DL: 27,
  DB: 27,
}

function dynastyAgeFactor(age: number | null, position: string): number {
  if (age === null) return 1.0
  const peak = IDP_AGE_PEAKS[position] ?? 27
  const diff = peak - age
  return Math.max(0.7, Math.min(1.15, 1 + diff * 0.03))
}

const IDP_POSITION_MULTIPLIER: Record<string, number> = {
  LB: 1.15,
  DL: 1.0,
  DB: 0.95,
}

let sleeperPlayerCache: Map<string, SleeperPlayerInfo> | null = null
let sleeperCacheTimestamp = 0
const SLEEPER_CACHE_TTL = 1000 * 60 * 60 * 6

async function getSleeperPlayersMap(): Promise<Map<string, SleeperPlayerInfo>> {
  if (sleeperPlayerCache && Date.now() - sleeperCacheTimestamp < SLEEPER_CACHE_TTL) {
    return sleeperPlayerCache
  }

  try {
    const res = await fetch('https://api.sleeper.app/v1/players/nfl') // db-first-exception: valuation fallback source pending DB cache wiring
    if (!res.ok) throw new Error(`Sleeper players API: ${res.status}`)
    const data = await res.json()
    const map = new Map<string, SleeperPlayerInfo>()
    for (const [pid, p] of Object.entries(data as Record<string, any>)) {
      map.set(pid, {
        player_id: pid,
        full_name: p.full_name || p.first_name + ' ' + p.last_name || 'Unknown',
        position: p.position || '',
        team: p.team || null,
        age: p.age ?? null,
        years_exp: p.years_exp ?? null,
        fantasy_positions: p.fantasy_positions || [],
        search_rank: p.search_rank ?? null,
      })
    }
    sleeperPlayerCache = map
    sleeperCacheTimestamp = Date.now()
    return map
  } catch (err) {
    if (sleeperPlayerCache) return sleeperPlayerCache
    return new Map()
  }
}

function rankIdpPlayers(
  players: SleeperPlayerInfo[],
  idpPosition: string,
): { playerId: string; rank: number; info: SleeperPlayerInfo }[] {
  const posPlayers = players.filter(p => {
    const normalized = normalizeIdpPosition(p.position)
    return normalized === idpPosition && p.team !== null
  })

  posPlayers.sort((a, b) => {
    const aRank = a.search_rank ?? 99999
    const bRank = b.search_rank ?? 99999
    if (aRank !== bRank) return aRank - bRank
    const aExp = a.years_exp ?? 0
    const bExp = b.years_exp ?? 0
    return bExp - aExp
  })

  return posPlayers.map((p, i) => ({
    playerId: p.player_id,
    rank: i + 1,
    info: p,
  }))
}

function rankKickers(
  players: SleeperPlayerInfo[],
): { playerId: string; rank: number; info: SleeperPlayerInfo }[] {
  const kickers = players.filter(p => p.position === 'K' && p.team !== null)

  kickers.sort((a, b) => {
    const aRank = a.search_rank ?? 99999
    const bRank = b.search_rank ?? 99999
    if (aRank !== bRank) return aRank - bRank
    const aExp = a.years_exp ?? 0
    const bExp = b.years_exp ?? 0
    return bExp - aExp
  })

  return kickers.map((p, i) => ({
    playerId: p.player_id,
    rank: i + 1,
    info: p,
  }))
}

/**
 * League context that turns the IDP ranking from a popularity poll into a projection.
 *
 * ⚠ OPTIONAL ON PURPOSE. Callers that cannot supply it keep the previous behaviour exactly,
 * so nothing changes underneath a surface that has not opted in. Supplying it is what makes
 * the ranking specific to the reader's league.
 */
export interface IdpLeagueValuationContext {
  /** Value over replacement per Sleeper id, from `buildIdpValuations`. */
  vorpBySleeperId: ReadonlyMap<string, number | null>
}

/**
 * ⚠ RANK BY PROJECTION, PRICE BY THE EXISTING LADDER — AND THE SPLIT IS EVIDENCE-BASED.
 *
 * Measured across the ten production leagues that genuinely score IDP, on offensive players
 * who have BOTH a FantasyCalc price and a value over replacement computed the same way:
 *
 *   QB  n=27  Spearman 0.868   R2(log) 0.794
 *   RB  n=47  Spearman 0.933   R2(log) 0.687
 *   WR  n=71  Spearman 0.885   R2(log) 0.440
 *   TE  n=25  Spearman 0.891   R2(log) 0.289
 *
 * Value over replacement ORDERS players almost exactly as the market does — rank correlation
 * near 0.9 at every position. It does not PRICE them: the market pays a different amount per
 * point of VORP depending on position (median 353 at QB, 399 at RB, 294 at WR, 164 at TE, a
 * 2.4x spread), and pooling the positions collapses the fit to R2 0.09.
 *
 * So VORP replaces `search_rank` as the ranking input, and the existing ladder still supplies
 * the units. Deriving an IDP price directly from VORP would require an exchange rate that the
 * data does not support, and inventing one would move every IDP-for-offence trade grade in the
 * product on the strength of a number nobody measured.
 */
export async function buildIdpKickerValueMap(
  rosterPlayerIds: string[],
  isDynasty: boolean,
  leagueContext?: IdpLeagueValuationContext | null,
): Promise<Map<string, PlayerValueMap>> {
  const sleeperPlayers = await getSleeperPlayersMap()
  const valueMap = new Map<string, PlayerValueMap>()

  const relevantPlayerIds = new Set(rosterPlayerIds)

  const allSleeperPlayers = Array.from(sleeperPlayers.values())

  const idpPositions = ['LB', 'DL', 'DB']
  const rankedByPosition = new Map<string, Map<string, number>>()

  for (const pos of idpPositions) {
    const ranked = rankIdpPlayers(allSleeperPlayers, pos)
    const posRankMap = new Map<string, number>()
    for (const r of ranked) {
      posRankMap.set(r.playerId, r.rank)
    }
    rankedByPosition.set(pos, posRankMap)
  }

  const kickerRanks = rankKickers(allSleeperPlayers)
  const kickerRankMap = new Map<string, number>()
  for (const r of kickerRanks) {
    kickerRankMap.set(r.playerId, r.rank)
  }

  /*
   * Rank within position by this league's value over replacement. Only players the league
   * could actually price appear — a null VORP means replacement level could not be
   * established, and ranking that at the bottom would price a data gap as the worst defender
   * on the board.
   */
  const vorpRankByPlayer = new Map<string, number>()
  if (leagueContext) {
    /*
     * ⚠ ONE COMBINED BOARD, NOT THREE. Ranking within each position group hands the ceiling to
     * the best linebacker, the best lineman AND the best defensive back at once, which asserts
     * the three are equally valuable. Measured on production before this: Blake Cashman, Myles
     * Garrett and Nick Emmanwori all priced at 5,500 in the same league.
     *
     * Value over replacement is already measured against each position's OWN replacement
     * level, and that is exactly what makes it comparable across positions — so the groups
     * merge into a single board and the curve is applied once. This must stay in step with
     * `leagueIdpVorp.valueBySleeperId`, which ranks the same way; two boards for one concept
     * is how the tier ladder and the projection path would start disagreeing.
     */
    const board: Array<{ pid: string; vorp: number }> = []
    for (const [pid, vorp] of leagueContext.vorpBySleeperId) {
      if (typeof vorp !== 'number' || !Number.isFinite(vorp)) continue
      const info = sleeperPlayers.get(pid)
      if (!info || !normalizeIdpPosition(info.position)) continue
      board.push({ pid, vorp })
    }
    board.sort((a, b) => b.vorp - a.vorp)
    board.forEach((e, i) => vorpRankByPlayer.set(e.pid, i + 1))
  }

  for (const pid of relevantPlayerIds) {
    const player = sleeperPlayers.get(pid)
    if (!player) continue

    const idpPos = normalizeIdpPosition(player.position)

    if (idpPos) {
      const vorpRank = vorpRankByPlayer.get(pid)
      const posRankMap = rankedByPosition.get(idpPos)
      const rank = vorpRank ?? posRankMap?.get(pid) ?? 200
      const tiers = isDynasty ? DYNASTY_IDP_TIERS : REDRAFT_IDP_TIERS
      let value = vorpRank != null ? interpolatedTierValue(rank, tiers) : getTierValue(rank, tiers)
      /*
       * ⚠ THE POSITION MULTIPLIER IS DROPPED ON THE PROJECTION PATH, AND DROPPING IT IS THE
       * POINT. LB 1.15 / DL 1.0 / DB 0.95 exists to express that linebackers out-score linemen
       * in most IDP scoring. Replacement level already measures that, from this league's own
       * settings and its own starting slots — applying both counts the same effect twice, and
       * the hardcoded version is the less accurate of the two.
       */
      if (vorpRank == null) {
        value = Math.round(value * (IDP_POSITION_MULTIPLIER[idpPos] ?? 1.0))
      }
      // Age is orthogonal: it is the trajectory layer, not the scarcity one, so it still applies.
      if (isDynasty) {
        value = Math.round(value * dynastyAgeFactor(player.age, idpPos))
      }
      valueMap.set(pid, {
        sleeperId: pid,
        value: isDynasty ? value : 0,
        redraftValue: isDynasty ? 0 : value,
        position: idpPos,
        age: player.age,
        name: player.full_name,
      })
    } else if (isKickerPosition(player.position)) {
      const rank = kickerRankMap.get(pid) ?? 50
      const tiers = isDynasty ? DYNASTY_KICKER_TIERS : REDRAFT_KICKER_TIERS
      const value = getTierValue(rank, tiers)
      valueMap.set(pid, {
        sleeperId: pid,
        value: isDynasty ? value : 0,
        redraftValue: isDynasty ? 0 : value,
        position: 'K',
        age: player.age,
        name: player.full_name,
      })
    }
  }

  return valueMap
}

export function detectIdpLeague(rosterPositions: string[]): boolean {
  const idpSlots = ['DL', 'LB', 'DB', 'IDP_FLEX', 'DE', 'DT', 'CB', 'S', 'SS', 'FS']
  return rosterPositions.some(p => idpSlots.includes(p.toUpperCase()))
}

export function detectKickerLeague(rosterPositions: string[]): boolean {
  return rosterPositions.some(p => p.toUpperCase() === 'K')
}

export function countIdpSlots(rosterPositions: string[]): number {
  const idpSlots = ['DL', 'LB', 'DB', 'IDP_FLEX', 'DE', 'DT', 'CB', 'S', 'SS', 'FS']
  return rosterPositions.filter(p => idpSlots.includes(p.toUpperCase())).length
}
