import { prisma } from '@/lib/prisma'
import { getLeagueRole } from '@/lib/league/permissions'

/**
 * Who may send an @everyone announcement, and to which leagues: the head commissioner AND
 * co-commissioners. User's decision, 2026-09-17.
 *
 * Co-commissioners already change the league's settings (`requireCommissionerRole`) — including
 * the switch that decides whether a broadcast notifies anyone — and can switch on recipes that
 * post to the whole league. The head commissioner still decides who is a co-commissioner
 * (`requireCommissionerOnly`). Until now this was `League.userId` only (`assertCommissioner`), so a
 * co-commissioner's send came back Forbidden.
 *
 * 🛑 THE COMPOSER'S LIST AND THE SEND MUST USE THIS SAME RULE. `GET /api/commissioner/leagues`
 * lists what the composers offer and `POST /api/commissioner/broadcast` re-checks every id; if the
 * two predicates drift, a broadcast half-fails league by league with no explanation. Both call
 * into this file, and both answer through `getLeagueRole`.
 *
 * ⚠ IMPORTED LEAGUES ARE NOT REFUSED HERE, deliberately. The 10b composer shows them read-only,
 * but the format hubs (`broadcastLeagueIds` in `lib/core-app/formatHubs.ts`) and the draft room
 * send to every league the user commissions, imported ones included. A server-side refusal would
 * silently change what those two send.
 */

const SENDING_ROLES = new Set(['commissioner', 'co_commissioner'])

export async function canBroadcast(leagueId: string, userId: string): Promise<boolean> {
  return SENDING_ROLES.has((await getLeagueRole(leagueId, userId)) ?? '')
}

/**
 * Every league this user may broadcast to. Candidates are the leagues they own plus the leagues
 * where their claimed team carries a commissioner flag; each candidate is then confirmed with
 * `getLeagueRole` — the call the send makes — so the list can never offer a league the send
 * would refuse.
 */
export async function listBroadcastLeagueIds(userId: string): Promise<string[]> {
  const [owned, flagged] = await Promise.all([
    prisma.league.findMany({ where: { userId }, select: { id: true } }),
    prisma.leagueTeam.findMany({
      where: { claimedByUserId: userId, OR: [{ isCommissioner: true }, { isCoCommissioner: true }] },
      select: { leagueId: true },
    }),
  ])
  const candidates = [...new Set([...owned.map((l) => l.id), ...flagged.map((t) => t.leagueId)])]
  const roles = await Promise.all(candidates.map((id) => getLeagueRole(id, userId)))
  return candidates.filter((_, i) => SENDING_ROLES.has(roles[i] ?? ''))
}
