/**
 * Whisperer secrecy for universe-wide rows (standings, the universe AI context).
 *
 * Those rows span many leagues, and each league decides separately whether this viewer may know
 * its Whisperer (`resolveWhispererViewer`). The universe owner sees every league. A league whose
 * permission cannot be resolved is masked, never shown.
 */

import { resolveWhispererViewer } from './whispererViewer'
import { redactZombieTeam, type WhispererIdentity } from './whispererRedaction'

const EMPTY_IDENTITY: WhispererIdentity = { rosterIds: new Set(), userIds: new Set() }

export async function redactUniverseRowsForViewer<T extends { leagueId: string; rosterId: string; status: string }>(
  rows: readonly T[],
  viewer: { userId: string; isOwner: boolean },
): Promise<T[]> {
  if (viewer.isOwner) return [...rows]

  const leagueIds = [...new Set(rows.map((row) => row.leagueId))]
  const byLeague = new Map(
    await Promise.all(
      leagueIds.map(async (leagueId) => [leagueId, await resolveWhispererViewer(leagueId, viewer.userId)] as const),
    ),
  )

  return rows.map((row) => {
    const leagueViewer = byLeague.get(row.leagueId)
    if (leagueViewer?.canSee) return row
    return redactZombieTeam(row, leagueViewer?.identity ?? EMPTY_IDENTITY)
  })
}
