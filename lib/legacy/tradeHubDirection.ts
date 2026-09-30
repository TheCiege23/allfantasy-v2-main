/**
 * WHICH WAY THE AF LEGACY TRADE HUB'S DEAL POINTS. PURE — the page and the analyzer route both use it.
 *
 * 🛑 THE TRADE HUB GRADED THE DEAL BACKWARDS UNTIL 2026-09-30. Team A defaults to the signed-in
 * manager's own roster and its players are picked FROM that roster — so Team A's list is what the user
 * GIVES. But the panel was labelled "You Get", and both graders were fed that list as the side the user
 * RECEIVES: Quick evaluate sent it as `assetsYouGet`, the full analyzer as `assetsA` (which the analyzer
 * reads as "what Team A receives"). The letter printed was therefore the letter for a manager who
 * receives their own players and sends away the partner's — the partner's side of the deal, shown as
 * the user's. The lineup slot map had the same inversion (it added the user's own players to the user's
 * roster and removed players the user never had).
 *
 * The analyzer route's league-mode roster check was the one piece written to the Trade Hub's inverted
 * orientation (it required `assetsA` to sit on Team A's roster), which is why the inversion never
 * bounced; it is also why the standalone trade analyzer, which sends the contract's orientation, was
 * refused in league mode. `tradeSideAssetOffRoster` below is that check, turned to the contract.
 *
 * The contract, one place:
 *   - the user's own team (Team A, "Your Team") is the side that GIVES — its panel reads "You Give";
 *   - the trade partner (Team B) is the side the user GETS from — its panel reads "You Get";
 *   - Quick evaluate: `assetsYouGive` = the user's list, `assetsYouGet` = the partner's;
 *   - the full analyzer: `assetsA` = what Team A (the user) RECEIVES = the partner's list,
 *     `assetsB` = what Team A GIVES = the user's list. Both routes grade `give = what the user sends`,
 *     so the letter is the user's.
 */

export const TRADE_HUB_SIDE_LABELS = {
  /** Team A — defaults to the signed-in manager's roster; its selected assets leave that roster. */
  mine: { title: 'You Give', teamLabel: 'Your Team' },
  /** Team B — the trade partner; its selected assets come to the user. */
  partner: { title: 'You Get', teamLabel: 'From Team' },
} as const

/** The Trade Hub's two lists: `mine` picked from the user's roster, `partner` from the partner's. */
export type TradeHubSides<T> = { mine: T; partner: T }

/** Quick evaluate's orientation: the graded side sends `assetsYouGive` and receives `assetsYouGet`. */
export function tradeHubQuickEvaluateSides<T>(sides: TradeHubSides<T>): { assetsYouGive: T; assetsYouGet: T } {
  return { assetsYouGive: sides.mine, assetsYouGet: sides.partner }
}

/** The full analyzer's orientation: Team A (the user) RECEIVES `assetsA` and GIVES `assetsB`. */
export function tradeHubAnalyzeSides<T>(sides: TradeHubSides<T>): { assetsA: T; assetsB: T } {
  return { assetsA: sides.partner, assetsB: sides.mine }
}

type SideAsset = { type?: string; player?: { id?: string | null; name?: string | null } | null }
type RosterPlayer = { id?: string | null }

/**
 * League-mode check for the analyzer: every player Team A RECEIVES (`assetsA`) must be on Team B's
 * roster, and every player Team A GIVES (`assetsB`) on Team A's. Returns the refusal message for the
 * first player that is not, or null. A player with no id is not checked (a typed-in name).
 */
export function tradeSideAssetOffRoster(args: {
  assetsA: ReadonlyArray<SideAsset>
  assetsB: ReadonlyArray<SideAsset>
  rosterA: ReadonlyArray<RosterPlayer>
  rosterB: ReadonlyArray<RosterPlayer>
}): string | null {
  const idsA = new Set(args.rosterA.map((p) => p?.id))
  const idsB = new Set(args.rosterB.map((p) => p?.id))
  for (const a of args.assetsA) {
    const id = a?.type === 'player' ? a.player?.id : null
    if (id && !idsB.has(id)) return `Side A receives "${a.player?.name}" (${id}), who is not on Side B's roster.`
  }
  for (const a of args.assetsB) {
    const id = a?.type === 'player' ? a.player?.id : null
    if (id && !idsA.has(id)) return `Side A gives "${a.player?.name}" (${id}), who is not on Side A's roster.`
  }
  return null
}
