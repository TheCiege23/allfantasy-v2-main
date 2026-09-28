import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  leagueFindUnique: vi.fn(),
  teamFindMany: vi.fn(),
  rosterFindFirst: vi.fn(),
  recordAdvice: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: h.leagueFindUnique },
    leagueTeam: { findMany: h.teamFindMany },
    roster: { findFirst: h.rosterFindFirst },
  },
}))
vi.mock('@/lib/chimmy-advice/adviceStore', () => ({ recordAdvice: h.recordAdvice }))

import { MAX_CHAT_START_CALLS, recordChatStartSitAdvice } from '@/lib/chimmy-advice/chatStartSitAdvice'
import type { ChatStartCall } from '@/lib/chimmy/tools/chimmyTools'

/**
 * Chat start/sit calls become graded advice — but only ones the answer actually SAID, in a Sleeper
 * league, about two players on the asker's own roster.
 */

const CALL: ChatStartCall = {
  leagueId: 'L1',
  season: 2026,
  week: 4,
  rec: { key: '4046', name: 'Jayden Reed' },
  alt: { key: '8150', name: 'Rashid Shaheed' },
  slot: 'FLEX',
}
const ANSWER = 'Start Jayden Reed over Rashid Shaheed at flex — Reed projects 3.1 more points.'

beforeEach(() => {
  vi.clearAllMocks()
  h.leagueFindUnique.mockResolvedValue({ id: 'L1', platform: 'sleeper', platformLeagueId: '999', sport: 'NFL' })
  h.teamFindMany.mockResolvedValue([{ externalId: '3', platformUserId: 'sleeper-u1' }])
  h.rosterFindFirst.mockResolvedValue({ playerData: { players: ['4046', '8150', '1234'], starters: ['8150'] } })
  h.recordAdvice.mockResolvedValue('recorded')
})

const record = (calls: ChatStartCall[] = [CALL], answer = ANSWER) => recordChatStartSitAdvice({ userId: 'u1', calls, answer })

describe('recordChatStartSitAdvice', () => {
  it('records a call the answer made, as start/sit advice from chat', async () => {
    expect(await record()).toEqual(['recorded'])
    expect(h.recordAdvice).toHaveBeenCalledWith({
      userId: 'u1',
      leagueId: 'L1',
      sport: 'NFL',
      season: 2026,
      week: 4,
      adviceType: 'start_sit',
      surface: 'chimmy_chat_lineup',
      rec: { key: '4046', name: 'Jayden Reed' },
      alt: { key: '8150', name: 'Rashid Shaheed' },
      slot: 'FLEX',
      confidencePct: null,
    })
  })

  /* The engine's call is what the answer was grounded on, not necessarily what it said. */
  it('records nothing the answer did not say — both players must be named', async () => {
    expect(await record([CALL], 'Start Jayden Reed this week.')).toEqual(['not_in_answer'])
    expect(await record([CALL], 'Tough call — check the injury report Sunday morning.')).toEqual(['not_in_answer'])
    expect(h.recordAdvice).not.toHaveBeenCalled()
    expect(h.leagueFindUnique).not.toHaveBeenCalled()
  })

  it('records nothing outside a Sleeper league, where it could never be graded', async () => {
    h.leagueFindUnique.mockResolvedValue({ id: 'L1', platform: 'espn', platformLeagueId: '5', sport: 'NFL' })
    expect(await record()).toEqual(['not_sleeper'])
    expect(h.recordAdvice).not.toHaveBeenCalled()
  })

  it('needs exactly one claimed team', async () => {
    h.teamFindMany.mockResolvedValue([])
    expect(await record()).toEqual(['no_team'])
    h.teamFindMany.mockResolvedValue([{ externalId: '3', platformUserId: 'a' }, { externalId: '4', platformUserId: 'b' }])
    expect(await record()).toEqual(['no_team'])
    expect(h.recordAdvice).not.toHaveBeenCalled()
  })

  it('records nothing about a player who is not on your roster', async () => {
    h.rosterFindFirst.mockResolvedValue({ playerData: { players: ['4046', '1234'] } })
    expect(await record()).toEqual(['not_on_roster'])
    expect(h.recordAdvice).not.toHaveBeenCalled()
  })

  it('records the same call once, reads each league once, and stops at the cap', async () => {
    const other = { ...CALL, rec: { key: '1234', name: 'Tank Dell' } }
    const answer = `${ANSWER} Also start Tank Dell over Rashid Shaheed.`
    const out = await record([CALL, CALL, other, other, other], answer)
    expect(MAX_CHAT_START_CALLS).toBe(3)
    expect(out).toEqual(['recorded', 'duplicate', 'recorded'])
    expect(h.recordAdvice).toHaveBeenCalledTimes(2)
    expect(h.leagueFindUnique).toHaveBeenCalledTimes(1)
  })

  it('passes a store refusal through rather than claiming it was recorded', async () => {
    h.recordAdvice.mockResolvedValue('unavailable')
    expect(await record()).toEqual(['unavailable'])
  })
})
