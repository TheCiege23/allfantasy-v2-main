import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  survivorTribalCouncil: { findUnique: vi.fn(), update: vi.fn() },
  survivorIdol: { findFirst: vi.fn(), updateMany: vi.fn() },
  survivorIdolLedgerEntry: { create: vi.fn() },
  roster: { findFirst: vi.fn() },
  survivorPlayer: { findUnique: vi.fn() },
  survivorJuryMember: { findUnique: vi.fn() },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

import { playIdol } from '@/lib/survivor/idolEngine'

beforeEach(() => {
  vi.clearAllMocks()
  db.survivorTribalCouncil.findUnique.mockResolvedValue({ id: 'council-1', leagueId: 'league-1', status: 'voting_open', week: 4, idolsPlayed: [] })
  db.roster.findFirst.mockImplementation(async ({ where }) => ({ id: `roster-${where.platformUserId}` }))
  db.survivorIdol.updateMany.mockResolvedValue({ count: 1 })
  db.survivorPlayer.findUnique.mockResolvedValue({ playerState: 'active', isJuryMember: false })
  db.survivorJuryMember.findUnique.mockResolvedValue(null)
})

describe('legacy idol play route engine', () => {
  it('refuses to play an idol held by another manager', async () => {
    db.survivorIdol.findFirst.mockResolvedValue({ id: 'idol-1', status: 'hidden', currentOwnerUserId: 'owner', rosterId: 'roster-owner', powerType: 'protect_self' })
    expect(await playIdol('idol-1', 'intruder', 'council-1')).toEqual({ ok: false, error: 'Invalid idol' })
    expect(db.survivorIdol.updateMany).not.toHaveBeenCalled()
  })

  it('falls back to the bound roster when no owner user is recorded', async () => {
    db.survivorIdol.findFirst.mockResolvedValue({ id: 'idol-1', status: 'hidden', currentOwnerUserId: null, rosterId: 'roster-owner', powerType: 'protect_self' })
    expect((await playIdol('idol-1', 'intruder', 'council-1')).ok).toBe(false)
    expect(db.survivorIdol.updateMany).not.toHaveBeenCalled()
  })

  it('lets only one of two simultaneous plays use the idol', async () => {
    db.survivorIdol.findFirst.mockResolvedValue({ id: 'idol-1', status: 'hidden', currentOwnerUserId: 'owner', rosterId: 'roster-owner', powerType: 'protect_self' })
    db.survivorIdol.updateMany.mockResolvedValue({ count: 0 })
    expect(await playIdol('idol-1', 'owner', 'council-1')).toEqual({ ok: false, error: 'Invalid idol' })
    expect(db.survivorIdolLedgerEntry.create).not.toHaveBeenCalled()
  })

  it('a juror cannot play an idol they still hold', async () => {
    db.survivorIdol.findFirst.mockResolvedValue({ id: 'idol-1', status: 'hidden', currentOwnerUserId: 'owner', rosterId: 'roster-owner', powerType: 'protect_self' })
    db.survivorJuryMember.findUnique.mockResolvedValue({ id: 'jury-row' })
    expect(await playIdol('idol-1', 'owner', 'council-1')).toEqual({ ok: false, error: 'Jurors cannot play idols.' })
    db.survivorJuryMember.findUnique.mockResolvedValue(null)
    db.survivorPlayer.findUnique.mockResolvedValue({ playerState: 'jury', isJuryMember: true })
    expect(await playIdol('idol-1', 'owner', 'council-1')).toEqual({ ok: false, error: 'Jurors cannot play idols.' })
    expect(db.survivorIdol.updateMany).not.toHaveBeenCalled()
  })
})
