/**
 * Who in this league is worth trading with — item #8 of the trade-system brief.
 *
 * ── WHAT EXISTED, AND WHY THIS IS NOT A SIXTH FINDER ─────────────────────────────────────────────
 *
 * `lib/trade-finder/partner-matchmaking.ts` (`findBestPartners`) already scores need, availability,
 * tendencies and offer shape — but its route fetches Sleeper LIVE, its roster ids are Sleeper's
 * numeric ones, and it renders only on `/af-legacy`. The /core Trade Center listed the league's
 * other managers in plain roster order. This ranks them from what the Trade Center ALREADY loads
 * (`/api/leagues/[id]/trades/rosters`: every roster, priced, on every platform) plus two DB reads
 * the route makes for it — the league's lineup and its trade history. No provider is called.
 *
 * ── THE FOUR COMPONENTS (each 0..1, or null when it cannot be measured) ───────────────────────────
 *
 *   availability — they hold a SPARE player (not one of their starters) who would upgrade one of
 *                  YOUR weakest starting spots. "Available" means exactly that: bench, not lineup.
 *   need         — the mirror: YOUR spare player would start at one of THEIR weak spots. A partner
 *                  with nothing to gain is a partner who says no.
 *   package      — a value-matched deal can actually be built from those two surpluses (within 15%,
 *                  topped up with a spare player or pick when one side is light).
 *   history      — they trade at all in this league, and they have traded with you.
 *
 * The score is the weighted mean of the components that COULD be measured, and the answer says
 * which could not. A league with no lineup on file is not scored as if it had a standard one —
 * `rosterNeed.readSlotRequirements` refuses that guess for the same reason.
 *
 * ── UNITS ─────────────────────────────────────────────────────────────────────────────────────────
 *
 * "Value" is whatever the caller priced the roster in (the rosters route: FantasyCalc market value,
 * picks on the same curve). Starters are chosen by that value — a proxy for "who would start", and
 * named as one. An unpriced player is left out and counted, never treated as worth 0.
 *
 * ⚠ PURE. No Prisma, no fetch: every input arrives resolved, so every branch is testable offline.
 */
import { DEFAULT_SLOT_ELIGIBILITY, fillLineup, type SlotEligibility } from '@/lib/decision-os/trade/rosterImpact'

export type RankingPlayer = {
  id: string
  name: string
  position: string | null
  /** ⚠ NULL IS "NOT PRICED" — excluded and disclosed, never scored as 0. */
  value: number | null
}

export type RankingPick = { pickId: string; label: string; value: number | null }

export type RankingRoster = {
  rosterId: string
  ownerName: string | null
  players: RankingPlayer[]
  picks: RankingPick[]
}

/** Completed-trade facts for the league, already resolved to `rosterId` space by the caller. */
export type RankingTradeHistory = {
  /** Distinct completed trades each roster took part in. */
  tradesByRoster: Map<string, number>
  /** Distinct completed trades each roster made WITH the viewer. */
  tradesWithViewer: Map<string, number>
}

export type PartnerAsset = { id: string; name: string; position: string | null; value: number; kind: 'player' | 'pick' }

export type PartnerRecommendation = {
  rosterId: string
  ownerName: string | null
  /** 1-based, best first. */
  rank: number
  /** 0..100 over the components that could be measured. */
  score: number
  label: 'Strong fit' | 'Good fit' | 'Possible fit' | 'Weak fit'
  components: {
    availability: number | null
    need: number | null
    package: number | null
    history: number | null
  }
  /** Manager-facing sentences, most important first. */
  reasons: string[]
  /** A starting package, when one could be built. Sides are from the VIEWER's point of view. */
  suggestion: { give: PartnerAsset[]; get: PartnerAsset[]; percentApart: number } | null
}

export type PartnerRanking = {
  partners: PartnerRecommendation[]
  /** What the ranking could not see, league-wide. Rendered verbatim. */
  gaps: string[]
}

const WEIGHTS = { availability: 0.35, need: 0.25, package: 0.25, history: 0.15 } as const

/**
 * The lineup model's slot map plus the flex names `rosterNeed` also recognises, so a league using
 * Sleeper's `DEF_FLEX` or ESPN's `WRRB_WRT` is not reported as having a slot nobody can fill.
 */
const ELIGIBILITY: SlotEligibility = {
  ...DEFAULT_SLOT_ELIGIBILITY,
  WRRB_WRT: ['RB', 'WR', 'TE'],
  SF: ['QB', 'RB', 'WR', 'TE'],
  DEF_FLEX: ['DL', 'LB', 'DB'],
}

/** Provider position spellings onto the slot vocabulary. */
const POSITION_ALIAS: Record<string, string> = {
  DST: 'DEF', 'D/ST': 'DEF', DE: 'DL', DT: 'DL', NT: 'DL', EDGE: 'DL',
  ILB: 'LB', OLB: 'LB', MLB: 'LB', CB: 'DB', S: 'DB', SS: 'DB', FS: 'DB', PK: 'K',
}

export function normalizePosition(position: string | null | undefined): string | null {
  const p = (position ?? '').trim().toUpperCase()
  if (!p) return null
  return POSITION_ALIAS[p] ?? p
}

/** A lineup "hole" or weak spot must be this far below the league's typical starter to count. */
const WEAK_SPOT = 0.85
/** A match inside this band needs no top-up. */
const FAIR_BAND = 0.15
/** Past this gap, no package is offered at all — it would not be a realistic opening. */
const MAX_APART = 0.35

type Analysed = {
  roster: RankingRoster
  priced: Array<RankingPlayer & { value: number; position: string }>
  starters: Set<string>
  /** Weakest starter value per position this league starts (0 when the slot went unfilled). */
  weakest: Map<string, number>
  /** Non-starters by position, best first. */
  spare: Map<string, Array<RankingPlayer & { value: number; position: string }>>
  unpriced: number
}

function analyse(roster: RankingRoster, slots: readonly string[], startingPositions: Set<string>): Analysed {
  const priced = roster.players.flatMap((p) => {
    const position = normalizePosition(p.position)
    return typeof p.value === 'number' && Number.isFinite(p.value) && position ? [{ ...p, value: p.value, position }] : []
  })
  const fill = fillLineup(
    priced.map((p) => ({ playerId: p.id, position: p.position, projectedPoints: p.value })),
    slots,
    ELIGIBILITY,
  )
  const starters = new Set(fill.starterIds)

  const weakest = new Map<string, number>()
  for (const position of startingPositions) {
    const values = priced.filter((p) => starters.has(p.id) && p.position === position).map((p) => p.value)
    weakest.set(position, values.length > 0 ? Math.min(...values) : 0)
  }

  const spare = new Map<string, Array<RankingPlayer & { value: number; position: string }>>()
  for (const p of priced) {
    if (starters.has(p.id)) continue
    const list = spare.get(p.position) ?? []
    list.push(p)
    spare.set(p.position, list)
  }
  for (const list of spare.values()) list.sort((a, b) => b.value - a.value)

  return { roster, priced, starters, weakest, spare, unpriced: roster.players.length - priced.length }
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2
}

type Upgrade = { position: string; player: RankingPlayer & { value: number; position: string }; severity: number; gain: number; score: number; currentWeakest: number }

/**
 * The best spare player `from` holds that would start over `to`'s weakest player somewhere `to`
 * is below the league's typical starter.
 */
function bestUpgrade(from: Analysed, to: Analysed, baseline: Map<string, number>): Upgrade | null {
  let best: Upgrade | null = null
  for (const [position, base] of baseline) {
    if (base <= 0) continue
    const current = to.weakest.get(position) ?? 0
    if (current >= base * WEAK_SPOT) continue
    const severity = Math.min(1, (base - current) / base)
    const candidate = (from.spare.get(position) ?? [])[0]
    if (!candidate || candidate.value <= current) continue
    const gain = Math.min(1, (candidate.value - current) / base)
    const score = severity * gain
    if (!best || score > best.score) best = { position, player: candidate, severity, gain, score, currentWeakest: current }
  }
  return best
}

function asset(p: RankingPlayer & { value: number }): PartnerAsset {
  return { id: p.id, name: p.name, position: p.position, value: p.value, kind: 'player' }
}

function sum(assets: PartnerAsset[]): number {
  return assets.reduce((total, a) => total + a.value, 0)
}

/** |a − b| as a share of the larger side. 0 is even. */
function apart(a: number, b: number): number {
  const hi = Math.max(a, b)
  return hi <= 0 ? 1 : Math.abs(a - b) / hi
}

/**
 * Build an opening package from `give` (viewer) and `get` (partner), topping up the lighter side
 * with ONE spare asset from that side's owner when the two are further apart than the fair band.
 *
 * ⚠ ONE TOP-UP, NOT A SOLVER. The point is a realistic opening a manager can edit, and a
 * five-piece "balanced" package is neither realistic nor something anyone would send.
 */
function buildPackage(
  give: PartnerAsset[],
  get: PartnerAsset[],
  viewerExtras: PartnerAsset[],
  partnerExtras: PartnerAsset[],
): { give: PartnerAsset[]; get: PartnerAsset[]; percentApart: number } | null {
  let g = give
  let k = get
  let gap = apart(sum(g), sum(k))
  if (gap > FAIR_BAND) {
    const lighterIsViewer = sum(g) < sum(k)
    const shortfall = Math.abs(sum(g) - sum(k))
    const pool = (lighterIsViewer ? viewerExtras : partnerExtras).filter(
      (a) => !g.some((x) => x.id === a.id) && !k.some((x) => x.id === a.id),
    )
    // The extra that lands closest to even without overshooting past the band.
    let pickBest: PartnerAsset | null = null
    let pickGap = gap
    for (const extra of pool) {
      const ng = lighterIsViewer ? [...g, extra] : g
      const nk = lighterIsViewer ? k : [...k, extra]
      const trial = apart(sum(ng), sum(nk))
      if (trial < pickGap && extra.value <= shortfall * (1 + FAIR_BAND)) {
        pickGap = trial
        pickBest = extra
      }
    }
    if (pickBest) {
      if (lighterIsViewer) g = [...g, pickBest]
      else k = [...k, pickBest]
      gap = pickGap
    }
  }
  if (gap > MAX_APART) return null
  return { give: g, get: k, percentApart: Math.round(gap * 100) }
}

function labelFor(score: number): PartnerRecommendation['label'] {
  if (score >= 70) return 'Strong fit'
  if (score >= 50) return 'Good fit'
  if (score >= 30) return 'Possible fit'
  return 'Weak fit'
}

function money(n: number): string {
  return Math.round(n).toLocaleString('en-US')
}

export function rankTradePartners(args: {
  viewerRosterId: string
  rosters: RankingRoster[]
  /** `League.starters` as stored. Null or unreadable ⇒ need and availability are not measured. */
  starterSlots: unknown
  /** Null ⇒ the history component is not measured and the answer says so. */
  history: RankingTradeHistory | null
}): PartnerRanking {
  const gaps: string[] = []
  const viewerRoster = args.rosters.find((r) => r.rosterId === args.viewerRosterId)
  if (!viewerRoster) return { partners: [], gaps: ['Your team could not be identified in this league.'] }

  const slots = Array.isArray(args.starterSlots)
    ? args.starterSlots.map((s) => String(s).toUpperCase().trim()).filter((s) => s && !['BN', 'BE', 'BENCH', 'IR', 'TAXI', 'RES'].includes(s))
    : []
  const lineupKnown = slots.length > 0
  if (!lineupKnown) {
    gaps.push("This league's starting lineup is not on file, so roster needs and spare players could not be judged.")
  }
  const unknownSlots = [...new Set(slots.filter((s) => !ELIGIBILITY[s]))]
  if (unknownSlots.length > 0) {
    gaps.push(`Lineup slot${unknownSlots.length === 1 ? '' : 's'} ${unknownSlots.join(', ')} ${unknownSlots.length === 1 ? 'is' : 'are'} not modelled and did not count toward needs.`)
  }

  const startingPositions = new Set<string>()
  for (const s of slots) for (const p of ELIGIBILITY[s] ?? []) startingPositions.add(p)

  const analysed = new Map(args.rosters.map((r) => [r.rosterId, analyse(r, lineupKnown ? slots : [], startingPositions)]))
  const viewer = analysed.get(args.viewerRosterId)!

  /* The league's typical weakest starter at each position — what "weak" is measured against. */
  const baseline = new Map<string, number>()
  if (lineupKnown) {
    for (const position of startingPositions) {
      baseline.set(position, median([...analysed.values()].map((a) => a.weakest.get(position) ?? 0)))
    }
  }

  const unpriced = [...analysed.values()].reduce((n, a) => n + a.unpriced, 0)
  if (unpriced > 0) {
    gaps.push(`${unpriced} rostered player${unpriced === 1 ? ' has' : 's have'} no market value and ${unpriced === 1 ? 'was' : 'were'} left out.`)
  }
  if (!args.history) gaps.push('Trade history is not on file for this league, so past dealing did not count.')

  const maxTrades = args.history ? Math.max(0, ...args.history.tradesByRoster.values()) : 0

  const viewerExtras: PartnerAsset[] = [
    ...[...viewer.spare.values()].flat().map(asset),
    ...viewerRoster.picks.flatMap((p) => (typeof p.value === 'number' ? [{ id: p.pickId, name: p.label, position: 'PICK', value: p.value, kind: 'pick' as const }] : [])),
  ].sort((a, b) => b.value - a.value)

  const scored = args.rosters
    .filter((r) => r.rosterId !== args.viewerRosterId)
    .map((r) => {
      const them = analysed.get(r.rosterId)!
      const reasons: string[] = []

      const forYou = lineupKnown ? bestUpgrade(them, viewer, baseline) : null
      const forThem = lineupKnown ? bestUpgrade(viewer, them, baseline) : null
      const availability = lineupKnown ? (forYou?.score ?? 0) : null
      const need = lineupKnown ? (forThem?.score ?? 0) : null

      if (forYou) {
        reasons.push(
          `Has a spare ${forYou.position}: ${forYou.player.name} (${money(forYou.player.value)}) would start over your weakest ${forYou.position}${forYou.currentWeakest > 0 ? ` (${money(forYou.currentWeakest)})` : ''}.`,
        )
      }
      if (forThem) {
        reasons.push(`Thin at ${forThem.position} — your ${forThem.player.name} would start for them.`)
      }

      let pkg: PartnerRecommendation['suggestion'] = null
      let packageScore: number | null = lineupKnown ? 0 : null
      if (forYou) {
        const partnerExtras: PartnerAsset[] = [
          ...[...them.spare.values()].flat().filter((p) => p.id !== forYou.player.id).map(asset),
          ...r.picks.flatMap((p) => (typeof p.value === 'number' ? [{ id: p.pickId, name: p.label, position: 'PICK', value: p.value, kind: 'pick' as const }] : [])),
        ].sort((a, b) => b.value - a.value)
        const get = [asset(forYou.player)]
        /*
         * Prefer giving what they NEED; otherwise the spare asset closest in value. The second is a
         * weaker opening — a deal that fills nothing for them — and scores as such.
         */
        const needGive = forThem ? [asset(forThem.player)] : null
        const valueGive = viewerExtras.length > 0
          ? [viewerExtras.reduce((best, a) => (apart(a.value, forYou.player.value) < apart(best.value, forYou.player.value) ? a : best))]
          : null
        const built = (needGive && buildPackage(needGive, get, viewerExtras, partnerExtras)) ||
          (valueGive && buildPackage(valueGive, get, viewerExtras, partnerExtras))
        if (built) {
          pkg = built
          const fillsTheirNeed = Boolean(needGive && built.give[0]?.id === needGive[0]!.id)
          packageScore = (1 - built.percentApart / 100 / MAX_APART) * (fillsTheirNeed ? 1 : 0.5)
          reasons.push(
            `A realistic opening: ${built.give.map((a) => a.name).join(' + ')} for ${built.get.map((a) => a.name).join(' + ')}${built.percentApart > 0 ? ` (${built.percentApart}% apart)` : ' (even)'}.`,
          )
        }
      }

      let history: number | null = null
      if (args.history) {
        const theirs = args.history.tradesByRoster.get(r.rosterId) ?? 0
        const withYou = args.history.tradesWithViewer.get(r.rosterId) ?? 0
        history = 0.6 * (maxTrades > 0 ? theirs / maxTrades : 0) + 0.4 * (withYou > 0 ? 1 : 0)
        if (withYou > 0) reasons.push(`Has traded with you ${withYou === 1 ? 'once' : `${withYou} times`} in this league.`)
        else if (theirs > 0) reasons.push(`Active trader: ${theirs} completed trade${theirs === 1 ? '' : 's'} in this league.`)
        else reasons.push('No completed trades on file in this league.')
      }

      const components = { availability, need, package: packageScore, history }
      let weight = 0
      let total = 0
      for (const key of Object.keys(WEIGHTS) as Array<keyof typeof WEIGHTS>) {
        const c = components[key]
        if (c == null) continue
        weight += WEIGHTS[key]
        total += WEIGHTS[key] * Math.max(0, Math.min(1, c))
      }
      const score = weight > 0 ? Math.round((total / weight) * 100) : 0
      return { r, score, components, reasons, pkg }
    })
    .sort((a, b) => b.score - a.score || a.r.rosterId.localeCompare(b.r.rosterId))

  const partners: PartnerRecommendation[] = scored.map((s, i) => ({
    rosterId: s.r.rosterId,
    ownerName: s.r.ownerName,
    rank: i + 1,
    score: s.score,
    label: labelFor(s.score),
    components: s.components,
    reasons: s.reasons,
    suggestion: s.pkg,
  }))

  return { partners, gaps }
}
