/**
 * Import a PUBLIC ESPN league with no cookies: the person picks their team from the list.
 *
 * Owner decision, 2026-11-08: a public ESPN league needs no cookies to import. The user claims their
 * team; cookies are only for proving you are the COMMISSIONER (invites, assigning teams, settings).
 *
 * What a picked team proves is nothing — anyone can open a public league and choose any row. So
 * this path is built to make that harmless:
 *
 *   1. The league is OWNED by the system account (`systemLeagueOwner.ts`), never by the importer,
 *      so no owner-based commissioner check can pass for them.
 *   2. The claim is recorded UNCONFIRMED (`LeagueManagerClaim.isConfirmed = false`). Every other
 *      claim path in the repo writes `true`, so `false` means exactly "picked, not proven".
 *   3. A team ESPN flags as commissioner or co-commissioner cannot be claimed this way at all, and
 *      `stripCommissionerFlagsFromUnprovenClaims` removes the head-commissioner flag from any team an
 *      unconfirmed claimant holds after each sync, in case ESPN's flags move later.
 *   4. Proof wins: a member who later connects ESPN and proves a team held by an unconfirmed claim
 *      takes it over (`claimExistingLeagueForMember`).
 *
 * A league someone already imported as its proven commissioner is NOT joined from here — that
 * league is run by a person, and joining it is what their invite link is for.
 */
import { prisma } from '@/lib/prisma'
import { calculateAndSaveRank } from '@/lib/rank/calculateRank'
import type { PersistImportedLeagueResult } from '@/lib/league-import/ImportedLeagueCommitService'
import type { NormalizedImportResult } from '@/lib/league-import/types'
import { ensureSystemLeagueOwner, isSystemLeagueOwner } from '@/lib/league-import/systemLeagueOwner'

/** The import screen's answer to "Who's the commissioner of this league on ESPN?" */
export type EspnLeagueRunBy = 'espn' | 'member' | 'me'

export function parseEspnLeagueRunBy(raw: unknown): EspnLeagueRunBy | null {
  return raw === 'espn' || raw === 'member' || raw === 'me' ? raw : null
}

export type EspnPublicMemberImportResult =
  | { ok: true; league: PersistImportedLeagueResult['league']; joinedExisting: boolean; existed: boolean }
  | { ok: false; status: number; code: string; error: string }

function fail(status: number, code: string, error: string): EspnPublicMemberImportResult {
  return { ok: false, status, code, error }
}

export async function importPublicEspnLeagueAsMember(args: {
  userId: string
  normalized: NormalizedImportResult
  claimSourceTeamId: string
  /** Persists the normalized league owned by `ownerUserId`. The caller's usual persist + audit. */
  persistAsOwner: (ownerUserId: string) => Promise<PersistImportedLeagueResult>
}): Promise<EspnPublicMemberImportResult> {
  const { userId, normalized } = args
  const claimId = args.claimSourceTeamId.trim()
  const roster = normalized.rosters.find((r) => String(r.source_team_id) === claimId)
  if (!roster) {
    return fail(400, 'CLAIM_TEAM_NOT_IN_LEAGUE', 'That team is not in this league. Go back and pick your team again.')
  }
  if (roster.is_commissioner === true || roster.is_co_commissioner === true) {
    return fail(
      403,
      'COMMISSIONER_TEAM_NEEDS_PROOF',
      "ESPN lists that team as one of this league's commissioners. To claim it, connect ESPN so we can confirm it's yours.",
    )
  }

  const platformLeagueId = String(normalized.source.source_league_id)
  const season =
    typeof normalized.league.season === 'number' && Number.isFinite(normalized.league.season)
      ? normalized.league.season
      : null
  if (season == null) {
    return fail(422, 'SEASON_UNKNOWN', 'We could not tell which ESPN season this league is. Try again in a moment.')
  }

  const rows = (await prisma.league.findMany({
    where: { platform: 'espn', platformLeagueId, season },
    select: { id: true, name: true, sport: true, userId: true },
  })) as Array<{ id: string; name: string | null; sport: string | null; userId: string }>

  // Already theirs (imported earlier as its proven commissioner): nothing to claim.
  const own = rows.find((r) => r.userId === userId)
  if (own) {
    return {
      ok: true,
      league: { id: own.id, name: own.name ?? 'ESPN League', sport: own.sport ?? 'NFL' },
      joinedExisting: false,
      existed: true,
    }
  }

  const systemRow = rows.find((r) => isSystemLeagueOwner(r.userId))
  if (!systemRow && rows.length > 0) {
    return fail(
      409,
      'LEAGUE_RUN_BY_COMMISSIONER',
      "This league is already on AllFantasy, set up by its commissioner. Ask them for the league's invite link — or connect ESPN and import again to join with your team.",
    )
  }

  let league: PersistImportedLeagueResult['league']
  let joinedExisting = false
  if (systemRow) {
    league = { id: systemRow.id, name: systemRow.name ?? 'ESPN League', sport: systemRow.sport ?? 'NFL' }
    joinedExisting = true
  } else {
    const ownerId = await ensureSystemLeagueOwner()
    const persisted = await args.persistAsOwner(ownerId)
    league = persisted.league
  }

  const claim = await claimTeamUnconfirmed({ leagueId: league.id, userId, teamExternalId: claimId })
  if (!claim.ok) return claim

  try {
    await calculateAndSaveRank(userId)
  } catch {
    // Non-fatal, like every other rank refresh after an import.
  }

  return { ok: true, league, joinedExisting, existed: claim.alreadyHeld }
}

/**
 * Claims one team for `userId`, UNCONFIRMED. Never takes a team someone else holds, and never gives
 * one person two teams in the same league.
 */
export async function claimTeamUnconfirmed(args: {
  leagueId: string
  userId: string
  teamExternalId: string
}): Promise<{ ok: true; alreadyHeld: boolean } | { ok: false; status: number; code: string; error: string }> {
  const { leagueId, userId, teamExternalId } = args
  const team = (await prisma.leagueTeam.findFirst({
    where: { leagueId, externalId: teamExternalId },
    select: { id: true, claimedByUserId: true, isCommissioner: true, isCoCommissioner: true, platformUserId: true },
  })) as
    | { id: string; claimedByUserId: string | null; isCommissioner: boolean; isCoCommissioner: boolean; platformUserId: string | null }
    | null
  if (!team) {
    return { ok: false, status: 400, code: 'CLAIM_TEAM_NOT_IN_LEAGUE', error: 'That team is not in this league. Go back and pick your team again.' }
  }
  if (team.claimedByUserId === userId) return { ok: true, alreadyHeld: true }
  if (team.claimedByUserId) {
    return {
      ok: false,
      status: 409,
      code: 'TEAM_ALREADY_CLAIMED',
      error: "Someone on AllFantasy already claimed that team. If it's yours, connect ESPN and import again — proving it moves the team to you.",
    }
  }
  if (team.isCommissioner || team.isCoCommissioner) {
    return {
      ok: false,
      status: 403,
      code: 'COMMISSIONER_TEAM_NEEDS_PROOF',
      error: "ESPN lists that team as one of this league's commissioners. To claim it, connect ESPN so we can confirm it's yours.",
    }
  }
  const heldElsewhere = await prisma.leagueTeam.findFirst({
    where: { leagueId, claimedByUserId: userId },
    select: { id: true },
  })
  if (heldElsewhere) {
    return { ok: false, status: 409, code: 'ALREADY_HAVE_TEAM', error: 'You already have a team in this league on AllFantasy.' }
  }

  try {
    await prisma.$transaction(async (tx) => {
      // Conditional on still being unclaimed, so two people racing for one team cannot both win.
      const taken = await tx.leagueTeam.updateMany({
        where: { id: team.id, claimedByUserId: null },
        data: { claimedByUserId: userId, isOrphan: false },
      })
      if (taken.count !== 1) throw new TeamClaimRaceError()
      await tx.leagueManagerClaim.create({
        data: {
          leagueId,
          afUserId: userId,
          teamExternalId,
          platformUserId: team.platformUserId,
          isConfirmed: false,
        },
      })
    })
  } catch (err) {
    if (err instanceof TeamClaimRaceError || (err as { code?: string })?.code === 'P2002') {
      return {
        ok: false,
        status: 409,
        code: 'TEAM_ALREADY_CLAIMED',
        error: "Someone on AllFantasy just claimed that team. If it's yours, connect ESPN and import again — proving it moves the team to you.",
      }
    }
    throw err
  }
  return { ok: true, alreadyHeld: false }
}

class TeamClaimRaceError extends Error {}

/**
 * After every write of a league's teams: a team held by an UNCONFIRMED claim never carries the
 * head-commissioner flag, whatever the provider now says. ~20 places grant commissioner rights from
 * `LeagueTeam.isCommissioner`; clearing the flag at the source covers all of them.
 *
 * Co-commissioner flags are left alone on purpose — a proven commissioner may grant them to a member,
 * and stripping them on every sync would undo that decision. Claiming a co-commissioner team without
 * proof is refused up front instead.
 */
export async function stripCommissionerFlagsFromUnprovenClaims(leagueId: string): Promise<number> {
  const unproven = (await prisma.leagueManagerClaim.findMany({
    where: { leagueId, isConfirmed: false },
    select: { afUserId: true },
  })) as Array<{ afUserId: string }>
  if (unproven.length === 0) return 0
  const res = await prisma.leagueTeam.updateMany({
    where: { leagueId, isCommissioner: true, claimedByUserId: { in: unproven.map((c) => c.afUserId) } },
    data: { isCommissioner: false },
  })
  return res.count
}
