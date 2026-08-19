import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  rosterFind: vi.fn(), scoreFind: vi.fn(), gameFind: vi.fn(), cacheFind: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    redraftRosterPlayer: { findMany: h.rosterFind },
    playerWeeklyScore: { findMany: h.scoreFind },
    sportsGame: { findFirst: h.gameFind },
    sportsDataCache: { findUnique: h.cacheFind },
  },
}))

import { playerOfTheWeekForRoster, composeStatLine } from '@/lib/live/playerOfTheWeek'

const ROSTER = [{ playerId: '101', playerName: 'Bijan Robinson', position: 'RB', team: 'ATL' }]
const SCORE = [{
  playerId: '101', fantasyPts: 31.44, isFinalized: true,
  stats: { rushing_yards: 187, rushing_touchdowns: 3, receptions: 2, receiving_yards: 14 },
}]

beforeEach(() => {
  for (const m of Object.values(h)) m.mockReset()
  h.rosterFind.mockResolvedValue(ROSTER)
  h.scoreFind.mockResolvedValue(SCORE)
  h.gameFind.mockResolvedValue({ externalId: 'g1', homeTeam: 'NO', awayTeam: 'ATL' })
  h.cacheFind.mockResolvedValue({
    data: { url: 'https://www.youtube.com/watch?v=abc' },
    expiresAt: new Date(Date.now() + 60_000),
  })
})

const call = () => playerOfTheWeekForRoster({ rosterId: 'r1', week: 3, season: 2026 })

describe('the moment', () => {
  it('picks the best scorer and reads like a person wrote it', async () => {
    const r = await call()
    expect(r?.playerName).toBe('Bijan Robinson')
    expect(r?.fantasyPoints).toBe(31.4)
    expect(r?.statLine).toBe('187 rushing yards, 3 rushing TD, 2 rec, 14 receiving yards')
  })

  it('finds the game whether the player was home OR away', async () => {
    await call()
    // A home-only match would silently drop half the league every week.
    const where = h.gameFind.mock.calls[0][0].where
    expect(where.OR).toEqual([{ homeTeam: 'ATL' }, { awayTeam: 'ATL' }])
  })

  it('attaches the highlight when one exists', async () => {
    expect((await call())?.highlightUrl).toBe('https://www.youtube.com/watch?v=abc')
  })
})

describe('the video is garnish, not the feature', () => {
  it('still returns the moment when no highlight exists', async () => {
    h.cacheFind.mockResolvedValue(null)
    const r = await call()
    expect(r?.highlightUrl).toBeNull()
    expect(r?.statLine).toContain('187 rushing yards') // the card still stands
  })

  it('ignores an expired highlight rather than serving a dead link', async () => {
    h.cacheFind.mockResolvedValue({
      data: { url: 'https://youtube.com/x' },
      expiresAt: new Date(Date.now() - 1000),
    })
    expect((await call())?.highlightUrl).toBeNull()
  })

  it('rejects a non-URL that somehow landed in the cache', async () => {
    h.cacheFind.mockResolvedValue({ data: { url: 'not a url' }, expiresAt: new Date(Date.now() + 60_000) })
    expect((await call())?.highlightUrl).toBeNull()
  })

  it('survives the game lookup failing', async () => {
    h.gameFind.mockRejectedValue(new Error('db down'))
    const r = await call()
    expect(r?.game).toBeNull()
    expect(r?.playerName).toBe('Bijan Robinson')
  })
})

describe('empty states', () => {
  it('returns null rather than celebrating a zero', async () => {
    // A card reading "0.0 pts" looks like a bug on a Tuesday morning.
    h.scoreFind.mockResolvedValue([{ ...SCORE[0], fantasyPts: 0 }])
    expect(await call()).toBeNull()
  })

  it('returns null on an empty roster', async () => {
    h.rosterFind.mockResolvedValue([])
    expect(await call()).toBeNull()
  })

  it('returns null when nobody has been scored yet', async () => {
    h.scoreFind.mockResolvedValue([])
    expect(await call()).toBeNull()
  })

  it('excludes dropped players from consideration', async () => {
    await call()
    expect(h.rosterFind.mock.calls[0][0].where.droppedAt).toBeNull()
  })

  it('flags a provisional week so the UI can label it', async () => {
    h.scoreFind.mockResolvedValue([{ ...SCORE[0], isFinalized: false }])
    expect((await call())?.isFinal).toBe(false)
  })
})

describe('composeStatLine', () => {
  it('handles a passing line', () => {
    expect(composeStatLine({ passing_yards: 341, passing_touchdowns: 4 }))
      .toBe('341 passing yards, 4 passing TD')
  })

  it('handles an IDP line, so a defender can be the moment too', () => {
    expect(composeStatLine({ idp_sack: 2, idp_interception: 1, idp_solo_tackle: 7, idp_assist_tackle: 3 }))
      .toBe('2 sacks, 1 INT, 10 tackles')
  })

  it('returns empty rather than inventing filler when stats are thin', () => {
    expect(composeStatLine({})).toBe('')
  })

  it('omits zero categories instead of printing "0 rushing yards"', () => {
    expect(composeStatLine({ rushing_yards: 0, receiving_yards: 62 })).toBe('62 receiving yards')
  })
})
