/**
 * CHIMMY AUTOPILOT — SENDING A TRADE OFFER (docs/chimmy-manager/IN_SEASON_MANAGER_PLAN.md, phase 4).
 *
 * Which offer, if any, a Chimmy team makes. Pure: it is handed its own players and the other teams'
 * BENCH players, already priced on one scale, and returns one one-for-one swap or nothing.
 *
 * The offer is always a modest shape, so it reads as a sensible ask rather than a raid:
 *   - Chimmy asks for ONE player who would be a clear upgrade on its weakest starter at that position
 *     (`UPGRADE_MARGIN`): a bench player, or any player the other manager has put on the TRADE BLOCK —
 *     a manager who lists a starter has said he would move him, so asking is not a raid.
 *   - It gives its own BENCH players only, never a starter, so it cannot open a hole in its lineup.
 *   - One for one where it can: what Chimmy gives is worth at least `FAIR_FLOOR` of what it asks for,
 *     and Chimmy, weighing its own way, must not lose on it.
 *   - Two for one only when no single bench player is enough: two bench players whose combined value
 *     is at least the player's and at most `TWO_FOR_ONE_PREMIUM` over it. Chimmy pays a little extra
 *     in total for the better single player; the other team gets depth.
 * Among every offer that fits, it takes the biggest upgrade, with a player on the trade block counting
 * for `BLOCK_BONUS` more — he is the one most likely to be said yes to — and more again when the
 * listing asks for a position Chimmy is giving. A manager who has said, where the league can see it,
 * that he is interested in one of Chimmy's bench players is offered THAT player where it is fair, and
 * the offer counts for `INTEREST_BONUS` more. Ties break on ids, so a run is repeatable.
 *
 * WHEN it may send (`sendsThisHour`) is decided here too, so the timing is testable without a clock:
 * each team has its own hour of the day, fixed by its roster id, and acts once in that hour — a league
 * never sees every Chimmy team send at the same moment.
 */
import { positionBiasFor, type ManagerProfile } from './managerProfile'

/** The player asked for must beat the starter he would replace by at least this share. */
export const UPGRADE_MARGIN = 0.1
/** What Chimmy gives is worth at least this share of what it asks for, on plain value. */
export const FAIR_FLOOR = 0.9

export type PricedPlayer = { playerId: string; playerName: string | null; position: string | null; value: number }
/** Two-for-one: the pair may be worth up to this much more than the one player, in total. */
export const TWO_FOR_ONE_PREMIUM = 0.2
/** A trade-block player's upgrade counts this much more when ranking offers. */
export const BLOCK_BONUS = 1.25
/** …and this much more again when his listing asks for a position Chimmy is giving. */
export const BLOCK_ASK_BONUS = 1.1

/** An offer that gives a manager a player he has shown interest in counts this much more. */
export const INTEREST_BONUS = 1.15

export type BlockPlayer = PricedPlayer & { askingForPositions?: ReadonlyArray<string> }
export type OtherTeam = {
  rosterId: string
  bench: ReadonlyArray<PricedPlayer>
  /** Players this team's manager has listed on the trade block (starters included), priced. */
  block?: ReadonlyArray<BlockPlayer>
  /** Chimmy's players this team's manager has a league-visible interest in. Private interest is never used. */
  wants?: ReadonlyArray<string>
}

export type TradeOfferPlan = {
  toRosterId: string
  /** One bench player, or two when no single one is enough. */
  give: PricedPlayer[]
  get: PricedPlayer
  /** The player asked for is on the other team's trade block. */
  onBlock: boolean
  /** The offer gives the other manager a player he has shown interest in. */
  wanted: boolean
  /** The starter the incoming player would replace. */
  replaces: PricedPlayer
  reason: string
}

const pos = (p: PricedPlayer) => String(p.position ?? '').toUpperCase()
const usable = (p: PricedPlayer) => Boolean(p.playerId) && Number.isFinite(p.value) && p.value > 0 && pos(p) !== ''
const weighed = (p: PricedPlayer, profile: Pick<ManagerProfile, 'positionBias'>) => p.value * Math.max(0, 1 + positionBiasFor(profile, p.position))

export function planTradeOffer(args: {
  profile: ManagerProfile
  starters: ReadonlyArray<PricedPlayer>
  bench: ReadonlyArray<PricedPlayer>
  others: ReadonlyArray<OtherTeam>
}): TradeOfferPlan | null {
  const { profile } = args
  const mine = new Set([...args.starters, ...args.bench].map((p) => p.playerId))
  // The weakest starter at each position: the spot an incoming player would take.
  const weakest = new Map<string, PricedPlayer>()
  for (const s of args.starters.filter(usable)) {
    const cur = weakest.get(pos(s))
    if (!cur || s.value < cur.value) weakest.set(pos(s), s)
  }
  const giveable = args.bench.filter(usable)
  if (weakest.size === 0 || giveable.length === 0) return null

  /** The cheapest fair way to pay for `get`: one bench player if any is enough, else two. */
  const payFor = (get: PricedPlayer, wants: ReadonlySet<string>): PricedPlayer[] | null => {
    const one = giveable
      .filter((g) => g.value >= get.value * FAIR_FLOOR && g.value <= get.value && weighed(get, profile) >= weighed(g, profile))
      // A player this manager asked about first; then give up as little as the deal allows.
      .sort((x, y) => Number(wants.has(y.playerId)) - Number(wants.has(x.playerId)) || x.value - y.value || x.playerId.localeCompare(y.playerId))[0]
    if (one) return [one]
    let pair: { players: PricedPlayer[]; sum: number } | null = null
    for (let i = 0; i < giveable.length; i += 1) {
      for (let j = i + 1; j < giveable.length; j += 1) {
        const x = giveable[i]!
        const y = giveable[j]!
        const sum = x.value + y.value
        // Each is worth less than the player asked for (or one-for-one would have done it).
        if (x.value >= get.value || y.value >= get.value) continue
        if (sum < get.value || sum > get.value * (1 + TWO_FOR_ONE_PREMIUM)) continue
        if (weighed(get, profile) * (1 + TWO_FOR_ONE_PREMIUM) < weighed(x, profile) + weighed(y, profile)) continue
        const key = [x.playerId, y.playerId].sort().join(':')
        if (!pair || sum < pair.sum || (sum === pair.sum && key < pair.players.map((p) => p.playerId).sort().join(':'))) {
          pair = { players: [x, y].sort((p, q) => q.value - p.value || p.playerId.localeCompare(q.playerId)), sum }
        }
      }
    }
    return pair?.players ?? null
  }

  let best: (TradeOfferPlan & { score: number }) | null = null
  for (const team of args.others) {
    const onBlock = new Map((team.block ?? []).filter(usable).map((p) => [p.playerId, p]))
    const wants = new Set(team.wants ?? [])
    const candidates = new Map<string, PricedPlayer>()
    for (const p of [...team.bench.filter(usable), ...onBlock.values()]) candidates.set(p.playerId, p)
    for (const get of candidates.values()) {
      if (mine.has(get.playerId)) continue
      const replaces = weakest.get(pos(get))
      if (!replaces || get.value < replaces.value * (1 + UPGRADE_MARGIN)) continue
      const give = payFor(get, wants)
      if (!give) continue
      const listing = onBlock.get(get.playerId)
      const asked = new Set((listing?.askingForPositions ?? []).map((x) => String(x).toUpperCase()))
      const wanted = give.find((g) => wants.has(g.playerId))
      const score = (get.value - replaces.value) * (listing ? BLOCK_BONUS : 1) * (listing && give.some((g) => asked.has(pos(g))) ? BLOCK_ASK_BONUS : 1) * (wanted ? INTEREST_BONUS : 1)
      const better = !best || score > best.score
        || (score === best.score && `${team.rosterId}:${get.playerId}` < `${best.toRosterId}:${best.get.playerId}`)
      if (better) {
        const getName = get.playerName?.trim() || 'your player'
        const giveNames = give.map((g) => g.playerName?.trim() || 'one of its players').join(' and ')
        const why = [
          wanted ? `you were interested in ${wanted.playerName?.trim() || 'one of them'}` : null,
          listing ? `you have him on the trade block` : null,
          `it needs help at ${pos(get)}`,
        ].filter(Boolean).join(', and ').replace(/, and (?=.*, and )/, ', ')
        best = { toRosterId: team.rosterId, give, get, replaces, onBlock: Boolean(listing), wanted: Boolean(wanted), score, reason: `Chimmy is offering ${giveNames} for ${getName}: ${why}.` }
      }
    }
  }
  if (!best) return null
  const { score: _s, ...plan } = best
  return plan
}

function hash(input: string): number {
  let h = 0
  for (let i = 0; i < input.length; i += 1) h = (h * 31 + input.charCodeAt(i)) >>> 0
  return h
}

/** The hour of the day (UTC, 0–23) this team sends offers in: fixed by its roster id. */
export function offerHourFor(rosterId: string): number {
  return hash(`chimmy-offer-hour:${rosterId}`) % 24
}

/** Whether this is the team's hour. The run is hourly, so this is true for one run a day. */
export function sendsThisHour(rosterId: string, now: Date): boolean {
  return now.getUTCHours() === offerHourFor(rosterId)
}

/**
 * The other teams to look at today, at most `limit`: a different slice each day, so over a week a team
 * shops the whole league without pricing every roster in one run.
 */
export function teamsToShopToday<T extends { rosterId: string }>(teams: ReadonlyArray<T>, rosterId: string, now: Date, limit: number): T[] {
  if (teams.length <= limit) return [...teams]
  const sorted = [...teams].sort((a, b) => a.rosterId.localeCompare(b.rosterId))
  const day = Math.floor(now.getTime() / 86_400_000)
  const start = (hash(rosterId) + day * limit) % sorted.length
  return Array.from({ length: limit }, (_, i) => sorted[(start + i) % sorted.length]!)
}
