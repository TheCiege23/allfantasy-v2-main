import { prisma } from '@/lib/prisma'

const SETTINGS_KEY = 'commissionerRosterLocks'

export function readCommissionerRosterLocks(settings: unknown): Record<string, boolean> {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return {}
  const raw = (settings as Record<string, unknown>)[SETTINGS_KEY]
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  return Object.fromEntries(
    Object.entries(raw).filter(([id, locked]) => id.length > 0 && locked === true).map(([id]) => [id, true]),
  )
}

export function withCommissionerRosterLocks(settings: unknown, locks: Record<string, boolean>) {
  const current = settings && typeof settings === 'object' && !Array.isArray(settings)
    ? settings as Record<string, unknown>
    : {}
  return { ...current, [SETTINGS_KEY]: readCommissionerRosterLocks({ [SETTINGS_KEY]: locks }) }
}

/** Team IDs are stable through seat claims; the roster owner can change. */
export async function isCommissionerRosterLocked(leagueId: string, rosterId: string): Promise<boolean> {
  const [league, roster] = await Promise.all([
    prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true } }),
    prisma.roster.findFirst({ where: { id: rosterId, leagueId }, select: { platformUserId: true } }),
  ])
  if (!league || !roster) return false
  const locks = readCommissionerRosterLocks(league.settings)
  if (!Object.keys(locks).length) return false
  const teams = await prisma.leagueTeam.findMany({
    where: {
      leagueId,
      OR: [
        { externalId: rosterId },
        { platformUserId: roster.platformUserId },
        { claimedByUserId: roster.platformUserId },
      ],
    },
    select: { id: true },
  })
  return teams.some((team) => locks[team.id] === true)
}
