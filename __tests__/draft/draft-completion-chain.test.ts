/**
 * G12 — Draft Lifecycle Audit: completion chain contract tests.
 *
 * Covers the path from board-full detection through session completion,
 * roster assignment, and artifact repair. Tests mix behavioral (mocked DB)
 * and source-contract (read source file) approaches.
 *
 * Key invariants:
 *  - finalizeRosterAssignments is format-agnostic: no sport/leagueType branch
 *  - hasExistingLineup (now exported) is the shared idempotency guard
 *  - DRAFT_COMPLETED event emitted generically from completeDraftSession (G12-2)
 *  - Redraft finalizer no longer double-emits DRAFT_COMPLETED (G12-2)
 *  - hasExistingLineup no longer duplicated (G12-1)
 *  - repairDraftCompletionIfBoardFull source contract verified
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(__dirname, '../..')
function src(rel: string) {
  return readFileSync(resolve(ROOT, rel), 'utf8')
}

// ---------------------------------------------------------------------------
// Prisma mock — includes both findUnique and findFirst for draftSession
// ---------------------------------------------------------------------------
const mocks = vi.hoisted(() => ({
  draftSessionFindUnique: vi.fn(),
  draftSessionFindFirst: vi.fn(),
  draftSessionUpdate: vi.fn(),
  draftPickFindMany: vi.fn(),
  rosterFindFirst: vi.fn(),
  rosterUpdate: vi.fn(),
  getLeagueDraftTemplatePayload: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    draftSession: {
      findUnique: (...a: unknown[]) => mocks.draftSessionFindUnique(...a),
      findFirst: (...a: unknown[]) => mocks.draftSessionFindFirst(...a),
      update: (...a: unknown[]) => mocks.draftSessionUpdate(...a),
    },
    draftPick: {
      findMany: (...a: unknown[]) => mocks.draftPickFindMany(...a),
    },
    roster: {
      findFirst: (...a: unknown[]) => mocks.rosterFindFirst(...a),
      update: (...a: unknown[]) => mocks.rosterUpdate(...a),
    },
    league: { findUnique: vi.fn().mockResolvedValue(null) },
  },
}))

vi.mock('@/lib/league/league-draft-template-payload', () => ({
  getLeagueDraftTemplatePayload: (...a: unknown[]) => mocks.getLeagueDraftTemplatePayload(...a),
}))

// ---------------------------------------------------------------------------
// hasExistingLineup (exported from RosterAssignmentService) — G12-1
// ---------------------------------------------------------------------------
describe('hasExistingLineup — shared guard', () => {
  it('returns false for null playerData', async () => {
    const { hasExistingLineup } = await import('@/lib/live-draft-engine/RosterAssignmentService')
    expect(hasExistingLineup(null)).toBe(false)
  })

  it('returns true when playerData.starters has a non-empty string entry', async () => {
    const { hasExistingLineup } = await import('@/lib/live-draft-engine/RosterAssignmentService')
    expect(hasExistingLineup({ starters: ['p1', 'p2'] })).toBe(true)
  })

  it('returns false when starters is empty strings only', async () => {
    const { hasExistingLineup } = await import('@/lib/live-draft-engine/RosterAssignmentService')
    expect(hasExistingLineup({ starters: ['', ''] })).toBe(false)
  })

  it('returns true when lineup_sections.starters has at least one entry', async () => {
    const { hasExistingLineup } = await import('@/lib/live-draft-engine/RosterAssignmentService')
    expect(hasExistingLineup({ lineup_sections: { starters: [{ id: 'p1' }] } })).toBe(true)
  })

  it('returns false when lineup_sections.starters is empty array', async () => {
    const { hasExistingLineup } = await import('@/lib/live-draft-engine/RosterAssignmentService')
    expect(hasExistingLineup({ lineup_sections: { starters: [] } })).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// finalizeRosterAssignments — format-agnostic behavioral tests
// ---------------------------------------------------------------------------
describe('finalizeRosterAssignments — generic (no league-type branch)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns empty summary when session is not found', async () => {
    mocks.draftSessionFindFirst.mockResolvedValue(null)
    const { finalizeRosterAssignments } = await import('@/lib/live-draft-engine/RosterAssignmentService')
    const summary = await finalizeRosterAssignments('L1')
    expect(summary.teamsSynced).toBe(0)
    expect(summary.playersSynced).toBe(0)
  })

  it('returns empty summary when session status is in_progress', async () => {
    mocks.draftSessionFindFirst.mockResolvedValue({
      id: 'DS1',
      status: 'in_progress',
      picks: [],
    })
    const { finalizeRosterAssignments } = await import('@/lib/live-draft-engine/RosterAssignmentService')
    const summary = await finalizeRosterAssignments('L1')
    expect(summary.teamsSynced).toBe(0)
  })

  it('materializes picks onto rosters when session is completed', async () => {
    mocks.draftSessionFindFirst.mockResolvedValue({
      id: 'DS1',
      status: 'completed',
      picks: [
        { rosterId: 'R1', playerName: 'Josh Allen', position: 'QB', playerId: 'p1', team: 'BUF', byeWeek: 7, pickMetadata: null },
        { rosterId: 'R1', playerName: 'Saquon Barkley', position: 'RB', playerId: 'p2', team: 'PHI', byeWeek: 9, pickMetadata: null },
      ],
    })
    mocks.rosterFindFirst.mockResolvedValue({ id: 'R1', playerData: null })
    mocks.rosterUpdate.mockResolvedValue({})

    const { finalizeRosterAssignments } = await import('@/lib/live-draft-engine/RosterAssignmentService')
    const summary = await finalizeRosterAssignments('L1')
    expect(summary.playersSynced).toBe(2)
    expect(summary.teamsSynced).toBe(1)
    expect(mocks.rosterUpdate).toHaveBeenCalledOnce()
  })

  it('does NOT overwrite existing lineup when hasExistingLineup is true', async () => {
    mocks.draftSessionFindFirst.mockResolvedValue({
      id: 'DS1',
      status: 'completed',
      picks: [
        { rosterId: 'R1', playerName: 'X', position: 'QB', playerId: 'px', team: 'BUF', byeWeek: 7, pickMetadata: null },
      ],
    })
    mocks.rosterFindFirst.mockResolvedValue({
      id: 'R1',
      playerData: { starters: ['existing_p1', 'existing_p2'] },
    })
    mocks.rosterUpdate.mockResolvedValue({})

    const { finalizeRosterAssignments } = await import('@/lib/live-draft-engine/RosterAssignmentService')
    await finalizeRosterAssignments('L1')

    const updateArg = mocks.rosterUpdate.mock.calls[0]?.[0] as { data: { playerData: Record<string, unknown> } }
    expect(updateArg.data.playerData).not.toHaveProperty('lineup_sections')
  })
})

// ---------------------------------------------------------------------------
// repairDraftCompletionIfBoardFull — source contract (G12 self-heal path)
// ---------------------------------------------------------------------------
describe('repairDraftCompletionIfBoardFull — source contract', () => {
  const repairSrc = src('lib/live-draft-engine/postDraftFinalizeArtifacts.ts')

  it('guards on session.status: skips when already completed', () => {
    expect(repairSrc).toMatch(/if \(!session \|\| session\.status === 'completed'\) return false/)
  })

  it('calls isDraftBoardFull to check pick count before completing', () => {
    expect(repairSrc).toMatch(/isDraftBoardFull\(rows as any, totalPicks\)/)
    expect(repairSrc).toMatch(/if \(!isDraftBoardFull/)
  })

  it('calls completeDraftSession when board is full and session is stuck', () => {
    expect(repairSrc).toMatch(/return completeDraftSession\(leagueId\)/)
  })
})

// ---------------------------------------------------------------------------
// DRAFT_COMPLETED event — generic emission from completeDraftSession (G12-2)
// ---------------------------------------------------------------------------
describe('DRAFT_COMPLETED event — generic emission contract (G12-2)', () => {
  const dsSrc = src('lib/live-draft-engine/DraftSessionService.ts')

  it('emits DRAFT_COMPLETED from completeDraftSession for all league types', () => {
    expect(dsSrc).toMatch(/getPlatformEvents\(\)\.emit\(EVENT\.DRAFT_COMPLETED/)
  })

  it('uses a deterministic idempotencyKey scoped to the session id', () => {
    expect(dsSrc).toMatch(/idempotencyKey: `draft\.completed:\$\{draftId\}`/)
  })

  it('returns sessionId from the completion transaction', () => {
    expect(dsSrc).toMatch(/sessionId: session\.id/)
  })

  it('annotates the survivor bootstrap with G12-3 finding comment', () => {
    expect(dsSrc).toMatch(/G12-3 FINDING/)
    expect(dsSrc).toMatch(/runSurvivorPostDraftBootstrap/)
  })
})

// ---------------------------------------------------------------------------
// Redraft path no longer double-emits DRAFT_COMPLETED (G12-2)
// ---------------------------------------------------------------------------
describe('syncCompletedDraftToRedraftSeason — no duplicate DRAFT_COMPLETED (G12-2)', () => {
  const finalizeSrc = src('lib/redraft/finalizeDraftToRedraftSeason.ts')

  it('does not emit DRAFT_COMPLETED from the Redraft finalize path', () => {
    expect(finalizeSrc).not.toMatch(/EVENT\.DRAFT_COMPLETED/)
  })

  it('still emits SEASON_ACTIVATED from the Redraft finalize path', () => {
    expect(finalizeSrc).toMatch(/EVENT\.SEASON_ACTIVATED/)
  })
})

// ---------------------------------------------------------------------------
// hasExistingLineup deduplication — G12-1
// ---------------------------------------------------------------------------
describe('hasExistingLineup deduplication (G12-1)', () => {
  const syncSrc = src('lib/league/roster/draft-to-roster-sync.ts')

  it('draft-to-roster-sync imports hasExistingLineup from RosterAssignmentService', () => {
    expect(syncSrc).toMatch(/import \{[^}]+hasExistingLineup[^}]+\} from '@\/lib\/live-draft-engine\/RosterAssignmentService'/)
  })

  it('draft-to-roster-sync does not define its own hasExistingLineup function', () => {
    expect(syncSrc).not.toMatch(/function hasExistingLineup/)
  })
})

// ---------------------------------------------------------------------------
// finalizeRosterAssignments source — format-agnostic guard
// ---------------------------------------------------------------------------
describe('finalizeRosterAssignments — source contract (format-agnostic)', () => {
  const rasSrc = src('lib/live-draft-engine/RosterAssignmentService.ts')

  it('guards on session.status === "completed" — no league-type check', () => {
    expect(rasSrc).toMatch(/if \(!session \|\| session\.status !== 'completed'\) return EMPTY_FINALIZE_SUMMARY/)
  })

  it('contains no sport or leagueType branch in the finalize path', () => {
    expect(rasSrc).not.toMatch(/leagueType|sport.*===.*NFL|isNflRedraft/)
  })

  it('hasExistingLineup is exported (shared between RosterAssignmentService and draft-to-roster-sync)', () => {
    expect(rasSrc).toMatch(/export function hasExistingLineup/)
  })
})
