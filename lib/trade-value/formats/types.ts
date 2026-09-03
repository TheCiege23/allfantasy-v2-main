/**
 * Per-format value models — the contract. PURE.
 *
 * ── WHY A REGISTRY AND NOT ONE PARAMETERISED MODEL ──────────────────────────────────────────
 * The first proposal here was a single "elimination model" with per-format parameters, on the
 * theory that guillotine, survivor, zombie, big_brother and KOTH are the same shape. The user
 * rejected that — "pirate needs something different, honestly I think they all need something
 * different" — and reading the Four Horsemen rulebook settled it: that league is not an
 * elimination format at all and still breaks the engine in eleven places, most of them from
 * ordinary settings rather than exotic mechanics.
 *
 * So each format gets its own module implementing this interface, and the shared machinery is
 * kept deliberately small: `LeagueShape` (team count, slots, bench, taxi, IR, deadline) and the
 * overall-pick-number curve, both already landed and both wrong for everyone before they were.
 *
 * ── 🛑 AN ADJUSTMENT RETURNS A MULTIPLIER AND A REASON, NEVER A MUTATED VALUE ────────────────
 * User's decision: format, need and injury effects are a SEPARATE "fit" number shown beside the
 * base value, not folded into it. Base stays market-objective so two managers can compare, and
 * every adjustment has to be able to explain itself in a sentence a person can argue with.
 *
 * A model that cannot justify an adjustment returns null. Null means "this format has no opinion
 * here", which is different from a multiplier of 1.0 meaning "this format looked and says no
 * change" — and consumers render them differently.
 */

import type { LeagueShape } from '../leagueShape'

/** What a format model is allowed to look at. Everything optional except the shape. */
export interface FormatValueInput {
  /** The base market value being adjusted, 0–10000. */
  base: number
  position: string | null | undefined
  /** Player age, when known. Dynasty formats care; redraft ones must not. */
  age?: number | null
  /** Years of NFL experience, when known. Taxi eligibility depends on it in some leagues. */
  experience?: number | null
  /** The league's structural facts — team count, slots, bench, taxi, IR, deadline. */
  shape: LeagueShape
  /** The week being played, when known. Needed for anything deadline-aware. */
  currentWeek?: number | null
  /**
   * Format-specific team state — strikes, eviction status, throne, plunder rights.
   *
   * ⚠ DELIBERATELY `unknown`. Each model narrows it itself and returns null when the shape it
   * needs is absent. Typing it as a union here would make every model depend on every other
   * format's state, which is the coupling the registry exists to avoid.
   */
  teamState?: unknown
  /**
   * Format-specific state about THIS ASSET, as opposed to the roster holding it.
   *
   * 🛑 WHY A SECOND CHANNEL RATHER THAN MORE FIELDS. Keeper value is the first fact here that is
   * per-PLAYER rather than per-TEAM: what you acquire is not the player, it is the player MINUS
   * what he costs to keep, and a receiver kept at a 2nd is a worse asset than the same receiver
   * kept at a 7th. `teamState` cannot carry that — it is one object for the whole roster — and
   * adding a typed `keeperCostRound` to this interface would make every future per-asset fact
   * re-open the same question.
   *
   * ⚠ DELIBERATELY `unknown`, exactly like `teamState`. Each model narrows it itself and returns
   * null when the shape it needs is absent, so no format depends on another format's state type.
   */
  assetState?: unknown
}

/**
 * One adjustment. The reason is not decoration — it is the deliverable.
 *
 * A number a manager cannot interrogate is a number they will not trust, and this engine's whole
 * posture is that an honest "here is why" beats a confident bare figure.
 */
export interface FormatAdjustment {
  /** Multiplicative on the base. 1.0 means "considered, no change". */
  multiplier: number
  /** One sentence, addressed to a manager, naming the rule and its effect. */
  reason: string
}

/** Why an asset cannot be traded right now. Legality, not valuation. */
export interface TradeLegality {
  ok: boolean
  /** Present only when `ok` is false. Names the rule, not a generic refusal. */
  reason?: string
}

export interface FormatValueModel {
  /** Matches `TradeValueContext.leagueType` / a league's own format id. */
  formatId: string
  /** Human name, for surfacing which model priced an asset. */
  label: string

  /**
   * The format's opinion on this asset's value, or null when it has none.
   *
   * ⚠ MUST NOT DOUBLE-COUNT `LeagueShape`. Team count, slot counts, flex share, bench depth and
   * the pick curve are already applied by the shared engine. A model that re-applies them prices
   * the same fact twice — the exact error that made `shape` supersede `isSuperflex` rather than
   * multiply with it.
   */
  adjust(input: FormatValueInput): FormatAdjustment | null

  /**
   * Asset kinds this format can trade that others cannot — an immunity idol, steal rights, cap
   * space. Empty for formats that trade only players and picks.
   */
  extraAssetKinds?: readonly string[]

  /**
   * Whether a trade may process at all right now. Separate from valuation on purpose: "this is
   * worth less" and "this cannot be traded" are different answers and a manager needs both.
   */
  canTrade?(input: FormatValueInput): TradeLegality
}
