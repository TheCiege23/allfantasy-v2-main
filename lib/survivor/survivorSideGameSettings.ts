/**
 * Exile Island and the side games — commissioner settings. Pure and client-safe (no I/O).
 *
 * Stored as ONE object under `League.settings.survivorSideGames`, so there is no column or table
 * migration, and the foundation settings (`exileIslandEnabled`, `exileReturnWeek`,
 * `exileReturnTokens`) stay exactly where they are.
 *
 * DEFAULTS KEEP EVERY EXISTING LEAGUE EXACTLY AS IT WAS:
 *  - tokens convert to 0 FAAB on return (native), the legacy path keeps its $5,
 *  - the Exile lineup copies the main league's slots, claims are instant first-come,
 *  - the Token Pool pays +1 per correct pick and costs nothing for a miss (the old "harsh" column
 *    still turns on −1), and stays open,
 *  - the token shop sells nothing, the Survivor Pool and auctions are off,
 *  - who is on Exile is not hidden.
 *
 * Times are US Eastern, like every other Survivor deadline.
 */

import { SURVIVOR_GOVERNANCE_DAYS, type SurvivorGovernanceDay } from './survivorGovernanceSettings'
import { SURVIVOR_REWARD_ADVANTAGE_POWERS, SURVIVOR_REWARD_LIMITS, type SurvivorRewardAdvantagePower } from './survivorRewardModel'

export const SURVIVOR_SIDE_GAMES_KEY = 'survivorSideGames'

export const EXILE_TOKEN_FAAB_BASES = ['all', 'leftover'] as const
export type ExileTokenFaabBasis = (typeof EXILE_TOKEN_FAAB_BASES)[number]

export const EXILE_CLAIM_MODES = ['first_come', 'faab_bid'] as const
export type ExileClaimMode = (typeof EXILE_CLAIM_MODES)[number]

export const TOKEN_POOL_MODES = ['per_pick', 'streak'] as const
export type TokenPoolMode = (typeof TOKEN_POOL_MODES)[number]

/** What a wrong Token Pool pick costs: nothing, one token, or every token held ("lose them all"). */
export const TOKEN_POOL_WRONG_PICK = ['keep', 'minus_one', 'lose_all'] as const
export type TokenPoolWrongPick = (typeof TOKEN_POOL_WRONG_PICK)[number]

/**
 * A prize a side game pays. Everything but `auction_cash` and `tokens` is a reward-API spec
 * (`applySurvivorReward`); those two are side-game balances.
 */
export const SIDE_GAME_PRIZE_KINDS = ['none', 'faab', 'score_bonus', 'advantage', 'free_trade_token', 'steal_blocker', 'auction_cash', 'tokens', 'opponent_penalty', 'vote_taken', 'forced_bench'] as const
export type SideGamePrizeKind = (typeof SIDE_GAME_PRIZE_KINDS)[number]

export interface SideGamePrize {
  kind: SideGamePrizeKind
  /** FAAB dollars, points, auction cash or tokens. Ignored for advantage / token / blocker. */
  amount: number
  powerType: SurvivorRewardAdvantagePower
  /** free_trade_token only. */
  samePositionOnly: boolean
}

/**
 * Disadvantage items: the winner (or buyer) hurts an opponent they choose, through the reward API's
 * choice flow (`chooseSurvivorRewardTarget`). `opponent_penalty`: `amount` points off the chosen
 * opponent's week. `vote_taken`: the chosen opponent's vote at their next Tribal Council does not
 * count. `forced_bench`: one of the chosen opponent's players cannot start that week (Survivor-only
 * lineup and score checks, lib/survivor/survivorForcedBench.ts). Each is OFF until the commissioner
 * enables it (`disadvantagesEnabled`).
 */
export const SIDE_GAME_DISADVANTAGE_KINDS = ['opponent_penalty', 'vote_taken', 'forced_bench'] as const
export type SideGameDisadvantageKind = (typeof SIDE_GAME_DISADVANTAGE_KINDS)[number]
export const isDisadvantageKind = (kind: string): kind is SideGameDisadvantageKind => (SIDE_GAME_DISADVANTAGE_KINDS as readonly string[]).includes(kind)

/** What the shop may sell. Each is delivered through the reward API. */
export const TOKEN_SHOP_KINDS = ['advantage', 'free_trade_token', 'steal_blocker', 'faab', 'score_bonus', 'opponent_penalty', 'vote_taken', 'forced_bench'] as const
export type TokenShopKind = (typeof TOKEN_SHOP_KINDS)[number]

export interface TokenShopItem {
  /** Stable id, a-z 0-9 _ (the purchase key uses it). */
  id: string
  kind: TokenShopKind
  enabled: boolean
  /** Price in tokens. */
  cost: number
  /** faab dollars / score points. */
  amount: number
  powerType: SurvivorRewardAdvantagePower
  samePositionOnly: boolean
}

export const SURVIVOR_POOL_RULES = ['any', 'conference', 'away_only', 'allowed_list', 'division'] as const
export type SurvivorPoolRule = (typeof SURVIVOR_POOL_RULES)[number]
/** The NFL's two conferences. Other sports name theirs from our stored `SportsTeam.conference`. */
export const SURVIVOR_POOL_CONFERENCES = ['AFC', 'NFC'] as const
/** A conference name: AFC / NFC, or any name our stored team data uses ("Eastern", "SEC"). */
export type SurvivorPoolConference = string

/** A tied game in the Survivor Pool: nothing happens (push, today), it knocks you out (loss), or it counts as a win. */
export const SURVIVOR_POOL_TIE_RULES = ['push', 'loss', 'win'] as const
export type SurvivorPoolTieRule = (typeof SURVIVOR_POOL_TIE_RULES)[number]
/** A week with no pick: nothing (today), it counts as a loss, or it uses a revive. */
export const SURVIVOR_POOL_MISSED_PICK = ['none', 'loss', 'revive'] as const
export type SurvivorPoolMissedPick = (typeof SURVIVOR_POOL_MISSED_PICK)[number]
/** The original league's "removed if exposed" rule, applied only by the commissioner from the Hub. */
export const EXILE_EXPOSURE_RULES = ['off', 'remove', 'strike'] as const
export type ExileExposureRule = (typeof EXILE_EXPOSURE_RULES)[number]

/** One week's variant ("away teams only", "red uniforms" = an allowed-team list). */
export interface SurvivorPoolWeekRule {
  week: number
  rule: SurvivorPoolRule
  conference?: SurvivorPoolConference
  allowedTeams?: string[]
  /** `division` weeks: the division name (from our stored team data; NFL divisions built in). */
  division?: string
}

export const AUCTION_CURRENCIES = ['faab', 'auction_cash'] as const
export type AuctionCurrency = (typeof AUCTION_CURRENCIES)[number]

export interface SurvivorSideGameSettings {
  // ── Exile return ────────────────────────────────────────────────────────────────
  /** FAAB per token paid to the castaway who returns. 0 = off (today's native behaviour). */
  exileTokenFaabRate: number
  /** `all`: every token held at the deadline converts; `leftover`: only those beyond the return cost. */
  exileTokenFaabBasis: ExileTokenFaabBasis
  // ── Exile lineup ────────────────────────────────────────────────────────────────
  /** The Exile starting slots, e.g. QB RB WR TE FLX. Empty: copy the main league's slots (today). */
  exileLineupSlots: string[]
  /** Bench slots on Exile when the slots above are set. */
  exileBenchSlots: number
  // ── Exile team claims ───────────────────────────────────────────────────────────
  exileClaimMode: ExileClaimMode
  /** Weekly sealed-bid budget each exile bids from (Exile dollars, never main-island FAAB). */
  exileBidBudget: number
  /** Sealed bids for teams close at this Eastern day/time inside each Exile period. */
  exileBidCloseDay: SurvivorGovernanceDay
  exileBidCloseTime: string
  // ── Secrecy ─────────────────────────────────────────────────────────────────────
  /** Hide who is on Exile from everyone not on Exile (the commissioner still sees it). */
  hideExileMembership: boolean
  // ── Token Pool ──────────────────────────────────────────────────────────────────
  tokenPoolEnabled: boolean
  /** Commissioner start/stop: closed = no new picks; open picks still settle. */
  tokenPoolOpen: boolean
  /** `per_pick`: each correct pick pays a token. `streak`: correct picks build a pot the exile can cash out. */
  tokenPoolMode: TokenPoolMode
  tokenPoolWrongPick: TokenPoolWrongPick
  tokenPoolPicksPerWeek: number
  /** Settle picks from our stored game finals; off = the commissioner settles in the Hub. */
  tokenPoolAutoSettle: boolean
  // ── Token shop ──────────────────────────────────────────────────────────────────
  tokenShopEnabled: boolean
  tokenShopItems: TokenShopItem[]
  // ── Survivor Pool ───────────────────────────────────────────────────────────────
  survivorPoolEnabled: boolean
  survivorPoolStartWeek: number
  survivorPoolRule: SurvivorPoolRule
  survivorPoolConference: SurvivorPoolConference
  survivorPoolAllowedTeams: string[]
  survivorPoolWeekRules: SurvivorPoolWeekRule[]
  survivorPoolPrize: SideGamePrize
  /** Times a manager may come back after a wrong pick; after that they are banned from the pool. */
  survivorPoolRevives: number
  /** The `division` rule's division (a name from our stored team data). */
  survivorPoolDivision: string
  /** What a tied game does to a Survivor Pool pick. `push` is today's behaviour. */
  survivorPoolTieRule: SurvivorPoolTieRule
  /** What a week with no pick does once that week's games have all kicked off. `none` is today's. */
  survivorPoolMissedPick: SurvivorPoolMissedPick
  /** No reusing a team: each manager may pick a team once per season. */
  survivorPoolNoReuse: boolean
  // ── Disadvantages ───────────────────────────────────────────────────────────────
  /** The disadvantage items the commissioner allows in auctions and the shop. Empty: none (today). */
  disadvantagesEnabled: SideGameDisadvantageKind[]
  // ── Exile exposure ──────────────────────────────────────────────────────────────
  /** "Removed if exposed": what the commissioner's Hub action does to a manager who exposed an exile. */
  exileExposureRule: ExileExposureRule
  // ── Auction Week ────────────────────────────────────────────────────────────────
  auctionCurrency: AuctionCurrency
  /** Auction cash handed to each active castaway when an auction opens. 0 = only what they have earned. */
  auctionCashPerAuction: number
}

export const SIDE_GAME_LIMITS = {
  exileTokenFaabRate: [0, 200],
  exileBenchSlots: [0, 5],
  exileLineupSlots: 12,
  exileBidBudget: [1, 1000],
  tokenPoolPicksPerWeek: [1, 5],
  tokenShopItems: 12,
  tokenShopCost: [1, 50],
  survivorPoolStartWeek: [1, 30],
  survivorPoolRevives: [0, 5],
  survivorPoolAllowedTeams: 40,
  survivorPoolWeekRules: 30,
  auctionCash: [0, 1000],
  prizeAmount: [0, 1000],
} as const

export const DEFAULT_SIDE_GAME_PRIZE: SideGamePrize = { kind: 'none', amount: 0, powerType: 'extra_vote', samePositionOnly: false }

/** The catalog the shop can sell; every item starts OFF until the commissioner prices it. */
export const DEFAULT_TOKEN_SHOP_ITEMS: TokenShopItem[] = [
  { id: 'extra_vote', kind: 'advantage', enabled: false, cost: 4, amount: 0, powerType: 'extra_vote', samePositionOnly: false },
  { id: 'vote_steal', kind: 'advantage', enabled: false, cost: 5, amount: 0, powerType: 'vote_steal', samePositionOnly: false },
  { id: 'vote_shield', kind: 'advantage', enabled: false, cost: 6, amount: 0, powerType: 'vote_shield', samePositionOnly: false },
  { id: 'free_trade', kind: 'free_trade_token', enabled: false, cost: 3, amount: 0, powerType: 'extra_vote', samePositionOnly: true },
  { id: 'steal_blocker', kind: 'steal_blocker', enabled: false, cost: 2, amount: 0, powerType: 'extra_vote', samePositionOnly: false },
  { id: 'faab_50', kind: 'faab', enabled: false, cost: 1, amount: 50, powerType: 'extra_vote', samePositionOnly: false },
]

export const SURVIVOR_SIDE_GAME_DEFAULTS: SurvivorSideGameSettings = {
  exileTokenFaabRate: 0,
  exileTokenFaabBasis: 'all',
  exileLineupSlots: [],
  exileBenchSlots: 0,
  exileClaimMode: 'first_come',
  exileBidBudget: 100,
  exileBidCloseDay: 'Wednesday',
  exileBidCloseTime: '21:00',
  hideExileMembership: false,
  tokenPoolEnabled: true,
  tokenPoolOpen: true,
  tokenPoolMode: 'per_pick',
  tokenPoolWrongPick: 'keep',
  tokenPoolPicksPerWeek: 1,
  tokenPoolAutoSettle: true,
  tokenShopEnabled: false,
  tokenShopItems: DEFAULT_TOKEN_SHOP_ITEMS,
  survivorPoolEnabled: false,
  survivorPoolStartWeek: 1,
  survivorPoolRule: 'any',
  survivorPoolConference: 'AFC',
  survivorPoolAllowedTeams: [],
  survivorPoolWeekRules: [],
  survivorPoolPrize: DEFAULT_SIDE_GAME_PRIZE,
  survivorPoolRevives: 2,
  survivorPoolDivision: '',
  survivorPoolTieRule: 'push',
  survivorPoolMissedPick: 'none',
  survivorPoolNoReuse: false,
  disadvantagesEnabled: [],
  exileExposureRule: 'off',
  auctionCurrency: 'faab',
  auctionCashPerAuction: 0,
}

export type SurvivorSideGameKey = keyof SurvivorSideGameSettings

type Rec = Record<string, unknown>
const rec = (v: unknown): Rec => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : {})
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/
const ITEM_ID = /^[a-z0-9_]{1,32}$/
const TEAM = /^[A-Za-z0-9 .'&-]{2,40}$/
/** A conference / division name as our stored team data spells it ("AFC East", "Pacific", "Big Ten"). */
const GROUP = /^[\p{L}0-9 .'&()/-]{1,40}$/u

function readGroup(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  const v = value.trim().replace(/\s+/g, ' ')
  return GROUP.test(v) ? v : fallback
}

function oneOf<T extends string>(value: unknown, options: readonly T[], fallback: T): T {
  return typeof value === 'string' && (options as readonly string[]).includes(value) ? (value as T) : fallback
}
function intIn(value: unknown, [min, max]: readonly [number, number], fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max ? value : fallback
}
const bool = (value: unknown, fallback: boolean) => (typeof value === 'boolean' ? value : fallback)
const isDay = (v: unknown): v is SurvivorGovernanceDay => typeof v === 'string' && (SURVIVOR_GOVERNANCE_DAYS as readonly string[]).includes(v)

/** "W/R/T" and "FLEX" mean the NFL flex slot (stored as FLX, the redraft slot name). */
export function normalizeExileSlotToken(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const v = raw.trim().toUpperCase().replace(/\s+/g, '')
  if (!v) return null
  if (v === 'W/R/T' || v === 'WRT' || v === 'FLEX' || v === 'FLX') return 'FLX'
  if (v === 'D/ST' || v === 'DST' || v === 'DEFENSE') return 'DEF'
  if (v === 'SUPERFLEX' || v === 'Q/W/R/T') return 'SF'
  if (v === 'UT') return 'UTIL'
  return /^[A-Z0-9]{1,5}$/.test(v) ? v : null
}

/** The commissioner's label for a stored slot (FLX → W/R/T on football). */
export function exileSlotLabel(slot: string, sport?: string | null): string {
  const football = ['NFL', 'NCAAF'].includes(String(sport ?? 'NFL').toUpperCase())
  if (slot === 'FLX') return football ? 'W/R/T' : 'FLEX'
  if (slot === 'SF') return 'SUPERFLEX'
  return slot
}

export function readSideGamePrize(value: unknown): SideGamePrize {
  const r = rec(value)
  const kind = oneOf(r.kind, SIDE_GAME_PRIZE_KINDS, 'none')
  return {
    kind,
    amount: intIn(r.amount, SIDE_GAME_LIMITS.prizeAmount, 0),
    powerType: oneOf(r.powerType, SURVIVOR_REWARD_ADVANTAGE_POWERS, 'extra_vote'),
    samePositionOnly: bool(r.samePositionOnly, false),
  }
}

function readShopItem(value: unknown): TokenShopItem | null {
  const r = rec(value)
  if (typeof r.id !== 'string' || !ITEM_ID.test(r.id)) return null
  const kind = oneOf(r.kind, TOKEN_SHOP_KINDS, 'advantage')
  return {
    id: r.id,
    kind,
    enabled: bool(r.enabled, false),
    cost: intIn(r.cost, SIDE_GAME_LIMITS.tokenShopCost, 1),
    amount: intIn(r.amount, [0, kind === 'score_bonus' || kind === 'opponent_penalty' ? SURVIVOR_REWARD_LIMITS.points : SURVIVOR_REWARD_LIMITS.faab], 0),
    powerType: oneOf(r.powerType, SURVIVOR_REWARD_ADVANTAGE_POWERS, 'extra_vote'),
    samePositionOnly: bool(r.samePositionOnly, false),
  }
}

function readTeams(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  for (const v of value) {
    if (typeof v !== 'string') continue
    const t = v.trim().toUpperCase()
    if (TEAM.test(t) && !out.includes(t)) out.push(t)
    if (out.length >= SIDE_GAME_LIMITS.survivorPoolAllowedTeams) break
  }
  return out
}

function readWeekRule(value: unknown): SurvivorPoolWeekRule | null {
  const r = rec(value)
  if (typeof r.week !== 'number' || !Number.isInteger(r.week) || r.week < 1 || r.week > 30) return null
  const rule = oneOf(r.rule, SURVIVOR_POOL_RULES, 'any')
  return {
    week: r.week,
    rule,
    ...(rule === 'conference' ? { conference: readGroup(r.conference, 'AFC') } : {}),
    ...(rule === 'allowed_list' ? { allowedTeams: readTeams(r.allowedTeams) } : {}),
    ...(rule === 'division' ? { division: readGroup(r.division, '') } : {}),
  }
}

/**
 * The league's side-game settings. Junk or missing values read as the defaults. `harshTokenLoss` is
 * the older `League.survivorExileHarshTokenLoss` column: when the commissioner has never set a
 * wrong-pick rule here, that column still means "−1 for a miss", exactly as before.
 */
export function readSurvivorSideGameSettings(leagueSettings: unknown, opts: { harshTokenLoss?: boolean | null } = {}): SurvivorSideGameSettings {
  const raw = rec(rec(leagueSettings)[SURVIVOR_SIDE_GAMES_KEY])
  const d = SURVIVOR_SIDE_GAME_DEFAULTS
  const slots = Array.isArray(raw.exileLineupSlots)
    ? raw.exileLineupSlots.map(normalizeExileSlotToken).filter((s): s is string => Boolean(s) && s !== 'BENCH').slice(0, SIDE_GAME_LIMITS.exileLineupSlots)
    : []
  const savedItems = Array.isArray(raw.tokenShopItems) ? raw.tokenShopItems.map(readShopItem).filter((i): i is TokenShopItem => Boolean(i)) : null
  const items = savedItems
    ? [...new Map(savedItems.map((i) => [i.id, i])).values()].slice(0, SIDE_GAME_LIMITS.tokenShopItems)
    : DEFAULT_TOKEN_SHOP_ITEMS
  const weekRules = Array.isArray(raw.survivorPoolWeekRules)
    ? [...new Map(raw.survivorPoolWeekRules.map(readWeekRule).filter((w): w is SurvivorPoolWeekRule => Boolean(w)).map((w) => [w.week, w])).values()]
      .sort((a, b) => a.week - b.week).slice(0, SIDE_GAME_LIMITS.survivorPoolWeekRules)
    : []
  return {
    exileTokenFaabRate: intIn(raw.exileTokenFaabRate, SIDE_GAME_LIMITS.exileTokenFaabRate, d.exileTokenFaabRate),
    exileTokenFaabBasis: oneOf(raw.exileTokenFaabBasis, EXILE_TOKEN_FAAB_BASES, d.exileTokenFaabBasis),
    exileLineupSlots: slots,
    exileBenchSlots: slots.length ? intIn(raw.exileBenchSlots, SIDE_GAME_LIMITS.exileBenchSlots, d.exileBenchSlots) : 0,
    exileClaimMode: oneOf(raw.exileClaimMode, EXILE_CLAIM_MODES, d.exileClaimMode),
    exileBidBudget: intIn(raw.exileBidBudget, SIDE_GAME_LIMITS.exileBidBudget, d.exileBidBudget),
    exileBidCloseDay: isDay(raw.exileBidCloseDay) ? raw.exileBidCloseDay : d.exileBidCloseDay,
    exileBidCloseTime: typeof raw.exileBidCloseTime === 'string' && TIME.test(raw.exileBidCloseTime) ? raw.exileBidCloseTime : d.exileBidCloseTime,
    hideExileMembership: bool(raw.hideExileMembership, d.hideExileMembership),
    tokenPoolEnabled: bool(raw.tokenPoolEnabled, d.tokenPoolEnabled),
    tokenPoolOpen: bool(raw.tokenPoolOpen, d.tokenPoolOpen),
    tokenPoolMode: oneOf(raw.tokenPoolMode, TOKEN_POOL_MODES, d.tokenPoolMode),
    tokenPoolWrongPick: oneOf(raw.tokenPoolWrongPick, TOKEN_POOL_WRONG_PICK, opts.harshTokenLoss ? 'minus_one' : d.tokenPoolWrongPick),
    tokenPoolPicksPerWeek: intIn(raw.tokenPoolPicksPerWeek, SIDE_GAME_LIMITS.tokenPoolPicksPerWeek, d.tokenPoolPicksPerWeek),
    tokenPoolAutoSettle: bool(raw.tokenPoolAutoSettle, d.tokenPoolAutoSettle),
    tokenShopEnabled: bool(raw.tokenShopEnabled, d.tokenShopEnabled),
    tokenShopItems: items,
    survivorPoolEnabled: bool(raw.survivorPoolEnabled, d.survivorPoolEnabled),
    survivorPoolStartWeek: intIn(raw.survivorPoolStartWeek, SIDE_GAME_LIMITS.survivorPoolStartWeek, d.survivorPoolStartWeek),
    survivorPoolRule: oneOf(raw.survivorPoolRule, SURVIVOR_POOL_RULES, d.survivorPoolRule),
    survivorPoolConference: readGroup(raw.survivorPoolConference, d.survivorPoolConference),
    survivorPoolAllowedTeams: readTeams(raw.survivorPoolAllowedTeams),
    survivorPoolWeekRules: weekRules,
    survivorPoolPrize: raw.survivorPoolPrize === undefined ? d.survivorPoolPrize : readSideGamePrize(raw.survivorPoolPrize),
    survivorPoolRevives: intIn(raw.survivorPoolRevives, SIDE_GAME_LIMITS.survivorPoolRevives, d.survivorPoolRevives),
    survivorPoolDivision: readGroup(raw.survivorPoolDivision, d.survivorPoolDivision),
    survivorPoolTieRule: oneOf(raw.survivorPoolTieRule, SURVIVOR_POOL_TIE_RULES, d.survivorPoolTieRule),
    survivorPoolMissedPick: oneOf(raw.survivorPoolMissedPick, SURVIVOR_POOL_MISSED_PICK, d.survivorPoolMissedPick),
    survivorPoolNoReuse: bool(raw.survivorPoolNoReuse, d.survivorPoolNoReuse),
    disadvantagesEnabled: Array.isArray(raw.disadvantagesEnabled)
      ? SIDE_GAME_DISADVANTAGE_KINDS.filter((k) => (raw.disadvantagesEnabled as unknown[]).includes(k))
      : d.disadvantagesEnabled,
    exileExposureRule: oneOf(raw.exileExposureRule, EXILE_EXPOSURE_RULES, d.exileExposureRule),
    auctionCurrency: oneOf(raw.auctionCurrency, AUCTION_CURRENCIES, d.auctionCurrency),
    auctionCashPerAuction: intIn(raw.auctionCashPerAuction, SIDE_GAME_LIMITS.auctionCash, d.auctionCashPerAuction),
  }
}

/** The pool rule that applies in `week`: that week's variant, else the season rule. */
export function survivorPoolRuleForWeek(s: SurvivorSideGameSettings, week: number): Required<Omit<SurvivorPoolWeekRule, 'week'>> {
  const v = s.survivorPoolWeekRules.find((r) => r.week === week)
  return {
    rule: v?.rule ?? s.survivorPoolRule,
    conference: v?.conference ?? s.survivorPoolConference,
    allowedTeams: v?.allowedTeams ?? s.survivorPoolAllowedTeams,
    division: v?.division ?? s.survivorPoolDivision,
  }
}

export interface SurvivorSideGameLockContext {
  /** The draft has started (or finished). */
  draftStarted: boolean
  /** The season is past week 0 (the island is running). */
  seasonStarted: boolean
}

/**
 * Settings that lock once the season starts: the ones that change the value of tokens a castaway
 * has ALREADY earned, or the shape of a lineup mid-period. Everything else — opening and closing the
 * Token Pool, shop prices, the pool's weekly variants, auction currency — stays editable all season,
 * because the commissioner runs those week to week.
 */
export const SIDE_GAME_KEYS_LOCKED_AT_SEASON_START: readonly SurvivorSideGameKey[] = [
  'exileTokenFaabRate', 'exileTokenFaabBasis', 'tokenPoolMode', 'survivorPoolRevives', 'survivorPoolStartWeek',
  // Changing these mid-season would re-judge weeks already played (a used-team list, a tie or a miss).
  'survivorPoolNoReuse', 'survivorPoolTieRule', 'survivorPoolMissedPick',
]

export function lockedSideGameKeys(ctx: SurvivorSideGameLockContext): SurvivorSideGameKey[] {
  return ctx.seasonStarted ? [...SIDE_GAME_KEYS_LOCKED_AT_SEASON_START] : []
}

export type SideGamePatchResult =
  | { ok: true; settings: SurvivorSideGameSettings; patch: Partial<SurvivorSideGameSettings> }
  | { ok: false; error: string; code: 'invalid' | 'locked' }

const KEYS = Object.keys(SURVIVOR_SIDE_GAME_DEFAULTS) as SurvivorSideGameKey[]

/**
 * Validate a commissioner patch. Unknown keys and junk values are refused rather than silently
 * dropped (a typo must not read as "saved"). Locked keys are refused only when they CHANGE.
 */
export function validateSurvivorSideGamePatch(current: SurvivorSideGameSettings, patch: unknown, locked: readonly SurvivorSideGameKey[] = []): SideGamePatchResult {
  const p = rec(patch)
  const keys = Object.keys(p)
  if (!keys.length) return { ok: false, error: 'Nothing to save.', code: 'invalid' }
  const unknown = keys.filter((k) => !(KEYS as string[]).includes(k))
  if (unknown.length) return { ok: false, error: `Unknown setting: ${unknown[0]}.`, code: 'invalid' }
  // Round-trip the merged object through the reader: anything the reader would not keep is junk.
  const merged = readSurvivorSideGameSettings({ [SURVIVOR_SIDE_GAMES_KEY]: { ...current, ...p } })
  for (const key of keys as SurvivorSideGameKey[]) {
    const wanted = JSON.stringify(normalizeForCompare(key, p[key]))
    const kept = JSON.stringify(normalizeForCompare(key, merged[key]))
    if (wanted !== kept) return { ok: false, error: `That value for ${key} is not allowed.`, code: 'invalid' }
    if (locked.includes(key) && JSON.stringify(current[key]) !== JSON.stringify(merged[key])) {
      return { ok: false, error: `${key} locks once the season starts.`, code: 'locked' }
    }
  }
  if (merged.survivorPoolEnabled && merged.survivorPoolPrize.kind !== 'none' && ['faab', 'score_bonus', 'auction_cash', 'tokens'].includes(merged.survivorPoolPrize.kind) && merged.survivorPoolPrize.amount < 1) {
    return { ok: false, error: 'Give the Survivor Pool prize an amount of at least 1.', code: 'invalid' }
  }
  const disadvantageError = sideGameDisadvantageError(merged)
  if (disadvantageError) return { ok: false, error: disadvantageError, code: 'invalid' }
  if (merged.survivorPoolEnabled && merged.survivorPoolRule === 'division' && !merged.survivorPoolDivision) {
    return { ok: false, error: 'Choose the division for the Survivor Pool division rule.', code: 'invalid' }
  }
  const out: Partial<SurvivorSideGameSettings> = {}
  for (const key of keys as SurvivorSideGameKey[]) (out as Rec)[key] = merged[key]
  return { ok: true, settings: merged, patch: out }
}

/** Slot tokens and team names are compared normalised, so "w/r/t" saves as FLX without an error. */
function normalizeForCompare(key: SurvivorSideGameKey, value: unknown): unknown {
  if (key === 'exileLineupSlots' && Array.isArray(value)) return value.map(normalizeExileSlotToken)
  if (key === 'survivorPoolAllowedTeams' && Array.isArray(value)) return value.map((t) => (typeof t === 'string' ? t.trim().toUpperCase() : t))
  if (key === 'survivorPoolWeekRules' && Array.isArray(value)) return value.map((r) => readWeekRule(r) ?? r)
  if (key === 'survivorPoolPrize') return readSideGamePrize(value)
  if (key === 'tokenShopItems' && Array.isArray(value)) return value.map((i) => readShopItem(i) ?? i)
  if (key === 'exileBenchSlots') return value
  if (key === 'disadvantagesEnabled' && Array.isArray(value)) return [...new Set(value)].sort()
  if ((key === 'survivorPoolConference' || key === 'survivorPoolDivision') && typeof value === 'string') return value.trim().replace(/\s+/g, ' ')
  return value
}

/**
 * A disadvantage sold in the shop (or offered as the pool prize) must be one the commissioner
 * enabled, and a point penalty needs points. One check for the settings save and the auction builder.
 */
export function sideGameDisadvantageError(s: Pick<SurvivorSideGameSettings, 'disadvantagesEnabled' | 'tokenShopItems' | 'survivorPoolPrize'>): string | null {
  for (const item of s.tokenShopItems) {
    if (!item.enabled || !isDisadvantageKind(item.kind)) continue
    if (!s.disadvantagesEnabled.includes(item.kind)) return `Turn on the ${item.kind.replace(/_/g, ' ')} disadvantage before selling it.`
    if (item.kind === 'opponent_penalty' && item.amount < 1) return 'Give the point-penalty item at least 1 point.'
  }
  if (isDisadvantageKind(s.survivorPoolPrize.kind)) return 'A disadvantage cannot be the Survivor Pool prize.'
  return null
}

/** May this auction item's prize be offered? Null when it may. */
export function auctionPrizeDisadvantageError(prize: SideGamePrize, enabled: readonly SideGameDisadvantageKind[]): string | null {
  if (!isDisadvantageKind(prize.kind)) return null
  if (!enabled.includes(prize.kind)) return `The ${prize.kind.replace(/_/g, ' ')} disadvantage is turned off in this league.`
  if (prize.kind === 'opponent_penalty' && (prize.amount < 1 || prize.amount > SURVIVOR_REWARD_LIMITS.points)) return `A point penalty is 1 to ${SURVIVOR_REWARD_LIMITS.points} points.`
  return null
}

export function mergeSurvivorSideGamesIntoSettings(leagueSettings: unknown, next: SurvivorSideGameSettings): Record<string, unknown> {
  return { ...rec(leagueSettings), [SURVIVOR_SIDE_GAMES_KEY]: next }
}
