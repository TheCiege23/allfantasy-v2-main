/**
 * Devy assets in a proposed trade: identify them, price them on THE GRADE'S scale, refuse what
 * cannot be priced.
 *
 * ⚠ EXTRACTED FROM `lib/trade-intel/tradeContextNotes.ts` SO THERE IS ONE IMPLEMENTATION.
 * `/api/trade-value/analyze` reaches it through trade context notes (Chimmy's devy notes);
 * `/api/trade-evaluator` calls it directly. Both get the same answer.
 *
 * 🛑 ONE DEVY NUMBER (2026-11-28). This module used to value a prospect in DEVY POINTS
 * (`devyAssetValue` / `gradeDevyTrade`), a denomination that converts to nothing, while the one
 * grade priced the same prospect by `devyOptionValue` on the FantasyCalc dynasty board. A manager
 * could therefore see a letter from one number and a Chimmy verdict from another. Now every value
 * here is `heldDevyOptionValue` — the grade's own call — so:
 *
 *   - IN A LEAGUE, only a prospect THIS league holds devy rights on is priced, at his option value
 *     as the league grade prices him (`applyDevyPricing`, no rescale). A college player the league
 *     holds no rights on is named and withheld, exactly as the grade withholds him.
 *   - WITH NO LEAGUE, any prospect on file is priced, rescaled to the chart being graded by
 *     `optionChartFactor` (the open analyzer's rule, `lib/devy/openMarketDevy.ts`), and a redraft
 *     chart (factor null) prices no prospect.
 *   - An UNMEASURED prospect (`devyOptionValue` returns null) is withheld, never zero.
 *
 * A devy-for-devy deal is then just a comparison on the same scale as any other deal, and a mixed
 * deal needs no conversion: option value is already denominated in the board's units.
 *
 * ⚠ THE COMMISSIONER BRIDGE STAYS AS THE EXPLICIT OVERRIDE. A league that set
 * `devyMarketUnitsPerDevyPoint` (`lib/devy/devyMarketBridge.ts`) has chosen a house rule over the
 * measured value; when the caller passes `leagueSettings` and the deal spans college and NFL assets,
 * prospects are priced at that rate in devy points instead — and the verdict carries
 * `DEVY_BRIDGE_CAVEAT`. Neither trade surface passes settings today, which keeps the note on the
 * grade's number; the override is opt-in at the call site, never inferred.
 */

import 'server-only'

import { prisma } from '@/lib/prisma'
import {
  heldDevyOptionValue,
  matchHeldDevy,
  type HeldDevyPlayer,
} from '@/lib/decision-os/trade/leagueAssetRules'
import { loadHeldDevyPlayers } from '@/lib/decision-os/trade/leagueAssetPolicy'
import { loadDevyCandidates } from '@/lib/devy/openMarketDevy'
import { projectDevyOutlook } from '@/lib/trade-intel/devyOutlook'
import { devyAssetValue } from '@/lib/trade-intel/devyTradeValue'
import {
  devyPointsToMarketUnits,
  resolveDevyBridge,
  type DevyBridgeOutcome,
} from '@/lib/devy/devyMarketBridge'

/** One player line of the deal, as the caller priced it. */
export type DevyDealLine = {
  name: string
  /** The caller's price, or null when it could not price him. */
  marketValue: number | null
  /** True when the caller's price IS a devy option value (`dataSource === 'devy-option'`). */
  devy?: boolean
}

/** One prospect in the deal, valued on the graded chart. */
export type DevyProspectPrice = {
  name: string
  /** The deal line's own spelling he was matched from. */
  lineName: string
  position: string | null
  /** On the graded chart. Null = withheld, never zero. */
  value: number | null
  /** Why — the option basis, or the reason he is withheld. */
  basis: string
}

export type DevyTradeVerdict = {
  matched: Array<{ name: string }>
  prospects: DevyProspectPrice[]
  /** Non-null when a prospect cannot be priced on the grade's scale, so the deal is withheld. */
  refusal: string | null
  /** One line per prospect: what he is worth and why. */
  standings: string[]
  /** Both sides on one scale, when every player in the deal is priced. Null otherwise. */
  verdict: string | null
  /**
   * The commissioner's rate, when the caller passed settings and the deal spans both kinds of asset.
   * ⚠ REPORTED SO A SURFACE CAN SAY THE CONVERSION WAS A HOUSE RULE.
   */
  bridge: DevyBridgeOutcome | null
  /** True when the deal spans college prospects AND priced NFL players — the only deal the bridge may touch. */
  mixed: boolean
}

/** Pricing rule the caller's grade uses for prospects. */
export type DevyPricingContext =
  /** The league grade: only held prospects, at their option value (no rescale). */
  | { kind: 'league'; held: readonly HeldDevyPlayer[] }
  /** The open analyzer: any prospect on file, rescaled to the chart; null factor = redraft chart. */
  | { kind: 'open'; chartFactor: number | null }

const fmt = (n: number) => Math.round(n).toLocaleString('en-US')

/**
 * The pure core: given the deal, the college players its names could mean, and the grade's pricing
 * rule, value every prospect and say what the deal comes to. No prisma.
 *
 * `bridgePoints` is the commissioner override's input (devy points by `devyPlayerId`), supplied only
 * when the caller resolved a valid bridge for a mixed deal.
 */
export function buildDevyTradeVerdict(args: {
  give: readonly DevyDealLine[]
  get: readonly DevyDealLine[]
  season: number
  candidates: readonly HeldDevyPlayer[]
  pricing: DevyPricingContext
  bridge?: DevyBridgeOutcome | null
  bridgePoints?: ReadonlyMap<string, number | null>
  /** True when the deal also carries picks or FAAB, which these lines do not — totals would be partial. */
  otherAssets?: boolean
}): DevyTradeVerdict | null {
  const lines = [...args.give.map((l) => ({ ...l, side: 'give' as const })), ...args.get.map((l) => ({ ...l, side: 'get' as const }))]
  const held = args.pricing.kind === 'league' ? args.pricing.held : []
  const pool = [...held, ...args.candidates.filter((c) => !held.some((h) => h.devyPlayerId === c.devyPlayerId))]

  // Which lines are college players. Only an unpriced name, or one the caller priced AS a prospect, is
  // ever read as one — a name that priced as an NFL player is one, whatever else shares it.
  const devyLine = lines.map((l) =>
    l.marketValue == null || l.devy ? matchHeldDevy(undefined, l.name, pool) : null,
  )
  if (!devyLine.some(Boolean)) return null

  const hasNfl = lines.some((l, i) => !devyLine[i] && l.marketValue != null)
  const bridge = args.bridge ?? null
  const useBridge = Boolean(bridge?.ok && hasNfl && args.bridgePoints)
  const rate = bridge?.ok ? bridge.marketUnitsPerDevyPoint : null

  const withheld: string[] = []
  const redraft: string[] = []
  const prospects: DevyProspectPrice[] = []
  const valueAt = new Map<number, number | null>()

  lines.forEach((line, i) => {
    const p = devyLine[i]
    if (!p) return
    const option = heldDevyOptionValue(p, args.season)
    let value: number | null
    let basis: string
    if (useBridge && bridge?.ok) {
      const points = args.bridgePoints!.get(p.devyPlayerId) ?? null
      value = devyPointsToMarketUnits(points, bridge)
      basis = value == null
        ? `${p.name} is unranked on the devy board, so your league's rate converts him to nothing — he is not counted.`
        : `${p.name} is ${points} devy points, ${fmt(value)} at your league's rate.`
    } else if (line.devy && line.marketValue != null) {
      // The caller's grade already priced him — that is the number, by construction the same call.
      value = line.marketValue
      basis = option.basis
    } else if (args.pricing.kind === 'league' && !held.some((h) => h.devyPlayerId === p.devyPlayerId)) {
      value = null
      basis = `${p.name} is a college prospect this league holds no devy rights on, so the grade prices him at nothing and does not count him as zero — this deal is withheld.`
      withheld.push(basis)
    } else if (option.value == null) {
      value = null
      basis = option.basis
      withheld.push(`${option.basis} The deal is withheld rather than counting him as zero.`)
    } else if (args.pricing.kind === 'open' && args.pricing.chartFactor == null) {
      value = null
      basis = option.basis
      redraft.push(p.name)
    } else {
      const factor = args.pricing.kind === 'open' ? (args.pricing.chartFactor as number) : 1
      value = Math.round(option.value * factor)
      basis = factor === 1 ? option.basis : `${option.basis} On the chart being graded that is ${fmt(value)}.`
    }
    valueAt.set(i, value)
    prospects.push({ name: p.name, lineName: line.name, position: p.position, value, basis })
  })

  if (redraft.length) {
    withheld.unshift(
      `${redraft.join(', ')}: college prospects are valued only on a dynasty chart — a player who cannot play this season has no redraft value, and saying 0 would be a claim — so this deal is not graded.`,
    )
  }

  // A bridge that was SET but is unusable is said out loud: a commissioner who typed 350 for 3.5
  // must not conclude the feature is broken. The measured value is used instead.
  const bridgeIgnored = bridge && !bridge.ok && bridge.reason !== 'unset' && hasNfl ? bridge.detail : null
  const standings = [
    ...prospects.map((p) => `${p.name}${p.position ? ` (${p.position})` : ''} — ${p.basis}`),
    ...(bridgeIgnored ? [bridgeIgnored] : []),
  ]

  const refusal = !useBridge && withheld.length ? withheld.join(' ') : null

  let verdict: string | null = null
  const otherUnpriced = lines.some((l, i) => !devyLine[i] && l.marketValue == null)
  if (!refusal && !otherUnpriced && !args.otherAssets) {
    let unconverted = 0
    const total = (side: 'give' | 'get') =>
      lines.reduce((sum, l, i) => {
        if (l.side !== side) return sum
        if (!devyLine[i]) return sum + (l.marketValue ?? 0)
        const v = valueAt.get(i) ?? null
        if (v == null) {
          unconverted++
          return sum
        }
        return sum + v
      }, 0)
    const give = total('give')
    const get = total('get')
    const diff = get - give
    const pct = give > 0 ? Math.round((Math.abs(diff) / give) * 1000) / 10 : null
    const direction = diff === 0 ? 'even' : diff > 0 ? 'in your favour' : 'against you'
    const sides = `you give ${fmt(give)}, you get ${fmt(get)} — ${pct == null ? 'a difference that cannot be expressed as a percentage of zero' : `${pct}% ${direction}`}.`
    if (useBridge && bridge?.ok) {
      const note = unconverted > 0 ? ` ${unconverted} asset(s) could not be priced at all and are excluded from both totals.` : ''
      verdict = `At your league's rate of ${rate} market units per devy point: ${sides}${note} ${bridge.caveat}`
    } else {
      verdict = `On the grade's own scale — college prospects at their measured option value, NFL players at market value — ${sides}`
    }
  }

  return {
    // By the deal line's own spelling, so a caller can filter its lines by it.
    matched: prospects.map((p) => ({ name: p.lineName })),
    prospects,
    refusal,
    standings,
    verdict,
    bridge: hasNfl ? bridge : null,
    mixed: hasNfl,
  }
}

/**
 * Same-scale prices for the evaluator's own pricing pass: every unpriced line that is a prospect
 * this verdict priced takes that value, so the evaluator grades the deal on the number the note
 * states. PURE. Lines it did not price are returned untouched.
 */
export function applyDevyVerdictPrices<
  T extends { name: string; value: number; unpriced?: true; type: 'player' | 'pick'; source: string; assetValue: { marketValue: number; impactValue: number; vorpValue: number; volatility: number } },
>(prices: readonly T[], verdict: DevyTradeVerdict | null): T[] {
  if (!verdict || verdict.refusal) return [...prices]
  const byName = new Map(verdict.prospects.filter((p) => p.value != null).map((p) => [p.lineName, p]))
  return prices.map((p) => {
    if (!p.unpriced || p.type === 'pick') return p
    const hit = byName.get(p.name)
    if (!hit || hit.value == null) return p
    // The caller's name is kept: downstream joins on it.
    const { unpriced: _u, ...rest } = p as T & { unpricedReason?: unknown }
    delete (rest as { unpricedReason?: unknown }).unpricedReason
    return {
      ...rest,
      value: hit.value,
      assetValue: { marketValue: hit.value, impactValue: 0, vorpValue: 0, volatility: 0 },
      ...(hit.position ? { position: hit.position } : {}),
      source: 'devy-option',
    } as unknown as T
  })
}

/*
 * Structural so a unit test can pass stubs; `any` on the Prisma argument because `findMany` is
 * generic in its argument and no concrete parameter type is assignable from it.
 */
type IdentifyDeps = {
  loadCandidates: (names: string[]) => Promise<HeldDevyPlayer[]>
  loadHeld: (leagueId: string) => Promise<HeldDevyPlayer[]>
  loadLeague: (leagueId: string) => Promise<{ sport: string | null; season: number | null } | null>
  loadBridgePoints: (players: readonly HeldDevyPlayer[], season: number) => Promise<Map<string, number | null>>
}

const defaultDeps: IdentifyDeps = {
  loadCandidates: (names) => loadDevyCandidates(prisma, { ids: [], names }),
  loadHeld: loadHeldDevyPlayers,
  loadLeague: async (leagueId) => {
    const row = await prisma.league.findUnique({ where: { id: leagueId }, select: { sport: true, season: true } }).catch(() => null)
    return row ? { sport: String(row.sport), season: row.season } : null
  },
  loadBridgePoints,
}

/**
 * Devy points for the commissioner override ONLY — the bridge is denominated in them. Ranked against
 * the whole evidenced board, never against the players in the deal.
 */
async function loadBridgePoints(players: readonly HeldDevyPlayer[], season: number): Promise<Map<string, number | null>> {
  const ids = players.map((p) => p.devyPlayerId)
  const [rows, board] = await Promise.all([
    prisma.devyPlayer.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, position: true, school: true, draftEligibleYear: true, recruitingComposite: true, breakoutAge: true, projectedDraftRound: true, devyAdp: true, draftProjectionScore: true },
    }),
    prisma.devyPlayer.findMany({ where: { graduatedToNFL: false, draftProjectionScore: { not: null } }, select: { draftProjectionScore: true } }),
  ])
  const descending = board.map((b) => b.draftProjectionScore as number).sort((a, b) => b - a)
  const rankOf = (score: number | null): number | null => {
    if (score == null) return null
    let lo = 0
    let hi = descending.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (descending[mid]! > score) lo = mid + 1
      else hi = mid
    }
    return lo + 1
  }
  return new Map(rows.map((r) => [r.id, devyAssetValue({
    devyRank: rankOf(r.draftProjectionScore),
    outlook: projectDevyOutlook({ player: r, draftEligibleYear: r.draftEligibleYear, currentSeason: season, name: r.name }),
    name: r.name,
  }).value]))
}

export async function identifyDevyAssets(
  args: {
    give: DevyDealLine[]
    get: DevyDealLine[]
    /** The season a prospect's wait is measured from, when no league says otherwise. */
    season: number
    /**
     * The league the grade runs in. Given, only prospects this league holds are priced — the league
     * grade's rule — and the wait is measured from the league's season.
     */
    leagueId?: string | null
    /** Open (no-league) only: `optionChartFactor` of the chart being graded. Default 1; null = redraft. */
    chartFactor?: number | null
    /** True when the deal carries picks or FAAB as well. */
    otherAssets?: boolean
    /**
     * The league's `settings` blob, to opt into the commissioner bridge. OMITTING IT KEEPS THE GRADE'S
     * NUMBER, which is what both trade surfaces want.
     */
    leagueSettings?: unknown
  },
  deps: IdentifyDeps = defaultDeps,
): Promise<DevyTradeVerdict | null> {
  const all = [...args.give, ...args.get]
  const names = all.filter((x) => x.marketValue == null || x.devy).map((x) => x.name)
  if (names.length === 0) return null

  let season = args.season
  let pricing: DevyPricingContext = { kind: 'open', chartFactor: args.chartFactor === undefined ? 1 : args.chartFactor }
  if (args.leagueId) {
    const league = await deps.loadLeague(args.leagueId).catch(() => null)
    const nfl = String(league?.sport ?? '').toUpperCase() === 'NFL' && league?.season != null
    // The grade prices no prospect outside an NFL league with a known season.
    const held = nfl ? await deps.loadHeld(args.leagueId).catch(() => [] as HeldDevyPlayer[]) : []
    if (nfl) season = league!.season!
    pricing = { kind: 'league', held }
  }
  const candidates = await deps.loadCandidates(names).catch(() => [] as HeldDevyPlayer[])
  if (candidates.length === 0 && (pricing.kind !== 'league' || pricing.held.length === 0)) return null

  const firstPass = buildDevyTradeVerdict({ give: args.give, get: args.get, season, candidates, pricing, otherAssets: args.otherAssets })
  if (!firstPass || args.leagueSettings === undefined || !firstPass.mixed) return firstPass

  // The override: only a deal that spans both kinds of asset, and only a usable rate.
  const bridge = resolveDevyBridge(args.leagueSettings)
  if (!bridge.ok) return buildDevyTradeVerdict({ give: args.give, get: args.get, season, candidates, pricing, bridge, otherAssets: args.otherAssets })
  const pool = pricing.kind === 'league' ? [...pricing.held, ...candidates] : candidates
  const bridgePoints = await deps.loadBridgePoints(pool, season).catch(() => new Map<string, number | null>())
  return buildDevyTradeVerdict({ give: args.give, get: args.get, season, candidates, pricing, bridge, bridgePoints, otherAssets: args.otherAssets })
}
