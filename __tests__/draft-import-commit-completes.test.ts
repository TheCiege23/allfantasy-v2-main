// @vitest-environment node
/**
 * An offline draft is imported, not played. A full imported board finishes the draft through
 * completeDraftSession, the same path a live room uses, so rosters, the season and the Survivor
 * setup follow; a partial import leaves the draft in progress for the room to finish.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  tx: {
    draftSession: { findFirst: vi.fn(), update: vi.fn() },
    draftPick: { deleteMany: vi.fn(), create: vi.fn() },
  },
  db: {
    draftSession: { findFirst: vi.fn() },
    draftImportBackup: { upsert: vi.fn() },
    $transaction: vi.fn(),
  },
  complete: vi.fn(),
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: m.db }))
vi.mock('@/lib/live-draft-engine/DraftSessionService', () => ({ completeDraftSession: m.complete }))

import { commitImport } from '@/lib/draft-import/ImportCommitFlow'

const slotOrder = [{ slot: 1, rosterId: 'r1', displayName: 'A' }, { slot: 2, rosterId: 'r2', displayName: 'B' }]
function pick(overall: number) {
  return { overall, round: overall <= 2 ? 1 : 2, slot: overall === 1 || overall === 4 ? 1 : 2, rosterId: overall === 1 || overall === 4 ? 'r1' : 'r2', displayName: null, playerName: `Player ${overall}`, position: 'QB', team: 'KC', byeWeek: 7, playerId: `p${overall}`, tradedPickMeta: null, source: 'user' }
}
function preview(count: number) {
  return { slotOrder, picks: Array.from({ length: count }, (_, i) => pick(i + 1)), tradedPicks: [], keeperSelections: [], keeperConfig: null, metadata: { rounds: 2, teamCount: 2 } } as never
}

describe('commitImport', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    const session = { id: 'session', leagueId: 'L1', rounds: 2, teamCount: 2, draftType: 'snake', thirdRoundReversal: false, slotOrder, tradedPicks: [], keeperSelections: [], keeperConfig: null, picks: [], sportType: 'NFL' }
    m.db.draftSession.findFirst.mockResolvedValue(session)
    m.tx.draftSession.findFirst.mockResolvedValue(session)
    m.tx.draftPick.deleteMany.mockResolvedValue({ count: 0 })
    m.tx.draftPick.create.mockResolvedValue({})
    m.tx.draftSession.update.mockResolvedValue({})
    m.db.$transaction.mockImplementation(async (work: (tx: typeof m.tx) => Promise<unknown>) => work(m.tx))
    m.complete.mockResolvedValue(true)
  })

  it('a full board is written in progress and then finished through completeDraftSession', async () => {
    expect(await commitImport('L1', preview(4))).toEqual({ success: true, backupId: undefined, completed: true })
    expect(m.tx.draftPick.create).toHaveBeenCalledTimes(4)
    expect(m.tx.draftSession.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'in_progress', rounds: 2, teamCount: 2 }) }))
    expect(m.complete).toHaveBeenCalledWith('L1')
  })

  it('a partial board stays in progress and nothing is finished', async () => {
    expect(await commitImport('L1', preview(3))).toEqual({ success: true, backupId: undefined, completed: false })
    expect(m.tx.draftSession.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'in_progress' }) }))
    expect(m.complete).not.toHaveBeenCalled()
  })

  it('reports a full board the engine refused to finish', async () => {
    m.complete.mockResolvedValue(false)
    expect(await commitImport('L1', preview(4))).toEqual({ success: true, backupId: undefined, completed: false })
  })
})
