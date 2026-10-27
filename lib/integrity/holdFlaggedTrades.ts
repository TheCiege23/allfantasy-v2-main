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
 * Three settings, stored in League.settings under one key (no migration):
 *   - `severe` — the DEFAULT (owner decision 2026-10-27): hold only the most serious flags, a heavily
 *     lopsided trade or an eliminated team sending starters to a contender (`SEVERE_HOLD_CODES`);
 *     every other flag still alerts the commissioner, and the trade goes through;
 *   - `all` — hold every flagged trade (stored `true` before the default existed, still read as this);
 *   - `off` — never hold (stored `false`).
 * Only on the AF Commissioner plan, and only while collusion monitoring is on for the league.
 */
import type { IntegrityJobPayload } from "@/lib/jobs/types"
import { prisma } from "@/lib/prisma"
import { checkLeagueCommissionerEntitlement } from "@/lib/integrity/leagueEntitlement"
import { scanTradeForCollusion } from "@/lib/integrity/CollusionDetectionEngine"

import { flagIsHeld, readHoldFlaggedTradesMode } from "@/lib/integrity/holdFlaggedTradesMode"

export {
  HOLD_FLAGGED_TRADES_KEY,
  HOLD_FLAGGED_TRADES_MODES,
  SEVERE_HOLD_CODES,
  flagIsHeld,
  parseHoldFlaggedTradesMode,
  readHoldFlaggedTradesMode,
  type HoldFlaggedTradesMode,
} from "@/lib/integrity/holdFlaggedTradesMode"

type TradeRef = NonNullable<IntegrityJobPayload["tradeRef"]>

type ScanFlag = { evidence?: { flags?: Array<{ code: string }> } }

export type HoldDeps = {
  entitled: (leagueId: string) => Promise<boolean>
  monitoringOn: (leagueId: string) => Promise<boolean>
  scan: (leagueId: string, tradeId: string, ref: TradeRef) => Promise<{ flags: ScanFlag[] }>
}

async function collusionMonitoringOn(leagueId: string): Promise<boolean> {
  const row = await prisma.leagueIntegritySettings.findUnique({ where: { leagueId }, select: { collusionMonitoringEnabled: true } })
  return row?.collusionMonitoringEnabled !== false
}

const defaultDeps: HoldDeps = {
  entitled: checkLeagueCommissionerEntitlement,
  monitoringOn: collusionMonitoringOn,
  scan: (leagueId, tradeId, ref) => scanTradeForCollusion(leagueId, tradeId, ref),
}

const codesOf = (flag: ScanFlag): string[] => (flag.evidence?.flags ?? []).map((f) => f.code)

/** True when this accepted trade must wait for the commissioner. */
export async function shouldHoldAcceptedTrade(
  input: { leagueId: string; settings: unknown; ref: TradeRef },
  deps: Partial<HoldDeps> = {},
): Promise<boolean> {
  const mode = readHoldFlaggedTradesMode(input.settings)
  if (mode === "off") return false
  const d = { ...defaultDeps, ...deps }
  try {
    if (!(await d.entitled(input.leagueId))) return false
    if (!(await d.monitoringOn(input.leagueId))) return false
    const tradeId = input.ref.kind === "af" ? input.ref.tradeId : input.ref.proposalId
    const result = await d.scan(input.leagueId, tradeId, input.ref)
    return result.flags.some((f) => flagIsHeld(mode, codesOf(f)))
  } catch (error) {
    console.error("[integrity] hold check failed; the trade proceeds", { leagueId: input.leagueId, error })
    return false
  }
}

/**
 * Trade ids that must NOT be auto-passed by a review window: an open collusion flag that the league's
 * setting holds (above). Read up front so a caller can leave them out of its query — a sweep that read
 * "the next N due" and skipped these would let N held trades starve every other trade forever.
 *
 * A league on the default holds only with AF Commissioner, as at acceptance; one that chose a mode
 * keeps it. A plan that lapsed with a trade held therefore releases it to its window, which is what
 * the trade would have had without the plan.
 */
export async function heldTradeIds(deps: Pick<Partial<HoldDeps>, "entitled"> = {}): Promise<string[]> {
  const entitled = deps.entitled ?? defaultDeps.entitled
  const flags = await prisma.integrityFlag.findMany({
    where: { flagType: "collusion", status: "open", tradeTransactionId: { not: null } },
    select: { leagueId: true, tradeTransactionId: true, evidenceJson: true, league: { select: { settings: true } } },
  })
  const entitledByLeague = new Map<string, boolean>()
  const held: string[] = []
  for (const f of flags) {
    if (!f.tradeTransactionId) continue
    const codes = codesOf({ evidence: f.evidenceJson as ScanFlag["evidence"] })
    if (!flagIsHeld(readHoldFlaggedTradesMode(f.league?.settings), codes)) continue
    if (!entitledByLeague.has(f.leagueId)) {
      entitledByLeague.set(f.leagueId, await entitled(f.leagueId).catch(() => false))
    }
    if (entitledByLeague.get(f.leagueId)) held.push(f.tradeTransactionId)
  }
  return held
}
