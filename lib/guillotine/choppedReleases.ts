/**
 * The chopped team's players, as the league sees them after a chop (2026-10-29).
 *
 * 🛑 `GuillotineWaiverRelease` HAD FIVE READERS AND NO WRITER. The league home's chop moment (each
 * released player with a Bid button), the war room's dropped-player pool, the AI storylines, the trade
 * notes and `/api/guillotine/releases` all read it; the one function that wrote it
 * (`playerPoolRecycler.releaseRoster`) had no caller. So after every chop the home said "the released
 * players show here once the roster is processed" forever, and the war room's pool was always empty.
 *
 * `recordChoppedReleases` writes the rows at the chop, from the chopped team's roster while it still
 * holds its players. `claimedPlayerIds` answers "has someone picked him up since" at read time, from
 * the rosters themselves: nothing updates a row when a claim lands, and a status that is not kept
 * current is worse than none.
 */
import { prisma } from '@/lib/prisma'

type ReleaseDb = Pick<typeof prisma, 'guillotineWaiverRelease' | 'redraftRosterPlayer'>

/**
 * One row per player each chopped team still holds, once per team per week. Call it BEFORE the chop
 * drops the roster's players (it reads the ones not yet dropped). Returns the rows written.
 */
export async function recordChoppedReleases(
  input: { leagueId: string; guillotineSeasonId: string; week: number; redraftRosterIds: readonly string[]; availableAt: Date },
  db: ReleaseDb = prisma,
): Promise<number> {
  let written = 0
  for (const rosterId of new Set(input.redraftRosterIds)) {
    // A retry of the week, or a recovered chop: the team's players are already listed.
    const already = await db.guillotineWaiverRelease.findFirst({
      where: { leagueId: input.leagueId, scoringPeriod: input.week, eliminatedRosterId: rosterId },
      select: { id: true },
    })
    if (already) continue
    const players = await db.redraftRosterPlayer.findMany({
      where: { rosterId, droppedAt: null },
      select: { playerId: true, playerName: true, position: true, team: true, sport: true },
    })
    if (players.length === 0) continue
    const created = await db.guillotineWaiverRelease.createMany({
      data: players.map((p) => ({
        seasonId: input.guillotineSeasonId,
        leagueId: input.leagueId,
        eliminatedRosterId: rosterId,
        scoringPeriod: input.week,
        playerId: p.playerId,
        playerName: p.playerName,
        position: p.position,
        team: p.team ?? null,
        sport: p.sport,
        releaseStatus: 'pending',
        availableAt: input.availableAt,
      })),
    })
    written += created.count
  }
  return written
}

/** Of these players, the ones on a team in the league's current season again — claimed since the chop. */
export async function claimedPlayerIds(
  leagueId: string,
  playerIds: readonly string[],
  db: Pick<typeof prisma, 'redraftSeason' | 'redraftRosterPlayer'> = prisma,
): Promise<Set<string>> {
  if (playerIds.length === 0) return new Set()
  const season = await db.redraftSeason.findFirst({ where: { leagueId }, orderBy: { createdAt: 'desc' }, select: { id: true } })
  if (!season) return new Set()
  const rows = await db.redraftRosterPlayer.findMany({
    where: { playerId: { in: [...new Set(playerIds)] }, droppedAt: null, roster: { seasonId: season.id } },
    select: { playerId: true },
  })
  return new Set(rows.map((r) => r.playerId))
}
