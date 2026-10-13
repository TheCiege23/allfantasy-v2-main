import { beforeEach, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  survivorChallenge: { findFirst: vi.fn() },
  survivorTribalCouncil: { findFirst: vi.fn() },
  survivorWeeklyScore: { findFirst: vi.fn() },
  survivorPlayer: { findFirst: vi.fn() },
  survivorTribe: { findUnique: vi.fn() },
  survivorTwistEvent: { findFirst: vi.fn() },
  survivorAuditEntry: { upsert: vi.fn() },
}))
const poster = vi.hoisted(() => ({ postWeeklyRecap: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/survivor/leagueChatPoster', () => poster)

beforeEach(() => {
  vi.clearAllMocks()
  db.survivorChallenge.findFirst.mockResolvedValue({ title: 'Weekly slate', winnerTribeId: 'tribe-1' })
  db.survivorTribalCouncil.findFirst.mockResolvedValue({
    eliminatedName: 'Out Manager', attendingTribeId: 'tribe-2', idolsPlayed: [], isTie: false,
  })
  db.survivorWeeklyScore.findFirst.mockResolvedValue({ userId: 'winner', finalScore: 180.5 })
  db.survivorPlayer.findFirst
    .mockResolvedValueOnce({ displayName: 'Top Manager' })
    .mockResolvedValueOnce(null)
  db.survivorTribe.findUnique
    .mockResolvedValueOnce({ name: 'Winning Tribe' })
    .mockResolvedValueOnce({ name: 'Losing Tribe' })
  db.survivorTwistEvent.findFirst.mockResolvedValue(null)
})

it('publishes only revealed council results and records the week once by stable audit key', async () => {
  const { generateAndPostWeeklyRecap } = await import('@/lib/survivor/weeklyRecapGenerator')
  await generateAndPostWeeklyRecap('league-1', 4)
  expect(db.survivorTribalCouncil.findFirst).toHaveBeenCalledWith(expect.objectContaining({
    where: expect.objectContaining({ isRevealed: true }),
  }))
  expect(poster.postWeeklyRecap).toHaveBeenCalledWith('league-1', 4, expect.objectContaining({
    challengeWinner: 'Winning Tribe',
    eliminatedPlayer: 'Out Manager',
    topScorer: 'Top Manager',
  }))
  expect(db.survivorAuditEntry.upsert).toHaveBeenCalledWith(expect.objectContaining({
    where: { id: 'survivor-weekly-recap-audit:league-1:4' },
  }))
})
