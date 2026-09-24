/**
 * One-league repair: remap legacy `placeholder-N` rosterIds on
 * DraftPick + DraftPickAuditLog to the real roster ids created by
 * materializeDraftSlots.
 *
 * USAGE (dry-run, default):
 *   npx tsx scripts/repair-placeholder-rosters-for-league.ts --league=<leagueId>
 *
 * APPLY (writes):
 *   npx tsx scripts/repair-placeholder-rosters-for-league.ts --league=<leagueId> --apply
 *
 * Preconditions:
 *   - materializeDraftSlots has already run for this league (slotOrder now
 *     references real Roster rows for every slot).
 *   - Only DraftPick + DraftPickAuditLog rows using the `placeholder-*` prefix
 *     are touched. Real roster ids are left alone.
 *
 * Safe to run multiple times: after a successful --apply, subsequent runs will
 * find 0 rows to update.
 */

import { PrismaClient } from '@prisma/client'
import { CURRENT_DRAFT_SESSION_ORDER } from '@/lib/draft-room/currentDraftSession'

type SlotOrderEntry = { slot: number; rosterId: string; displayName: string }

interface Args {
  leagueId: string
  apply: boolean
}

function parseArgs(argv: string[]): Args {
  const args: Record<string, string | boolean> = {}
  for (const raw of argv.slice(2)) {
    if (!raw.startsWith('--')) continue
    const [k, v] = raw.slice(2).split('=')
    args[k] = v ?? true
  }
  const leagueId = typeof args.league === 'string' ? args.league : ''
  if (!leagueId) {
    console.error('Missing required --league=<leagueId>')
    process.exit(2)
  }
  return { leagueId, apply: args.apply === true }
}

function isPlaceholderId(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('placeholder-')
}

async function main() {
  const { leagueId, apply } = parseArgs(process.argv)
  const prisma = new PrismaClient()

  try {
    const session = await prisma.draftSession.findFirst({
      where: { leagueId },
      orderBy: CURRENT_DRAFT_SESSION_ORDER,
      select: { id: true, slotOrder: true, teamCount: true },
    })
    if (!session) {
      console.error(`No draft session found for league ${leagueId}`)
      process.exit(2)
    }

    const slotOrder: SlotOrderEntry[] = Array.isArray(session.slotOrder)
      ? (session.slotOrder as unknown as SlotOrderEntry[])
      : []

    // Build slot -> real rosterId map from current slotOrder.
    // (Any slot that still references a placeholder after materialization is a bug; we'll warn.)
    const slotToReal = new Map<number, string>()
    for (const entry of slotOrder) {
      if (isPlaceholderId(entry.rosterId)) {
        console.warn(
          `[warn] slotOrder still has placeholder at slot ${entry.slot} (${entry.rosterId}). Run materialize-slots first.`,
        )
        continue
      }
      slotToReal.set(entry.slot, entry.rosterId)
    }

    if (slotToReal.size === 0) {
      console.error('No real roster ids in slotOrder yet. Run materialize-slots first, then retry.')
      process.exit(2)
    }

    // Find DraftPick rows with placeholder rosterId, grouped by slot.
    const draftPicks = await prisma.draftPick.findMany({
      where: { session: { leagueId }, rosterId: { startsWith: 'placeholder-' } },
      select: { id: true, overall: true, slot: true, rosterId: true, playerName: true },
      orderBy: { overall: 'asc' },
    })

    // Audit rows reference rosterIds on two columns (old + new). We remap both where they're placeholders.
    const auditRows = await prisma.draftPickAuditLog.findMany({
      where: {
        leagueId,
        OR: [{ oldRosterId: { startsWith: 'placeholder-' } }, { newRosterId: { startsWith: 'placeholder-' } }],
      },
      select: {
        id: true,
        action: true,
        overallPickNumber: true,
        round: true,
        oldRosterId: true,
        newRosterId: true,
      },
    })

    console.log('Repair plan for league', leagueId)
    console.log('  slot → real rosterId:')
    for (const [slot, rosterId] of [...slotToReal.entries()].sort((a, b) => a[0] - b[0])) {
      console.log(`    ${slot.toString().padStart(2, ' ')} → ${rosterId}`)
    }
    console.log(`  DraftPick rows to update: ${draftPicks.length}`)
    for (const p of draftPicks) {
      const real = slotToReal.get(p.slot)
      console.log(
        `    pick#${p.overall} slot=${p.slot} ${p.rosterId} → ${real ?? '[no mapping!]'} (${p.playerName})`,
      )
    }
    console.log(`  DraftPickAuditLog rows to touch: ${auditRows.length}`)
    for (const a of auditRows) {
      console.log(
        `    audit ${a.id} action=${a.action} overall=${a.overallPickNumber} round=${a.round} old=${a.oldRosterId} new=${a.newRosterId}`,
      )
    }

    if (!apply) {
      console.log('\nDry-run complete. Re-run with --apply to write changes.')
      return
    }

    // Apply phase.
    let pickUpdates = 0
    let auditUpdates = 0
    await prisma.$transaction(
      async (tx) => {
        for (const p of draftPicks) {
          const real = slotToReal.get(p.slot)
          if (!real) continue
          await tx.draftPick.update({ where: { id: p.id }, data: { rosterId: real } })
          pickUpdates += 1
        }

        for (const a of auditRows) {
          const data: { oldRosterId?: string; newRosterId?: string } = {}
          // Audit log stores overallPickNumber + round; pick slot is not on the row,
          // so derive the slot from current draft session's slotOrder via overallPickNumber.
          // Simpler: map by value — placeholder-N always has slot N encoded in the literal id.
          if (a.oldRosterId && isPlaceholderId(a.oldRosterId)) {
            const slot = Number(a.oldRosterId.replace(/^placeholder-/, ''))
            const real = Number.isFinite(slot) ? slotToReal.get(slot) : undefined
            if (real) data.oldRosterId = real
          }
          if (a.newRosterId && isPlaceholderId(a.newRosterId)) {
            const slot = Number(a.newRosterId.replace(/^placeholder-/, ''))
            const real = Number.isFinite(slot) ? slotToReal.get(slot) : undefined
            if (real) data.newRosterId = real
          }
          if (Object.keys(data).length) {
            await tx.draftPickAuditLog.update({ where: { id: a.id }, data })
            auditUpdates += 1
          }
        }
      },
      { timeout: 30_000, maxWait: 10_000 },
    )

    console.log(`\nApplied: ${pickUpdates} DraftPick updates, ${auditUpdates} audit row updates.`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
