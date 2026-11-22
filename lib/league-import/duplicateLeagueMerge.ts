/**
 * Plan the merge of duplicate copies of one imported league into a single League row.
 *
 * Why copies exist: `League` is unique on (userId, platform, platformLeagueId, season), so every
 * account that imports the same provider league gets its own row, with its own rosters, teams,
 * draft session and chat. The import joins a second account to the existing copy only through a
 * team claim (or, since 2026-11-17, as a proven commissioner), so older imports left duplicates —
 * measured on the KBI tournament: 30 Sleeper leagues held as 65 rows, the live drafts in one copy
 * and a re-importing commissioner's copies in another.
 *
 * Pure: no database access. `scripts/merge-duplicate-imported-leagues.ts` reads, prints and applies.
 *
 * What the plan carries, and what it deliberately does not:
 *   - KEEP the copy the league actually happens in: a mirrored provider draft first, then a copy
 *     whose owner account is deleted only as a tiebreak that the caller chose, then the oldest.
 *   - MOVE every team claim that exists only in a removed copy onto the same team (by provider team
 *     id) in the kept copy — never onto a team someone else holds, and never a second team for one
 *     person. Those become `conflicts` for a human, and the claim is not moved.
 *   - MOVE chat. Everything else in a removed copy is re-derivable import data and goes with it.
 *   - Report, never silently decide, anyone who would lose access: an owner of a removed copy who
 *     ends with no team, no ownership and no co-commissioner seat in the kept one.
 */

export type MergeTeam = { id: string; externalId: string | null; claimedByUserId: string | null }
export type MergeRoster = { id: string; sourceTeamId: string | null; platformUserId: string | null }

export type MergeCopy = {
  id: string
  userId: string
  ownerDeleted: boolean
  createdAt: Date
  hasMirroredDraft: boolean
  teams: MergeTeam[]
  rosters: MergeRoster[]
  chatMessageCount: number
  /** `LeagueSafeConnection` rows: these restrict deletion and are never moved automatically. */
  blockingRowCount: number
  /** Teamless co-commissioners already recorded on this copy (tournament or import). */
  teamlessCoCommissionerIds: string[]
}

export type ClaimMove = { userId: string; externalId: string; keepTeamId: string; keepRosterId: string | null }
export type MergeConflict = { userId: string; externalId: string | null; reason: string }

export type LeagueMergePlan = {
  keepId: string
  removeIds: string[]
  claimMoves: ClaimMove[]
  conflicts: MergeConflict[]
  chatMessagesToMove: number
  /** Set when the kept copy's owner account is deleted and a commissioner was named to take it. */
  transferOwnerTo: string | null
  /** The named commissioner, when they will run the kept copy without owning it or holding a team. */
  addCoCommissioner: string | null
  /** Owners of removed copies left with no way into the kept one. Reported, not fixed. */
  losesAccess: string[]
  /** Set when the group cannot be merged automatically at all. */
  blocked: string | null
}

export function chooseKeptCopy(copies: MergeCopy[]): MergeCopy {
  return [...copies].sort(
    (a, b) =>
      Number(b.hasMirroredDraft) - Number(a.hasMirroredDraft) ||
      Number(b.ownerDeleted) - Number(a.ownerDeleted) ||
      a.createdAt.getTime() - b.createdAt.getTime() ||
      a.id.localeCompare(b.id),
  )[0]!
}

export function planDuplicateLeagueMerge(copies: MergeCopy[], opts: { commissionerUserId?: string | null } = {}): LeagueMergePlan {
  if (copies.length < 2) throw new Error('planDuplicateLeagueMerge needs at least two copies')
  const keep = chooseKeptCopy(copies)
  const removed = copies.filter((c) => c.id !== keep.id)
  const commissioner = opts.commissionerUserId ?? null

  const plan: LeagueMergePlan = {
    keepId: keep.id,
    removeIds: removed.map((c) => c.id),
    claimMoves: [],
    conflicts: [],
    chatMessagesToMove: removed.reduce((n, c) => n + c.chatMessageCount, 0),
    transferOwnerTo: null,
    addCoCommissioner: null,
    losesAccess: [],
    blocked: null,
  }

  const blocking = removed.filter((c) => c.blockingRowCount > 0)
  if (blocking.length > 0) {
    plan.blocked = `removed copy ${blocking.map((c) => c.id).join(', ')} has LeagueSafe connections`
    return plan
  }

  const keepTeamByExt = new Map(keep.teams.filter((t) => t.externalId).map((t) => [t.externalId as string, t]))
  const keepRosterByTeam = new Map(keep.rosters.filter((r) => r.sourceTeamId).map((r) => [r.sourceTeamId as string, r]))
  // Who holds what in the kept copy, updated as moves are planned so two copies cannot both win a seat.
  const holderOf = new Map<string, string>()
  const seatOf = new Map<string, string>()
  for (const t of keep.teams) {
    if (t.claimedByUserId && t.externalId) {
      holderOf.set(t.externalId, t.claimedByUserId)
      seatOf.set(t.claimedByUserId, t.externalId)
    }
  }

  for (const copy of removed) {
    for (const t of copy.teams) {
      const userId = t.claimedByUserId
      if (!userId) continue
      const ext = t.externalId
      if (!ext) {
        plan.conflicts.push({ userId, externalId: null, reason: 'claimed team has no provider team id' })
        continue
      }
      const target = keepTeamByExt.get(ext)
      if (!target) {
        plan.conflicts.push({ userId, externalId: ext, reason: 'team not present in the kept copy' })
        continue
      }
      const holder = holderOf.get(ext)
      if (holder === userId) continue // already theirs there
      if (holder) {
        plan.conflicts.push({ userId, externalId: ext, reason: 'team already claimed by someone else in the kept copy' })
        continue
      }
      const existingSeat = seatOf.get(userId)
      if (existingSeat && existingSeat !== ext) {
        plan.conflicts.push({ userId, externalId: ext, reason: `already holds team ${existingSeat} in the kept copy` })
        continue
      }
      holderOf.set(ext, userId)
      seatOf.set(userId, ext)
      plan.claimMoves.push({ userId, externalId: ext, keepTeamId: target.id, keepRosterId: keepRosterByTeam.get(ext)?.id ?? null })
    }
  }

  if (commissioner && keep.ownerDeleted) plan.transferOwnerTo = commissioner
  const finalOwner = plan.transferOwnerTo ?? keep.userId
  if (
    commissioner &&
    commissioner !== finalOwner &&
    !seatOf.has(commissioner) &&
    !keep.teamlessCoCommissionerIds.includes(commissioner)
  ) {
    plan.addCoCommissioner = commissioner
  }

  const hasWayIn = (u: string) =>
    u === finalOwner || seatOf.has(u) || u === plan.addCoCommissioner || keep.teamlessCoCommissionerIds.includes(u)
  // A deleted account cannot sign in, so it cannot lose access.
  plan.losesAccess = [...new Set(removed.filter((c) => !c.ownerDeleted).map((c) => c.userId))].filter((u) => !hasWayIn(u))
  return plan
}
