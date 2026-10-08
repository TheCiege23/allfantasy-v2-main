/**
 * A CLAIMED team the provider stopped listing — departed, or the same seat under a new id?
 *
 * Removal reconciliation (`applyTeamsRosters`) never archives a claimed team: it marks it `isOrphan`
 * and keeps the claim, so a user's team and data survive a provider that really dropped it. Right
 * for a departure, wrong for a RE-KEY. Measured in production 2026-10-08: a Fantrax league changed
 * its team ids from `fantrax-team:<slug>` to numeric, the bootstrap wrote the new row and carried
 * the claim onto it, and the old row stayed CURRENT and claimed for five weeks — a 13th team in a
 * 12-team league, and a permanent "we could not read your rosters" on /core/live.
 *
 * A vanished claimed team is SUPERSEDED when a team in the same complete response is the same seat:
 * the same provider user id (`platformUserId`), or already carrying the same claim. Then:
 *
 *   - the live row already holds the claim  -> archive the old row and clear its duplicate claim;
 *   - the live row is the same provider user and UNCLAIMED -> move the claim to it, then archive;
 *   - the live row is claimed by SOMEONE ELSE -> conflict: touch nothing, leave today's orphan rule.
 *
 * A claimed team with no live counterpart is a real departure and keeps today's behaviour.
 * Pure: no prisma. The caller applies the plan.
 */

export type StaleClaimedTeam = { id: string; externalId: string; platformUserId: string | null; claimedByUserId: string }
export type LiveTeam = { id: string; externalId: string; platformUserId: string | null; claimedByUserId: string | null }

export type SupersedePlan =
  | { kind: 'archive'; staleId: string; staleExternalId: string; liveExternalId: string }
  | { kind: 'move_claim_and_archive'; staleId: string; staleExternalId: string; liveId: string; liveExternalId: string; userId: string }
  | { kind: 'conflict'; staleId: string; staleExternalId: string; liveExternalId: string }
  | { kind: 'departed'; staleId: string; staleExternalId: string }

export const SUPERSEDED_ARCHIVE_REASON = 'superseded'

export function planSupersededTeams(stale: readonly StaleClaimedTeam[], live: readonly LiveTeam[]): SupersedePlan[] {
  return stale.map((t) => {
    /*
     * Same claim already on a live row: the seat moved, the old row is a duplicate. Unless the two
     * rows name DIFFERENT provider users — then it is one person holding two teams, and the one that
     * left is a departure, not a duplicate.
     */
    const sameClaim = live.find(
      (l) =>
        l.claimedByUserId === t.claimedByUserId &&
        (!t.platformUserId || !l.platformUserId || l.platformUserId === t.platformUserId),
    )
    if (sameClaim) return { kind: 'archive', staleId: t.id, staleExternalId: t.externalId, liveExternalId: sameClaim.externalId }
    const sameUser = t.platformUserId ? live.find((l) => l.platformUserId === t.platformUserId) : undefined
    if (!sameUser) return { kind: 'departed', staleId: t.id, staleExternalId: t.externalId }
    if (sameUser.claimedByUserId == null) {
      return {
        kind: 'move_claim_and_archive',
        staleId: t.id,
        staleExternalId: t.externalId,
        liveId: sameUser.id,
        liveExternalId: sameUser.externalId,
        userId: t.claimedByUserId,
      }
    }
    return { kind: 'conflict', staleId: t.id, staleExternalId: t.externalId, liveExternalId: sameUser.externalId }
  })
}
