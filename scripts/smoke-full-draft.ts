/**
 * Draft QA Slice — full draft completion smoke (READ-ONLY AUDIT).
 *
 * Audits an existing draft session in Neon and reports:
 *   - picks made vs. expected total
 *   - duplicate players / duplicate overall pick numbers
 *   - placeholder roster IDs still in slotOrder
 *   - picks pointing to a rosterId that doesn't resolve to a real Roster
 *   - chat pick event count + AI-badge count + headshot coverage
 *   - draft audit-log entries (commissioner edits)
 *   - session status + duration
 *
 * USAGE
 *   npm run smoke:full-draft -- --league=<leagueId>
 *   npm run smoke:full-draft -- --league=<leagueId> --json
 *
 * SAFETY: this script is READ-ONLY. It performs no mutations. Safe to run
 * against a real production league or a test-seeded one.
 */

/** server-only stub is loaded by scripts/_audit-preload.cjs (node --require). */

import { PrismaClient } from '@prisma/client'
import {
  auditFullDraft,
  type FullDraftSmokeInput,
  type SmokeChatPickEventRow,
} from '../lib/draft-room/fullDraftSmokeAudit'
import { CURRENT_DRAFT_SESSION_ORDER } from '@/lib/draft-room/currentDraftSession'

const prisma = new PrismaClient()

interface Args {
  leagueId: string
  json: boolean
}

function parseArgs(argv: string[]): Args {
  const out: Args = { leagueId: '', json: false }
  for (const raw of argv) {
    if (raw.startsWith('--league=')) out.leagueId = raw.slice('--league='.length).trim()
    else if (raw === '--json') out.json = true
  }
  return out
}

type SlotOrderEntry = { slot: number; rosterId: string; displayName: string }

function parseSlotOrder(raw: unknown): SlotOrderEntry[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((entry): entry is Record<string, unknown> => entry != null && typeof entry === 'object')
    .map((entry) => ({
      slot: typeof entry.slot === 'number' ? entry.slot : Number(entry.slot ?? 0) || 0,
      rosterId: typeof entry.rosterId === 'string' ? entry.rosterId : String(entry.rosterId ?? ''),
      displayName: typeof entry.displayName === 'string' ? entry.displayName : '',
    }))
    .filter((s) => s.rosterId && s.slot > 0)
}

async function loadInput(leagueId: string): Promise<FullDraftSmokeInput | null> {
  const session = await prisma.draftSession.findFirst({
    where: { leagueId },
    orderBy: CURRENT_DRAFT_SESSION_ORDER,
    select: {
      id: true,
      leagueId: true,
      status: true,
      sessionKind: true,
      teamCount: true,
      draftType: true,
      slotOrder: true,
      startedAt: true,
      completedAt: true,
      rounds: true,
    },
  })
  if (!session) return null

  const expectedTotalPicks =
    typeof session.teamCount === 'number' && typeof session.rounds === 'number'
      ? session.teamCount * session.rounds
      : null

  const [rosters, picks, auditLog, chatPickEvents] = await Promise.all([
    prisma.roster.findMany({
      where: { leagueId },
      select: { id: true, leagueId: true, displayName: true, platformUserId: true },
    }),
    prisma.draftPick.findMany({
      where: { session: { leagueId } },
      select: {
        id: true,
        overall: true,
        round: true,
        roundPick: true,
        rosterId: true,
        playerName: true,
        position: true,
        source: true,
        pickedAt: true,
      },
      orderBy: { overall: 'asc' },
    }),
    prisma.draftPickAuditLog.findMany({
      where: { draftSessionId: session.id },
      select: { id: true, action: true },
    }),
    prisma.leagueChatMessage.findMany({
      where: { leagueId, type: 'draft_pick', source: 'draft' },
      select: { id: true, metadata: true },
    }),
  ])

  const chatRows: SmokePickEventRowLike[] = chatPickEvents.map((c) => ({
    id: c.id,
    metadata: (c.metadata && typeof c.metadata === 'object' ? c.metadata : null) as
      | SmokeChatPickEventRow['metadata']
      | null,
  }))

  return {
    session: {
      id: session.id,
      leagueId: session.leagueId,
      status: session.status,
      sessionKind: session.sessionKind,
      teamCount: session.teamCount,
      draftType: session.draftType,
      slotOrder: parseSlotOrder(session.slotOrder),
      startedAt: session.startedAt,
      completedAt: session.completedAt,
      expectedTotalPicks,
    },
    rosters,
    picks: picks.map((p) => ({
      id: p.id,
      overall: p.overall,
      round: p.round,
      roundPick: p.roundPick ?? null,
      rosterId: p.rosterId,
      playerName: p.playerName,
      position: p.position,
      source: p.source ?? null,
      pickedAt: p.pickedAt,
    })),
    auditLog,
    chatPickEvents: chatRows,
  }
}

type SmokePickEventRowLike = SmokeChatPickEventRow

function printPretty(report: ReturnType<typeof auditFullDraft>): void {
  const bar = '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'
  console.log(bar)
  console.log(' Draft QA — Full Draft Completion Smoke')
  console.log(bar)
  console.log(` League:                ${report.leagueId}`)
  console.log(` Session:               ${report.sessionId}`)
  console.log(` Status:                ${report.status}`)
  console.log(
    ` Picks made:            ${report.picksMade}${
      report.expectedTotalPicks != null ? ` / ${report.expectedTotalPicks}` : ''
    }`,
  )
  if (report.startedAt) console.log(` Started at:            ${report.startedAt}`)
  if (report.completedAt) console.log(` Completed at:          ${report.completedAt}`)
  if (report.durationMs != null) {
    const sec = Math.round(report.durationMs / 1000)
    console.log(` Duration:              ${sec}s (${report.durationMs}ms)`)
  }
  console.log('')
  console.log(' Rosters:')
  console.log(`   in league:                ${report.rosterCounts.totalRostersInLeague}`)
  console.log(`   in slotOrder:             ${report.rosterCounts.rostersInSlotOrder}`)
  console.log(`   without platformUserId:   ${report.rosterCounts.rostersWithoutPlatformUser}`)
  console.log(`   placeholder slots:        ${report.rosterCounts.placeholderSlots.length}`)
  if (report.rosterCounts.placeholderSlots.length) {
    for (const s of report.rosterCounts.placeholderSlots.slice(0, 5)) {
      console.log(`     • slot ${s.slot} → ${s.rosterId}`)
    }
  }
  console.log('')
  console.log(' Duplicates:')
  console.log(`   duplicate player names:   ${report.duplicates.duplicatePlayerNames.length}`)
  console.log(`   duplicate overall picks:  ${report.duplicates.duplicateOverallNumbers.length}`)
  for (const d of report.duplicates.duplicatePlayerNames.slice(0, 5)) {
    console.log(`     • ${d.player} (${d.count}× — picks ${d.overalls.join(', ')})`)
  }
  for (const d of report.duplicates.duplicateOverallNumbers.slice(0, 5)) {
    console.log(`     • #${d.overall} (${d.count}× — pick ids ${d.ids.slice(0, 3).join(', ')})`)
  }
  console.log('')
  console.log(' Orphaned roster assignments:')
  console.log(`   count:                    ${report.orphanedRosterAssignments.length}`)
  for (const o of report.orphanedRosterAssignments.slice(0, 5)) {
    console.log(`     • #${o.overall} ${o.playerName} → ${o.rosterId}`)
  }
  console.log('')
  console.log(' Chat pick events:')
  console.log(`   total:                    ${report.chat.pickEventCount}`)
  console.log(`   autopick (AI badge):      ${report.chat.autopickEventCount}`)
  console.log(`   with headshot URL:        ${report.chat.headshotPresentCount}`)
  console.log('')
  console.log(' Audit log:')
  console.log(`   total entries:            ${report.auditLog.totalEntries}`)
  for (const [action, n] of Object.entries(report.auditLog.byAction)) {
    console.log(`     • ${action}: ${n}`)
  }
  console.log('')
  console.log(` Diagnosis: ${report.diagnosis}`)
  for (const note of report.notes) {
    console.log(`   • ${note}`)
  }
  console.log(bar)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!args.leagueId) {
    console.error('Usage: npm run smoke:full-draft -- --league=<leagueId> [--json]')
    process.exit(2)
  }

  try {
    const input = await loadInput(args.leagueId)
    if (!input) {
      console.error(`No DraftSession found for league ${args.leagueId}`)
      process.exit(2)
    }

    const report = auditFullDraft(input)

    if (args.json) {
      console.log(JSON.stringify(report, null, 2))
    } else {
      printPretty(report)
    }

    // Exit non-zero on BLOCKING so this can gate CI / pre-deploy checks.
    process.exit(report.diagnosis === 'BLOCKING' ? 1 : 0)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch(async (err) => {
  console.error('[smoke-full-draft] failed:', err)
  await prisma.$disconnect()
  process.exit(1)
})
