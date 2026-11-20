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

type ChimmyActionKind = 'lineup' | 'trade' | 'automation' | 'queue' | 'settings'

/** The league settings a commissioner can change through Chimmy (stage 5 of Chimmy, 2026-11-16). */
export type ChimmySettingKey =
  | 'name'
  | 'waiverType'
  | 'waiverBudget'
  | 'waiverMinBid'
  | 'tradeReviewHours'
  | 'tradeDeadlineWeek'
  | 'playoffTeams'
  | 'playoffStartWeek'
  | 'irSlots'

/** One setting a card changes. `from` is what the card was built against; the confirm refuses if it moved. */
export type SettingChangeSpec = { key: ChimmySettingKey; from: string | number | null; to: string | number | null }

/** A player a queue card adds — resolved from the draft room's own pool, never from the model. */
export type QueueAddSpec = { playerName: string; position: string; team: string | null; playerId: string | null }

/** A league automation change a commissioner asked Chimmy for (phase 12, 2026-10-29). */
export type AutomationChangeSpec =
  | { type: 'preset'; preset: 'recommended' | 'run_it' | 'hands_on' }
  | { type: 'handover'; rule: { days: 7 | 14 | 21; to: 'lineups' | 'autopilot' } | null }

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
  | {
      kind: 'automation'
      change: AutomationChangeSpec
      /**
       * The keys of what the card showed would change. The confirm recomputes the change against the
       * league as it is then and refuses if the list differs, so a card never saves something the
       * commissioner was not shown.
       */
      expectedKeys: string[]
    }
  | {
      /** The user's own draft queue (stage 2 of drafts, 2026-11-16). Never a pick. */
      kind: 'queue'
      /** The draft session the card was made for; the confirm refuses if another draft is now current. */
      sessionId: string
      rosterId?: string | null
      add: QueueAddSpec[]
      addAt: 'top' | 'bottom'
      /** `queueNameKey`s of players to take out. */
      removeKeys: string[]
      /** `queueFingerprint` of the queue the card was built against. */
      baseFingerprint: string
    }
  | {
      /**
       * League settings a commissioner asked for. Saved through `executeLeagueSettingsPatch` — the same
       * pipeline as the settings page, with its permission, lock and audit steps.
       */
      kind: 'settings'
      /** The settings-page section these all belong to; one card never spans two. */
      section: 'general' | 'waivers' | 'trades' | 'playoffs' | 'roster'
      changes: SettingChangeSpec[]
      /** The season had started when the card was made, so the card asked for a second tap. */
      midSeason: boolean
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
  automation?: {
    /** Each setting that will change, in plain words. */
    changes: string[]
  }
  queue?: {
    add: ActionCardPlayer[]
    addAt: 'top' | 'bottom'
    remove: ActionCardPlayer[]
    /** The first few names of the queue as it will be after Confirm. */
    resultingTop: string[]
  }
  settings?: {
    /** Each setting as the commissioner reads it: "FAAB budget", "$100", "$200". */
    changes: Array<{ label: string; from: string; to: string }>
    /** The season is under way: the card needs a second tap, after a plain warning. */
    midSeason: boolean
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
