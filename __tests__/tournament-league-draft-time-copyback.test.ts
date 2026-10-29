/**
 * copyLeagueDraftTimeToTournament: the league → tournament half of draft-time sync. Only a league linked
 * as a divisions conference league is touched; an unchanged time writes nothing.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  prisma: {
    tournamentLeague: { findUnique: vi.fn(), update: vi.fn() },
    tournamentAuditLog: { create: vi.fn() },
  },
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: m.prisma }))

import { copyLeagueDraftTimeToTournament } from '@/lib/tournament/divisions/leagueDraftTimeToTournament'

const OLD = new Date('2026-10-30T23:00:00.000Z')
const NEW = new Date('2026-11-01T23:00:00.000Z')

function linked(format = 'divisions', at: Date | null = OLD) {
  m.prisma.tournamentLeague.findUnique.mockResolvedValue({ id: 'tl1', name: 'North', tournamentId: 't1', draftScheduledAt: at, tournament: { format } })
}

beforeEach(() => {
  vi.clearAllMocks()
  m.prisma.tournamentLeague.update.mockResolvedValue({})
  m.prisma.tournamentAuditLog.create.mockResolvedValue({})
})

describe('league draft time → tournament conference record', () => {
  it('🛑 copies a new league draft time onto the conference, audited as the acting user', async () => {
    linked()
    expect(await copyLeagueDraftTimeToTournament('L1', NEW, 'co1')).toBe('copied')
    expect(m.prisma.tournamentLeague.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { leagueId: 'L1' } }))
    expect(m.prisma.tournamentLeague.update).toHaveBeenCalledWith({ where: { id: 'tl1' }, data: { draftScheduledAt: NEW } })
    const audit = m.prisma.tournamentAuditLog.create.mock.calls[0][0].data
    expect(audit).toMatchObject({ tournamentId: 't1', actorId: 'co1', action: 'divisions_draft_times_synced' })
    // The control screen reads the per-league entry and shows the league as scheduled.
    expect(audit.data).toMatchObject({ via: 'league', from: OLD.toISOString(), to: NEW.toISOString(), leagues: [{ tournamentLeagueId: 'tl1', outcome: 'scheduled' }] })
  })

  it('an unchanged time writes nothing (the tournament → league sync then has nothing to re-send)', async () => {
    linked('divisions', NEW)
    expect(await copyLeagueDraftTimeToTournament('L1', new Date(NEW.getTime()), 'co1')).toBe('unchanged')
    expect(m.prisma.tournamentLeague.update).not.toHaveBeenCalled()
    expect(m.prisma.tournamentAuditLog.create).not.toHaveBeenCalled()
  })

  it('a cleared league time clears the conference time', async () => {
    linked()
    expect(await copyLeagueDraftTimeToTournament('L1', null, 'owner')).toBe('copied')
    expect(m.prisma.tournamentLeague.update).toHaveBeenCalledWith({ where: { id: 'tl1' }, data: { draftScheduledAt: null } })
  })

  it('a league no tournament links is left alone', async () => {
    m.prisma.tournamentLeague.findUnique.mockResolvedValue(null)
    expect(await copyLeagueDraftTimeToTournament('L9', NEW, 'u')).toBe('not_linked')
    expect(m.prisma.tournamentLeague.update).not.toHaveBeenCalled()
  })

  it('a league linked by another tournament format is left alone', async () => {
    linked('bracket')
    expect(await copyLeagueDraftTimeToTournament('L1', NEW, 'u')).toBe('not_linked')
    expect(m.prisma.tournamentLeague.update).not.toHaveBeenCalled()
  })
})
