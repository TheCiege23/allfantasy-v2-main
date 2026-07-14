import { beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const getLiveADP = vi.fn()
const loadSportAwareDraftPlayerPool = vi.fn()

vi.mock('@/lib/adp-data', () => ({ getLiveADP }))
vi.mock('@/lib/mock-draft/sport-player-pool', () => ({ loadSportAwareDraftPlayerPool }))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/mock-draft-simulator/DraftAIManager', () => ({ makeAIPick: vi.fn() }))

const { loadMockDraftPlayerPool } = await import('@/lib/mock-draft-engine/MockDraftRuntimeService')

const baseSettings = {
  leagueType: 'redraft',
  draftType: 'snake',
  numTeams: 8,
  rounds: 12,
  timerSeconds: 60,
  aiEnabled: true,
  scoringFormat: 'default',
  poolType: 'all',
  roomMode: 'solo' as const,
  humanTeams: 1,
  keepersEnabled: false,
  keepers: [],
}

describe('mock draft sport-pool isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getLiveADP.mockResolvedValue([{ name: 'NFL Player', position: 'QB' }])
    loadSportAwareDraftPlayerPool.mockResolvedValue([{ name: 'College Player', position: 'QB' }])
  })

  it('never loads the NFL live-ADP feed for an NCAAF mock draft', async () => {
    const result = await loadMockDraftPlayerPool({ ...baseSettings, sport: 'NCAAF' })

    expect(getLiveADP).not.toHaveBeenCalled()
    expect(loadSportAwareDraftPlayerPool).toHaveBeenCalledWith({
      sport: 'NCAAF',
      leagueId: null,
      limit: 216,
    })
    expect(result).toEqual([{ name: 'College Player', position: 'QB' }])
  })

  it('retains the NFL live-ADP fast path for NFL mock drafts', async () => {
    const result = await loadMockDraftPlayerPool({ ...baseSettings, sport: 'NFL' })

    expect(getLiveADP).toHaveBeenCalledWith('redraft', 216)
    expect(loadSportAwareDraftPlayerPool).not.toHaveBeenCalled()
    expect(result[0]?.name).toBe('NFL Player')
  })
})

describe('mock draft exposed-format safety', () => {
  it('does not advertise auction in either live mock-room setup', () => {
    const setup = fs.readFileSync(path.join(process.cwd(), 'components/mock-draft/MockDraftSetup.tsx'), 'utf8')
    const room = fs.readFileSync(path.join(process.cwd(), 'components/mock-draft/MockDraftSleeperRoomClient.tsx'), 'utf8')
    const createRoute = fs.readFileSync(path.join(process.cwd(), 'app/api/mock-draft/create/route.ts'), 'utf8')

    expect(setup).not.toMatch(/value:\s*'auction',\s*label:\s*'Auction'/)
    expect(room).not.toMatch(/value:\s*'auction',\s*label:\s*'Auction'/)
    expect(createRoute).toContain('Auction mock drafts are not available in the live mock room yet.')
  })
})
