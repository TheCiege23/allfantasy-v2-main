/**
 * The league → tournament half of draft-time sync.
 *
 * ./conferenceLeagueSync.ts copies a conference's tournament draft time ONTO its real league. A
 * commissioner (or co-commissioner) can also change the draft time on the league itself, through the
 * league's own settings; without this the tournament's record for that conference
 * (`TournamentLeague.draftScheduledAt`) would go on showing the old time on the control screen and hub.
 *
 * Only a league linked as a divisions conference league (`TournamentLeague.leagueId`) is affected;
 * every other league is a single indexed read that finds nothing.
 *
 * ⚠ NO WRITE LOOP, BY CONSTRUCTION. This writes the tournament row only — it never calls back into
 * the tournament → league sync — and the league settings patch skips calling it when the patch IS
 * that sync (`source: 'tournament'`). Both directions also write nothing when the two sides already
 * agree, so even a future caller wiring them together would converge after one step.
 */
import 'server-only'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

/** `lib/tournament/divisions/divisionsStore.ts` DIVISIONS_FORMAT — not imported, that module is heavy. */
const DIVISIONS_FORMAT = 'divisions'

export type LeagueDraftTimeCopyOutcome = 'copied' | 'unchanged' | 'not_linked'

/**
 * Record a league's new draft time (`null` = cleared) on its tournament conference, if it has one.
 * `actorUserId` is whoever changed it on the league; the tournament audit row names them.
 */
export async function copyLeagueDraftTimeToTournament(
  leagueId: string,
  draftDateUtc: Date | null,
  actorUserId: string,
): Promise<LeagueDraftTimeCopyOutcome> {
  const row = await prisma.tournamentLeague.findUnique({
    where: { leagueId },
    select: { id: true, name: true, tournamentId: true, draftScheduledAt: true, tournament: { select: { format: true } } },
  })
  if (!row || row.tournament?.format !== DIVISIONS_FORMAT) return 'not_linked'
  const before = row.draftScheduledAt
  if ((before?.getTime() ?? null) === (draftDateUtc?.getTime() ?? null)) return 'unchanged'
  await prisma.tournamentLeague.update({ where: { id: row.id }, data: { draftScheduledAt: draftDateUtc } })
  // Same action the tournament → league sync audits, so the control screen's per-league draft status
  // (lifecycle.ts leagueSyncView) reads the league and the tournament as in step again.
  await prisma.tournamentAuditLog.create({
    data: {
      tournamentId: row.tournamentId,
      actorId: actorUserId,
      actorType: 'commissioner',
      action: 'divisions_draft_times_synced',
      targetType: 'tournament_league',
      targetId: row.id,
      data: {
        via: 'league',
        leagueId,
        from: before?.toISOString() ?? null,
        to: draftDateUtc?.toISOString() ?? null,
        leagues: [{ tournamentLeagueId: row.id, league: row.name, outcome: 'scheduled', error: null }],
      } as Prisma.InputJsonValue,
    },
  })
  return 'copied'
}
