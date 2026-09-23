import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * The stored-stats tools run in the tool loop, AFTER lib/ai/deterministic.ts — so anything that
 * module answers or refuses never reaches them. These pin which stat questions it now yields.
 */

const h = vi.hoisted(() => ({ findMany: vi.fn(), count: vi.fn(), leaders: vi.fn() }))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    sportsGame: { findMany: h.findMany },
    gameSchedule: { count: h.count },
  },
}))
vi.mock('@/lib/live/playerStatLeaders', async () => {
  const actual = await vi.importActual<typeof import('@/lib/live/playerStatLeaders')>('@/lib/live/playerStatLeaders')
  return { ...actual, readStatLeaders: h.leaders }
})

import {
  isLiveWindowStatQuestion,
  isStoredFootballStatsQuestion,
  tryDeterministicAnswerDetailed,
} from '@/lib/ai/deterministic'

beforeEach(() => {
  vi.clearAllMocks()
  h.findMany.mockResolvedValue([])
  h.count.mockResolvedValue(0)
  // A busy Sunday: the live window HAS plays, which is when the old interception happened.
  h.leaders.mockResolvedValue({
    family: 'touchdowns',
    eventsScanned: 120,
    leaders: [{ playerName: 'Josh Allen', team: 'BUF', total: 2 }],
  })
})

describe('classifiers', () => {
  it('season / week football questions belong to the stored-stats tools', () => {
    for (const q of [
      'How many TDs does Josh Allen have this season?',
      'Who leads the NFL in rushing yards?',
      "How many receiving yards did Ja'Marr Chase have last week?",
      'passing yards leaders in college football',
      'how many touchdowns has Bijan scored so far',
    ]) {
      expect(isStoredFootballStatsQuestion(q), q).toBe(true)
    }
  })

  it('other sports and live questions do not', () => {
    for (const q of [
      'How many home runs does Ohtani have this season?',
      'who has the most goals this season in the EPL',
      'who has the most TDs today?',
      'how many rushing yards does Henry have right now',
      'who leads in TDs?',
    ]) {
      expect(isStoredFootballStatsQuestion(q), q).toBe(false)
    }
  })

  it('the live window is for questions about now', () => {
    expect(isLiveWindowStatQuestion('who has the most TDs today?')).toBe(true)
    expect(isLiveWindowStatQuestion('Who leads the NFL in rushing yards?')).toBe(false)
  })
})

describe('tryDeterministicAnswerDetailed', () => {
  it('REGRESSION: a season-leader question is no longer answered from the live window', async () => {
    const out = await tryDeterministicAnswerDetailed('Who leads the NFL in touchdowns this season?')
    expect(out).toBeNull()
  })

  it('REGRESSION: a season stat question is no longer refused into a paid web search', async () => {
    h.leaders.mockResolvedValue({ family: 'touchdowns', eventsScanned: 0, leaders: [] })
    const out = await tryDeterministicAnswerDetailed('How many TDs does Josh Allen have this season?')
    expect(out).toBeNull()
  })

  it('still answers a live question from the live window', async () => {
    const out = await tryDeterministicAnswerDetailed('who has the most TDs today?')
    expect(out?.kind).toBe('answer')
    expect(out?.text).toContain('Josh Allen')
  })

  it('still refuses a non-football season stat, so it can escalate to web search', async () => {
    const out = await tryDeterministicAnswerDetailed('How many home runs does Ohtani have this season?')
    expect(out?.kind).toBe('refusal')
  })
})
