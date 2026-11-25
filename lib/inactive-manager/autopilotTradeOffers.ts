/**
 * CHIMMY AUTOPILOT — SENDING A TRADE OFFER (docs/chimmy-manager/IN_SEASON_MANAGER_PLAN.md, phase 4).
 *
 * Which offer, if any, a Chimmy team makes. Pure: it is handed its own players and the other teams'
 * BENCH players, already priced on one scale, and returns one one-for-one swap or nothing.
 *
 * The offer is always the same modest shape, so it reads as a sensible ask rather than a raid:
 *   - Chimmy asks for ONE bench player, never a starter, who would be a clear upgrade on its weakest
 *     starter at that position (`UPGRADE_MARGIN`).
 *   - It gives ONE of its own bench players, never a starter, so it cannot open a hole in its lineup.
 *   - The swap is fair to the other side on plain value: what Chimmy gives is worth at least
 *     `FAIR_FLOOR` of what it asks for — and Chimmy, weighing its own way, must not lose on it.
 * Among every swap that fits, it takes the biggest upgrade. Ties break on ids, so a run is repeatable.
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
export type OtherTeam = { rosterId: string; bench: ReadonlyArray<PricedPlayer> }

export type TradeOfferPlan = {
  toRosterId: string
  give: PricedPlayer
  get: PricedPlayer
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

  let best: (TradeOfferPlan & { upgrade: number }) | null = null
  for (const team of args.others) {
    for (const get of team.bench.filter(usable)) {
      if (mine.has(get.playerId)) continue
      const replaces = weakest.get(pos(get))
      if (!replaces || get.value < replaces.value * (1 + UPGRADE_MARGIN)) continue
      const give = giveable
        .filter((g) => g.value >= get.value * FAIR_FLOOR && g.value <= get.value && weighed(get, profile) >= weighed(g, profile))
        // Give up as little as the deal allows.
        .sort((a, b) => a.value - b.value || a.playerId.localeCompare(b.playerId))[0]
      if (!give) continue
      const upgrade = get.value - replaces.value
      const better = !best || upgrade > best.upgrade
        || (upgrade === best.upgrade && `${team.rosterId}:${get.playerId}` < `${best.toRosterId}:${best.get.playerId}`)
      if (better) {
        const getName = get.playerName?.trim() || 'your player'
        const giveName = give.playerName?.trim() || 'one of its players'
        best = { toRosterId: team.rosterId, give, get, replaces, upgrade, reason: `Chimmy is offering ${giveName} for ${getName}: it needs help at ${pos(get)}.` }
      }
    }
  }
  if (!best) return null
  const { upgrade: _u, ...plan } = best
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
