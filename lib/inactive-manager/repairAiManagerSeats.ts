import 'server-only'

import { prisma } from '@/lib/prisma'
import { resolveWriteAuthority } from '@/lib/league/write-authority'
import { applyChimmyAutopilot } from './inactiveManagerService'

/**
 * One-time repair, run hourly until there is nothing left (2026-10-31). The orphan-teams "Assign AI
 * manager" button used to rewrite a seat's owner to `ai-manager-<rosterId>`. The draft's empty-seat
 * logic only recognises `orphan-…`, so Chimmy stopped drafting for exactly those teams, and nothing in
 * season ran them. Each such seat goes back to an ordinary empty seat (`orphan-<rosterId>`, on the
 * league roster and its season roster together) and is handed to Chimmy — subject to the 4-team limit
 * and the league owner's plan, like any other hand-over. Idempotent: a repaired seat no longer matches.
 */
export type AiManagerSeatRepair = { found: number; repaired: number; chimmy: number; chimmyRefused: Array<{ rosterId: string; error: string }> }

export function repairedSeatOwner(rosterId: string): string {
  return `orphan-${rosterId}`
}

export async function repairAiManagerSeats(opts?: { limit?: number }): Promise<AiManagerSeatRepair> {
  const result: AiManagerSeatRepair = { found: 0, repaired: 0, chimmy: 0, chimmyRefused: [] }
  const rows = await prisma.roster.findMany({
    where: { platformUserId: { startsWith: 'ai-manager-' } },
    select: { id: true, leagueId: true, platformUserId: true },
    take: opts?.limit ?? 200,
  })
  result.found = rows.length
  for (const row of rows) {
    const league = await prisma.league.findUnique({ where: { id: row.leagueId }, select: { platform: true, userId: true } })
    if (!league || resolveWriteAuthority(league.platform) !== 'NATIVE') continue
    const oldOwner = row.platformUserId
    const seat = repairedSeatOwner(row.id)
    const moved = await prisma.$transaction(async (tx) => {
      const updated = await tx.roster.updateMany({ where: { id: row.id, platformUserId: oldOwner }, data: { platformUserId: seat } })
      if (updated.count !== 1) return false
      await tx.redraftRoster.updateMany({ where: { leagueId: row.leagueId, ownerId: oldOwner }, data: { ownerId: seat } })
      return true
    })
    if (!moved) continue
    result.repaired += 1
    const chimmy = await applyChimmyAutopilot(row.leagueId, league.userId ?? 'system', row.id, undefined)
    if (chimmy.ok) result.chimmy += 1
    else result.chimmyRefused.push({ rosterId: row.id, error: chimmy.error })
  }
  return result
}
