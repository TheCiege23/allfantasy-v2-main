import { beforeEach, describe, expect, it, vi } from 'vitest'

const session = vi.hoisted(() => vi.fn())
const commissioner = vi.hoisted(() => vi.fn())
const finalize = vi.hoisted(() => vi.fn())

vi.mock('next-auth', () => ({ getServerSession: session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/commissioner/permissions', () => ({ assertCommissioner: commissioner }))
vi.mock('@/lib/league-creation/canonical/finalizeImportedCarryover', () => ({ finalizeImportedCarryover: finalize }))

import { POST } from '@/app/api/leagues/[leagueId]/import-carryover/finalize/route'

const request = new Request('http://localhost/api/leagues/native/import-carryover/finalize', { method: 'POST' })
const context = { params: Promise.resolve({ leagueId: 'native' }) }

beforeEach(() => {
  vi.clearAllMocks()
  session.mockResolvedValue({ user: { id: 'commissioner' } })
  commissioner.mockResolvedValue({ league: { id: 'native' } })
})

describe('imported roster finalization route', () => {
  it('requires a logged-in commissioner', async () => {
    session.mockResolvedValueOnce(null)
    expect((await POST(request, context)).status).toBe(401)
    commissioner.mockRejectedValueOnce(new Error('Forbidden'))
    expect((await POST(request, context)).status).toBe(403)
    expect(finalize).not.toHaveBeenCalled()
  })

  it('reports an incomplete retry without activating the league', async () => {
    finalize.mockResolvedValue({ complete: false, expectedPlayers: 2, materializedPlayers: 1 })
    const response = await POST(request, context)
    expect(response.status).toBe(202)
    expect(await response.json()).toMatchObject({ complete: false, expectedPlayers: 2, materializedPlayers: 1 })
  })

  it('reports completed materialization', async () => {
    finalize.mockResolvedValue({ complete: true, expectedPlayers: 2, materializedPlayers: 2 })
    const response = await POST(request, context)
    expect(response.status).toBe(200)
    expect(commissioner).toHaveBeenCalledWith('native', 'commissioner')
    expect(await response.json()).toMatchObject({ complete: true })
  })
})
