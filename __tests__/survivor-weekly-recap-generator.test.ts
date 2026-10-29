import { beforeEach, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  survivorChallenge: { findFirst: vi.fn() },
  survivorTribalCouncil: { findMany: vi.fn(), count: vi.fn() },
  survivorWeeklyScore: { findFirst: vi.fn(), findMany: vi.fn() },
  survivorPlayer: { findFirst: vi.fn(), count: vi.fn() },
  survivorGameState: { findUnique: vi.fn() },
  survivorTribe: { findUnique: vi.fn(), findMany: vi.fn() },
  survivorTwistEvent: { findFirst: vi.fn() },
  survivorAuditEntry: { upsert: vi.fn() },
  league: { findUnique: vi.fn() },
}))
const poster = vi.hoisted(() => ({ postWeeklyRecap: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/survivor/leagueChatPoster', () => poster)
const confessionals = vi.hoisted(() => ({ latest: vi.fn(async () => null as string | null) }))
vi.mock('@/lib/survivor/survivorConfessionals', () => ({ latestConfessional: confessionals.latest }))

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
  db.survivorGameState.findUnique.mockResolvedValue({ phase: 'pre_merge', mergeTriggeredAt: null })
  db.survivorWeeklyScore.findMany.mockResolvedValue([])
  db.survivorPlayer.count.mockResolvedValue(11)
  db.survivorTribalCouncil.count.mockResolvedValue(4)
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

it('posts the week as an episode and stores it for the Episodes page', async () => {
  db.survivorWeeklyScore.findMany.mockResolvedValue([
    { tribeId: 'tribe-1', finalScore: 210 }, { tribeId: 'tribe-1', finalScore: 200.5 },
    { tribeId: 'tribe-2', finalScore: 190 }, { tribeId: 'tribe-2', finalScore: 170.1 },
  ])
  db.survivorTribe.findMany.mockImplementation(async ({ where }: { where: { id: { in: string[] } } }) =>
    [{ id: 'tribe-1', name: 'Tala' }, { id: 'tribe-2', name: 'Losing Tribe' }].filter(t => where.id.in.includes(t.id)))
  const { generateAndPostWeeklyRecap } = await import('@/lib/survivor/weeklyRecapGenerator')
  await generateAndPostWeeklyRecap('league-1', 5)
  const episode = poster.postWeeklyRecap.mock.calls[0][2].episode
  expect(episode.title).toBe('The Tribe Has Spoken')
  expect(episode.scenes).toContainEqual({ label: 'The scores', text: 'Tala led the week with 410.5. Losing Tribe finished last with 360.1 and headed to Tribal Council.' })
  expect(episode.scenes).toContainEqual({ label: 'Tribal Council', text: 'Out Manager was voted out, the 5th manager to leave the island.' })
  expect(episode.scenes).toContainEqual({ label: 'Next time', text: '11 managers remain. The merge is getting closer.' })
  expect(db.survivorAuditEntry.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ data: { posted: true, episode } }), update: { data: { posted: true, episode } } }))
  // Earlier weeks only: a council still being read this week is never counted ahead of its read.
  expect(db.survivorTribalCouncil.count).toHaveBeenCalledWith({ where: expect.objectContaining({ week: { lt: 5 } }) })
})

it('gives the manager voted out the last word: their latest confessional, quoted in the episode', async () => {
  db.survivorTribalCouncil.findMany.mockResolvedValue([{ eliminatedName: 'Out Manager', eliminatedUserId: 'u-out', attendingTribeId: 'tribe-2', idolsPlayed: [], isTie: false, isRevealed: true }])
  confessionals.latest.mockResolvedValueOnce('I never trusted Ava.')
  const { generateAndPostWeeklyRecap } = await import('@/lib/survivor/weeklyRecapGenerator')
  await generateAndPostWeeklyRecap('league-1', 7)
  expect(confessionals.latest).toHaveBeenCalledWith('league-1', 'u-out')
  expect(poster.postWeeklyRecap.mock.calls.at(-1)![2].episode.scenes).toContainEqual({ label: 'Confessional', text: 'Out Manager, before the vote: “I never trusted Ava.”' })
})

it('never reads a confessional for a council still being read', async () => {
  db.survivorTribalCouncil.findMany.mockResolvedValue([{
    eliminatedName: 'Out Manager', eliminatedUserId: 'u-out', attendingTribeId: 'tribe-2', idolsPlayed: [], isTie: false, isRevealed: true,
    revealStartsAt: new Date(Date.now() - 1000), revealStep: 0,
    revealSequence: [{ targetName: 'Out Manager', status: 'counts' }, { targetName: 'Other', status: 'counts' }, { targetName: 'Out Manager', status: 'counts' }],
  }])
  const { generateAndPostWeeklyRecap } = await import('@/lib/survivor/weeklyRecapGenerator')
  await generateAndPostWeeklyRecap('league-1', 7)
  expect(confessionals.latest).not.toHaveBeenCalled()
})

// Story mode (AF Supreme, the command center's Story mode controls) changes how the episode is told.
it('tells the episode in the commissioner’s tone, and a league that never set one reads classic', async () => {
  const { generateAndPostWeeklyRecap } = await import('@/lib/survivor/weeklyRecapGenerator')
  await generateAndPostWeeklyRecap('league-1', 4)
  expect(poster.postWeeklyRecap.mock.calls[0][2].episode.title).toBe('The Tribe Has Spoken')
  poster.postWeeklyRecap.mockClear()
  db.league.findUnique.mockResolvedValue({ survivorRevealMode: 'dramatic_sequential', settings: { survivorStoryMode: { tone: 'dramatic', confessionals: true, postToChat: true } } })
  await generateAndPostWeeklyRecap('league-1', 4)
  expect(poster.postWeeklyRecap.mock.calls[0][2].episode.title).toBe('The Torch Goes Dark')
})

it('leaves confessionals out, and skips the chat post while still storing the episode, when told to', async () => {
  db.survivorTribalCouncil.findMany.mockResolvedValue([{
    eliminatedName: 'Out Manager', eliminatedUserId: 'u-out', attendingTribeId: 'tribe-2', idolsPlayed: [], isTie: false, isRevealed: true,
  }])
  confessionals.latest.mockResolvedValue('I trusted the wrong people.')
  db.league.findUnique.mockResolvedValue({ survivorRevealMode: 'dramatic_sequential', settings: { survivorStoryMode: { tone: 'classic', confessionals: false, postToChat: false } } })
  const { generateAndPostWeeklyRecap } = await import('@/lib/survivor/weeklyRecapGenerator')
  await generateAndPostWeeklyRecap('league-1', 4)
  expect(confessionals.latest).not.toHaveBeenCalled()
  expect(poster.postWeeklyRecap).not.toHaveBeenCalled()
  const stored = db.survivorAuditEntry.upsert.mock.calls[0][0].create.data.episode
  expect(stored.scenes.some((scene: { label: string }) => scene.label === 'Confessional')).toBe(false)
  expect(stored.title).toBe('The Tribe Has Spoken')
})
