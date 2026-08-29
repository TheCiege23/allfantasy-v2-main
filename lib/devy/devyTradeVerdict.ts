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

export type DevyTradeVerdict = {
  matched: Array<{ name: string }>
  /** Non-null when the trade spans both scales and therefore cannot be graded as one number. */
  refusal: string | null
  /** One line per devy asset, ranking him against the devy pool. */
  standings: string[]
  /** A devy-for-devy verdict, in devy points. Null for a mixed deal. */
  verdict: string | null
}

export async function identifyDevyAssets(args: {
  give: Array<{ name: string; marketValue: number | null }>
  get: Array<{ name: string; marketValue: number | null }>
  season: number
}): Promise<{
  matched: Array<{ name: string }>
  refusal: string | null
  standings: string[]
  verdict: string | null
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
  const refusal = refuseMixedScaleGrade(assets)?.reason ?? null

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
  if (!refusal) {
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
  }
}
