import 'server-only'

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

/**
 * When a NATIVE league's manager last did something THEMSELVES (2026-11-20) — the clock the commissioner's
 * "inactive" and "at risk" read, in the per-manager table (`managerHealth.ts`) and the hub's league count
 * (`commissionerHubHealth.ts`) alike.
 *
 * 🛑 `Roster.updatedAt` IS NOT A MANAGER SIGNAL, AND BOTH SURFACES USED IT. Every write to the roster row moves
 * it: syncs, auto-subs, IR and bye moves, taxi rules, and Inactive Manager Mode's own autopilot. So a manager
 * who had walked away kept looking active for exactly as long as AllFantasy kept managing their team. The
 * automatic hand-over (`inactiveManagerService.runAutoHandovers`) already refused that clock and read the
 * owner's own saves; this is the same rule, widened to every manager-only action, for the commissioner view.
 *
 * What counts — each one something only the team's manager can do:
 *   - a lineup save they made (`af_roster_move_history` source `user_save`, `redraft_roster_move_history`
 *     source `user`), by the owner (`platformUserId`) or the manager running the team (`managerUserId`);
 *   - a waiver claim they submitted, EXCEPT autopilot's: Inactive Manager Mode files claims under the owner's
 *     id with `metadata.source = 'chimmy_autopilot'`, and counting those would mark the absent manager active;
 *   - a claim on the team's NFL-redraft roster (that route accepts only the owner or a co-owner);
 *   - a trade they proposed (`af_league_trades`, `redraft_trade_proposals`).
 *
 * ⚠ NO ACTION AT ALL IS `null`, NEVER "INACTIVE". A manager with nothing on record — a league still before
 * its draft, a seat just filled — is unknown on this clock, and both surfaces treat `null` as "not
 * inactive". The roster's age is deliberately not a fallback: that is how a whole preseason league reads
 * as abandoned.
 *
 * IMPORTED LEAGUES ARE NOT READ HERE. Their managers act on the host platform, which none of these tables
 * see; they keep the synced timestamp.
 */

export type OwnerActionRoster = {
  id: string
  leagueId: string
  platformUserId: string | null
  managerUserId?: string | null
  redraftRosterId?: string | null
}

/** One grouped read: the latest time `actorUserId` did this on `rosterId` (actor null = not recorded). */
export type ActionMax = { rosterId: string; actorUserId: string | null; at: Date | null }

/**
 * PURE. Fold the action reads into one latest time per roster. A row whose actor is recorded counts only
 * when it is the team's own manager; a row with no actor column (redraft claims, trade proposals — both
 * owner-gated where they are made) counts as the team's.
 */
export function foldOwnerLastActions(
  rosters: readonly OwnerActionRoster[],
  reads: { byActor: readonly ActionMax[]; byRedraftActor: readonly ActionMax[]; owned: readonly ActionMax[]; ownedRedraft: readonly ActionMax[] },
): Map<string, Date | null> {
  const out = new Map<string, Date | null>(rosters.map((r) => [r.id, null]))
  const owners = new Map(rosters.map((r) => [r.id, new Set([r.platformUserId, r.managerUserId].filter((x): x is string => Boolean(x && x.trim())))]))
  const byRedraft = new Map(rosters.filter((r) => r.redraftRosterId).map((r) => [r.redraftRosterId!, r.id]))
  const bump = (rosterId: string | undefined, at: Date | null) => {
    if (!rosterId || !at || !out.has(rosterId)) return
    const prev = out.get(rosterId)
    if (!prev || at.getTime() > prev.getTime()) out.set(rosterId, at)
  }
  for (const r of reads.byActor) if (r.actorUserId && owners.get(r.rosterId)?.has(r.actorUserId)) bump(r.rosterId, r.at)
  for (const r of reads.byRedraftActor) {
    const id = byRedraft.get(r.rosterId)
    if (id && r.actorUserId && owners.get(id)?.has(r.actorUserId)) bump(id, r.at)
  }
  for (const r of reads.owned) bump(r.rosterId, r.at)
  for (const r of reads.ownedRedraft) bump(byRedraft.get(r.rosterId), r.at)
  return out
}

const at = (v: unknown): Date | null => (v instanceof Date && Number.isFinite(v.getTime()) ? v : null)

/** The latest manager-only action per roster, for native-league rosters. Never throws: a failed read is "no action". */
export async function loadOwnerLastActions(rosters: readonly OwnerActionRoster[]): Promise<Map<string, Date | null>> {
  if (rosters.length === 0) return new Map()
  const ids = rosters.map((r) => r.id)
  const leagueIds = [...new Set(rosters.map((r) => r.leagueId))]
  const redraftIds = rosters.map((r) => r.redraftRosterId).filter((x): x is string => Boolean(x))
  const none: ActionMax[] = []

  // Each read on its own: one that throws (even synchronously, on a missing delegate) is "no action", never a failure.
  const safe = async (fn: () => Promise<ActionMax[]>): Promise<ActionMax[]> => {
    try {
      return await fn()
    } catch {
      return none
    }
  }
  const [saves, redraftSaves, claims, redraftClaims, trades, redraftTrades] = await Promise.all([
    safe(async () =>
      (
        await prisma.afRosterMoveHistory.groupBy({
          by: ['rosterId', 'actorUserId'],
          where: { leagueId: { in: leagueIds }, rosterId: { in: ids }, source: 'user_save' },
          _max: { createdAt: true },
        })
      ).map((r) => ({ rosterId: r.rosterId, actorUserId: r.actorUserId, at: at(r._max.createdAt) })),
    ),
    redraftIds.length
      ? safe(async () =>
          (
            await prisma.redraftRosterMoveHistory.groupBy({
              by: ['rosterId', 'actorUserId'],
              where: { leagueId: { in: leagueIds }, rosterId: { in: redraftIds }, source: 'user' },
              _max: { createdAt: true },
            })
          ).map((r) => ({ rosterId: r.rosterId, actorUserId: r.actorUserId, at: at(r._max.createdAt) })),
        )
      : none,
    // Raw for the JSON test: autopilot's claims carry the owner's id and are told apart only by their metadata.
    safe(async () =>
      (
        await prisma.$queryRaw<Array<{ rosterId: string; actorUserId: string | null; at: Date | null }>>(Prisma.sql`
          SELECT "rosterId", "userId" AS "actorUserId", MAX("createdAt") AS "at"
          FROM waiver_claims
          WHERE "rosterId" = ANY(${ids}::text[])
            AND COALESCE(metadata->>'source', '') <> 'chimmy_autopilot'
          GROUP BY "rosterId", "userId"`)
      ).map((c) => ({ rosterId: c.rosterId, actorUserId: c.actorUserId, at: at(c.at) })),
    ),
    redraftIds.length
      ? safe(async () =>
          (await prisma.redraftWaiverClaim.groupBy({ by: ['rosterId'], where: { rosterId: { in: redraftIds } }, _max: { submittedAt: true } })).map((r) => ({
            rosterId: r.rosterId,
            actorUserId: null,
            at: at(r._max.submittedAt),
          })),
        )
      : none,
    safe(async () =>
      (await prisma.afLeagueTrade.groupBy({ by: ['proposerRosterId'], where: { proposerRosterId: { in: ids } }, _max: { createdAt: true } })).map((r) => ({
        rosterId: r.proposerRosterId,
        actorUserId: null,
        at: at(r._max.createdAt),
      })),
    ),
    redraftIds.length
      ? safe(async () =>
          (await prisma.redraftTradeProposal.groupBy({ by: ['proposerRosterId'], where: { proposerRosterId: { in: redraftIds } }, _max: { createdAt: true } })).map(
            (r) => ({ rosterId: r.proposerRosterId, actorUserId: null, at: at(r._max.createdAt) }),
          ),
        )
      : none,
  ])

  return foldOwnerLastActions(rosters, {
    byActor: [...saves, ...claims],
    byRedraftActor: redraftSaves,
    owned: trades,
    ownedRedraft: [...redraftClaims, ...redraftTrades],
  })
}
