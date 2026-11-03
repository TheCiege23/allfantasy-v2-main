/**
 * Who is in a native redraft trade, and who still has to agree to it.
 *
 * A `RedraftTradeProposal` names one proposer and one receiver. A multi-team trade (3 or 4 teams)
 * adds the rest in `additionalRosterIds`; each `RedraftTradeAsset` already carries its own
 * `fromRosterId` / `toRosterId`, so the assets say who sends what to whom.
 *
 * ⚠ A TWO-TEAM TRADE IS THE SPECIAL CASE WITH NO ADDITIONAL TEAMS, AND EVERY HELPER HERE REDUCES TO
 * THE OLD PAIR FOR IT. Its receiver's accept goes straight to the existing accept flow and
 * `acceptedRosterIds` is never written — `isMultiTeamTrade` is the only switch.
 *
 * The reference design is the generic engine (lib/league-trade-engine/tradeService.ts): every
 * non-proposer participant must accept, and acceptances are recorded per team.
 */

/** Proposer plus up to three partners. */
export const MAX_REDRAFT_TRADE_TEAMS = 4

/**
 * 🛑 THE IDP SALARY CAP IS A TWO-TEAM CALCULATION, SO A MULTI-TEAM TRADE IS REFUSED IN A CAP LEAGUE.
 * `validateRedraftTradeCap` (lib/idp/capEngine.ts) nets one side's outgoing salary against the
 * other's; with three teams there is no "other side", and checking each pair alone would approve a
 * trade whose net leaves a team over the cap. Creation refuses it (app/api/redraft/trade-proposals);
 * settlement refuses it again (lib/redraft/finalizeRedraftTrade.ts) as the backstop.
 */
export const MULTI_TEAM_CAP_LEAGUE_REFUSAL = 'Multi-team trades are not available in salary-cap leagues yet.'

export type RedraftTradeParticipantsShape = {
  proposerRosterId: string
  receiverRosterId: string
  additionalRosterIds?: readonly string[] | null
  acceptedRosterIds?: readonly string[] | null
}

function cleanIds(ids: readonly string[] | null | undefined): string[] {
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string' && id.length > 0) : []
}

/** Every team in the trade: proposer, receiver, then the additional teams, deduplicated. */
export function tradeParticipantRosterIds(p: RedraftTradeParticipantsShape): string[] {
  return [...new Set([p.proposerRosterId, p.receiverRosterId, ...cleanIds(p.additionalRosterIds)])]
}

export function isMultiTeamTrade(p: Pick<RedraftTradeParticipantsShape, 'additionalRosterIds'>): boolean {
  return cleanIds(p.additionalRosterIds).length > 0
}

/** The teams whose acceptance the trade needs: everyone but the proposer. */
export function tradePartiesToAccept(p: RedraftTradeParticipantsShape): string[] {
  return tradeParticipantRosterIds(p).filter((id) => id !== p.proposerRosterId)
}

/** Teams that still have to accept, in participant order. */
export function tradePartiesPendingAcceptance(p: RedraftTradeParticipantsShape): string[] {
  const accepted = new Set(cleanIds(p.acceptedRosterIds))
  return tradePartiesToAccept(p).filter((id) => !accepted.has(id))
}

export function allTradePartiesAccepted(p: RedraftTradeParticipantsShape): boolean {
  return tradePartiesPendingAcceptance(p).length === 0
}

/**
 * Normalise a create request's extra teams. Returns the cleaned list or the reason it is refused.
 * Two-team requests (nothing supplied) come back as an empty list and change nothing.
 */
export function normalizeAdditionalRosterIds(
  raw: unknown,
  proposerRosterId: string,
  receiverRosterId: string,
): { ok: true; ids: string[] } | { ok: false; error: string } {
  if (raw == null) return { ok: true, ids: [] }
  if (!Array.isArray(raw)) return { ok: false, error: 'additionalRosterIds must be a list of team ids' }
  const ids = raw.map((v) => (typeof v === 'string' ? v.trim() : '')).filter(Boolean)
  if (ids.length !== raw.length) return { ok: false, error: 'additionalRosterIds must be a list of team ids' }
  const all = [proposerRosterId, receiverRosterId, ...ids]
  if (new Set(all).size !== all.length) return { ok: false, error: 'Each team can appear in a trade only once' }
  if (all.length > MAX_REDRAFT_TRADE_TEAMS) {
    return { ok: false, error: `A trade can include at most ${MAX_REDRAFT_TRADE_TEAMS} teams` }
  }
  return { ok: true, ids }
}

/**
 * Teams listed in the trade that neither send nor receive anything. Empty means every team takes
 * part. Always empty for a two-team trade with at least one asset, since every asset moves between
 * the only two teams there are.
 */
export function uninvolvedTradeParticipants(
  participants: readonly string[],
  assets: ReadonlyArray<{ fromRosterId: string; toRosterId: string }>,
): string[] {
  const touched = new Set<string>()
  for (const a of assets) {
    touched.add(a.fromRosterId)
    touched.add(a.toRosterId)
  }
  return participants.filter((id) => !touched.has(id))
}

/**
 * 🛑 THE NOT-GRADED STATE FOR A MULTI-TEAM TRADE, IN THE TRADE CENTER'S OWN WORDS.
 * Every grade, value delta and "who won" reading in this app compares two sides. A 3- or 4-team trade
 * has no "other side", so it is not graded, and never graded as if it were two teams. Readers that
 * would otherwise show a grade say this instead (app/api/redraft/trade-proposals returns the same
 * sentence as `gradeWithheld`).
 */
export const MULTI_TEAM_GRADE_WITHHELD = 'Grades are shown for two-team trades.'

/** What one team in the trade sends and receives. */
export type TradeTeamMoves<A> = { rosterId: string; gives: A[]; gets: A[] }

/**
 * Every team in the trade, in participant order, with the assets it sends (`gives`) and receives
 * (`gets`). Read off each asset's own `fromRosterId` / `toRosterId`, so it is right for any number of
 * teams; for a two-team trade it is the proposer's and the receiver's halves, in that order.
 */
export function tradeTeamMoves<A extends { fromRosterId: string; toRosterId: string }>(
  p: RedraftTradeParticipantsShape,
  assets: readonly A[],
): Array<TradeTeamMoves<A>> {
  return tradeParticipantRosterIds(p).map((rosterId) => ({
    rosterId,
    gives: assets.filter((a) => a.fromRosterId === rosterId),
    gets: assets.filter((a) => a.toRosterId === rosterId),
  }))
}

/** "A and B", "A, B and C": the plain English list the server and Chimmy copy uses. */
export function joinTeamNames(names: readonly string[]): string {
  if (names.length === 0) return ''
  if (names.length === 1) return names[0]!
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/**
 * One line per team: "A gives X, Y and gets Z". English, for server notices and Chimmy grounding (the
 * model answers in the user's language). `label` renders one asset; an empty side reads "nothing".
 */
export function describeTradeTeamMoves<A>(
  moves: ReadonlyArray<TradeTeamMoves<A>>,
  nameOf: (rosterId: string) => string,
  label: (asset: A) => string,
): string[] {
  const list = (xs: A[]) => (xs.length ? xs.map(label).join(', ') : 'nothing')
  return moves.map((m) => `${nameOf(m.rosterId)} gives ${list(m.gives)} and gets ${list(m.gets)}`)
}
