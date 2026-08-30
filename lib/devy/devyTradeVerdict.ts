/**
 * Devy assets in a proposed trade: identify them, refuse what cannot be graded, rank what can.
 *
 * ⚠ EXTRACTED FROM `lib/trade-intel/tradeContextNotes.ts` SO THERE IS ONE IMPLEMENTATION.
 * `/api/trade-value/analyze` reached this logic through trade context notes; the primary
 * surface, `/api/trade-evaluator`, did not — it saw a college player as simply "unpriced" and
 * told the manager to check his spelling for a correctly-spelled name. Both now call this.
 *
 * 🛑 THE MIXED-SCALE REFUSAL IS THE PRODUCT DECISION, NOT A LIMITATION TO ENGINEER AWAY.
 * Devy assets are denominated in devy points and NFL assets in market units, and no tested
 * conversion exists between them (P(reaches the NFL) has never been observed — see
 * `lib/trade-intel/devyOutlook.ts` for why that is structural rather than a broken job).
 * A deal spanning both is reported ungradeable. Returning a letter would mean inventing the
 * exchange rate silently.
 */

import { prisma } from '@/lib/prisma'
import {
  projectDevyOutlook,
  refuseMixedScaleGrade,
  type TradeAsset as DevyTradeAsset,
} from '@/lib/trade-intel/devyOutlook'
import { devyAssetValue, gradeDevyTrade, type DevyTradeSide } from '@/lib/trade-intel/devyTradeValue'
import {
  devyPointsToMarketUnits,
  resolveDevyBridge,
  type DevyBridgeOutcome,
} from '@/lib/devy/devyMarketBridge'

export type DevyTradeVerdict = {
  matched: Array<{ name: string }>
  /** Non-null when the trade spans both scales and therefore cannot be graded as one number. */
  refusal: string | null
  /** One line per devy asset, ranking him against the devy pool. */
  standings: string[]
  /** A devy-for-devy verdict, in devy points. Null for a mixed deal. */
  verdict: string | null
  /**
   * How the league's devy exchange rate was resolved, when a mixed deal made it relevant.
   *
   * ⚠ REPORTED SO A SURFACE CAN SAY THE CONVERSION WAS A HOUSE RULE. A converted grade rendered
   * without that is indistinguishable from a market-backed one, which is the failure the
   * refusal exists to prevent. Null when the deal never spanned both scales.
   */
  bridge: DevyBridgeOutcome | null
}

export async function identifyDevyAssets(args: {
  /**
   * The league's `settings` blob, when the caller has it. Supplying it lets a commissioner-set
   * exchange rate grade a mixed deal; OMITTING IT KEEPS THE REFUSAL, which is the correct
   * default and what every caller got before this existed.
   */
  leagueSettings?: unknown
  give: Array<{ name: string; marketValue: number | null }>
  get: Array<{ name: string; marketValue: number | null }>
  season: number
}): Promise<{
  matched: Array<{ name: string }>
  refusal: string | null
  standings: string[]
  verdict: string | null
  bridge: DevyBridgeOutcome | null
} | null> {
  const all = [...args.give, ...args.get]
  const unpricedNames = all.filter((x) => x.marketValue == null).map((x) => x.name)
  if (unpricedNames.length === 0) return null

  const select = {
    name: true,
    position: true,
    school: true,
    draftEligibleYear: true,
    recruitingComposite: true,
    breakoutAge: true,
    projectedDraftRound: true,
    devyAdp: true,
    draftProjectionScore: true,
  } as const

  const candidates = await prisma.devyPlayer.findMany({
    where: {
      graduatedToNFL: false,
      OR: unpricedNames.map((n) => ({ name: { equals: n, mode: 'insensitive' as const } })),
    },
    select,
  })
  if (candidates.length === 0) return null

  const assets: DevyTradeAsset[] = [
    ...candidates.map((c) => ({ label: c.name, kind: 'devy_player' as const })),
    ...all
      .filter((x) => x.marketValue != null)
      .map((x) => ({ label: x.name, kind: 'nfl_player' as const })),
  ]
  const mixed = refuseMixedScaleGrade(assets)

  /*
   * 🛑 THE BRIDGE IS ONLY CONSULTED FOR A DEAL THAT ACTUALLY SPANS BOTH SCALES. A devy-for-devy
   * trade settles in devy points and must not be converted — running it through a market rate
   * would restate a self-consistent comparison in units nobody needed, and would drag the
   * caveat onto a verdict that does not require one.
   */
  const bridge = mixed ? resolveDevyBridge(args.leagueSettings) : null

  const outlookFor = (c: (typeof candidates)[number]) =>
    projectDevyOutlook({
      player: c,
      draftEligibleYear: c.draftEligibleYear,
      currentSeason: args.season,
      name: c.name,
    })

  const standings = candidates.map(
    (c) => `${c.name} (${c.position}, ${c.school}) — ${outlookFor(c).basis}`,
  )

  /*
   * ⚠ RANK MUST BE AGAINST THE WHOLE BOARD, NOT THE PLAYERS IN THE DEAL. Ranking
   * the two prospects in a trade against each other makes them #1 and #2 and
   * therefore near-elite by construction, which is how a swap of two nobodies
   * would grade as a blockbuster.
   *
   * The whole non-null score column is ~800 floats, so it is cheaper to pull and
   * rank in memory than to issue a positional COUNT per player.
   */
  const board = await prisma.devyPlayer.findMany({
    where: { graduatedToNFL: false, draftProjectionScore: { not: null } },
    select: { draftProjectionScore: true },
  })
  const descending = board
    .map((b) => b.draftProjectionScore as number)
    .sort((a, b) => b - a)

  const rankOf = (score: number | null): number | null => {
    if (score == null) return null
    /* One-based rank: how many players score strictly higher, plus one. */
    let lo = 0
    let hi = descending.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (descending[mid] > score) lo = mid + 1
      else hi = mid
    }
    return lo + 1
  }

  /*
   * A verdict only when the deal is devy on BOTH sides. A mixed deal is refused
   * above, and devy points cannot settle a trade whose other half is priced in
   * market units.
   */
  let verdict: string | null = null
  let refusal: string | null = mixed?.reason ?? null

  /*
   * A mixed deal the league HAS priced a rate for.
   *
   * ⚠ IT REPORTS TWO TOTALS AND WHICH SIDE IS AHEAD — IT DOES NOT ISSUE A LETTER. The graders
   * elsewhere in this repo map a percentage onto A+/D, and a letter carries an authority this
   * number has not earned: the conversion is one unmeasured constant a commissioner typed, so
   * the honest output is the arithmetic plus the fact that it rests on a house rule.
   */
  if (mixed && bridge?.ok) {
    const byNameMixed = new Map(candidates.map((c) => [c.name.toLowerCase(), c]))
    const sideTotal = (lines: Array<{ name: string; marketValue: number | null }>) => {
      let total = 0
      let unconverted = 0
      for (const l of lines) {
        const devy = byNameMixed.get(l.name.toLowerCase())
        if (devy) {
          const points = devyAssetValue({
            devyRank: rankOf(devy.draftProjectionScore),
            outlook: outlookFor(devy),
            name: devy.name,
          }).value
          const converted = devyPointsToMarketUnits(points, bridge)
          /* An unranked prospect converts to nothing, so he is COUNTED as unpriced rather
             than added as a zero — the same rule devyAssetValue applies upstream. */
          if (converted == null) unconverted++
          else total += converted
        } else if (l.marketValue != null) {
          total += l.marketValue
        } else {
          unconverted++
        }
      }
      return { total, unconverted }
    }

    const give = sideTotal(args.give)
    const get = sideTotal(args.get)
    const diff = get.total - give.total
    const pct =
      give.total > 0 ? Math.round((Math.abs(diff) / give.total) * 1000) / 10 : null
    const direction =
      diff === 0 ? 'even' : diff > 0 ? 'in your favour' : 'against you'

    const unpricedNote =
      give.unconverted + get.unconverted > 0
        ? ` ${give.unconverted + get.unconverted} asset(s) could not be priced at all and are excluded from both totals.`
        : ''

    verdict =
      `At your league's rate of ${bridge.marketUnitsPerDevyPoint} market units per devy point: ` +
      `you give ${give.total.toLocaleString()}, you get ${get.total.toLocaleString()} — ` +
      `${pct == null ? 'a difference that cannot be expressed as a percentage of zero' : `${pct}% ${direction}`}.` +
      unpricedNote +
      ` ${bridge.caveat}`

    /* The deal is gradeable now, so the refusal is withdrawn — but only this one. */
    refusal = null
  } else if (mixed && bridge && !bridge.ok && bridge.reason !== 'unset') {
    /*
     * A rate WAS set and is being ignored. Saying so matters more than the refusal itself: a
     * commissioner who typed 350 instead of 3.5 would otherwise see the ordinary "cannot be
     * graded" message and conclude the feature does not work.
     */
    refusal = `${mixed.reason} ${bridge.detail}`
  }

  if (!refusal && !mixed) {
    const byName = new Map(candidates.map((c) => [c.name.toLowerCase(), c]))
    const toSide = (lines: Array<{ name: string }>): DevyTradeSide[] =>
      lines
        .map((l) => byName.get(l.name.toLowerCase()))
        .filter((c): c is (typeof candidates)[number] => c != null)
        .map((c) => ({
          label: c.name,
          value: devyAssetValue({
            devyRank: rankOf(c.draftProjectionScore),
            outlook: outlookFor(c),
            name: c.name,
          }),
        }))

    const give = toSide(args.give)
    const get = toSide(args.get)
    if (give.length > 0 && get.length > 0) {
      verdict = gradeDevyTrade({ give, get }).basis
    }
  }

  return {
    matched: candidates.map((c) => ({ name: c.name })),
    refusal,
    standings,
    verdict,
    bridge,
  }
}
