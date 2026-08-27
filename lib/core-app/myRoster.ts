import type { PrismaClient } from '@prisma/client'

/**
 * Which roster in a league is YOURS.
 *
 * ⚠ THIS JOIN IS THE ONE THAT QUIETLY FAILED FOR MOST OF THE PRODUCT. The chain is
 * `LeagueTeam.claimedByUserId` → its `platformUserId`/`externalId` → `Roster.platformUserId`,
 * and the last hop does not have one reliable key. `Roster.platformUserId` is always set, but
 * it does not always hold the PLATFORM's id — sometimes it holds our own `User` uuid.
 *
 * Measured on production: with only `platformUserId` and `externalId` as candidates, 38 of 106
 * claimed teams joined to a roster and just 11 had a lineup — so the surfaces built on this
 * rendered "no roster imported" to roughly two thirds of the people they were for, over rosters
 * sitting right there in the table. Adding `userId` takes it to 93 joined / 51 with lineups and
 * matches more than one roster for exactly ZERO teams, so it widens recall without ever risking
 * showing someone another manager's team.
 *
 * It lives here because more than one surface needs it and a second copy of a join this
 * delicate would drift — and the failure mode of the drift is silent and looks like missing
 * data, not like a bug.
 */

export interface ClaimedTeamKeys {
  platformUserId?: string | null
  externalId?: string | null
}

/**
 * The ids to try against `Roster.platformUserId`, in order, for a claimed team.
 *
 * ⚠ Do not "clean this up" to a single key. Each of the three is the right answer for some
 * real slice of production, and the set matches at most one roster per team.
 */
export function myRosterCandidates(team: ClaimedTeamKeys, userId: string): string[] {
  return [team.platformUserId, team.externalId, userId].filter(
    (v): v is string => typeof v === 'string' && v.length > 0,
  )
}

export type MyRosterLookup =
  | { found: true; playerData: unknown }
  | { found: false; reason: 'no_team_claimed' | 'no_roster' }

/**
 * Resolve the caller's roster in a league, or say which hop failed.
 *
 * The two failures are different things and a caller must be able to tell them apart: nobody
 * has claimed a team (the user can fix that) versus a claimed team whose rosters were never
 * imported (they cannot).
 */
export async function findMyRoster(
  prisma: Pick<PrismaClient, 'leagueTeam' | 'roster'>,
  leagueId: string,
  userId: string,
): Promise<MyRosterLookup> {
  const team = await prisma.leagueTeam
    .findFirst({
      where: { leagueId, claimedByUserId: userId },
      select: { platformUserId: true, externalId: true },
    })
    .catch(() => null)

  if (!team) return { found: false, reason: 'no_team_claimed' }

  const candidates = myRosterCandidates(team, userId)
  if (candidates.length === 0) return { found: false, reason: 'no_roster' }

  const roster = await prisma.roster
    .findFirst({
      where: { leagueId, platformUserId: { in: candidates } },
      select: { playerData: true },
    })
    .catch(() => null)

  return roster ? { found: true, playerData: roster.playerData } : { found: false, reason: 'no_roster' }
}

/** Sections of a roster object that hold player ids. `players` is the full set; the rest are subsets. */
const ID_SECTIONS = ['players', 'starters', 'bench', 'taxi', 'reserve', 'ir', 'devy'] as const

/**
 * Player ids off a `Roster.playerData` blob.
 *
 * ⚠ THE SHAPE IS AN OBJECT, NOT AN ARRAY, AND ASSUMING OTHERWISE RETURNS SILENT EMPTINESS.
 * Measured on production: **0 of 1,094 roster rows are arrays** — every one is
 * `{ players: string[], starters: string[], taxi: [], reserve: [], lineup_sections: {...} }`,
 * with the ids as bare Sleeper id strings rather than objects. An `Array.isArray` guard on the
 * blob therefore skips every roster in the database and returns an empty set, which reads
 * downstream as "this league has no players" rather than as a parse failure.
 *
 * Both older spellings are still accepted: an array of objects carrying `playerId`/`id`/
 * `sleeperPlayerId`, and an array of bare strings. Nothing in production uses them today, but
 * they cost two branches and their absence is what made this silent in the first place.
 */
export function rosterPlayerIds(playerData: unknown): string[] {
  const out: string[] = []
  const seen = new Set<string>()

  const push = (raw: unknown) => {
    let pid = ''
    if (typeof raw === 'string' || typeof raw === 'number') {
      pid = String(raw).trim()
    } else if (raw && typeof raw === 'object') {
      const o = raw as Record<string, unknown>
      pid = String(o.playerId ?? o.id ?? o.sleeperPlayerId ?? '').trim()
    }
    if (!pid || pid === 'null' || pid === 'undefined' || seen.has(pid)) return
    seen.add(pid)
    out.push(pid)
  }

  if (Array.isArray(playerData)) {
    for (const raw of playerData) push(raw)
    return out
  }

  if (playerData && typeof playerData === 'object') {
    const o = playerData as Record<string, unknown>
    for (const section of ID_SECTIONS) {
      const arr = o[section]
      if (Array.isArray(arr)) for (const raw of arr) push(raw)
    }
    /*
     * `lineup_sections` repeats the same ids grouped by slot. It is read last and deduped, so a
     * roster whose top-level `players` is missing still resolves rather than coming back empty.
     */
    const sections = o.lineup_sections
    if (sections && typeof sections === 'object') {
      for (const arr of Object.values(sections as Record<string, unknown>)) {
        if (Array.isArray(arr)) for (const raw of arr) push(raw)
      }
    }
  }

  return out
}
