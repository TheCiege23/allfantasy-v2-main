import 'server-only'

import { prisma } from '@/lib/prisma'

/**
 * The viewer's own team and roster row in one league.
 *
 * Moved verbatim out of `buildTradeContextNotes` (2026-09-24) when the league-graded trade verdict
 * needed the same answer: two copies of "which roster is mine" is how the note under a verdict and
 * the verdict itself come to describe different rosters. Every reason below is the original's.
 */
export type ViewerLeagueRoster =
  | {
      ok: true
      team: { platformUserId: string; externalId: string | null }
      roster: { id: string; playerData: unknown }
    }
  | {
      ok: false
      /** Why, in words the "what we couldn't see" list can print. */
      gap: string
    }

export async function resolveViewerLeagueRoster(leagueId: string, userId: string): Promise<ViewerLeagueRoster> {
  /*
   * The viewer's own roster in this league. Matched through LeagueTeam because
   * `Roster.platformUserId` is the PLATFORM's id for them, not ours — the same
   * two-id-space trap the scoreboard hit.
   *
   * ⚠ A CLAIMED TEAM IS NOT GUARANTEED, AND THIS FUNCTION RETURNS EVERYTHING.
   * Claiming is a deliberate action a manager may never have taken, and until
   * this fell back, an unclaimed league produced NO notes at all — not just no
   * leverage: no byes, no roster need, no league scale, no format rules. One
   * missing `claimedByUserId` silently emptied the entire ledger for that
   * league, and nothing on screen said why. `buildNativeActiveTrades` already
   * does this dual lookup for exactly this reason.
   */
  const team = await (async () => {
    const claimed = await prisma.leagueTeam
      .findFirst({
        where: { leagueId, claimedByUserId: userId },
        select: { platformUserId: true, externalId: true },
      })
      .catch(() => null)
    if (claimed?.platformUserId) return claimed

    /*
     * The linked Sleeper account. Deliberately second: a claim is an explicit
     * statement about THIS league, and a linked platform id is an inference
     * from an id space shared across all of them.
     */
    const profile = await prisma.userProfile
      .findUnique({ where: { userId }, select: { sleeperUserId: true } })
      .catch(() => null)
    const linked = profile?.sleeperUserId?.trim()
    if (!linked) return null
    return prisma.leagueTeam
      .findFirst({
        where: { leagueId, platformUserId: linked },
        select: { platformUserId: true, externalId: true },
      })
      .catch(() => null)
  })()
  /*
   * ⚠ AN EMPTY LEDGER AND A LEDGER THAT FOUND NOTHING LOOK IDENTICAL ON SCREEN.
   * Both render as no notes. Only one of them is something the manager can fix,
   * so the reason rides back and the analyzer prints it under "what we
   * couldn't see" rather than leaving a silent blank.
   */
  if (!team?.platformUserId) {
    return {
      ok: false,
      gap: 'which of these teams is yours — claim your team, or link the account you play on, and the league-specific read turns on',
    }
  }

  /*
   * 🛑 TWO ID SPACES, AND THE VIEWER'S OWN ROSTER IS THE ONE ROW THAT LANDS IN
   * THE OTHER ONE — so keying this the obvious way misses exactly the manager
   * this whole ledger exists for, and nobody else.
   *
   * `SleeperLeagueCreationBootstrapService` writes `Roster.platformUserId` as
   * `managerUserIds.get(source_manager_id) ?? source_manager_id` — the
   * AllFantasy user id whenever the manager resolves to a linked account, the
   * raw Sleeper id when they do not. `LeagueTeam.platformUserId` on the same
   * pass is written as `r.source_manager_id || null`: always the Sleeper id.
   * The viewer is by definition resolved (they are looking at the screen), so
   * their Roster row carries the AF id while their LeagueTeam row carries the
   * Sleeper id, and a lookup by the team's id finds all eleven strangers and
   * misses them. `Roster.redraftRosterId`'s own schema note records the same
   * split from the data side: "23 carry an app uuid in platformUserId rather
   * than a platform id".
   *
   * `buildNativeActiveTrades` in /api/league/trades-panel already does this
   * dual lookup, and says why. This did not, so a fully imported league
   * reported itself unsynced under "what we couldn't see" and every note group
   * — byes, roster need, league scale, format rules — came back empty.
   *
   * ⚠ ORDERED, NOT `findFirst` OVER AN UNORDERED `in`. Both rows can exist at
   * once: the bootstrap writes the AF-id row and a later `/api/league/sync`
   * (`lib/league-sync-core.ts`, which keys on Sleeper `owner_id`) creates a
   * SECOND row for the same manager. Picking arbitrarily between them means a
   * manager's roster silently alternates between two vintages across reloads.
   * Newest write wins.
   */
  const rosterOwnerIds = [...new Set([team.platformUserId, userId].filter(Boolean))]
  const roster = await prisma.roster
    .findFirst({
      where: { leagueId, platformUserId: { in: rosterOwnerIds } },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, playerData: true },
    })
    .catch(() => null)
  if (!roster) {
    return { ok: false, gap: 'your roster in this league, which has not been synced yet' }
  }
  return { ok: true, team: { platformUserId: team.platformUserId, externalId: team.externalId ?? null }, roster }
}
