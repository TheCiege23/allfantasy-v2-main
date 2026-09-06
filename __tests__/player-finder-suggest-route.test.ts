import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * The suggest route: the query gate, the session → league-id plumbing, and
 * the signed-out path. The suggester itself is mocked; its own suite covers
 * ranking and chips.
 */

const mockSession = vi.hoisted(() => vi.fn())
const mockSuggest = vi.hoisted(() => vi.fn())
const mockLeagueList = vi.hoisted(() => vi.fn())

vi.mock('next-auth', () => ({ getServerSession: mockSession }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/core-app/playerSuggest', () => ({ suggestPlayers: mockSuggest }))
vi.mock('@/lib/dashboard/get-dashboard-league-list', () => ({ getDashboardLeagueListForUser: mockLeagueList }))

beforeEach(() => {
  vi.clearAllMocks()
  mockSuggest.mockResolvedValue([{ name: 'Dalton Kincaid' }])
  mockLeagueList.mockResolvedValue({
    leagues: [{ id: 'L-dragons' }, { id: 'L-gang', hasUnifiedRecord: true }, { id: 'L-ghost', hasUnifiedRecord: false }, { name: 'no id' }],
  })
})

describe('GET /api/core/players/suggest', () => {
  it('refuses a query under two characters', async () => {
    mockSession.mockResolvedValue(null)
    const { GET } = await import('@/app/api/core/players/suggest/route')
    const res = await GET(new Request('http://localhost/api/core/players/suggest?q=k'))
    expect(res.status).toBe(400)
    expect(mockSuggest).not.toHaveBeenCalled()
  })

  it('passes the signed-in user and only the leagues they play', async () => {
    mockSession.mockResolvedValue({ user: { id: 'me' } })
    const { GET } = await import('@/app/api/core/players/suggest/route')
    const res = await GET(new Request('http://localhost/api/core/players/suggest?q=kin&limit=5'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([{ name: 'Dalton Kincaid' }])
    const args = mockSuggest.mock.calls[0][0]
    expect(args).toMatchObject({ query: 'kin', userId: 'me', limit: 5 })
    // The rows with no unified record, and rows with no id, are not played leagues.
    expect(await args.loadLeagueIds()).toEqual(['L-dragons', 'L-gang'])
    expect(mockLeagueList).toHaveBeenCalledWith('me')
  })

  it('still suggests when signed out, with no leagues to load', async () => {
    mockSession.mockResolvedValue(null)
    const { GET } = await import('@/app/api/core/players/suggest/route')
    const res = await GET(new Request('http://localhost/api/core/players/suggest?q=kin'))
    expect(res.status).toBe(200)
    const args = mockSuggest.mock.calls[0][0]
    expect(args).toMatchObject({ userId: null, limit: 8 })
    expect(await args.loadLeagueIds()).toEqual([])
    expect(mockLeagueList).not.toHaveBeenCalled()
  })
})
