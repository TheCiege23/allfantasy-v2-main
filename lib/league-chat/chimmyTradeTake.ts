/**
 * Chimmy's take on a trade: who won it on paper, with the numbers. PURE — no Prisma, no fetch.
 *
 * The values are FantasyCalc market values the caller has already READ FROM THE DATABASE
 * (`lib/league-chat/chimmyTradeMoment.ts` → `readFantasyCalcValuesFromDb`); this module only prices
 * the assets with the repo's own helpers and words the verdict:
 *   - players by Sleeper id, then by name (`findPlayerBySleeperId` / `findPlayerByName`),
 *   - picks with `getPickValue`,
 *   - the winner's grade with `tradeScore` + `letterGradeFromScore` (it sets how strongly the win is
 *     called — see below),
 *   - "even" under a 5% gap, the same threshold `compareTradeValues` uses.
 *
 * ⚠ NUMBERS OR NOTHING. If any asset on either side cannot be priced — an unknown player, a pick with
 * no round, FAAB, a specialty asset — there is no take at all. A verdict computed from half a trade
 * is a false number in a league chat, and `TradeCardView` already records why a grade with no data
 * behind it is worse than no grade.
 */

import {
  findPlayerByName,
  findPlayerBySleeperId,
  getPickValue,
  letterGradeFromScore,
  tradeScore,
  type FantasyCalcPlayer,
} from '@/lib/fantasycalc'

export type TradeTakeAsset =
  | { kind: 'player'; sleeperId?: string | null; name?: string | null; position?: string | null; team?: string | null }
  | { kind: 'pick'; season?: number | null; round?: number | null }
  /** FAAB, specialty assets — anything with no market value. Its presence means no take. */
  | { kind: 'other'; label?: string | null }

export type TradeTakeSide = {
  /** Who this side is, as the league knows them. */
  manager: string
  /** What this side RECEIVES in the trade. */
  receives: TradeTakeAsset[]
}

export type TradeTakeSideResult = {
  manager: string
  /** Market value this side takes in. */
  received: number
  /** Market value this side sends away (the other side's `received`). */
  sent: number
  grade: string
}

export type ChimmyTradeTake = {
  text: string
  verdict: 'win' | 'even'
  winner: string | null
  sides: [TradeTakeSideResult, TradeTakeSideResult]
  /** Absolute gap between the two sides' received value. */
  gap: number
  percentGap: number
}

/** The gap below which a trade is called even — `compareTradeValues`' own threshold. */
export const EVEN_PERCENT = 5

const fmt = (n: number) => Math.round(n).toLocaleString('en-US')

function priceAsset(
  asset: TradeTakeAsset,
  players: FantasyCalcPlayer[],
  opts: { isDynasty: boolean; now: Date },
): number | null {
  if (asset.kind === 'player') {
    const bySleeper = asset.sleeperId ? findPlayerBySleeperId(players, asset.sleeperId) : null
    const hit =
      bySleeper ??
      (asset.name ? findPlayerByName(players, asset.name, { position: asset.position, team: asset.team }) : null)
    return hit && Number.isFinite(hit.value) && hit.value > 0 ? hit.value : null
  }
  if (asset.kind === 'pick') {
    if (!asset.round || asset.round < 1) return null
    const season = asset.season && asset.season > 2000 ? asset.season : opts.now.getFullYear()
    const value = getPickValue(season, asset.round, opts.isDynasty)
    return Number.isFinite(value) && value > 0 ? value : null
  }
  return null
}

/** Each side's received value, or null when any asset cannot be priced. */
export function priceTradeSides(
  sides: TradeTakeSide[],
  players: FantasyCalcPlayer[],
  opts: { isDynasty: boolean; now?: Date },
): number[] | null {
  if (sides.length !== 2 || players.length === 0) return null
  const now = opts.now ?? new Date()
  const totals: number[] = []
  for (const side of sides) {
    if (side.receives.length === 0) return null
    let total = 0
    for (const asset of side.receives) {
      const value = priceAsset(asset, players, { isDynasty: opts.isDynasty, now })
      if (value == null) return null
      total += value
    }
    totals.push(total)
  }
  return totals
}

/** Deterministic per trade, so a re-render or a retry says the same thing. */
function pick<T>(pool: readonly T[], seed: string): T {
  let h = 0
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return pool[h % pool.length]!
}

/**
 * Chimmy's take, or null when the numbers are not all there (see the header).
 *
 * `seed` picks the closing line — pass something stable for the trade, like its id.
 */
export function buildChimmyTradeTake(input: {
  sides: [TradeTakeSide, TradeTakeSide]
  players: FantasyCalcPlayer[]
  isDynasty: boolean
  seed: string
  now?: Date
}): ChimmyTradeTake | null {
  const totals = priceTradeSides(input.sides, input.players, { isDynasty: input.isDynasty, now: input.now })
  if (!totals) return null
  const [aIn, bIn] = totals as [number, number]
  const [a, b] = input.sides

  const sides: [TradeTakeSideResult, TradeTakeSideResult] = [
    { manager: a.manager, received: aIn, sent: bIn, grade: letterGradeFromScore(tradeScore(aIn, bIn)) },
    { manager: b.manager, received: bIn, sent: aIn, grade: letterGradeFromScore(tradeScore(bIn, aIn)) },
  ]
  const gap = Math.abs(aIn - bIn)
  const percentGap = Math.round((gap / Math.max(aIn, bIn)) * 100)

  if (percentGap < EVEN_PERCENT) {
    const closer = pick(
      ['Fair deal. Now go win with it.', 'Nobody got fleeced. Rare, and respected.', 'Clean trade. Let the games settle it.'],
      `${input.seed}:even`,
    )
    return {
      text: `Dead even on paper: ${a.manager} takes in ${fmt(aIn)} of market value, ${b.manager} takes in ${fmt(bIn)} (${percentGap}% apart). ${closer}`,
      verdict: 'even',
      winner: null,
      sides,
      gap,
      percentGap,
    }
  }

  const [win, lose] = aIn > bIn ? sides : [sides[1], sides[0]]
  /*
   * The WINNER's grade sets how strongly it is said. The loser's grade is not quoted: on this
   * helper's scale almost any gap past 5% grades the losing side an F, and posting "Jordan F" to the
   * whole league is not the warm half of the brand. The numbers say the rest.
   */
  const verb = win.grade === 'A' ? "wins this one, and it isn't close" : win.grade === 'B' ? 'wins this one' : 'gets the edge'
  const closer = pick(
    [
      `${lose.manager}, the market says you paid up. Make it count.`,
      `${lose.manager} is betting on fit over math. We'll see.`,
      `${lose.manager}, this one had better win you a week.`,
    ],
    `${input.seed}:win`,
  )
  return {
    text:
      `On paper, ${win.manager} ${verb}: ${fmt(win.received)} of market value coming in, ` +
      `${fmt(win.sent)} going out (+${fmt(gap)}). ${closer}`,
    verdict: 'win',
    winner: win.manager,
    sides,
    gap,
    percentGap,
  }
}
