// @vitest-environment node
/**
 * The waiver claim Chimmy's chat grounded on, recorded as "add" advice (retention item 6, user
 * decision 2026-09-14: waiver claims only). The engine's id is a pool row id, so it is mapped to a
 * Sleeper id and name-checked; only the top claim counts; nothing already yours is an add.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  leagueFind: vi.fn(),
  spFind: vi.fn(),
  pimFind: vi.fn(),
  teamFind: vi.fn(),
  rosterFind: vi.fn(),
  currentWeek: vi.fn(),
  record: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: h.leagueFind },
    sportsPlayer: { findUnique: h.spFind },
    playerIdentityMap: { findUnique: h.pimFind },
    leagueTeam: { findMany: h.teamFind },
    roster: { findFirst: h.rosterFind },
  },
}))
vi.mock('@/lib/core-app/currentWeek', () => ({ resolveCurrentWeekForLeague: h.currentWeek }))
vi.mock('@/lib/chimmy-advice/adviceStore', () => ({ recordAdvice: h.record }))

import { recordChatWaiverAdvice } from '@/lib/chimmy-advice/chatWaiverAdvice'

const claim = (over: Record<string, unknown> = {}) => ({
  addPlayerId: 'sp-row-1',
  addPlayerName: 'Jaylen Wright',
  position: 'RB',
  team: 'MIA',
  dropPlayerId: null,
  dropPlayerName: null,
  faabBid: 12,
  priorityRank: 1,
  compositeScore: 71,
  recommendation: 'strong_add',
  reason: 'Starter out',
  ...over,
})

/** The answer the user saw. It names every fixture player, so the checks below get past the name gate. */
const ANSWER = 'Add Jaylen Wright this week. Tank Bigsby is the fallback, and the Kansas City Chiefs defense streams well.'

const base = {
  userId: 'u1',
  leagueId: 'af-ice',
  claims: [claim()],
  confidencePct: 68,
  answer: ANSWER,
} as Parameters<typeof recordChatWaiverAdvice>[0]

function db() {
  h.leagueFind.mockResolvedValue({ id: 'af-ice', platform: 'sleeper', platformLeagueId: 'sl-ice', sport: 'NFL' })
  h.spFind.mockResolvedValue({ sleeperId: '11620', name: 'Jaylen Wright' })
  h.pimFind.mockResolvedValue(null)
  h.teamFind.mockResolvedValue([{ externalId: '4', platformUserId: 'sl-me' }])
  h.rosterFind.mockResolvedValue({ playerData: { players: ['4046'], starters: ['4046'], reserve: [], taxi: [] } })
  h.currentWeek.mockResolvedValue({ seasonYear: 2026, week: 6 })
  h.record.mockResolvedValue('recorded')
}

beforeEach(() => {
  for (const f of Object.values(h)) f.mockReset()
})

/*
 * 🛑 "CHIMMY SAID ADD X" MUST BE SOMETHING THE ANSWER SAID. The engine's top claim is what the
 * answer was grounded on; the model can decline it or name someone else.
 */
describe('advice is recorded only when the answer named the player', () => {
  it('refuses an answer that does not name the top claim, before touching the database', async () => {
    db()
    const result = await recordChatWaiverAdvice({ ...base, answer: 'Hold your FAAB this week; nobody is worth it.' })
    expect(result).toBe('not_in_answer')
    expect(h.leagueFind).not.toHaveBeenCalled()
    expect(h.record).not.toHaveBeenCalled()
  })

  it('matches the whole name, not a fragment of it', async () => {
    db()
    expect(await recordChatWaiverAdvice({ ...base, answer: 'Jaylen is fine, and Wright is a common name.' })).toBe(
      'not_in_answer',
    )
  })

  it('refuses an empty answer', async () => {
    db()
    expect(await recordChatWaiverAdvice({ ...base, answer: '' })).toBe('not_in_answer')
  })
})

describe('recordChatWaiverAdvice', () => {
  it('🛑 records the top claim as add advice under the player’s SLEEPER id, this week', async () => {
    db()
    expect(await recordChatWaiverAdvice(base)).toBe('recorded')
    expect(h.record).toHaveBeenCalledWith({
      userId: 'u1',
      leagueId: 'af-ice',
      sport: 'NFL',
      season: 2026,
      week: 6,
      adviceType: 'add',
      surface: 'chimmy_chat_waiver',
      rec: { key: '11620', name: 'Jaylen Wright' },
      alt: null,
      slot: null,
      confidencePct: 68,
    })
    expect(h.spFind.mock.calls[0][0].where).toEqual({ id: 'sp-row-1' })
    expect(h.rosterFind.mock.calls[0][0].where).toEqual({ leagueId: 'af-ice', platformUserId: { in: ['sl-me', '4', 'u1'] } })
  })

  it('only the TOP-ranked claim is advice', async () => {
    db()
    h.spFind.mockImplementation(async ({ where }: { where: { id: string } }) =>
      where.id === 'sp-row-2' ? { sleeperId: '9999', name: 'Tank Bigsby' } : { sleeperId: '11620', name: 'Jaylen Wright' },
    )
    await recordChatWaiverAdvice({ ...base, claims: [claim({ priorityRank: 2 }), claim({ addPlayerId: 'sp-row-2', addPlayerName: 'Tank Bigsby', priorityRank: 1 })] as never })
    expect(h.record.mock.calls[0][0].rec).toEqual({ key: '9999', name: 'Tank Bigsby' })
  })

  it('an IDP fallback id resolves through the identity map', async () => {
    db()
    h.spFind.mockResolvedValue(null)
    h.pimFind.mockResolvedValue({ sleeperId: '7777', canonicalName: 'Jaylen Wright' })
    expect(await recordChatWaiverAdvice(base)).toBe('recorded')
    expect(h.record.mock.calls[0][0].rec.key).toBe('7777')
  })

  it('🛑 no Sleeper id, a name that does not match the row, or a synthetic defense records nothing', async () => {
    db()
    h.spFind.mockResolvedValue({ sleeperId: null, name: 'Jaylen Wright' })
    expect(await recordChatWaiverAdvice(base)).toBe('unresolved')
    h.spFind.mockResolvedValue({ sleeperId: '11620', name: 'Jaylen Warren' })
    expect(await recordChatWaiverAdvice(base)).toBe('unresolved')
    h.spFind.mockRejectedValue(new Error('invalid input syntax for type uuid'))
    h.pimFind.mockRejectedValue(new Error('invalid input syntax for type uuid'))
    expect(await recordChatWaiverAdvice({ ...base, claims: [claim({ addPlayerId: 'nfl:def:KC', addPlayerName: 'Kansas City Chiefs' })] as never })).toBe('unresolved')
    expect(h.record).not.toHaveBeenCalled()
  })

  it('names match through the canonical normalizer', async () => {
    db()
    h.spFind.mockResolvedValue({ sleeperId: '11620', name: 'jaylen  WRIGHT' })
    expect(await recordChatWaiverAdvice(base)).toBe('recorded')
  })

  it('🛑 a player already on your roster is not an add', async () => {
    db()
    h.rosterFind.mockResolvedValue({ playerData: { players: [], starters: [], reserve: ['11620'], taxi: [] } })
    expect(await recordChatWaiverAdvice(base)).toBe('already_yours')
    expect(h.record).not.toHaveBeenCalled()
  })

  it('no claims, non-Sleeper leagues, no single team, or no current week record nothing', async () => {
    db()
    expect(await recordChatWaiverAdvice({ ...base, claims: [] })).toBe('no_claim')
    expect(await recordChatWaiverAdvice({ ...base, claims: [claim({ addPlayerName: ' ' })] as never })).toBe('no_claim')
    expect(h.leagueFind).not.toHaveBeenCalled()
    h.leagueFind.mockResolvedValue({ id: 'af-espn', platform: 'espn', platformLeagueId: '1', sport: 'NFL' })
    expect(await recordChatWaiverAdvice(base)).toBe('not_sleeper')
    db()
    h.teamFind.mockResolvedValue([{ externalId: '4', platformUserId: null }, { externalId: '5', platformUserId: null }])
    expect(await recordChatWaiverAdvice(base)).toBe('no_team')
    db()
    h.rosterFind.mockResolvedValue(null)
    expect(await recordChatWaiverAdvice(base)).toBe('no_team')
    db()
    h.currentWeek.mockResolvedValue(null)
    expect(await recordChatWaiverAdvice(base)).toBe('no_week')
    h.currentWeek.mockRejectedValue(new Error('db'))
    expect(await recordChatWaiverAdvice(base)).toBe('no_week')
    expect(h.record).not.toHaveBeenCalled()
  })

  it('passes the store’s own answer through (unavailable before the migration is applied)', async () => {
    db()
    h.record.mockResolvedValue('unavailable')
    expect(await recordChatWaiverAdvice(base)).toBe('unavailable')
  })
})
