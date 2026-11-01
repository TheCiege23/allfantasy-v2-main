/**
 * Exile Island and the side games — the pure rules (no I/O; unit-tested in
 * __tests__/survivor-side-game-rules.test.ts). The DB half is survivorSideGameService.ts.
 *
 * Every decision a side game makes lives here so the server, the commissioner override and Chimmy
 * cannot disagree: who won a game from our stored finals, what a Token Pool pick pays or costs, whether
 * a Survivor Pool pick is allowed this week, who wins an auction item or an Exile team, and what Chimmy
 * picks or bids for a seat it runs.
 */

import { fromZonedTime } from 'date-fns-tz'
import { SURVIVOR_GOVERNANCE_DAYS, type SurvivorGovernanceDay } from './survivorGovernanceSettings'
import { SURVIVOR_REWARD_LIMITS } from './survivorRewardModel'
import type {
  ExileTokenFaabBasis,
  SurvivorPoolConference,
  SurvivorPoolRule,
  TokenPoolMode,
  TokenPoolWrongPick,
  TokenShopItem,
} from './survivorSideGameSettings'

// ── Teams ──────────────────────────────────────────────────────────────────────────────────────

/** NFL teams: abbreviation → conference and the names feeds spell them with. Facts, not provider data. */
const NFL_TEAMS: Record<string, { conference: SurvivorPoolConference; names: string[] }> = {
  BUF: { conference: 'AFC', names: ['Buffalo Bills'] },
  MIA: { conference: 'AFC', names: ['Miami Dolphins'] },
  NE: { conference: 'AFC', names: ['New England Patriots'] },
  NYJ: { conference: 'AFC', names: ['New York Jets'] },
  BAL: { conference: 'AFC', names: ['Baltimore Ravens'] },
  CIN: { conference: 'AFC', names: ['Cincinnati Bengals'] },
  CLE: { conference: 'AFC', names: ['Cleveland Browns'] },
  PIT: { conference: 'AFC', names: ['Pittsburgh Steelers'] },
  HOU: { conference: 'AFC', names: ['Houston Texans'] },
  IND: { conference: 'AFC', names: ['Indianapolis Colts'] },
  JAX: { conference: 'AFC', names: ['Jacksonville Jaguars'] },
  TEN: { conference: 'AFC', names: ['Tennessee Titans'] },
  DEN: { conference: 'AFC', names: ['Denver Broncos'] },
  KC: { conference: 'AFC', names: ['Kansas City Chiefs'] },
  LV: { conference: 'AFC', names: ['Las Vegas Raiders', 'Oakland Raiders'] },
  LAC: { conference: 'AFC', names: ['Los Angeles Chargers', 'San Diego Chargers'] },
  DAL: { conference: 'NFC', names: ['Dallas Cowboys'] },
  NYG: { conference: 'NFC', names: ['New York Giants'] },
  PHI: { conference: 'NFC', names: ['Philadelphia Eagles'] },
  WAS: { conference: 'NFC', names: ['Washington Commanders', 'Washington Football Team', 'Washington Redskins'] },
  CHI: { conference: 'NFC', names: ['Chicago Bears'] },
  DET: { conference: 'NFC', names: ['Detroit Lions'] },
  GB: { conference: 'NFC', names: ['Green Bay Packers'] },
  MIN: { conference: 'NFC', names: ['Minnesota Vikings'] },
  ATL: { conference: 'NFC', names: ['Atlanta Falcons'] },
  CAR: { conference: 'NFC', names: ['Carolina Panthers'] },
  NO: { conference: 'NFC', names: ['New Orleans Saints'] },
  TB: { conference: 'NFC', names: ['Tampa Bay Buccaneers'] },
  ARI: { conference: 'NFC', names: ['Arizona Cardinals'] },
  LAR: { conference: 'NFC', names: ['Los Angeles Rams', 'St. Louis Rams', 'St Louis Rams'] },
  SF: { conference: 'NFC', names: ['San Francisco 49ers'] },
  SEA: { conference: 'NFC', names: ['Seattle Seahawks'] },
}

const NFL_ALIASES: Record<string, string> = {
  JAC: 'JAX', WSH: 'WAS', WFT: 'WAS', LA: 'LAR', STL: 'LAR', SD: 'LAC', OAK: 'LV', LVR: 'LV',
  ARZ: 'ARI', KCC: 'KC', TBB: 'TB', NOR: 'NO', GBP: 'GB', SFO: 'SF', NEP: 'NE',
}

const NFL_BY_NAME = new Map<string, string>()
for (const [abbr, team] of Object.entries(NFL_TEAMS)) for (const name of team.names) NFL_BY_NAME.set(simplify(name), abbr)

function simplify(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9 ]+/g, ' ').trim().replace(/\s+/g, ' ').toUpperCase()
}

/**
 * The one key a team is compared on in every side game: an NFL team's abbreviation (full names and
 * old spellings fold onto it), any other sport's simplified name. Empty for nothing.
 */
export function sideGameTeamKey(sport: string, team: string | null | undefined): string {
  const raw = String(team ?? '').trim()
  if (!raw) return ''
  if (String(sport).toUpperCase() !== 'NFL') return simplify(raw)
  const upper = raw.toUpperCase()
  if (NFL_TEAMS[upper]) return upper
  if (NFL_ALIASES[upper]) return NFL_ALIASES[upper]
  return NFL_BY_NAME.get(simplify(raw)) ?? simplify(raw)
}

export function nflConference(teamKey: string): SurvivorPoolConference | null {
  return NFL_TEAMS[teamKey]?.conference ?? null
}

// ── Games ──────────────────────────────────────────────────────────────────────────────────────

export interface SideGameGame {
  /** `${awayKey}@${homeKey}` — stable across feeds, so a pick survives a re-sync from another source. */
  key: string
  homeTeam: string
  awayTeam: string
  homeKey: string
  awayKey: string
  startTime: Date | null
  final: boolean
  homeScore: number | null
  awayScore: number | null
  /** Sources disagreed on the final score: the game cannot settle on its own. */
  conflicting?: boolean
}

export interface SideGameRawGame {
  homeTeam: string
  awayTeam: string
  startTime: Date | null
  /** Already canonical: `normalizeGameStatus(row.status) === 'final'`. */
  final: boolean
  homeScore: number | null
  awayScore: number | null
}

export function sideGameKey(homeKey: string, awayKey: string): string {
  return `${awayKey}@${homeKey}`
}

/**
 * Fold `SportsGame` rows (several feeds per real game) into one game each. A final needs BOTH halves
 * of the score; two finals that disagree mark the game `conflicting` so nothing settles on a guess.
 */
export function foldSideGameRows(sport: string, rows: readonly SideGameRawGame[]): SideGameGame[] {
  const byKey = new Map<string, SideGameGame>()
  for (const row of rows) {
    const homeKey = sideGameTeamKey(sport, row.homeTeam)
    const awayKey = sideGameTeamKey(sport, row.awayTeam)
    if (!homeKey || !awayKey || homeKey === awayKey) continue
    const key = sideGameKey(homeKey, awayKey)
    const scored = row.final && Number.isFinite(row.homeScore) && Number.isFinite(row.awayScore)
    const existing = byKey.get(key)
    if (!existing) {
      byKey.set(key, {
        key, homeTeam: row.homeTeam, awayTeam: row.awayTeam, homeKey, awayKey,
        startTime: row.startTime, final: scored, homeScore: scored ? row.homeScore : null, awayScore: scored ? row.awayScore : null,
      })
      continue
    }
    if (row.startTime && (!existing.startTime || row.startTime < existing.startTime)) existing.startTime = row.startTime
    if (!scored) continue
    if (!existing.final) {
      existing.final = true
      existing.homeScore = row.homeScore
      existing.awayScore = row.awayScore
    } else if (existing.homeScore !== row.homeScore || existing.awayScore !== row.awayScore) {
      existing.conflicting = true
    }
  }
  return [...byKey.values()].sort((a, b) => (a.startTime?.getTime() ?? 0) - (b.startTime?.getTime() ?? 0) || a.key.localeCompare(b.key))
}

/** The winning team key, 'tie', or null while the game is not final (or its feeds disagree). */
export function sideGameWinnerKey(game: SideGameGame): string | 'tie' | null {
  if (!game.final || game.conflicting || game.homeScore == null || game.awayScore == null) return null
  if (game.homeScore === game.awayScore) return 'tie'
  return game.homeScore > game.awayScore ? game.homeKey : game.awayKey
}

/** A pick on a game is open until that game kicks off. A game with no start time cannot be picked. */
export function sideGamePickOpen(game: SideGameGame, now: Date): boolean {
  return Boolean(game.startTime) && game.startTime!.getTime() > now.getTime() && !game.final
}

export type PickOutcome = 'correct' | 'wrong' | 'push'

/** A pick against a settled winner (an override from the commissioner, or the stored final). */
export function pickOutcome(pickTeamKey: string, winner: string | 'tie'): PickOutcome {
  if (winner === 'tie') return 'push'
  return pickTeamKey === winner ? 'correct' : 'wrong'
}

// ── Token Pool ─────────────────────────────────────────────────────────────────────────────────

export interface TokenPoolSettlement {
  /** Change to the exile's token balance (never takes it below 0). */
  balanceDelta: number
  /** The unbanked streak pot after this pick (streak mode only; per_pick stays 0). */
  potAfter: number
  /** Every token was lost to this pick. */
  lostAll: boolean
}

/**
 * One settled Token Pool pick.
 *  per_pick: correct +1; wrong costs nothing (`keep`), one token (`minus_one`) or every token (`lose_all`).
 *  streak:   correct adds 1 to an unbanked pot; wrong loses the pot, plus one token (`minus_one`) or
 *            every banked token too (`lose_all`). The exile banks the pot whenever they like (cash out).
 * A tied game is a push: nothing moves.
 */
export function settleTokenPoolPick(args: {
  mode: TokenPoolMode
  wrongPick: TokenPoolWrongPick
  outcome: PickOutcome
  balance: number
  pot: number
}): TokenPoolSettlement {
  const balance = Math.max(0, Math.floor(args.balance))
  const pot = args.mode === 'streak' ? Math.max(0, Math.floor(args.pot)) : 0
  if (args.outcome === 'push') return { balanceDelta: 0, potAfter: pot, lostAll: false }
  if (args.outcome === 'correct') {
    return args.mode === 'streak' ? { balanceDelta: 0, potAfter: pot + 1, lostAll: false } : { balanceDelta: 1, potAfter: 0, lostAll: false }
  }
  const delta = args.wrongPick === 'lose_all' ? -balance : args.wrongPick === 'minus_one' ? -Math.min(1, balance) : 0
  return { balanceDelta: delta || 0, potAfter: 0, lostAll: args.wrongPick === 'lose_all' && (balance > 0 || pot > 0) }
}

// ── Survivor Pool ──────────────────────────────────────────────────────────────────────────────

export type PoolPickRefusal = 'not_in_conference' | 'not_away' | 'not_allowed' | 'not_in_game' | 'conference_unknown'

/** Is picking `teamKey` in `game` allowed under this week's pool rule? Null when it is. */
export function poolPickRefusal(
  sport: string,
  rule: { rule: SurvivorPoolRule; conference: SurvivorPoolConference; allowedTeams: readonly string[] },
  game: Pick<SideGameGame, 'homeKey' | 'awayKey'>,
  teamKey: string,
): PoolPickRefusal | null {
  if (teamKey !== game.homeKey && teamKey !== game.awayKey) return 'not_in_game'
  switch (rule.rule) {
    case 'any':
      return null
    case 'away_only':
      return teamKey === game.awayKey ? null : 'not_away'
    case 'conference': {
      if (String(sport).toUpperCase() !== 'NFL') return 'conference_unknown'
      const conf = nflConference(teamKey)
      if (!conf) return 'conference_unknown'
      return conf === rule.conference ? null : 'not_in_conference'
    }
    case 'allowed_list':
      return rule.allowedTeams.some((t) => sideGameTeamKey(sport, t) === teamKey) ? null : 'not_allowed'
  }
}

/** A Survivor Pool entry, folded from the ledger. */
export interface PoolEntryState {
  alive: boolean
  revivesUsed: number
  /** Extra revives the commissioner granted on top of the league allowance. */
  revivesGranted: number
  eliminatedWeek: number | null
  wins: number
}

export const EMPTY_POOL_ENTRY: PoolEntryState = { alive: true, revivesUsed: 0, revivesGranted: 0, eliminatedWeek: null, wins: 0 }

export function poolRevivesLeft(entry: PoolEntryState, allowance: number): number {
  return Math.max(0, allowance + entry.revivesGranted - entry.revivesUsed)
}

/** Out of the pool and out of revives: banned for the rest of the season. */
export function poolBanned(entry: PoolEntryState, allowance: number): boolean {
  return !entry.alive && poolRevivesLeft(entry, allowance) === 0
}

/** A settled pool pick. Correct: a win (the prize is paid). Wrong: out until a revive. Push: nothing. */
export function applyPoolOutcome(entry: PoolEntryState, outcome: PickOutcome, week: number): PoolEntryState {
  if (!entry.alive) return entry
  if (outcome === 'correct') return { ...entry, wins: entry.wins + 1 }
  if (outcome === 'wrong') return { ...entry, alive: false, eliminatedWeek: week }
  return entry
}

export function revivePoolEntry(entry: PoolEntryState, allowance: number): PoolEntryState | null {
  if (entry.alive || poolRevivesLeft(entry, allowance) === 0) return null
  return { ...entry, alive: true, revivesUsed: entry.revivesUsed + 1, eliminatedWeek: null }
}

// ── Auctions ───────────────────────────────────────────────────────────────────────────────────

export interface AuctionBid {
  itemId: string
  rosterId: string
  amount: number
  /** ISO time the bid was placed — the tie-break: the earlier bid wins. */
  at: string
}

export interface AuctionAward {
  itemId: string
  rosterId: string
  amount: number
}

/**
 * Settle a whole auction. Items settle in the order given; each goes to the highest bid, a tie to
 * the EARLIER bid, skipping a bidder who can no longer afford it after what they already won here.
 * An item with no affordable bid goes unsold.
 */
export function resolveAuction(itemIds: readonly string[], bids: readonly AuctionBid[], balances: ReadonlyMap<string, number>): AuctionAward[] {
  const spent = new Map<string, number>()
  const awards: AuctionAward[] = []
  for (const itemId of itemIds) {
    const ranked = bids
      .filter((b) => b.itemId === itemId && b.amount > 0)
      .sort((a, b) => b.amount - a.amount || a.at.localeCompare(b.at) || a.rosterId.localeCompare(b.rosterId))
    for (const bid of ranked) {
      const left = (balances.get(bid.rosterId) ?? 0) - (spent.get(bid.rosterId) ?? 0)
      if (bid.amount > left) continue
      spent.set(bid.rosterId, (spent.get(bid.rosterId) ?? 0) + bid.amount)
      awards.push({ itemId, rosterId: bid.rosterId, amount: bid.amount })
      break
    }
  }
  return awards
}

/** The standing high bid on an item (open auctions show it; sealed ones never do). */
export function highBid(itemId: string, bids: readonly AuctionBid[]): AuctionBid | null {
  return [...bids].filter((b) => b.itemId === itemId).sort((a, b) => b.amount - a.amount || a.at.localeCompare(b.at))[0] ?? null
}

export type BidRefusal = 'too_low' | 'over_balance' | 'locked' | 'not_whole'

/**
 * May this bid stand? Sealed: one bid per item, and it locks. Open: it must beat the high bid by at
 * least 1, and a bidder may raise their own. Never more than the bidder holds.
 */
export function bidRefusal(args: { mode: 'sealed' | 'open'; amount: number; balance: number; mine: AuctionBid | null; high: AuctionBid | null }): BidRefusal | null {
  if (!Number.isInteger(args.amount) || args.amount < 1) return 'not_whole'
  if (args.amount > args.balance) return 'over_balance'
  if (args.mode === 'sealed') return args.mine ? 'locked' : null
  if (args.high && args.amount <= args.high.amount) return 'too_low'
  return null
}

// ── Exile team bids ────────────────────────────────────────────────────────────────────────────

export interface ExileTeamBid {
  userId: string
  team: string
  amount: number
  at: string
}

/**
 * Sealed Exile team bids: every bid ranked by amount, then the EARLIER bid; a team goes to its best
 * bid whose bidder has not already won a team. Everyone else claims first-come once bidding closes.
 */
export function resolveExileTeamBids(sport: string, bids: readonly ExileTeamBid[]): Array<{ userId: string; team: string; amount: number }> {
  const ranked = [...bids].filter((b) => b.amount > 0).sort((a, b) => b.amount - a.amount || a.at.localeCompare(b.at) || a.userId.localeCompare(b.userId))
  const teams = new Set<string>()
  const users = new Set<string>()
  const out: Array<{ userId: string; team: string; amount: number }> = []
  for (const bid of ranked) {
    const key = sideGameTeamKey(sport, bid.team)
    if (!key || teams.has(key) || users.has(bid.userId)) continue
    teams.add(key)
    users.add(bid.userId)
    out.push({ userId: bid.userId, team: bid.team.trim().toUpperCase(), amount: bid.amount })
  }
  return out
}

/** The first Eastern `day` at `HH:MM` at or after `after` — an Exile period's bid close. */
export function easternDayTimeOnOrAfter(after: Date, day: SurvivorGovernanceDay, hhmm: string): Date {
  const target = SURVIVOR_GOVERNANCE_DAYS.indexOf(day)
  const base = new Date(after.getTime())
  for (let i = 0; i < 8; i++) {
    const probe = new Date(base.getTime() + i * 86_400_000)
    const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(probe)
    const weekday = new Date(`${ymd}T12:00:00Z`).getUTCDay()
    if (weekday !== target) continue
    const at = fromZonedTime(`${ymd}T${hhmm}:00`, 'America/New_York')
    if (at.getTime() >= after.getTime()) return at
  }
  return fromZonedTime(`${new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(after)}T${hhmm}:00`, 'America/New_York')
}

// ── Exile return FAAB ──────────────────────────────────────────────────────────────────────────

/** FAAB a returning castaway receives for their tokens. 0 when the commissioner left the rate at 0. */
export function exileReturnFaab(args: { rate: number; basis: ExileTokenFaabBasis; held: number; required: number }): number {
  if (!(args.rate > 0)) return 0
  const held = Math.max(0, Math.floor(args.held))
  const tokens = args.basis === 'leftover' ? Math.max(0, held - Math.max(0, args.required)) : held
  return tokens * Math.floor(args.rate)
}

/** One reward pays at most SURVIVOR_REWARD_LIMITS.faab; a larger total pays in several stable chunks. */
export function chunkFaab(total: number, max: number = SURVIVOR_REWARD_LIMITS.faab): number[] {
  const out: number[] = []
  let left = Math.max(0, Math.floor(total))
  while (left > 0) {
    const part = Math.min(max, left)
    out.push(part)
    left -= part
  }
  return out
}

// ── Exile lineup ───────────────────────────────────────────────────────────────────────────────

/** Starter capacities for the commissioner's Exile slots (QB RB WR TE FLX → one each). */
export function exileSlotCapacities(slots: readonly string[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const s of slots) out.set(s, (out.get(s) ?? 0) + 1)
  return out
}

// ── Token shop ─────────────────────────────────────────────────────────────────────────────────

export type ShopRefusal = 'shop_closed' | 'not_for_sale' | 'not_enough_tokens'

export function shopPurchaseRefusal(args: { shopEnabled: boolean; item: TokenShopItem | undefined; balance: number }): ShopRefusal | null {
  if (!args.shopEnabled) return 'shop_closed'
  if (!args.item || !args.item.enabled) return 'not_for_sale'
  if (args.balance < args.item.cost) return 'not_enough_tokens'
  return null
}

// ── Chimmy ─────────────────────────────────────────────────────────────────────────────────────

export interface TeamRecord {
  wins: number
  losses: number
}

/** Win share from stored finals, with one phantom win and loss so a 1-0 team is not "perfect". */
export function teamStrength(record: TeamRecord | undefined): number {
  const w = record?.wins ?? 0
  const l = record?.losses ?? 0
  return (w + 1) / (w + l + 2)
}

/** Season records from the final games we have stored (ties count for neither side). */
export function seasonRecords(games: readonly SideGameGame[]): Map<string, TeamRecord> {
  const out = new Map<string, TeamRecord>()
  const bump = (key: string, field: keyof TeamRecord) => {
    const r = out.get(key) ?? { wins: 0, losses: 0 }
    r[field] += 1
    out.set(key, r)
  }
  for (const g of games) {
    const winner = sideGameWinnerKey(g)
    if (!winner || winner === 'tie') continue
    bump(winner, 'wins')
    bump(winner === g.homeKey ? g.awayKey : g.homeKey, 'losses')
  }
  return out
}

/**
 * The stored-data favourite in a game: the better season record, then home field, then the key.
 * Deterministic, so a re-run makes the same pick.
 */
export function storedFavourite(game: Pick<SideGameGame, 'homeKey' | 'awayKey'>, records: ReadonlyMap<string, TeamRecord>): { teamKey: string; edge: number } {
  const home = teamStrength(records.get(game.homeKey)) + 0.02
  const away = teamStrength(records.get(game.awayKey))
  if (home === away) return { teamKey: game.homeKey < game.awayKey ? game.homeKey : game.awayKey, edge: 0 }
  return home > away ? { teamKey: game.homeKey, edge: home - away } : { teamKey: game.awayKey, edge: away - home }
}

/**
 * Chimmy's pick among the games still open: the biggest stored-data edge it is allowed to take
 * (the pool rule passes `allowed`). Null when nothing is open.
 */
export function chimmySideGamePick(
  games: readonly SideGameGame[],
  records: ReadonlyMap<string, TeamRecord>,
  now: Date,
  allowed: (game: SideGameGame, teamKey: string) => boolean = () => true,
): { gameKey: string; teamKey: string } | null {
  let best: { gameKey: string; teamKey: string; edge: number } | null = null
  for (const game of games) {
    if (!sideGamePickOpen(game, now)) continue
    const fav = storedFavourite(game, records)
    const options = [fav.teamKey, fav.teamKey === game.homeKey ? game.awayKey : game.homeKey]
    const teamKey = options.find((t) => allowed(game, t))
    if (!teamKey) continue
    const edge = teamKey === fav.teamKey ? fav.edge : -fav.edge
    if (!best || edge > best.edge || (edge === best.edge && game.key < best.gameKey)) best = { gameKey: game.key, teamKey, edge }
  }
  return best ? { gameKey: best.gameKey, teamKey: best.teamKey } : null
}

/** Chimmy banks a streak pot of this size rather than risk it. */
export const CHIMMY_TOKEN_POOL_CASH_OUT_AT = 2

/** The most of its balance Chimmy will put on one auction item. */
export const CHIMMY_AUCTION_MAX_SHARE = 0.25

const PRIZE_PRIORITY: Record<string, number> = { advantage: 5, free_trade_token: 4, steal_blocker: 3, score_bonus: 2, faab: 1 }

/**
 * Chimmy's auction bid for a seat it runs: ONE item per auction — the most useful one it can see
 * (a blind item is never chosen) — for at most a quarter of its balance, and never zero. In an open
 * auction it bids one more than the high bid only while that stays under the cap; sealed, it bids the cap.
 */
export function chimmyAuctionBid(args: {
  mode: 'sealed' | 'open'
  balance: number
  items: ReadonlyArray<{ itemId: string; blind: boolean; prizeKind: string }>
  bids: readonly AuctionBid[]
  rosterId: string
}): { itemId: string; amount: number } | null {
  const cap = Math.floor(Math.max(0, args.balance) * CHIMMY_AUCTION_MAX_SHARE)
  if (cap < 1) return null
  const already = args.bids.find((b) => b.rosterId === args.rosterId)
  const ranked = args.items.filter((i) => !i.blind).sort((a, b) => (PRIZE_PRIORITY[b.prizeKind] ?? 0) - (PRIZE_PRIORITY[a.prizeKind] ?? 0) || a.itemId.localeCompare(b.itemId))
  const target = already ? args.items.find((i) => i.itemId === already.itemId) : ranked[0]
  if (!target) return null
  if (args.mode === 'sealed') return already ? null : { itemId: target.itemId, amount: cap }
  const high = highBid(target.itemId, args.bids)
  if (high?.rosterId === args.rosterId) return null
  const amount = (high?.amount ?? 0) + 1
  return amount <= cap ? { itemId: target.itemId, amount } : null
}
