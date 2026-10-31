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
