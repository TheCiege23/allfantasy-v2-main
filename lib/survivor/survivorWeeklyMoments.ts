import 'server-only'

import { prisma } from '@/lib/prisma'
import type { SurvivorAccessContext } from './survivorAccessControl'
import { getActiveTribeImmunity } from './survivorTribeImmunity'

/**
 * SURVIVOR WEEKLY MOMENTS (weekly-loop handoff, sections 2 and 3).
 *
 * The immunity win and the torch-out are public results, so every league member sees them. The
 * torch-out only exists after the read (isRevealed + an eliminated manager): nothing here can
 * surface a result before reveal. Seen state is stored per user so a moment plays once.
 */

export interface TorchOutMoment {
  key: string
  councilId: string
  week: number
  userId: string
  rosterId: string | null
  name: string
  isYou: boolean
  exileEnabled: boolean
  seen: boolean
}

export interface ImmunityMoment {
  key: string
  week: number
  tribeId: string
  tribeName: string | null
  userId: string
  rosterId: string
  name: string
  score: number
  isYou: boolean
  seen: boolean
}

export interface WeeklyMomentsPayload {
  torchOut: TorchOutMoment | null
  immunity: ImmunityMoment[]
}

export function torchMomentKey(councilId: string): string {
  return `torch:${councilId}`
}

export function immunityMomentKey(week: number, tribeId: string): string {
  return `immunity:${week}:${tribeId}`
}

const KEY_PATTERN = /^(torch:[A-Za-z0-9_-]{1,64}|immunity:\d{1,4}:[A-Za-z0-9_-]{1,64})$/

export function isValidMomentKey(key: unknown): key is string {
  return typeof key === 'string' && KEY_PATTERN.test(key)
}

type SeenTable = {
  findMany: (args: unknown) => Promise<Array<{ momentKey: string }>>
  upsert: (args: unknown) => Promise<unknown>
}

function seenTable(): SeenTable | null {
  const delegate = (prisma as unknown as Record<string, unknown>).survivorMomentSeen
  return delegate && typeof delegate === 'object' ? (delegate as SeenTable) : null
}

async function loadSeenKeys(leagueId: string, userId: string, keys: string[]): Promise<Set<string>> {
  const table = seenTable()
  if (!table || !keys.length) return new Set()
  try {
    const rows = await table.findMany({ where: { leagueId, userId, momentKey: { in: keys } }, select: { momentKey: true } })
    return new Set(rows.map(row => row.momentKey))
  } catch {
    return new Set()
  }
}

export async function buildWeeklyMoments(access: SurvivorAccessContext): Promise<WeeklyMomentsPayload> {
  const { leagueId, userId } = access
  // Only a council that has been read can produce a torch-out.
  const council = await prisma.survivorTribalCouncil.findFirst({
    where: { leagueId, isRevealed: true, eliminatedUserId: { not: null } },
    orderBy: [{ week: 'desc' }, { councilNumber: 'desc' }, { createdAt: 'desc' }],
    select: { id: true, week: true, eliminatedUserId: true, eliminatedRosterId: true, eliminatedName: true },
  })
  const necklaces = await getActiveTribeImmunity(leagueId)
  const tribeIds = [...new Set(necklaces.map(row => row.tribeId))]
  const tribes = tribeIds.length
    ? await prisma.survivorTribe.findMany({ where: { leagueId, id: { in: tribeIds } }, select: { id: true, name: true } })
    : []
  const tribeName = new Map(tribes.map(tribe => [tribe.id, tribe.name]))

  const keys = [
    ...(council ? [torchMomentKey(council.id)] : []),
    ...necklaces.map(row => immunityMomentKey(row.week, row.tribeId)),
  ]
  const seen = await loadSeenKeys(leagueId, userId, keys)

  const torchOut: TorchOutMoment | null = council && council.eliminatedUserId
    ? {
        key: torchMomentKey(council.id),
        councilId: council.id,
        week: council.week,
        userId: council.eliminatedUserId,
        rosterId: council.eliminatedRosterId,
        name: council.eliminatedName ?? 'A manager',
        isYou: council.eliminatedUserId === userId,
        exileEnabled: Boolean(access.settings.exileIslandEnabled),
        seen: seen.has(torchMomentKey(council.id)),
      }
    : null

  return {
    torchOut,
    immunity: necklaces.map(row => ({
      key: immunityMomentKey(row.week, row.tribeId),
      week: row.week,
      tribeId: row.tribeId,
      tribeName: tribeName.get(row.tribeId) ?? null,
      userId: row.immunityWinnerUserId,
      rosterId: row.immunityWinnerRosterId,
      name: row.winnerName ?? 'A manager',
      score: row.score,
      isYou: row.immunityWinnerUserId === userId,
      seen: seen.has(immunityMomentKey(row.week, row.tribeId)),
    })),
  }
}

export async function markWeeklyMomentSeen(leagueId: string, userId: string, key: string): Promise<boolean> {
  const table = seenTable()
  if (!table || !isValidMomentKey(key)) return false
  try {
    await table.upsert({
      where: { leagueId_userId_momentKey: { leagueId, userId, momentKey: key } },
      create: { leagueId, userId, momentKey: key },
      update: {},
    })
    return true
  } catch {
    return false
  }
}
