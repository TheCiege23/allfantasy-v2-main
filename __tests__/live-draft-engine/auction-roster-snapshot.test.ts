import { describe, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({ find: vi.fn(), update: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { roster: { findFirst: m.find, update: m.update } } }))
vi.mock('@/lib/tournament/seasonDraftMutationGate', () => ({ isSeasonTournamentDraft: async () => false }))
import { appendPickToRosterDraftSnapshot } from '@/lib/live-draft-engine/RosterAssignmentService'

describe('draft snapshot after completion', () => {
  it('does not append the final sale twice after finalization already wrote it', async () => {
    m.find.mockResolvedValue({ id: 'a', playerData: { draftPicks: [{ playerId: 'p1', playerName: 'Player', position: 'QB' }] } })
    await appendPickToRosterDraftSnapshot('league', 'a', { playerId: 'p1', playerName: 'Player', position: 'QB' })
    expect(m.update).not.toHaveBeenCalled()
  })
})
