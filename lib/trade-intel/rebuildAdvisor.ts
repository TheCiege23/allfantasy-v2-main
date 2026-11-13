/**
 * The rebuild advisor — the healthy alternative to tanking (owner decision 2026-11-06).
 *
 * A manager out of the race has two ways to get better for next year. Tanking throws games, wrecks
 * the league for the teams still racing, and is what the integrity monitor flags. Rebuilding sells
 * this-season value to the teams that need it for future value, and makes the race MORE competitive.
 * This tells a rebuilding manager how: what to sell and to whom, what to keep, and what to ask for.
 *
 * ── WHERE EVERY CALL COMES FROM ────────────────────────────────────────────────────────────────────
 *
 *   sell / hold — the market's own view of each player's future: FantasyCalc's dynasty price against
 *                 its redraft price (lib/trade-intel/trajectory.ts). Priced well BELOW in dynasty
 *                 means the market thinks this season is near his peak: sell while it pays. Priced
 *                 well ABOVE means the value is still climbing: selling now is selling low. No age
 *                 curve is applied on top, so age is never charged twice.
 *   sell to     — teams in the race (lib/trade-intel/contention.ts) for whom the player would START,
 *                 by the same lineup fill the partner ranker uses (`fillLineup`, `ELIGIBILITY`).
 *   target      — those teams' picks, and their rising players who do not start for them: what a
 *                 contender gives up for help now.
 *   package     — one fair opening per buyer: within 15% of value, the partner ranker's own band, and
 *                 graded by the league's trade grader before it is shown (the route does that).
 *
 * ⚠ FAIR OR NOTHING. Steering an out-of-the-race manager into a lopsided deal with a contender is the
 * exact shape the collusion monitor exists to catch. No package past the band is offered, ever.
 *
 * ⚠ PURE. Every input arrives resolved; the route loads values, leans, standings and picks.
 * Units are the caller's (the rosters route: FantasyCalc 0–10000, picks on the same curve). An
 * unpriced asset, or a player with no dynasty/redraft read, is left out and counted — never guessed.
 */
import { fillLineup } from '@/lib/decision-os/trade/rosterImpact'
import type { Posture } from './contention'
import { ELIGIBILITY, readStarterSlots, type PartnerAsset, type SuggestionGrade } from './partnerRanking'

type RebuildLean = 'rising' | 'flat' | 'declining'

export type RebuildPlayer = {
  id: string
  name: string
  position: string | null
  value: number | null
  /** The dynasty/redraft spread's direction, or null when either price is missing. */
  lean: RebuildLean | null
  /** Dynasty price ÷ redraft price, when `lean` is known. */
  leanRatio?: number | null
}

type RebuildPick = {
  pickId: string
  label: string
  value: number | null
  /** The team the pick originally belonged to, when the caller knows; its standing decides where it lands. */
  originalRosterId?: string | null
}

export type RebuildRoster = {
  rosterId: string
  ownerName: string | null
  players: RebuildPlayer[]
  picks: RebuildPick[]
  /** Where this team stands in the race; null when it could not be judged. */
  posture: Posture | null
}

export type RebuildTrigger = 'eliminated' | 'strategy'

type RebuildCall = { asset: PartnerAsset; why: string }
type RebuildBuyer = { rosterId: string; ownerName: string | null; why: string }
type RebuildSell = RebuildCall & { buyers: RebuildBuyer[] }
type RebuildTarget = RebuildCall & { rosterId: string; ownerName: string | null }
export type RebuildPackage = {
  rosterId: string
  ownerName: string | null
  give: PartnerAsset[]
  get: PartnerAsset[]
  /** |give − get| as a share of the larger side. Always within FAIR_BAND. */
  percentApart: number
  why: string
  grade?: SuggestionGrade | null
}

export type RebuildPlan = {
  trigger: RebuildTrigger
  /** One sentence: why this team is being shown a rebuild plan. */
  basis: string
  sell: RebuildSell[]
  hold: RebuildCall[]
  targets: RebuildTarget[]
  packages: RebuildPackage[]
  gaps: string[]
}

/** A package must land within this share of value — the partner ranker's own fair band. */
export const FAIR_BAND = 0.15
const MAX_SELL = 5
const MAX_HOLD = 5
const MAX_BUYERS = 3
const MAX_TARGETS = 6
const MAX_PACKAGES = 3
/** Below this market value a player moves nobody's needle; he is not worth a line in the plan. */
const MEANINGFUL_VALUE = 1000

type Priced = RebuildPlayer & { value: number; position: string }

function priced(players: readonly RebuildPlayer[]): Priced[] {
  return players.flatMap((p) => {
    const position = (p.position ?? '').trim().toUpperCase()
    return typeof p.value === 'number' && Number.isFinite(p.value) && position ? [{ ...p, value: p.value, position }] : []
  })
}

function playerAsset(p: Priced): PartnerAsset {
  return { id: p.id, name: p.name, position: p.position, value: p.value, kind: 'player' }
}

function pickAsset(p: RebuildPick & { value: number }): PartnerAsset {
  return { id: p.pickId, name: p.label, position: 'PICK', value: p.value, kind: 'pick' }
}

const pct = (ratio: number | null | undefined, rising: boolean) =>
  typeof ratio === 'number' && ratio > 0 ? Math.round(Math.abs(rising ? ratio - 1 : 1 - ratio) * 100) : null

function starterIds(players: readonly Priced[], slots: readonly string[]): Set<string> {
  return new Set(
    fillLineup(
      players.map((p) => ({ playerId: p.id, position: p.position, projectedPoints: p.value })),
      slots,
      ELIGIBILITY,
    ).starterIds,
  )
}

const inRace = (posture: Posture | null) => posture === 'contending' || posture === 'bubble'

function apart(a: number, b: number): number {
  const hi = Math.max(a, b)
  return hi <= 0 ? 1 : Math.abs(a - b) / hi
}

/**
 * The fairest 1–2 assets from `pool` against `value`, within the band; null when none is fair.
 * One asset is preferred over two at the same closeness — a simpler deal is an easier yes.
 */
function fairMatch(value: number, pool: readonly PartnerAsset[]): { get: PartnerAsset[]; percentApart: number } | null {
  let best: { get: PartnerAsset[]; percentApart: number } | null = null
  const consider = (get: PartnerAsset[]) => {
    const gap = apart(value, get.reduce((t, a) => t + a.value, 0))
    if (gap > FAIR_BAND) return
    if (!best || gap < best.percentApart - 1e-9 || (Math.abs(gap - best.percentApart) < 1e-9 && get.length < best.get.length)) {
      best = { get, percentApart: gap }
    }
  }
  for (let i = 0; i < pool.length; i++) {
    consider([pool[i]!])
    for (let j = i + 1; j < pool.length; j++) consider([pool[i]!, pool[j]!])
  }
  return best
}

export function buildRebuildPlan(args: {
  viewerRosterId: string
  rosters: readonly RebuildRoster[]
  /** `League.starters` as stored. Unreadable ⇒ buyers are not checked for need, and the plan says so. */
  starterSlots: unknown
  trigger: RebuildTrigger
  basis: string
}): RebuildPlan {
  const gaps: string[] = []
  const plan: RebuildPlan = { trigger: args.trigger, basis: args.basis, sell: [], hold: [], targets: [], packages: [], gaps }
  const viewer = args.rosters.find((r) => r.rosterId === args.viewerRosterId)
  if (!viewer) {
    gaps.push('Your team could not be identified in this league.')
    return plan
  }

  const slots = readStarterSlots(args.starterSlots)
  const lineupKnown = slots.length > 0
  if (!lineupKnown) gaps.push("This league's starting lineup is not on file, so buyers were not checked for need.")

  const mine = priced(viewer.players)
  const unpriced = viewer.players.length - mine.length
  if (unpriced > 0) gaps.push(`${unpriced} of your players ${unpriced === 1 ? 'has' : 'have'} no market value and ${unpriced === 1 ? 'was' : 'were'} left out.`)
  const noLean = mine.filter((p) => p.lean == null && p.value >= MEANINGFUL_VALUE).length
  if (noLean > 0) {
    gaps.push(`${noLean} of your players ${noLean === 1 ? 'has' : 'have'} no dynasty-versus-redraft read, so the plan makes no sell or hold call on ${noLean === 1 ? 'him' : 'them'}.`)
  }

  /* ── Who is in the race, and what each would start ─────────────────────────────────────────── */
  const others = args.rosters.filter((r) => r.rosterId !== viewer.rosterId)
  const contenders = others.filter((r) => inRace(r.posture))
  if (contenders.length === 0) gaps.push('No other team could be placed in the playoff race, so there is nobody to sell to yet.')
  const theirs = new Map(contenders.map((r) => {
    const players = priced(r.players)
    return [r.rosterId, { roster: r, players, starters: lineupKnown ? starterIds(players, slots) : new Set<string>() }] as const
  }))

  /** Would `p` start for this team, and whom would he push out? */
  const fitFor = (p: Priced, rosterId: string): { displaced: Priced | null; gain: number } | null => {
    const t = theirs.get(rosterId)
    if (!t) return null
    if (!lineupKnown) return { displaced: null, gain: 0 }
    const after = starterIds([...t.players, p], slots)
    if (!after.has(p.id)) return null
    const displaced = t.players.find((x) => t.starters.has(x.id) && !after.has(x.id)) ?? null
    return { displaced, gain: p.value - (displaced?.value ?? 0) }
  }

  /* ── Sell ──────────────────────────────────────────────────────────────────────────────────── */
  const sellable = mine
    .filter((p) => p.lean === 'declining' && p.value >= MEANINGFUL_VALUE)
    .sort((a, b) => b.value - a.value)
    .slice(0, MAX_SELL)
  for (const p of sellable) {
    const lower = pct(p.leanRatio, false)
    const buyers = contenders
      .map((r) => ({ r, fit: fitFor(p, r.rosterId) }))
      .filter((x): x is { r: RebuildRoster; fit: { displaced: Priced | null; gain: number } } => x.fit != null)
      .sort((a, b) => b.fit.gain - a.fit.gain)
      .slice(0, MAX_BUYERS)
      .map(({ r, fit }) => ({
        rosterId: r.rosterId,
        ownerName: r.ownerName,
        why: fit.displaced
          ? `In the race, and he would start over ${fit.displaced.name}.`
          : lineupKnown
            ? 'In the race, and he would fill an empty starting spot.'
            : 'In the race.',
      }))
    plan.sell.push({
      asset: playerAsset(p),
      why: `${lower != null ? `The market prices him ${lower}% lower in dynasty than in redraft` : 'The market prices him lower in dynasty than in redraft'}: this season is likely near his peak, so his trade value is highest now.`,
      buyers,
    })
  }

  /* ── Hold ──────────────────────────────────────────────────────────────────────────────────── */
  for (const p of mine.filter((x) => x.lean === 'rising' && x.value >= MEANINGFUL_VALUE).sort((a, b) => b.value - a.value).slice(0, MAX_HOLD)) {
    const higher = pct(p.leanRatio, true)
    plan.hold.push({
      asset: playerAsset(p),
      why: `${higher != null ? `Priced ${higher}% higher in dynasty than in redraft` : 'Priced higher in dynasty than in redraft'}: his value is still climbing, so trading him now sells low.`,
    })
  }
  const ownPicks = viewer.picks
    .filter((p): p is RebuildPick & { value: number } => typeof p.value === 'number' && (p.originalRosterId == null || p.originalRosterId === viewer.rosterId))
    .sort((a, b) => b.value - a.value)
    .slice(0, 2)
  for (const p of ownPicks) {
    plan.hold.push({ asset: pickAsset(p), why: 'Your own pick. A rebuilding team picks early, so it is worth more to you than the market price suggests.' })
  }

  /* ── Targets: what contenders give up for help now ─────────────────────────────────────────── */
  const targetPool = new Map<string, PartnerAsset[]>()
  for (const [rosterId, t] of theirs) {
    const pool: PartnerAsset[] = []
    for (const pk of t.roster.picks) {
      if (typeof pk.value !== 'number') continue
      const asset = pickAsset(pk as RebuildPick & { value: number })
      pool.push(asset)
      const own = pk.originalRosterId == null || pk.originalRosterId === rosterId
      plan.targets.push({
        asset,
        rosterId,
        ownerName: t.roster.ownerName,
        why: own
          ? 'A contender’s own pick. It will likely land late in the round, so value it below a pick from a weak team.'
          : 'A contender holds it, but it was another team’s pick, so where it lands depends on that team.',
      })
    }
    for (const p of t.players) {
      if (p.lean !== 'rising' || t.starters.has(p.id) || p.value < MEANINGFUL_VALUE) continue
      const asset = playerAsset(p)
      pool.push(asset)
      const higher = pct(p.leanRatio, true)
      plan.targets.push({
        asset,
        rosterId,
        ownerName: t.roster.ownerName,
        why: `${higher != null ? `Priced ${higher}% higher in dynasty` : 'Priced higher in dynasty'}, and he does not start for them. A contender trades future value like this for help now.`,
      })
    }
    targetPool.set(rosterId, pool.sort((a, b) => b.value - a.value))
  }
  plan.targets.sort((a, b) => b.asset.value - a.asset.value)
  plan.targets = plan.targets.slice(0, MAX_TARGETS)

  /* ── Packages: one fair opening per buyer ──────────────────────────────────────────────────── */
  const usedBuyers = new Set<string>()
  for (const s of plan.sell) {
    if (plan.packages.length >= MAX_PACKAGES) break
    for (const b of s.buyers) {
      if (usedBuyers.has(b.rosterId)) continue
      const match = fairMatch(s.asset.value, targetPool.get(b.rosterId) ?? [])
      if (!match) continue
      usedBuyers.add(b.rosterId)
      plan.packages.push({
        rosterId: b.rosterId,
        ownerName: b.ownerName,
        give: [s.asset],
        get: match.get,
        percentApart: match.percentApart,
        why: `${s.asset.name} helps them win now; ${match.get.map((a) => a.name).join(' and ')} ${match.get.length === 1 ? 'helps' : 'help'} you next year.`,
      })
      break
    }
  }
  if (plan.sell.length > 0 && plan.packages.length === 0 && contenders.length > 0) {
    gaps.push('No contender holds assets that make a fair trade for your sell candidates right now.')
  }

  return plan
}
