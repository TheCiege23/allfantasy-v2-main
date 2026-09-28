/**
 * Release chopped roster(s) to waivers/free agency: clear playerData so players become available.
 */

import { prisma } from '@/lib/prisma'
import { getRosterPlayerIds } from '@/lib/waiver-wire/roster-utils'
import { appendEvent } from './GuillotineEventLog'

export interface ReleaseChoppedRostersInput {
  leagueId: string
  rosterIds: string[]
  releaseTiming: 'immediate' | 'next_waiver_run' | 'custom_time'
}

/**
 * Clear each chopped roster's players so they enter the waiver/FA pool.
 * Does not process claims; next waiver run will include these players.
 */
export async function releaseChoppedRosters(input: ReleaseChoppedRostersInput): Promise<void> {
  const { leagueId, rosterIds } = input
  if (rosterIds.length === 0) return

  const rosters = await prisma.roster.findMany({
    where: { leagueId, id: { in: rosterIds } },
    select: { id: true, playerData: true },
  })

  const releasedPlayerIds: string[] = []
  for (const roster of rosters) {
    const ids = getRosterPlayerIds(roster.playerData)
    releasedPlayerIds.push(...ids)
    const emptyData = Array.isArray(roster.playerData) ? [] : clearReleasedRosterData(roster.playerData)
    await prisma.roster.update({
      where: { id: roster.id },
      data: { playerData: emptyData as object },
    })
  }

  await appendEvent(leagueId, 'roster_released', {
    rosterIds,
    releasedPlayerIds,
    releaseTiming: input.releaseTiming,
  })
}

/** Keep roster metadata while removing every lineup reference to released players. */
export function clearReleasedRosterData(playerData: unknown): Record<string, unknown> {
  const data = playerData && typeof playerData === 'object' && !Array.isArray(playerData)
    ? { ...(playerData as Record<string, unknown>) } : {}
  for (const key of ['players', 'starters', 'bench', 'ir', 'taxi', 'devy']) {
    if (key === 'players' || Array.isArray(data[key])) data[key] = []
  }
  const sections = data.lineup_sections
  if (sections && typeof sections === 'object' && !Array.isArray(sections)) {
    const cleared = { ...(sections as Record<string, unknown>) }
    for (const key of ['starters', 'bench', 'ir', 'taxi', 'devy']) {
      if (Array.isArray(cleared[key])) cleared[key] = []
    }
    data.lineup_sections = cleared
  }
  return data
}
