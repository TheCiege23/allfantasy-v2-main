/**
 * One-league repair: put the human commissioner's real Roster into slotOrder[0]
 * when a prior materialization accidentally seated an orphan AI manager there.
 *
 * USAGE (dry-run, default):
 *   npx tsx scripts/claim-slot-for-human.ts --league=<leagueId> --user=<appUserId>
 *   npx tsx scripts/claim-slot-for-human.ts --league=<leagueId> --roster=<rosterId>
 *
 * APPLY (writes):
 *   npx tsx scripts/claim-slot-for-human.ts --league=<leagueId> --user=<appUserId> --apply
 *
 * OPTIONAL:
 *   --delete-orphan     also delete the orphan roster that previously held slot 1
 *                       (only applied together with --apply; only if the orphan
 *                       is not referenced by any DraftPick or audit-log row)
 *
 * Behavior:
 *   - Identifies slotOrder[0] and the orphan roster it points at.
 *   - Rewrites slotOrder[0].rosterId to the human's real roster id.
 *   - Remaps DraftPick.rosterId + DraftPickAuditLog.(old|new)RosterId from the
 *     orphan to the human where they match.
 *   - Optionally deletes the orphan roster row (--delete-orphan).
 *   - Always dry-run unless --apply is passed.
 */

import { PrismaClient } from '@prisma/client'
import { CURRENT_DRAFT_SESSION_ORDER } from '@/lib/draft-room/currentDraftSession'

type SlotOrderEntry = { slot: number; rosterId: string; displayName: string }

interface Args {
  leagueId: string
  userId: string | null
  rosterId: string | null
  apply: boolean
  deleteOrphan: boolean
}

function parseArgs(argv: string[]): Args {
  const args: Record<string, string | boolean> = {}
  for (const raw of argv.slice(2)) {
    if (!raw.startsWith('--')) continue
    const [k, v] = raw.slice(2).split('=')
    args[k] = v ?? true
  }
  const leagueId = typeof args.league === 'string' ? args.league : ''
  const userId = typeof args.user === 'string' ? args.user : null
  const rosterId = typeof args.roster === 'string' ? args.roster : null
  if (!leagueId) {
    console.error('Missing required --league=<leagueId>')
    process.exit(2)
  }
  if (!userId && !rosterId) {
    console.error('Provide one of --user=<appUserId> or --roster=<rosterId>')
    process.exit(2)
  }
  return {
    leagueId,
    userId,
    rosterId,
    apply: args.apply === true,
    deleteOrphan: args['delete-orphan'] === true,
  }
}

async function main() {
  const { leagueId, userId, rosterId, apply, deleteOrphan } = parseArgs(process.argv)
  const prisma = new PrismaClient()

  try {
    const session = await prisma.draftSession.findFirst({
      where: { leagueId },
      orderBy: CURRENT_DRAFT_SESSION_ORDER,
      select: { id: true, slotOrder: true },
    })
    if (!session) {
      console.error(`No draft session found for league ${leagueId}`)
      process.exit(2)
    }
    const slotOrder: SlotOrderEntry[] = Array.isArray(session.slotOrder)
      ? (session.slotOrder as unknown as SlotOrderEntry[])
      : []
    if (slotOrder.length === 0) {
      console.error('slotOrder is empty — nothing to repair.')
      process.exit(2)
    }

    // Resolve the human roster.
    const humanRoster = rosterId
      ? await prisma.roster.findFirst({ where: { id: rosterId, leagueId }, select: { id: true, platformUserId: true } })
      : await prisma.roster.findFirst({
          where: { leagueId, platformUserId: userId ?? '' },
          select: { id: true, platformUserId: true },
        })
    if (!humanRoster) {
      console.error(
        `No matching roster in league ${leagueId} for ${rosterId ? `rosterId=${rosterId}` : `userId=${userId}`}`,
      )
      process.exit(2)
    }

    const currentSlot1 = slotOrder[0]
    if (!currentSlot1) {
      console.error('slotOrder[0] missing; cannot repair')
      process.exit(2)
    }

    if (currentSlot1.rosterId === humanRoster.id) {
      console.log('slotOrder[0] already references the human roster. Nothing to do.')
      return
    }

    const displacedOrphanId = currentSlot1.rosterId
    const displacedRoster = await prisma.roster.findUnique({
      where: { id: displacedOrphanId },
      select: { id: true, platformUserId: true },
    })

    // Count references to the displaced orphan that we'd remap.
    const picksToRemap = await prisma.draftPick.findMany({
      where: { session: { leagueId }, rosterId: displacedOrphanId },
      select: { id: true, overall: true, playerName: true },
      orderBy: { overall: 'asc' },
    })
    const auditToRemap = await prisma.draftPickAuditLog.findMany({
      where: {
        leagueId,
        OR: [{ oldRosterId: displacedOrphanId }, { newRosterId: displacedOrphanId }],
      },
      select: { id: true, action: true, overallPickNumber: true, oldRosterId: true, newRosterId: true },
    })

    console.log('Repair plan for league', leagueId)
    console.log(`  slot 1 current rosterId: ${displacedOrphanId} (${displacedRoster?.platformUserId ?? 'missing row'})`)
    console.log(`  slot 1 new rosterId:     ${humanRoster.id} (${humanRoster.platformUserId})`)
    console.log(`  DraftPick rows to remap: ${picksToRemap.length}`)
    for (const p of picksToRemap) console.log(`    pick#${p.overall}: ${p.playerName}`)
    console.log(`  DraftPickAuditLog rows to touch: ${auditToRemap.length}`)
    for (const a of auditToRemap) {
      console.log(`    audit ${a.id} action=${a.action} overall=${a.overallPickNumber}`)
    }
    if (deleteOrphan) {
      console.log(
        `  --delete-orphan requested: will delete roster ${displacedOrphanId} ONLY if no refs remain after remap`,
      )
    }

    if (!apply) {
      console.log('\nDry-run complete. Re-run with --apply to write changes.')
      return
    }

    let pickUpdates = 0
    let auditUpdates = 0
    let orphanDeleted = false

    await prisma.$transaction(
      async (tx) => {
        // Rewrite slotOrder[0].
        const nextSlotOrder = [
          { ...slotOrder[0], rosterId: humanRoster.id, displayName: slotOrder[0].displayName || 'Team 1' },
          ...slotOrder.slice(1),
        ]
        await tx.draftSession.update({
          where: { id: session.id },
          data: {
            slotOrder: nextSlotOrder as unknown,
            version: { increment: 1 },
            updatedAt: new Date(),
          } as any,
        })

        // Remap DraftPick rows.
        for (const p of picksToRemap) {
          await tx.draftPick.update({ where: { id: p.id }, data: { rosterId: humanRoster.id } })
          pickUpdates += 1
        }

        // Remap audit log rows.
        for (const a of auditToRemap) {
          const data: { oldRosterId?: string; newRosterId?: string } = {}
          if (a.oldRosterId === displacedOrphanId) data.oldRosterId = humanRoster.id
          if (a.newRosterId === displacedOrphanId) data.newRosterId = humanRoster.id
          if (Object.keys(data).length) {
            await tx.draftPickAuditLog.update({ where: { id: a.id }, data })
            auditUpdates += 1
          }
        }

        if (deleteOrphan && displacedRoster) {
          // Safety: only delete if nothing still references it.
          const remainingPicks = await tx.draftPick.count({
            where: { session: { leagueId }, rosterId: displacedOrphanId },
          })
          const remainingAudit = await tx.draftPickAuditLog.count({
            where: {
              leagueId,
              OR: [{ oldRosterId: displacedOrphanId }, { newRosterId: displacedOrphanId }],
            },
          })
          const stillInSlotOrder = nextSlotOrder.some((s) => s.rosterId === displacedOrphanId)
          if (remainingPicks === 0 && remainingAudit === 0 && !stillInSlotOrder) {
            await tx.roster.delete({ where: { id: displacedOrphanId } })
            orphanDeleted = true
          } else {
            console.warn(
              `[warn] --delete-orphan skipped: ${remainingPicks} picks, ${remainingAudit} audit rows, slotOrder=${stillInSlotOrder}`,
            )
          }
        }
      },
      { timeout: 30_000, maxWait: 10_000 },
    )

    console.log(
      `\nApplied: slotOrder[0] → ${humanRoster.id}, picks updated=${pickUpdates}, audit updated=${auditUpdates}, orphan deleted=${orphanDeleted}`,
    )
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
