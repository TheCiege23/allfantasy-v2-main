/**
 * Chimmy ACTIONS — the shapes shared by the proposal tools, the signed token and the confirm route.
 *
 * ── 🛑 A PROPOSAL CHANGES NOTHING ───────────────────────────────────────────────────────────────
 * `propose_lineup_change` and `propose_trade` only ever BUILD one of these. The only code path that
 * writes is `/api/chimmy/actions/confirm`, reached by the signed-in user tapping Confirm on the card.
 * A model that calls a propose tool in a loop produces cards, never moves.
 *
 * Client-safe: no server imports, so the card component can import the display types.
 */

export type ChimmyActionKind = 'lineup' | 'trade'

/** One lineup move, by player id. `to` is where the player ends up. */
export type LineupMoveSpec = {
  playerId: string
  to: 'starters' | 'bench'
}

/** A player changing hands, from the proposer's point of view. */
export type TradeAssetSpec = {
  playerId: string
  fromRosterId: string
  toRosterId: string
}

/**
 * What the token authorises. Ids only, all resolved server-side from the user's OWN roster at
 * proposal time — the model never supplies one.
 */
export type ChimmyActionSpec =
  | {
      kind: 'lineup'
      rosterId: string
      week: number
      season: number
      /** The players whose placement changes. Everyone else stays exactly where they are. */
      moves: LineupMoveSpec[]
      /**
       * Hash of the roster's starters + bench at proposal time. The confirm refuses if the lineup
       * changed in between, so a card can never apply to a lineup the user was not shown.
       */
      baseFingerprint: string
    }
  | {
      kind: 'trade'
      proposerRosterId: string
      receiverRosterId: string
      week: number
      season: number
      assets: TradeAssetSpec[]
    }

/** The signed payload. `exp` is epoch seconds. */
export type ChimmyActionTokenPayload = {
  v: 1
  actionId: string
  userId: string
  leagueId: string
  exp: number
  spec: ChimmyActionSpec
}

/** A player as the card shows them. */
export type ActionCardPlayer = {
  name: string
  position: string | null
  team: string | null
}

/**
 * What the chat renders. Display only: the confirm route never reads any of this — it re-derives
 * everything from the signed spec — so editing the card client-side cannot change what executes.
 */
export type ChimmyActionCard = {
  actionId: string
  kind: ChimmyActionKind
  /** Opaque signed token. The ONLY thing the confirm button sends. */
  token: string
  title: string
  league: { id: string; name: string | null; sport: string }
  week: number
  season: number
  /** ISO timestamp after which the confirm is refused. */
  expiresAt: string
  lineup?: {
    moveIn: Array<ActionCardPlayer & { slot: string | null }>
    moveOut: ActionCardPlayer[]
  }
  trade?: {
    partnerTeamName: string
    youGive: ActionCardPlayer[]
    youGet: ActionCardPlayer[]
    /** How this league reviews trades once accepted — "commissioner review", "league vote"… */
    reviewNote: string | null
  }
  /** Plain-language caveats. Always rendered; never hidden behind a toggle. */
  warnings: string[]
}

/** The confirm route's answer. */
export type ChimmyActionConfirmResult = {
  ok: boolean
  status: 'executed' | 'already_executed' | 'refused' | 'expired' | 'invalid'
  message: string
  kind?: ChimmyActionKind
  tradeId?: string
  /**
   * Tapping again may give a different answer: no verdict arrived (the client sets it on a network
   * error), or the first tap is still being processed (the server sets it). Tapping again is always
   * safe — the action id is claimed once, so a retry reports the recorded outcome.
   */
  retryable?: boolean
}
