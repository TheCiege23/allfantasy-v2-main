/**
 * "Create a test league": fill every open seat of a freshly created league with a
 * placeholder AI manager, so one tester can walk the whole flow (draft, lineups,
 * trades, scoring) without recruiting eleven friends.
 *
 * The placeholders reuse the repo's existing seat conventions rather than inventing a
 * third kind of non-human team:
 *   - platformUserId `orphan-…`  → `isSeatPlaceholderUserId` is true, so no platform
 *     notification, email or push is ever addressed to the seat, and the orphan AI
 *     manager may run it (same prefix `materializeDraftSlots` uses);
 *   - Roster.settings.aiManaged  → the existing AI-manager flag;
 *   - LeagueTeam.managerKind AI  → the lifecycle axis that replaces overloaded isOrphan.
 *
 * The league itself is marked `settings.isTestLeague = true`, which is what keeps it out
 * of real-league analytics counts (see `realLeagueWhere` in ./analyticsExclusion).
 *
 * Only seats that are still OPEN are touched; the commissioner's own team and any seat
 * a real person already claimed are left exactly as they are.
 */
import 'server-only'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

export const TEST_PLACEHOLDER_PREFIX = 'orphan-test-'

export type FillTestLeagueResult = { filled: number }

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? { ...(v as Record<string, unknown>) } : {}
}

export function placeholderTeamName(slot: number): string {
  return `Test Team ${slot}`
}

export function placeholderManagerName(slot: number): string {
  return `Test Manager ${slot}`
}

export async function fillTestLeagueWithPlaceholders(leagueId: string): Promise<FillTestLeagueResult> {
  return prisma.$transaction(
    async (tx) => {
      const league = await tx.league.findUnique({ where: { id: leagueId }, select: { id: true, settings: true } })
      if (!league) throw new Error('League not found')

      const slots = await tx.leagueEntrySlot.findMany({
        where: { leagueId, status: 'OPEN', rosterId: { not: null } },
        select: { id: true, slotNumber: true, rosterId: true },
        orderBy: { slotNumber: 'asc' },
      })

      const renamed = new Map<string, string>()
      for (const slot of slots) {
        const rosterId = slot.rosterId!
        const roster = await tx.roster.findUnique({ where: { id: rosterId }, select: { id: true, settings: true } })
        if (!roster) continue
        const placeholderId = `${TEST_PLACEHOLDER_PREFIX}${roster.id}`
        const teamName = placeholderTeamName(slot.slotNumber)

        await tx.roster.update({
          where: { id: roster.id },
          data: {
            platformUserId: placeholderId,
            settings: {
              ...asRecord(roster.settings),
              openSlot: false,
              aiManaged: true,
              aiManagerType: 'default',
              testPlaceholder: true,
            } as Prisma.InputJsonValue,
          },
        })
        await tx.leagueTeam.updateMany({
          where: { leagueId, externalId: roster.id, claimedByUserId: null },
          data: {
            ownerName: placeholderManagerName(slot.slotNumber),
            teamName,
            platformUserId: placeholderId,
            isOrphan: false,
            managerKind: 'AI',
          },
        })
        await tx.leagueEntrySlot.update({ where: { id: slot.id }, data: { status: 'FILLED' } })
        renamed.set(roster.id, teamName)
      }

      // The draft room reads seat labels from the session's slotOrder, not from LeagueTeam.
      if (renamed.size > 0) {
        const sessions = await tx.draftSession.findMany({ where: { leagueId }, select: { id: true, slotOrder: true } })
        for (const s of sessions) {
          if (!Array.isArray(s.slotOrder)) continue
          const next = (s.slotOrder as unknown[]).map((entry) => {
            const e = asRecord(entry)
            const name = typeof e.rosterId === 'string' ? renamed.get(e.rosterId) : undefined
            return name ? { ...e, displayName: name, open: false } : e
          })
          await tx.draftSession.update({ where: { id: s.id }, data: { slotOrder: next as Prisma.InputJsonValue } })
        }
      }

      await tx.league.update({
        where: { id: leagueId },
        data: { settings: { ...asRecord(league.settings), isTestLeague: true } as Prisma.InputJsonValue },
      })

      return { filled: renamed.size }
    },
    { timeout: 30_000, maxWait: 10_000 },
  )
}
