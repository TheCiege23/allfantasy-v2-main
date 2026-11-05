import 'server-only'

import { prisma } from '@/lib/prisma'
import { usesDynastyBackground } from '@/lib/league-media/dynastyBackground'
import { loadDynastyOutlook } from './dynastyOutlook'
import { taxiIdsOf } from './dynastyLeagueHome'
import { findMyRoster, myRosterCandidates } from './myRoster'
import type { ClaimedTeamRow, LeagueContextRow } from './leagueContext'
import { buildRookieDraftRoom, sessionDrivesRoom, type RookieDraftRoom, type RookieRoomSession } from './draftHqRookieRoom'

/**
 * Draft HQ's dynasty draft room — the reads (the pure half is `draftHqRookieRoom.ts`).
 *
 * Null for every league that is not dynasty, by the same rule the /core shell stamp and the
 * /league/[id] workspace use (`usesDynastyBackground`), so no other league's Draft HQ changes at all.
 *
 * DB-first, no provider call: `LeagueSettings.draftDateUtc`, the viewer's `Roster` row (taxi), and —
 * only when the session cannot answer "which picks are mine" — the future-pick inventory through
 * `loadDynastyOutlook` (empty starters/roster, so its age read never runs). Each read fails to a
 * missing block, never to an error on the screen.
 */
export async function loadRookieDraftRoom(args: {
  league: LeagueContextRow
  userId: string
  claimedTeam: ClaimedTeamRow | null
  session: RookieRoomSession | null
  syncNote?: string | null
  now?: Date
}): Promise<RookieDraftRoom | null> {
  const { league, userId, claimedTeam } = args
  if (!usesDynastyBackground(league)) return null

  const inventoryTeam = sessionDrivesRoom(args.session) ? null : claimedTeam
  const [settingsRow, roster, outlook] = await Promise.all([
    prisma.leagueSettings.findUnique({ where: { leagueId: league.id }, select: { draftDateUtc: true } }).catch(() => null),
    findMyRoster(prisma, league.id, userId).catch(() => null),
    inventoryTeam
      ? loadDynastyOutlook({
          league: {
            id: league.id,
            platform: league.platform,
            leagueType: league.leagueType,
            isDynasty: league.isDynasty,
            season: league.season,
            status: league.status,
            sport: league.sport,
          },
          teamExternalId: inventoryTeam.externalId,
          rosterCandidates: myRosterCandidates(inventoryTeam, userId),
          starters: [],
          roster: [],
        }).catch(() => null)
      : Promise.resolve(null),
  ])

  return buildRookieDraftRoom({
    leagueSeason: league.season,
    session: args.session,
    draftDateUtc: settingsRow?.draftDateUtc ?? null,
    leagueSettings: league.settings,
    inventory: outlook?.picks ?? null,
    taxi: roster?.found
      ? { count: taxiIdsOf(roster.playerData).length, slots: Math.max(0, Number(league.taxiSlots ?? 0) || 0) }
      : null,
    syncNote: args.syncNote ?? null,
    now: args.now ?? new Date(),
  })
}
