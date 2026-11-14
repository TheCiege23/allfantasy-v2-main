import type { PricedAsset } from '@/lib/hybrid-valuation'
import { applyDevyPricing, heldDevyOptionValue, type HeldDevyPlayer } from '@/lib/decision-os/trade/leagueAssetRules'
import { normalizeDevyName } from '@/lib/devy/devyPlayerReads'
import type { TradeAssetInput, TradeConsolePlayerLine } from '@/lib/trade-value-console/types'

/**
 * COLLEGE PROSPECTS IN THE OPEN (NO-LEAGUE) TRADE ANALYZER — "a college player for a pro player".
 *
 * Inside a devy league a prospect is priced by `applyDevyPricing` because the league HOLDS him
 * (`loadHeldDevyPlayers`). With no league there are no rights to read, so the candidate list is built from
 * the trade itself: a prospect picked from search carries `devy:<DevyPlayer.id>`, and a typed name is
 * matched against `DevyPlayer` by normalised name. Everything after that is the league grade's own rule —
 * `heldDevyOptionValue` / `devyOptionValue`, one implementation, so a prospect cannot be worth one number in a
 * league and another here.
 *
 * ⚠ ONE AXIS, AND ONLY ON A DYNASTY CHART. `devyOptionValue` prices on the FantasyCalc dynasty Superflex
 * 12-team board (`DEVY_BASIS_NOTE`); the caller rescales to the chart actually being graded
 * (`optionChartFactor`), and a REDRAFT chart prices no prospect at all — a player who cannot play this
 * season has no redraft value, and saying "0" would be a claim, not an absence.
 *
 * ⚠ A SEARCHED PROSPECT NEVER GOES THROUGH THE NFL PRICER. An id-tagged prospect is set aside before
 * `resolveAssets`, because the NFL path matches by NAME against the chart and a college player sharing a
 * name with a pro would silently be priced as the pro.
 */

const DEVY_ID_PREFIX = 'devy:'

export function devyIdOf(asset: TradeAssetInput): string | null {
  if (asset.kind !== 'player') return null
  const id = asset.playerId?.trim() ?? ''
  return id.startsWith(DEVY_ID_PREFIX) && id.length > DEVY_ID_PREFIX.length ? id.slice(DEVY_ID_PREFIX.length) : null
}

/** The NFL season a prospect's wait is measured from (seasons start in September). */
export function nflSeasonNow(now = new Date()): number {
  return now.getUTCMonth() >= 8 ? now.getUTCFullYear() : now.getUTCFullYear() - 1
}

const HELD_SELECT = {
  id: true,
  name: true,
  position: true,
  school: true,
  ppaSeasonTotal: true,
  recruitingComposite: true,
  recruitingStars: true,
  draftEligibleYear: true,
} as const

type DevyRow = {
  id: string
  name: string
  position: string | null
  school: string | null
  ppaSeasonTotal: number | null
  recruitingComposite: number | null
  recruitingStars: number | null
  draftEligibleYear: number | null
}

/*
 * Structural so a unit test can pass a stub; `any` on the argument because Prisma's `findMany` is generic
 * in its argument and no concrete parameter type is assignable from it.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DevyDelegate = { devyPlayer: { findMany: (args: any) => PromiseLike<unknown> } }

const toHeld = (r: DevyRow): HeldDevyPlayer => ({
  devyPlayerId: r.id,
  name: r.name,
  position: r.position ?? null,
  ppaSeasonTotal: r.ppaSeasonTotal ?? null,
  recruitingComposite: r.recruitingComposite ?? null,
  recruitingStars: r.recruitingStars ?? null,
  draftEligibleYear: r.draftEligibleYear ?? null,
})

/**
 * Prospects this trade could mean: every tagged id, plus every not-yet-drafted prospect whose normalised
 * name equals one of the trade's unpriced names. Empty on any read failure — the lines then stay unpriced,
 * exactly as before.
 */
export async function loadDevyCandidates(
  prisma: DevyDelegate,
  args: { ids: readonly string[]; names: readonly string[] },
): Promise<HeldDevyPlayer[]> {
  const ids = [...new Set(args.ids.filter(Boolean))]
  const names = [...new Set(args.names.map(normalizeDevyName).filter((n) => n.length >= 2))]
  if (ids.length === 0 && names.length === 0) return []
  try {
    const rows = (await prisma.devyPlayer.findMany({
      where: {
        graduatedToNFL: false,
        OR: [...(ids.length ? [{ id: { in: ids } }] : []), ...(names.length ? [{ normalizedName: { in: names } }] : [])],
      },
      select: HELD_SELECT,
      take: 200,
    })) as DevyRow[]
    return rows.map(toHeld)
  } catch {
    return []
  }
}

type OpenMarketDevySearchRow = {
  playerId: string
  name: string
  position: string | null
  team: string | null
  value: number | null
  /** Marks the row as a college prospect for the UI. */
  college: true
}

/**
 * Prospects matching a search, valued on the devy board's own scale (FantasyCalc dynasty Superflex
 * 12-team) — the same number the grade starts from before rescaling to the chart it grades on.
 */
export async function searchOpenMarketDevy(
  prisma: DevyDelegate,
  query: string,
  opts: { limit?: number; now?: Date } = {},
): Promise<OpenMarketDevySearchRow[]> {
  const needle = normalizeDevyName(query)
  if (needle.length < 2) return []
  try {
    const rows = (await prisma.devyPlayer.findMany({
      where: { normalizedName: { contains: needle }, graduatedToNFL: false, position: { in: ['QB', 'RB', 'WR', 'TE'] } },
      select: HELD_SELECT,
      orderBy: [{ draftProjectionScore: 'desc' }, { devyValue: 'desc' }, { name: 'asc' }],
      take: opts.limit ?? 5,
    })) as DevyRow[]
    const season = nflSeasonNow(opts.now)
    return rows.map((r) => {
      const option = heldDevyOptionValue(toHeld(r), season)
      return {
        playerId: `${DEVY_ID_PREFIX}${r.id}`,
        name: r.name,
        position: r.position ?? null,
        team: r.school ? `College · ${r.school}` : 'College',
        value: option.value == null ? null : Math.round(option.value),
        college: true as const,
      }
    })
  } catch {
    return []
  }
}

/** Set id-tagged prospects aside, so the NFL pricer never sees (and never name-matches) them. PURE. */
export function splitDevyInputs(inputs: readonly TradeAssetInput[]): { rest: TradeAssetInput[]; devy: Array<{ index: number; input: TradeAssetInput }> } {
  const rest: TradeAssetInput[] = []
  const devy: Array<{ index: number; input: TradeAssetInput }> = []
  inputs.forEach((input, index) => (devyIdOf(input) ? devy.push({ index, input }) : rest.push(input)))
  return { rest, devy }
}

/**
 * Put the set-aside prospects back where they were, as UNPRICED placeholder lines, so `applyDevyPricing`
 * sees inputs and lines index-aligned. PURE. If the pricer dropped a line (an unnamed asset), alignment is
 * gone and the placeholders are appended — the matcher then works by id/name, which it already supports.
 */
export function mergeDevyPlaceholders(
  inputs: readonly TradeAssetInput[],
  split: ReturnType<typeof splitDevyInputs>,
  resolved: { lines: TradeConsolePlayerLine[]; priced: PricedAsset[] },
  placeholder: (input: TradeAssetInput) => { line: TradeConsolePlayerLine; priced: PricedAsset },
): { inputs: TradeAssetInput[]; lines: TradeConsolePlayerLine[]; priced: PricedAsset[] } {
  if (split.devy.length === 0) return { inputs: [...inputs], lines: resolved.lines, priced: resolved.priced }
  if (resolved.lines.length !== split.rest.length) {
    const extra = split.devy.map((d) => placeholder(d.input))
    return {
      inputs: [...split.rest, ...split.devy.map((d) => d.input)],
      lines: [...resolved.lines, ...extra.map((e) => e.line)],
      priced: [...resolved.priced, ...extra.map((e) => e.priced)],
    }
  }
  const lines: TradeConsolePlayerLine[] = []
  const priced: PricedAsset[] = []
  let r = 0
  const devyAt = new Map(split.devy.map((d) => [d.index, d.input]))
  inputs.forEach((_, i) => {
    const d = devyAt.get(i)
    if (d) {
      const p = placeholder(d)
      lines.push(p.line)
      priced.push(p.priced)
    } else {
      lines.push(resolved.lines[r]!)
      priced.push(resolved.priced[r]!)
      r++
    }
  })
  return { inputs: [...inputs], lines, priced }
}

type Side = { inputs: TradeAssetInput[]; lines: TradeConsolePlayerLine[]; priced: PricedAsset[] }

/**
 * Price every unpriced line that is a college prospect, on THIS chart. PURE but for the injected factor.
 *
 * `chartFactor` is `optionChartFactor(chart)`: 1 on the devy board's own chart, the measured ratio on any
 * other dynasty chart, and null on a redraft chart — in which case nothing is priced and each prospect is
 * named in `redraftRefused`, so the grade can say why it withheld instead of guessing a value.
 */
export function priceOpenMarketDevySide(
  side: Side,
  candidates: readonly HeldDevyPlayer[],
  currentSeason: number,
  chartFactor: number | null,
): Side & { devyPriced: number; unmeasured: string[]; redraftRefused: string[] } {
  const none = { ...side, devyPriced: 0, unmeasured: [] as string[], redraftRefused: [] as string[] }
  if (candidates.length === 0 || !side.lines.some((l) => l.unpriced)) return none
  // Ids arrive tagged; the matcher compares against the bare DevyPlayer id.
  const inputs = side.inputs.map((a) => {
    const id = devyIdOf(a)
    return id && a.kind === 'player' ? { ...a, playerId: id } : a
  })
  const priced = applyDevyPricing({ inputs, lines: side.lines, priced: side.priced, held: candidates, currentSeason })
  if (priced.devyPriced === 0) return { ...none, unmeasured: priced.unmeasured }

  if (chartFactor == null) {
    // Name every prospect the pricer would have priced, and price none of them.
    const refused = priced.lines.filter((l, i) => l.dataSource === 'devy-option' && !l.unpriced && side.lines[i]?.unpriced).map((l) => l.name)
    return { ...none, unmeasured: priced.unmeasured, redraftRefused: refused }
  }
  const lines = priced.lines.map((l, i) => {
    if (l.dataSource !== 'devy-option' || l.unpriced || !side.lines[i]?.unpriced) return l
    return { ...l, marketValue: Math.round((l.marketValue ?? 0) * chartFactor) }
  })
  const assets = priced.priced.map((p, i) => {
    if (p.source !== 'devy-option' || !side.lines[i]?.unpriced) return p
    const v = Math.round(p.assetValue.marketValue * chartFactor)
    return { ...p, value: v, assetValue: { ...p.assetValue, marketValue: v } }
  })
  return { inputs: side.inputs, lines, priced: assets, devyPriced: priced.devyPriced, unmeasured: priced.unmeasured, redraftRefused: [] }
}
