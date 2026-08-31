/**
 * Fantrax transactions, derived by diffing rosters across scoring periods.
 *
 * 🛑 THIS EXISTS BECAUSE FANTRAX PUBLISHES NO TRANSACTIONS ENDPOINT. The word
 * does not appear in its documentation — `fantraxApi.ts` records the full
 * endpoint list read off the official docs — so trade and waiver history is
 * available only from the league CSV export or by diffing `getTeamRosters` at
 * consecutive periods. This is that diff.
 *
 * ⚠ EVERYTHING HERE IS INFERRED, AND THE TYPES SAY SO. A roster diff observes
 * that a player changed hands; it never observes WHY. Presenting an inference as
 * a recorded transaction is the failure this module is written to avoid, so
 * nothing below is called a "waiver" or a "trade" without qualification:
 *
 *   - an ADD may be a waiver claim, a free-agent pickup, or the incoming half of
 *     a trade. The diff cannot tell them apart, so they are all `adds`.
 *   - a DROP may be a cut, or the outgoing half of a trade.
 *   - a TRADE is only ever `suspected`, and only on the one shape that a waiver
 *     cannot produce: two teams exchanging players with each other in the SAME
 *     period, in both directions.
 *
 * ⚠ ONE-WAY MOVEMENT IS NOT A TRADE, AND THIS IS THE EASY MISTAKE. If team A
 * drops a player and team B adds that same player in the same period, that is
 * far more likely a waiver claim on a dropped player than a gift. Counting it as
 * a trade would manufacture trades in every active league. Only a genuine
 * two-way exchange is reported, and even then as `suspected`.
 *
 * ⚠ A GAP BETWEEN PERIODS HIDES MOVES. Diffing period 3 against period 1 reports
 * the NET change and silently loses anything added and dropped in between. The
 * caller passes consecutive periods; `gapsSkipped` reports where it could not.
 */

/** One team's roster at one scoring period, reduced to what a diff needs. */
export type PeriodRoster = {
  period: number
  /** Fantrax team id → the player ids on that team at that period. */
  teams: Record<string, { teamName: string; playerIds: string[] }>
}

export type DerivedMove = {
  period: number
  teamId: string
  teamName: string
  /** May be a waiver claim, a free agent, or the incoming half of a trade. */
  adds: string[]
  /** May be a cut, or the outgoing half of a trade. */
  drops: string[]
}

export type SuspectedTrade = {
  period: number
  teamAId: string
  teamAName: string
  teamBId: string
  teamBName: string
  /** Players that moved A → B. */
  aSent: string[]
  /** Players that moved B → A. */
  bSent: string[]
}

export type DerivedTransactions = {
  moves: DerivedMove[]
  /**
   * Two-way exchanges only. Never a recorded trade — see the header. A consumer
   * that renders these must say "looks like a trade", not "traded".
   */
  suspectedTrades: SuspectedTrade[]
  /**
   * Period boundaries the caller could not supply consecutively, e.g. [ [1,4] ].
   * Moves inside a gap are invisible and MUST NOT be reported as "no activity".
   */
  gapsSkipped: Array<[number, number]>
}

/**
 * Diff a sequence of period rosters into moves.
 *
 * Input need not be sorted; it is sorted here so a caller cannot change the
 * result by changing fetch order.
 */
export function deriveFantraxTransactions(periods: PeriodRoster[]): DerivedTransactions {
  const sorted = [...periods].sort((a, b) => a.period - b.period)
  const moves: DerivedMove[] = []
  const suspectedTrades: SuspectedTrade[] = []
  const gapsSkipped: Array<[number, number]> = []

  for (let i = 1; i < sorted.length; i += 1) {
    const prev = sorted[i - 1]!
    const curr = sorted[i]!

    /*
     * ⚠ RECORDED, NOT REPAIRED. A gap is reported and the diff still runs — the
     * net change across it is real information — but the caller is told the
     * detail inside it is unrecoverable rather than being handed a clean-looking
     * result that quietly omits moves.
     */
    if (curr.period - prev.period > 1) gapsSkipped.push([prev.period, curr.period])

    /* teamId → what that team gained and lost between the two periods. */
    const delta = new Map<string, { teamName: string; adds: string[]; drops: string[] }>()
    const teamIds = new Set([...Object.keys(prev.teams), ...Object.keys(curr.teams)])

    for (const teamId of teamIds) {
      const before = prev.teams[teamId]
      const after = curr.teams[teamId]
      /*
       * A team present in only one snapshot cannot be diffed — that is an
       * expansion, a fold, or a missing fetch, none of which are roster moves.
       */
      if (!before || !after) continue

      const beforeSet = new Set(before.playerIds)
      const afterSet = new Set(after.playerIds)
      const adds = after.playerIds.filter((p) => !beforeSet.has(p))
      const drops = before.playerIds.filter((p) => !afterSet.has(p))
      if (adds.length === 0 && drops.length === 0) continue

      delta.set(teamId, { teamName: after.teamName || before.teamName, adds, drops })
      moves.push({ period: curr.period, teamId, teamName: after.teamName || before.teamName, adds, drops })
    }

    /*
     * ⚠ TWO-WAY ONLY. For a pair (A,B) we require that something A dropped
     * arrived on B *and* something B dropped arrived on A, in this same period.
     * A one-way movement — A drops, B adds — is the signature of a waiver claim
     * on a dropped player and is deliberately NOT reported, because treating it
     * as a trade would invent a trade for every claim in an active league.
     */
    const ids = [...delta.keys()]
    for (let a = 0; a < ids.length; a += 1) {
      for (let b = a + 1; b < ids.length; b += 1) {
        const A = delta.get(ids[a]!)!
        const B = delta.get(ids[b]!)!
        const aSent = A.drops.filter((p) => B.adds.includes(p))
        const bSent = B.drops.filter((p) => A.adds.includes(p))
        if (aSent.length === 0 || bSent.length === 0) continue
        suspectedTrades.push({
          period: curr.period,
          teamAId: ids[a]!,
          teamAName: A.teamName,
          teamBId: ids[b]!,
          teamBName: B.teamName,
          aSent,
          bSent,
        })
      }
    }
  }

  return { moves, suspectedTrades, gapsSkipped }
}
