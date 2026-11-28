/**
 * Accept / decline / counter an ESPN trade offer from inside AllFantasy — THE PLUMBING ONLY.
 *
 * 🛑 NO ESPN REQUEST EXISTS HERE, AND THAT IS THE POINT. No committed capture shows the shape of an
 * ESPN trade write (`contracts/espn/GAPS.md` T-03d, T-03e). CLAUDE.md forbids probing ESPN to learn
 * one, and capturing a write means PERFORMING one — so the owner-only contract capture
 * (`lib/admin/contractCapture/`) cannot take it either: it only ever sends reads. T-03e records the
 * exact capture the owner can supply (a HAR from his own browser on a throwaway offer).
 *
 * What is here, so wiring is one step once that capture is committed:
 *   - the action vocabulary and its validation;
 *   - the flag (`ESPN_TRADE_OFFER_ACTIONS`, OFF unless set to `on`) AND a second lock,
 *     `ESPN_OFFER_WRITE_CONTRACT_CAPTURED`, which stays `false` until a request is implemented
 *     against a committed fixture. Turning the flag on alone still refuses: there is nothing to send;
 *   - the ledger transition each action would make, applied only after ESPN CONFIRMS it — never
 *     optimistically, because a write we could not verify must not read as done.
 *
 * PURE. No `server-only`, no prisma, no fetch: the route and the panel both import it.
 */

export const ESPN_OFFER_ACTIONS = ['accept', 'decline', 'counter'] as const
export type EspnOfferAction = (typeof ESPN_OFFER_ACTIONS)[number]

/**
 * 🛑 FLIP ONLY IN THE SAME CHANGE THAT IMPLEMENTS THE ESPN REQUEST AGAINST A COMMITTED FIXTURE
 * (`contracts/espn/fixtures/`, GAPS.md T-03e). Nothing else may set it.
 */
export const ESPN_OFFER_WRITE_CONTRACT_CAPTURED = false

export const ESPN_OFFER_ACTION_UNAVAILABLE_MESSAGE =
  'Accepting, declining or countering an ESPN trade is not available in AllFantasy yet — act on it in ESPN.'

export function isEspnOfferAction(v: unknown): v is EspnOfferAction {
  return typeof v === 'string' && (ESPN_OFFER_ACTIONS as readonly string[]).includes(v)
}

/** The flag. OFF unless the environment says exactly `on`. */
export function espnOfferActionsFlagOn(env: Record<string, string | undefined> = process.env): boolean {
  return String(env.ESPN_TRADE_OFFER_ACTIONS ?? '').trim().toLowerCase() === 'on'
}

/** Whether AllFantasy may show and perform the actions: the flag AND a captured write contract. */
export function espnOfferActionsAvailable(env: Record<string, string | undefined> = process.env): boolean {
  return espnOfferActionsFlagOn(env) && ESPN_OFFER_WRITE_CONTRACT_CAPTURED
}

/** The actions the panel may render for one offer: none while unavailable; never on a closed offer. */
export function espnOfferActionsFor(
  offer: { status: string; viewerConsented: boolean; proposedByViewer: boolean },
  env: Record<string, string | undefined> = process.env,
): EspnOfferAction[] {
  if (!espnOfferActionsAvailable(env) || offer.status !== 'pending') return []
  // The proposer has nothing to accept or decline; withdrawing is a different write, not captured either.
  if (offer.proposedByViewer || offer.viewerConsented) return []
  return [...ESPN_OFFER_ACTIONS]
}

/**
 * The ledger transition an action makes ONCE ESPN HAS CONFIRMED IT. `null` = no change.
 *
 *  - accept  → `accepted` only when every other team has also accepted; ESPN may still hold it for
 *              league review, which no capture shows, so otherwise it stays `pending`.
 *  - decline → `rejected`.
 *  - counter → the original is `rejected` from our side; the counter is a NEW offer the next sweep
 *              reads with its own id (GAPS.md T-03c: a countered offer's shape is not captured).
 * Only a `pending` offer moves.
 */
export function espnOfferStatusAfter(
  current: string,
  action: EspnOfferAction,
  opts: { allOtherTeamsAccepted?: boolean } = {},
): 'accepted' | 'rejected' | null {
  if (current !== 'pending') return null
  if (action === 'accept') return opts.allOtherTeamsAccepted ? 'accepted' : null
  return 'rejected'
}

export type EspnOfferActionOutcome =
  | { ok: true; status: 'accepted' | 'rejected' | null }
  | { ok: false; code: 'not_available' | 'invalid_action'; message: string }

/**
 * Perform one action. Today: always refuses, because there is no request to send. When the capture
 * lands, the ESPN call goes here (through the existing ESPN adapter, never a new host literal), and
 * the ledger is updated with `espnOfferStatusAfter` only on a confirmed response.
 */
export async function performEspnOfferAction(input: {
  action: unknown
  env?: Record<string, string | undefined>
}): Promise<EspnOfferActionOutcome> {
  if (!isEspnOfferAction(input.action)) {
    return { ok: false, code: 'invalid_action', message: 'Unknown action. Use accept, decline or counter.' }
  }
  if (!espnOfferActionsAvailable(input.env)) {
    return { ok: false, code: 'not_available', message: ESPN_OFFER_ACTION_UNAVAILABLE_MESSAGE }
  }
  // Unreachable while ESPN_OFFER_WRITE_CONTRACT_CAPTURED is false. Kept explicit so a flip without an
  // implementation still refuses instead of reporting a write that never happened.
  return { ok: false, code: 'not_available', message: ESPN_OFFER_ACTION_UNAVAILABLE_MESSAGE }
}
