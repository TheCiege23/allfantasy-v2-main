// @vitest-environment node
/**
 * "Tribe emoji in names" (display only) on the server side: Chimmy's weekly commissioner report and the
 * swap/shuffle view. Stored names never change; the setting off leaves both exactly as before.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  db: {
    survivorPlayer: { findMany: vi.fn() },
    league: { findUnique: vi.fn() },
    survivorTribe: { findMany: vi.fn() },
    survivorTribalCouncil: { findMany: vi.fn() },
    survivorVote: { findMany: vi.fn() },
    exileWeeklyEntry: { findMany: vi.fn() },
    survivorTribeSwap: { findFirst: vi.fn() },
    roster: { findMany: vi.fn() },
    survivorAuditEntry: { findFirst: vi.fn(), findUnique: vi.fn(), count: vi.fn() },
  },
  notify: vi.fn(),
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: h.db }))
vi.mock('@/lib/inactive-manager/inactiveManagerMode', () => ({ readManagedLineups: () => ({}), isChimmyRunning: () => true }))
vi.mock('@/lib/survivor/exileRosterRules', () => ({ readExileRoster: () => null }))
vi.mock('@/lib/survivor/survivorCommissionerAlerts', () => ({ notifySurvivorCommissionerOnce: h.notify }))
vi.mock('@/lib/survivor/survivorChallengeBuilder', () => ({ countChimmyChallengeAnswers: async () => new Map() }))
vi.mock('@/lib/survivor/survivorSideGameService', () => ({ loadSideGameReportData: async () => null }))
vi.mock('@/lib/survivor/survivorSideGameSummary', () => ({ sideGameWeeklyReportLine: () => null }))
vi.mock('@/lib/survivor/SurvivorLeagueConfig', () => ({ getSurvivorConfig: vi.fn(async () => ({ configId: 'cfg' })) }))
vi.mock('@/lib/survivor/SurvivorRosterState', () => ({ getActiveRosterIdsForLeague: vi.fn(async () => []) }))
vi.mock('@/lib/survivor/survivorSetupTransaction', () => ({ withSurvivorSetupTransaction: vi.fn() }))
vi.mock('@/lib/survivor/survivorTribeChatProvisioning', () => ({ provisionSurvivorChats: vi.fn() }))

import { sendChimmyWeeklyReport } from '@/lib/survivor/chimmyWeeklyReport'
import { getTribeShuffleView } from '@/lib/survivor/tribeSwapService'

const settings = (on: boolean) => ({ survivorGovernance: { tribeEmojiInNames: on } })

beforeEach(() => {
  vi.clearAllMocks()
  h.notify.mockResolvedValue({ sent: true })
  h.db.survivorPlayer.findMany.mockResolvedValue([
    { userId: 'orphan-r1', displayName: 'Seat One', playerState: 'active', redraftRosterId: 'r1', tribeId: 'vela' },
    { userId: 'orphan-r2', displayName: 'Seat Two', playerState: 'eliminated', redraftRosterId: 'r2', tribeId: 'vela' },
  ])
  h.db.survivorTribe.findMany.mockResolvedValue([{ id: 'vela', name: 'Vela', catalogId: 'scorpion', isMerged: false }])
  h.db.survivorTribalCouncil.findMany.mockResolvedValue([])
  h.db.survivorVote.findMany.mockResolvedValue([])
  h.db.exileWeeklyEntry.findMany.mockResolvedValue([])
})

describe("Chimmy's weekly commissioner report", () => {
  it('shows the tribe emoji beside a castaway still in a tribe, and nobody else', async () => {
    h.db.league.findUnique.mockResolvedValue({ settings: settings(true), language: 'en' })
    await sendChimmyWeeklyReport('L1', 5)
    const body = h.notify.mock.calls[0][2].body as string
    expect(body).toContain('Seat One 🦂: still in the game')
    expect(body).toContain('Seat Two: out of the game')
  })

  it('setting off: the names exactly as stored, and no tribe read', async () => {
    h.db.league.findUnique.mockResolvedValue({ settings: settings(false), language: 'en' })
    await sendChimmyWeeklyReport('L1', 5)
    expect(h.notify.mock.calls[0][2].body).toContain('Seat One: still in the game')
    expect(h.db.survivorTribe.findMany).not.toHaveBeenCalled()
  })
})

describe('the swap / shuffle view', () => {
  beforeEach(() => {
    h.db.survivorTribeSwap.findFirst.mockResolvedValue(null)
    h.db.survivorTribe.findMany.mockResolvedValue([
      { id: 'vela', name: 'Vela', colorHex: null, logoUrl: null, isMerged: false, isActive: true, catalogId: 'scorpion', createdAt: new Date() },
      { id: 'zz', name: 'Zzyzx', colorHex: null, logoUrl: null, isMerged: false, isActive: true, catalogId: null, createdAt: new Date() },
    ])
    h.db.survivorPlayer.findMany.mockResolvedValue([])
    h.db.roster.findMany.mockResolvedValue([])
    h.db.survivorAuditEntry.findFirst.mockResolvedValue(null)
  })

  it('each tribe carries its emoji and shows it beside its name, with the league language', async () => {
    h.db.league.findUnique.mockResolvedValue({ userId: 'commish', sport: 'NFL', survivorSwapWeek: 4, survivorMergeWeek: 9, settings: settings(true), language: 'es' })
    const view = await getTribeShuffleView('L1', 'u1')
    expect(view.tribes.map((t) => [t.name, t.emoji])).toEqual([['Vela 🦂', '🦂'], ['Zzyzx', null]])
    expect(view.language).toBe('es')
  })

  it('setting off: no emoji, names unchanged', async () => {
    h.db.league.findUnique.mockResolvedValue({ userId: 'commish', sport: 'NFL', survivorSwapWeek: 4, survivorMergeWeek: 9, settings: settings(false), language: null })
    const view = await getTribeShuffleView('L1', 'u1')
    expect(view.tribes.map((t) => [t.name, t.emoji])).toEqual([['Vela', null], ['Zzyzx', null]])
  })
})
