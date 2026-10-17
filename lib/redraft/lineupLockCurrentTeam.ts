import 'server-only'

import type { PrismaClient } from '@prisma/client'
import { crosswalkToSleeperIds, sleeperLookupId } from '@/lib/core-app/rosterIdCrosswalk'
import { authoritativeRowsBySleeperId } from '@/lib/player-match/authoritativePlayerRow'
import { sleeperIdWhere } from '@/lib/player-identity/externalIdNamespace'
import { normalizeTeamAbbrev } from '@/lib/team-abbrev'

/**
 * The club each rostered NFL player is on NOW, for the lineup lock to look his kickoff up by.
 *
 * 🛑 `RedraftRosterPlayer.team` IS A SNAPSHOT FROM WHEN THE PLAYER WAS ADDED, AND THE LOCK USED IT.
 * Measured on production 2026-10-12, active NFL rosters in Sleeper/native leagues: 96 players
 * (1,858 roster rows) whose stored team is not their Sleeper row's current team once both are
 * folded to an abbreviation — J.J. McCarthy MIN→NYG, Darius Slayton NYG→IND, Audric Estime NO→MIN —
 * and 5 players (10 rows) Sleeper now lists with no team. A traded player locked at his OLD club's
 * kickoff: if that club played later or was on bye, the manager could still move him after his
 * real game had started, and the reverse blocked him early.
 *
 * Returns roster id → current team (a canonical abbreviation, the form the NFL kickoff map is
 * keyed by), or `null` when Sleeper says he has no club — no game, so no lock from a stale one.
 * A player with no entry keeps his stored team: no Sleeper row, a foreign id the crosswalk cannot
 * bridge, or any read failure. NFL only — the other sports' rosters are not Sleeper-keyed.
 *
 * ⚠ Only a `source = 'sleeper'` row speaks (see `authoritativePlayerRow.ts`): a vendor row for a
 * free agent holds his LAST club, which is exactly the stale answer this replaces. And Sleeper's
 * NFL rows store FULL names ("Philadelphia Eagles", all 3,452 with a team), so the abbreviation
 * fold is not cosmetic: unfolded, `normalizeNflTeam` keys it under a name the api_sports and
 * espn_live games never carry.
 *
 * Server-only and separate from `lineupLock.ts` because that module is in client bundles (via
 * `teamDefenseIdentity.ts`) and the crosswalk imports prisma; callers hand the result to the hydrator.
 */
export async function resolveCurrentLockTeams(
  db: PrismaClient,
  args: { sport: string; platform: string | null | undefined; playerIds: readonly string[] },
): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>()
  if (String(args.sport ?? '').trim().toUpperCase() !== 'NFL' || args.playerIds.length === 0) return out
  try {
    const rosterIds = [...new Set(args.playerIds)]
    const crosswalk = await crosswalkToSleeperIds(String(args.platform ?? ''), 'NFL', rosterIds).catch(
      () => new Map<string, string>(),
    )
    const sleeperIdByRosterId = new Map<string, string>()
    for (const id of rosterIds) {
      const sid = sleeperLookupId(args.platform, id, crosswalk)
      if (sid) sleeperIdByRosterId.set(id, sid)
    }
    if (sleeperIdByRosterId.size === 0) return out
    const rows = (await db.sportsPlayer.findMany({
      where: { ...sleeperIdWhere([...sleeperIdByRosterId.values()], 'NFL'), source: 'sleeper' },
      select: { externalId: true, sleeperId: true, name: true, position: true, team: true, source: true, fetchedAt: true },
    })) as Array<{
      externalId: string
      sleeperId: string | null
      name: string
      position: string | null
      team: string | null
      source: string
      fetchedAt: Date
    }>
    const authoritative = authoritativeRowsBySleeperId(
      rows.map((r) => ({
        ...r,
        sleeperId: r.sleeperId ?? (r.externalId.startsWith('sleeper:') ? r.externalId.slice('sleeper:'.length) : null),
      })),
    )
    for (const [rosterId, sid] of sleeperIdByRosterId) {
      const row = authoritative.get(sid.trim().toLowerCase())
      if (!row || row.source !== 'sleeper') continue
      out.set(rosterId, row.team ? normalizeTeamAbbrev(row.team) : null)
    }
  } catch {
    // Fail open to the stored team, never to "no team": a read error must not unlock a roster.
    out.clear()
  }
  return out
}
