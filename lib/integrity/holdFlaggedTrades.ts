import "server-only"

/**
 * "Hold flagged trades" (AF Commissioner): run the collusion check when a trade is ACCEPTED, before it
 * executes, and send a flagged trade to commissioner review instead of letting it go through.
 *
 * Without it the check runs after the trade has settled (lib/integrity/enqueueCollusionScan.ts) and can
 * only alert. With it a flagged trade waits for the commissioner on both trade paths:
 *   - AF trades (lib/league-trade-engine/tradeService.ts): `awaiting_commissioner`, the status a
 *     commissioner-review league already uses, approved or vetoed from the same screen;
 *   - native redraft proposals (app/api/redraft/trade-votes): switched to commissioner review, and the
 *     review-window sweep (lib/redraft/tradeReviewWindowSweep.ts) will not auto-pass it while its flag
 *     is open, so it waits for an explicit approve or veto.
 *
 * The scan creates the flag and sends the alert itself, so the post-settlement scan of the same trade
 * finds the open flag and adds nothing. It FAILS OPEN: if the check cannot run, the trade proceeds
 * exactly as it would have — a broken check must never freeze a league's trading.
 *
 * Stored in League.settings (no migration); absent = off.
 */
import type { IntegrityJobPayload } from "@/lib/jobs/types"
import { prisma } from "@/lib/prisma"
import { checkLeagueCommissionerEntitlement } from "@/lib/integrity/leagueEntitlement"
import { scanTradeForCollusion } from "@/lib/integrity/CollusionDetectionEngine"

export const HOLD_FLAGGED_TRADES_KEY = "integrity_hold_flagged_trades"

type TradeRef = NonNullable<IntegrityJobPayload["tradeRef"]>

export function readHoldFlaggedTrades(settings: unknown): boolean {
  const v = settings && typeof settings === "object" ? (settings as Record<string, unknown>)[HOLD_FLAGGED_TRADES_KEY] : undefined
  return v === true
}

export type HoldDeps = {
  entitled: (leagueId: string) => Promise<boolean>
  scan: (leagueId: string, tradeId: string, ref: TradeRef) => Promise<{ flags: unknown[] }>
}

const defaultDeps: HoldDeps = {
  entitled: checkLeagueCommissionerEntitlement,
  scan: (leagueId, tradeId, ref) => scanTradeForCollusion(leagueId, tradeId, ref),
}

/** True when this accepted trade must wait for the commissioner. */
export async function shouldHoldAcceptedTrade(
  input: { leagueId: string; settings: unknown; ref: TradeRef },
  deps: Partial<HoldDeps> = {},
): Promise<boolean> {
  if (!readHoldFlaggedTrades(input.settings)) return false
  const d = { ...defaultDeps, ...deps }
  try {
    if (!(await d.entitled(input.leagueId))) return false
    const tradeId = input.ref.kind === "af" ? input.ref.tradeId : input.ref.proposalId
    const result = await d.scan(input.leagueId, tradeId, input.ref)
    return result.flags.length > 0
  } catch (error) {
    console.error("[integrity] hold check failed; the trade proceeds", { leagueId: input.leagueId, error })
    return false
  }
}

/**
 * Trade ids that must NOT be auto-passed by a review window: an open collusion flag, in a league that
 * holds flagged trades. Read up front so a caller can leave them out of its query — a sweep that read
 * "the next N due" and skipped these would let N held trades starve every other trade forever.
 */
export async function heldTradeIds(): Promise<string[]> {
  const flags = await prisma.integrityFlag.findMany({
    where: { flagType: "collusion", status: "open", tradeTransactionId: { not: null } },
    select: { tradeTransactionId: true, league: { select: { settings: true } } },
  })
  return flags
    .filter((f) => f.tradeTransactionId && readHoldFlaggedTrades(f.league?.settings))
    .map((f) => f.tradeTransactionId as string)
}
