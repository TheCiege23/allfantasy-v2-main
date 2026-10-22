import { beforeEach, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  survivorChallenge: { findFirst: vi.fn() },
  survivorTribalCouncil: { findMany: vi.fn() },
  survivorWeeklyScore: { findFirst: vi.fn() },
  survivorPlayer: { findFirst: vi.fn() },
  survivorTribe: { findUnique: vi.fn(), findMany: vi.fn() },
  survivorTwistEvent: { findFirst: vi.fn() },
  survivorAuditEntry: { upsert: vi.fn() },
  league: { findUnique: vi.fn() },
}))
const poster = vi.hoisted(() => ({ postWeeklyRecap: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/survivor/leagueChatPoster', () => poster)

beforeEach(() => {
  vi.clearAllMocks()
  db.survivorChallenge.findFirst.mockResolvedValue({ title: 'Weekly slate', winnerTribeId: 'tribe-1' })
  db.survivorTribalCouncil.findMany.mockResolvedValue([{
    eliminatedName: 'Out Manager', attendingTribeId: 'tribe-2', idolsPlayed: [], isTie: false, isRevealed: true,
  }])
  db.league.findUnique.mockResolvedValue({ survivorRevealMode: 'dramatic_sequential' })
  db.survivorWeeklyScore.findFirst.mockResolvedValue({ userId: 'winner', finalScore: 180.5 })
  db.survivorPlayer.findFirst
    .mockResolvedValueOnce({ displayName: 'Top Manager' })
    .mockResolvedValueOnce(null)
  db.survivorTribe.findUnique.mockResolvedValue({ name: 'Winning Tribe' })
  db.survivorTribe.findMany.mockResolvedValue([{ id: 'tribe-2', name: 'Losing Tribe' }, { id: 'tribe-3', name: 'Other Tribe' }])
  db.survivorTwistEvent.findFirst.mockResolvedValue(null)
})

it('publishes only revealed council results and records the week once by stable audit key', async () => {
  const { generateAndPostWeeklyRecap } = await import('@/lib/survivor/weeklyRecapGenerator')
  await generateAndPostWeeklyRecap('league-1', 4)
  expect(db.survivorTribalCouncil.findMany).toHaveBeenCalledWith(expect.objectContaining({
    where: expect.objectContaining({ isRevealed: true }),
  }))
  expect(poster.postWeeklyRecap).toHaveBeenCalledWith('league-1', 4, expect.objectContaining({
    challengeWinner: 'Winning Tribe',
    tribalLoser: 'Losing Tribe',
    eliminatedPlayer: 'Out Manager',
    topScorer: 'Top Manager',
  }))
  expect(db.survivorAuditEntry.upsert).toHaveBeenCalledWith(expect.objectContaining({
    where: { id: 'survivor-weekly-recap-audit:league-1:4' },
  }))
})

it('does not name the voted-out manager while the council read is still in progress', async () => {
  db.survivorTribalCouncil.findMany.mockResolvedValue([{
    eliminatedName: 'Out Manager', attendingTribeId: 'tribe-2', idolsPlayed: [], isTie: false, isRevealed: true,
    revealStartsAt: new Date(Date.now() - 1000), revealStep: 0,
    revealSequence: [{ targetName: 'Out Manager', status: 'counts' }, { targetName: 'Other', status: 'counts' }, { targetName: 'Out Manager', status: 'counts' }],
  }])
  const { generateAndPostWeeklyRecap } = await import('@/lib/survivor/weeklyRecapGenerator')
  await generateAndPostWeeklyRecap('league-1', 4)
  expect(JSON.stringify(poster.postWeeklyRecap.mock.calls)).not.toContain('Out Manager')
})

it('names both managers voted out on a double-elimination week, and each tribe once', async () => {
  db.survivorTribalCouncil.findMany.mockResolvedValue([
    { eliminatedName: 'First Out', attendingTribeId: 'tribe-2', idolsPlayed: [{ powerLabel: 'Idol A' }], isTie: false, isRevealed: true },
    { eliminatedName: 'Second Out', attendingTribeId: 'tribe-2', idolsPlayed: [{ powerLabel: 'Idol B' }], isTie: false, isRevealed: true },
  ])
  const { generateAndPostWeeklyRecap } = await import('@/lib/survivor/weeklyRecapGenerator')
  await generateAndPostWeeklyRecap('league-1', 9)
  expect(db.survivorTribalCouncil.findMany).toHaveBeenCalledWith(expect.objectContaining({ orderBy: { councilNumber: 'asc' } }))
  expect(poster.postWeeklyRecap).toHaveBeenCalledWith('league-1', 9, expect.objectContaining({
    eliminatedPlayer: 'First Out and Second Out',
    tribalLoser: 'Losing Tribe',
    idolsPlayed: ['Idol A', 'Idol B'],
  }))
})

it('names only the first manager while the second council of the week is still being read', async () => {
  db.survivorTribalCouncil.findMany.mockResolvedValue([
    { eliminatedName: 'First Out', attendingTribeId: 'tribe-2', idolsPlayed: [], isTie: false, isRevealed: true },
    { eliminatedName: 'Second Out', attendingTribeId: 'tribe-3', idolsPlayed: [], isTie: false, isRevealed: true,
      revealStartsAt: new Date(Date.now() - 1000), revealStep: 0,
      revealSequence: [{ targetName: 'Second Out', status: 'counts' }, { targetName: 'Other', status: 'counts' }, { targetName: 'Second Out', status: 'counts' }] },
  ])
  const { generateAndPostWeeklyRecap } = await import('@/lib/survivor/weeklyRecapGenerator')
  await generateAndPostWeeklyRecap('league-1', 9)
  const sent = JSON.stringify(poster.postWeeklyRecap.mock.calls)
  expect(sent).toContain('First Out')
  expect(sent).not.toContain('Second Out')
})
