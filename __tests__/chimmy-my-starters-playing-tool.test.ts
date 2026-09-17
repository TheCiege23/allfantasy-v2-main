import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const h = vi.hoisted(() => ({
  gameFindMany: vi.fn(),
  resolveTeam: vi.fn(),
  listLeagues: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: { sportsGame: { findMany: h.gameFindMany } },
}))
vi.mock('@/lib/ai-payload/resolveAiTeamContext', () => ({
  resolveAiTeamContext: h.resolveTeam,
}))
vi.mock('@/lib/chimmy/tools/leagueByName', () => ({
  listMemberLeagues: h.listLeagues,
}))

import { buildMyStartersPlayingContext } from '@/lib/chimmy/tools/myStartersPlayingTool'
import { isPersonalRosterScoped } from '@/lib/ai/deterministic'

/**
 * THE PRODUCTION MESSAGE THIS WHOLE CHANGE EXISTS FOR, verbatim. Chimmy answered
 * it on 2026-09-17 with a list of that evening's fixtures.
 */
const THE_QUESTION =
  'seeing as there is a game tonight, how many leagues do i have fantasy players playing tonight? as a starter? for NFL'

/** 8:15pm ET on 2026-09-17 == 00:15Z on the 18th. */
const TONIGHT_KICKOFF = new Date('2026-09-18T00:15:00.000Z')
/** 1:00pm ET the same day — inside the ET day, outside "tonight". */
const AFTERNOON_KICKOFF = new Date('2026-09-17T17:00:00.000Z')

function game(over: Record<string, unknown> = {}) {
  return {
    homeTeam: 'Buffalo Bills',
    awayTeam: 'Detroit Lions',
    startTime: TONIGHT_KICKOFF,
    season: 2026,
    status: 'scheduled',
    fetchedAt: new Date('2026-09-17T12:00:00.000Z'),
    source: 'espn',
    homeScore: null,
    awayScore: null,
    ...over,
  }
}

const player = (name: string, team: string | null, position = 'WR') => ({
  playerId: name.toLowerCase().replace(/\s/g, '-'),
  name,
  position,
  team,
  injuryStatus: null,
})

function teamCtx(starters: unknown[], over: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1 as const,
    teamId: 't1',
    teamName: 'TheCiege26',
    platformUserId: 'sleeper-1',
    record: null,
    standingRank: null,
    pointsFor: null,
    rosterPlayerCount: starters.length,
    starters,
    bench: [],
    injuredReserve: [],
    taxi: [],
    opponentThisPeriod: null,
    dataGaps: [],
    ...over,
  }
}

const league = (id: string, name: string, over: Record<string, unknown> = {}) => ({
  id,
  name,
  sport: 'NFL',
  season: 2026,
  platformLeagueId: null,
  ownerUserId: 'u1',
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  h.gameFindMany.mockResolvedValue([game()])
  h.listLeagues.mockResolvedValue([league('l1', 'KBFL')])
  h.resolveTeam.mockResolvedValue(teamCtx([player('James Cook', 'BUF', 'RB')]))
})

/*
 * ⚠ THIS IS THE POSITIVE CONTROL, AND IT IS THE POINT OF THE FILE. The guard it
 * checks is a regex that returns false by default, so a test asserting only "the
 * fixture list was suppressed" would pass with the whole guard deleted. Both
 * directions are asserted: it must fire on the real question AND stay silent on
 * a world question, because over-firing silently retires the cached schedule
 * answer for everybody.
 */
describe('isPersonalRosterScoped — the deterministic short-circuit guard', () => {
  it('fires on the exact production question that was answered with a schedule', () => {
    expect(isPersonalRosterScoped(THE_QUESTION)).toBe(true)
  })

  it.each([
    'do i have anyone playing tonight',
    'how many of my leagues play tonight',
    'am i starting anyone in this game',
    'how many leagues do i have players in tonight',
    'how many leagues am i playing tonight',
    'is he in my lineup tonight',
    'who should i start as a starter tonight',
  ])('fires on first-person roster question: %s', (message) => {
    expect(isPersonalRosterScoped(message)).toBe(true)
  })

  /*
   * The control. Every one of these still has to reach the cached fixture list,
   * and each contains a word the guard's patterns sit near — "tonight", "games",
   * "starters", "leagues" — so a pattern loosened by one word breaks this block
   * rather than passing quietly.
   */
  it.each([
    'what games are on tonight',
    'any nfl games tonight',
    'live scores',
    'whats on today',
    "tonight's schedule",
    'which teams are playing tonight',
    'who are the best starters tonight',
    /*
     * ⚠ THESE TWO CAUGHT A REAL BUG, so they stay. The "how many leagues"
     * pattern originally made the possessive optional and matched both.
     */
    'how many leagues does the nfl have',
    'how many leagues are there in europe',
  ])('does NOT fire on world question: %s', (message) => {
    expect(isPersonalRosterScoped(message)).toBe(false)
  })
})

describe('buildMyStartersPlayingContext', () => {
  it('counts the leagues, not the fixtures, and names the starter', async () => {
    h.listLeagues.mockResolvedValue([league('l1', 'KBFL'), league('l2', 'Dynasty For Life')])
    h.resolveTeam
      .mockResolvedValueOnce(teamCtx([player('James Cook', 'BUF', 'RB')]))
      .mockResolvedValueOnce(teamCtx([player('Garrett Wilson', 'NYJ')]))

    const out = await buildMyStartersPlayingContext({ userId: 'u1', window: 'tonight' })

    expect(out).toContain('ANSWER: 1 of 2 readable NFL league(s)')
    expect(out).toContain('KBFL: James Cook RB BUF')
    expect(out).not.toContain('Dynasty For Life:')
  })

  /*
   * ⚠ THE ABBREVIATION IS THE WHOLE JOIN. A roster carries "BUF"; SportsGame
   * carries "Buffalo Bills" from three sources and "BUF" from a fourth. Matching
   * on string equality would report zero starters for a full lineup — and zero is
   * a plausible-looking answer, which is what makes it dangerous.
   */
  it('matches a roster abbreviation against a full team name', async () => {
    h.resolveTeam.mockResolvedValue(teamCtx([player('Amon-Ra St. Brown', 'DET')]))
    const out = await buildMyStartersPlayingContext({ userId: 'u1', window: 'tonight' })
    expect(out).toContain('ANSWER: 1 of 1 readable NFL league(s)')
  })

  it('collapses the four provider rows for one fixture', async () => {
    h.gameFindMany.mockResolvedValue([
      game({ source: 'espn' }),
      game({ source: 'thesportsdb' }),
      game({ source: 'rolling_insights' }),
      game({ homeTeam: 'BUF', awayTeam: 'DET', source: 'espn_live' }),
    ])
    const out = await buildMyStartersPlayingContext({ userId: 'u1', window: 'tonight' })
    /* One fixture line, not four. */
    expect(out.match(/Detroit Lions @ Buffalo Bills|DET @ BUF/g)?.length).toBe(1)
  })

  it("excludes an afternoon kickoff from 'tonight' but keeps it for 'today'", async () => {
    h.gameFindMany.mockResolvedValue([
      game({ homeTeam: 'New York Jets', awayTeam: 'Miami Dolphins', startTime: AFTERNOON_KICKOFF }),
    ])
    h.resolveTeam.mockResolvedValue(teamCtx([player('Garrett Wilson', 'NYJ')]))

    const tonight = await buildMyStartersPlayingContext({ userId: 'u1', window: 'tonight' })
    expect(tonight).toContain('NO NFL GAME is on my cached schedule for tonight')
    expect(tonight).toContain("elsewhere in today's Eastern day")

    const today = await buildMyStartersPlayingContext({ userId: 'u1', window: 'today' })
    expect(today).toContain('ANSWER: 1 of 1 readable NFL league(s)')
  })

  it('reports no games without reading a single roster', async () => {
    h.gameFindMany.mockResolvedValue([])
    const out = await buildMyStartersPlayingContext({ userId: 'u1', window: 'tonight' })
    expect(out).toContain('NO NFL GAME')
    expect(h.resolveTeam).not.toHaveBeenCalled()
  })

  /*
   * ⚠ EVERY GAP MOVES THE ANSWER IN ONE KNOWN DIRECTION, AND MUST SAY WHICH. An
   * unreadable league cannot lower the count, so "the real count can only be
   * HIGHER" is a fact, not a hedge — and it is the difference between "you have
   * players in 1 league" and "1 of the 1 I could read".
   */
  it('declares an unclaimed league as a gap, not as a zero', async () => {
    h.listLeagues.mockResolvedValue([league('l1', 'KBFL'), league('l2', 'Unclaimed Keeper')])
    h.resolveTeam
      .mockResolvedValueOnce(teamCtx([player('James Cook', 'BUF', 'RB')]))
      .mockResolvedValueOnce(null)

    const out = await buildMyStartersPlayingContext({ userId: 'u1', window: 'tonight' })

    expect(out).toContain('ANSWER: 1 of 1 readable NFL league(s)')
    expect(out).toContain('Unclaimed Keeper')
    expect(out).toContain('can only be HIGHER')
    expect(out).toContain('NOT a finding that those leagues are empty')
  })

  it('declares a starter with no NFL team as unknown rather than absent', async () => {
    h.resolveTeam.mockResolvedValue(teamCtx([player('Brian Thomas Jr.', null)]))
    const out = await buildMyStartersPlayingContext({ userId: 'u1', window: 'tonight' })
    expect(out).toContain('ANSWER: 0 of 1 readable NFL league(s)')
    expect(out).toContain('no NFL team on file')
    expect(out).toContain('can only be HIGHER')
  })

  /*
   * A league list spans seasons. Counting every row would answer "how many
   * leagues have players playing tonight" with rosters that stopped existing two
   * seasons ago.
   */
  it('counts only the season the games belong to', async () => {
    h.listLeagues.mockResolvedValue([
      league('l1', 'KBFL'),
      league('l0', 'KBFL', { id: 'l0', season: 2024 }),
    ])
    const out = await buildMyStartersPlayingContext({ userId: 'u1', window: 'tonight' })
    expect(out).toContain('2026 NFL season')
    expect(out).toContain('ANSWER: 1 of 1 readable NFL league(s)')
    expect(h.resolveTeam).toHaveBeenCalledTimes(1)
  })

  it('excludes bench, IR and taxi from the count', async () => {
    h.resolveTeam.mockResolvedValue(
      teamCtx([player('Garrett Wilson', 'NYJ')], {
        bench: [player('James Cook', 'BUF', 'RB')],
        injuredReserve: [player('Amon-Ra St. Brown', 'DET')],
      }),
    )
    const out = await buildMyStartersPlayingContext({ userId: 'u1', window: 'tonight' })
    expect(out).toContain('ANSWER: 0 of 1 readable NFL league(s)')
  })

  it('says nothing was counted when no NFL league is on file', async () => {
    h.listLeagues.mockResolvedValue([])
    const out = await buildMyStartersPlayingContext({ userId: 'u1', window: 'tonight' })
    expect(out).toContain('NO NFL leagues on file')
    expect(out).not.toContain('ANSWER:')
  })

  it('never throws when the roster read blows up', async () => {
    h.resolveTeam.mockRejectedValue(new Error('pool exhausted'))
    const out = await buildMyStartersPlayingContext({ userId: 'u1', window: 'tonight' })
    expect(out).toContain('ANSWER: 0 of 0 readable NFL league(s)')
  })
})
