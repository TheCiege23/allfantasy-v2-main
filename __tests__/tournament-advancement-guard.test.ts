// @vitest-environment node
/**
 * Guards the only irreversible action on the hub.
 *
 * 🛑 `identifyQualifiers` WRITES THE MOMENT IT IS CALLED — it stamps
 * `advancementStatus` on every participant, with no dry run and no undo. The
 * call that works out who advances is the same call that ends 176 seasons.
 *
 * 🛑 AND AN UNMATCHED MANAGER IS SILENTLY ELIMINATED BY IT: with no imported
 * team row, `calculateLeagueStandings` falls back to the zeros stored on the
 * participant, which sorts them last. Afterwards nothing distinguishes "we could
 * not read this manager's record" from "this manager lost every week".
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const roundFindFirst = vi.fn()
const advancementCount = vi.fn()
const auditCreate = vi.fn()
const getBoard = vi.fn()
const identifyQualifiers = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: {
    tournamentRound: { findFirst: (...a: unknown[]) => roundFindFirst(...a) },
    tournamentAdvancementGroup: { count: (...a: unknown[]) => advancementCount(...a) },
    tournamentAuditLog: { create: (...a: unknown[]) => auditCreate(...a) },
  },
}))
vi.mock('@/lib/tournament/standingsBoard', () => ({
  getTournamentStandingsBoard: (...a: unknown[]) => getBoard(...a),
}))
vi.mock('@/lib/tournament/advancementEngine', () => ({
  identifyQualifiers: (...a: unknown[]) => identifyQualifiers(...a),
}))

import { previewAdvancement, signatureOf } from '@/lib/tournament/advancementPreview'
import { runGuardedAdvancement } from '@/lib/tournament/runGuardedAdvancement'

function board(opts: { unmatched?: number; cut?: number; rows?: number; fresh?: boolean } = {}) {
  const rowCount = opts.rows ?? 6
  const cut = opts.cut ?? 2
  const rows = Array.from({ length: rowCount }, (_, i) => ({
    leagueParticipantId: `lp${i}`,
    participantId: `p${i}`,
    userId: `u${i}`,
    displayName: `mgr${i}`,
    wins: rowCount - i,
    losses: i,
    ties: 0,
    pointsFor: 1000 - i,
    pointsAgainst: 900,
    appUserId: null,
    leagueRank: i + 1,
    conferenceRank: i + 1,
    unmatched: false,
    matchedBy: 'platformUserId' as const,
    standing: (i < cut ? 'in' : 'out') as 'in' | 'out',
  }))
  return {
    tournamentId: 't1',
    name: 'KBI',
    roundNumber: 1,
    advancersPerLeague: 0,
    wildcardCount: cut,
    bubbleEnabled: false,
    bubbleSize: 0,
    tiebreakerMode: 'points_for',
    unmatchedTotal: opts.unmatched ?? 0,
    oldestUpdatedAt: opts.fresh === false ? new Date('2020-01-01T00:00:00Z') : new Date(),
    conferences: [
      {
        id: 'c1',
        name: 'BLACK',
        colorHex: null,
        qualifyingCount: cut,
        conferencePoints: 1,
        leagues: [
          {
            tournamentLeagueId: 'tl1',
            leagueId: 'lg1',
            name: 'BEAST',
            unmatchedCount: opts.unmatched ?? 0,
            unclaimedTeams: [],
            oldestUpdatedAt: null,
            rows,
          },
        ],
      },
    ],
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  roundFindFirst.mockResolvedValue({ id: 'r1' })
  advancementCount.mockResolvedValue(0)
  auditCreate.mockResolvedValue({})
  getBoard.mockResolvedValue(board())
  identifyQualifiers.mockResolvedValue({
    directQualifiers: ['p0', 'p1'],
    wildcards: [],
    bubble: [],
    eliminated: ['p2', 'p3', 'p4', 'p5'],
  })
})

describe('the preview', () => {
  it('writes nothing and reports who is in and out', async () => {
    const out = await previewAdvancement('t1', 'commish')
    expect(out).toMatchObject({ totalAdvancing: 2, totalEliminated: 4 })
    expect(identifyQualifiers).not.toHaveBeenCalled()
  })

  /**
   * ⚠ THE CLOSE CALLS ARE WHAT A HUMAN CAN ACTUALLY CHECK. Nobody verifies 64
   * names; everybody can check the few either side of the line, which is exactly
   * where a wrong setting or a missing link shows up.
   */
  it('shows the managers either side of the line', async () => {
    const out = await previewAdvancement('t1', 'commish')
    const c = out!.conferences[0]
    expect(c.lastIn.map((m) => m.displayName)).toEqual(['mgr0', 'mgr1'])
    expect(c.firstOut.map((m) => m.displayName)).toEqual(['mgr2', 'mgr3', 'mgr4'])
  })

  it('blocks on unmatched managers, saying why it matters', async () => {
    getBoard.mockResolvedValue(board({ unmatched: 3 }))
    const out = await previewAdvancement('t1', 'commish')
    const b = out!.blockers.find((x) => x.code === 'unmatched' && x.severity === 'blocker')
    expect(b?.message).toMatch(/missing link/i)
  })

  it('blocks a cut of zero and a cut that eliminates nobody', async () => {
    getBoard.mockResolvedValue(board({ cut: 0 }))
    expect((await previewAdvancement('t1', 'x'))!.blockers.some((b) => b.code === 'no_cut')).toBe(true)
    getBoard.mockResolvedValue(board({ cut: 6, rows: 6 }))
    expect(
      (await previewAdvancement('t1', 'x'))!.blockers.some((b) => b.code === 'cut_exceeds_field'),
    ).toBe(true)
  })

  it('blocks a round that has already been advanced', async () => {
    advancementCount.mockResolvedValue(1)
    const out = await previewAdvancement('t1', 'commish')
    expect(out!.blockers.some((b) => b.code === 'already_advanced')).toBe(true)
  })

  /** ⚠ Stale data is a warning, not a blocker — a settled week may legitimately not sync. */
  it('warns rather than blocks on a stale sync', async () => {
    getBoard.mockResolvedValue(board({ fresh: false }))
    const out = await previewAdvancement('t1', 'commish')
    const stale = out!.blockers.find((b) => b.severity === 'warning')
    expect(stale?.message).toMatch(/synced/i)
  })
})

describe('the signature', () => {
  /**
   * 🛑 SWAPPING 64th AND 65th LEAVES EVERY COUNT IDENTICAL. A fingerprint over
   * counts alone would call that "unchanged" and let a commissioner confirm a
   * cut they never read.
   */
  it('changes when the order changes, not just the counts', () => {
    const a = board()
    const b = board()
    const rows = b.conferences[0].leagues[0].rows
    ;[rows[1].participantId, rows[2].participantId] = [rows[2].participantId, rows[1].participantId]
    rows[1].standing = 'in'
    rows[2].standing = 'out'
    expect(signatureOf(a)).not.toBe(signatureOf(b))
  })

  it('is stable for the same board', () => {
    expect(signatureOf(board())).toBe(signatureOf(board()))
  })
})

describe('running it', () => {
  it('runs when the signature matches and nothing blocks', async () => {
    const preview = await previewAdvancement('t1', 'commish')
    const out = await runGuardedAdvancement({
      tournamentId: 't1',
      commissionerUserId: 'commish',
      expectedSignature: preview!.signature,
    })
    expect(out).toMatchObject({ ok: true, qualified: 2, eliminated: 4 })
    expect(identifyQualifiers).toHaveBeenCalledWith('t1', 'r1')
  })

  /**
   * 🛑 THE BOARD MOVES BETWEEN LOOKING AND CLICKING. A sync landing in between
   * changes who is 64th, and confirming then authorises a cut nobody read.
   */
  it('refuses a stale signature and runs nothing', async () => {
    const out = await runGuardedAdvancement({
      tournamentId: 't1',
      commissionerUserId: 'commish',
      expectedSignature: 'from-an-older-look',
    })
    expect(out).toMatchObject({ ok: false, status: 409 })
    expect(identifyQualifiers).not.toHaveBeenCalled()
  })

  it('refuses while a blocker is unacknowledged, and names it', async () => {
    getBoard.mockResolvedValue(board({ unmatched: 2 }))
    const preview = await previewAdvancement('t1', 'commish')
    const out = await runGuardedAdvancement({
      tournamentId: 't1',
      commissionerUserId: 'commish',
      expectedSignature: preview!.signature,
    })
    expect(out).toMatchObject({ ok: false, status: 400 })
    expect((out as { blockers?: Array<{ code: string }> }).blockers?.[0].code).toBe('unmatched')
    expect(identifyQualifiers).not.toHaveBeenCalled()
  })

  it('runs once every blocker is explicitly acknowledged', async () => {
    getBoard.mockResolvedValue(board({ unmatched: 2 }))
    const preview = await previewAdvancement('t1', 'commish')
    const out = await runGuardedAdvancement({
      tournamentId: 't1',
      commissionerUserId: 'commish',
      expectedSignature: preview!.signature,
      acknowledge: ['unmatched'],
    })
    expect(out).toMatchObject({ ok: true })
  })

  /**
   * ⚠ THE OVERRIDE IS RECORDED. If someone was eliminated because a link was
   * missing and that was waved through, the record has to say it was a choice —
   * otherwise the only evidence left is a manager who looks like he lost out.
   */
  it('records which blockers were overridden', async () => {
    getBoard.mockResolvedValue(board({ unmatched: 2 }))
    const preview = await previewAdvancement('t1', 'commish')
    await runGuardedAdvancement({
      tournamentId: 't1',
      commissionerUserId: 'commish',
      expectedSignature: preview!.signature,
      acknowledge: ['unmatched'],
    })
    expect(auditCreate.mock.calls[0][0].data.data.overrode).toEqual(['unmatched'])
  })

  it('refuses a tournament this user does not commission', async () => {
    getBoard.mockResolvedValue(null)
    const out = await runGuardedAdvancement({
      tournamentId: 't1',
      commissionerUserId: 'someone-else',
      expectedSignature: 'x',
    })
    expect(out).toMatchObject({ ok: false, status: 404 })
    expect(identifyQualifiers).not.toHaveBeenCalled()
  })
})
