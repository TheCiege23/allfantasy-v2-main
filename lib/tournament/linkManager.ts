/**
 * Point a tournament participant at the team row that is really theirs.
 *
 * 🛑 EVERY NUMBER ON THE HUB RESTS ON THIS JOIN. A manager whose participant row
 * does not resolve to a `LeagueTeam` has no record, no rank and no standing — so
 * the automatic routes (platform id, then name) getting one person wrong is not
 * a cosmetic problem in a format where the bottom of the conference goes home.
 * This is the manual override for the ones they miss.
 *
 * ⚠ IT MOVES A POINTER, IT DOES NOT MOVE A SEASON. The link is written to the
 * participant's identity column; no record, rank or advancement status is
 * copied, and the next board read recomputes from the team row. So a wrong link
 * is corrected by re-linking, and nothing has to be unwound.
 */
import 'server-only'
import { prisma } from '@/lib/prisma'
import { teamIdentity } from '@/lib/tournament/importedStandingsSource'

export type LinkOutcome =
  | { ok: true; userId: string }
  | { ok: false; error: string; status: 400 | 404 | 409 }

/**
 * @param tournamentId the `TournamentShell`
 * @param commissionerUserId the caller, checked against `TournamentShell.commissionerId`
 * @param leagueParticipantId `TournamentLeagueParticipant.id` — the manager
 * @param externalId `LeagueTeam.externalId` — the team, within that league
 */
export async function linkParticipantToTeam(args: {
  tournamentId: string
  commissionerUserId: string
  leagueParticipantId: string
  externalId: string
}): Promise<LinkOutcome> {
  const { tournamentId, commissionerUserId, leagueParticipantId, externalId } = args

  const shell = await prisma.tournamentShell.findFirst({
    where: { id: tournamentId, commissionerId: commissionerUserId },
    select: { id: true },
  })
  /* Same answer for "no such tournament" and "not yours" — a distinct 403 would
     confirm a tournament exists to someone who cannot see it. */
  if (!shell) return { ok: false, error: 'Tournament not found', status: 404 }

  const lp = await prisma.tournamentLeagueParticipant.findFirst({
    where: { id: leagueParticipantId, league: { tournamentId } },
    select: {
      id: true,
      participantId: true,
      userId: true,
      league: { select: { leagueId: true } },
    },
  })
  /*
   * ⚠ SCOPED TO THIS TOURNAMENT IN THE QUERY, NOT CHECKED AFTERWARDS. The id
   * arrives in a request body, so an unscoped lookup would let a commissioner of
   * one tournament rewrite a participant in somebody else's.
   */
  if (!lp) return { ok: false, error: 'Manager not found in this tournament', status: 404 }

  const leagueId = lp.league?.leagueId
  if (!leagueId) {
    return {
      ok: false,
      error: 'That league has no imported league behind it yet, so there is nothing to link to.',
      status: 400,
    }
  }

  const team = await prisma.leagueTeam.findFirst({
    where: { leagueId, externalId },
    select: { externalId: true, platformUserId: true, ownerName: true, teamName: true },
  })
  if (!team) return { ok: false, error: 'Team not found in that league', status: 404 }

  /*
   * The platform's own id when it has one, and a deterministic pointer at the
   * team row when it does not — `platformUserId` is nullable, and an orphan team
   * is exactly the kind of row that needs linking by hand.
   */
  const newUserId = team.platformUserId || teamIdentity(leagueId, team.externalId)

  if (newUserId === lp.userId) return { ok: true, userId: newUserId }

  /*
   * 🛑 ONE TEAM, ONE MANAGER. `@@unique([tournamentId, userId])` on
   * `TournamentParticipant` would reject this anyway, but a raw constraint error
   * reaches the commissioner as "an unexpected error" — and the thing they need
   * to know is WHICH manager already holds it, because one of the two links is
   * wrong and they have to decide which.
   */
  const conflict = await prisma.tournamentParticipant.findFirst({
    where: { tournamentId, userId: newUserId },
    select: { displayName: true },
  })
  if (conflict) {
    return {
      ok: false,
      error: `That team is already linked to ${conflict.displayName || 'another manager'}. Unlink them first.`,
      status: 409,
    }
  }

  /*
   * ⚠ BOTH ROWS, IN ONE TRANSACTION. `TournamentParticipant.userId` is the
   * tournament-wide identity and `TournamentLeagueParticipant.userId` is the
   * per-round copy the board actually matches on. Writing one without the other
   * leaves a manager linked in this round and unlinked in the next, which
   * presents as the bug reappearing by itself after a redraft.
   */
  await prisma.$transaction([
    prisma.tournamentParticipant.update({
      where: { id: lp.participantId },
      data: { userId: newUserId },
    }),
    prisma.tournamentLeagueParticipant.updateMany({
      where: { participantId: lp.participantId },
      data: { userId: newUserId },
    }),
    prisma.tournamentAuditLog.create({
      data: {
        tournamentId,
        action: 'participant.link_team',
        actorType: 'commissioner',
        actorId: commissionerUserId,
        targetType: 'participant',
        targetId: lp.participantId,
        data: {
          leagueId,
          externalId: team.externalId,
          teamName: team.teamName,
          ownerName: team.ownerName,
          previousUserId: lp.userId,
          newUserId,
        },
      },
    }),
  ])

  return { ok: true, userId: newUserId }
}
