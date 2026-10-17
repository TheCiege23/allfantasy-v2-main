// @vitest-environment node
/**
 * Score alerts for followed teams (phase 2, owner's call 2026-10-03): a final, and a halftime where
 * ESPN's live state says so — once per team per day, to that team's followers, NFL + college football.
 * Several cases come from a read-only dry run over the 2026-09-26 production slate.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Prisma } from '@prisma/client'

const h = vi.hoisted(() => ({
  gamesFind: vi.fn(),
  ledgerFind: vi.fn(),
  ledgerCreate: vi.fn(),
  getIndex: vi.fn(),
  listTeams: vi.fn(),
  followers: vi.fn(),
  cap: vi.fn(),
  dispatch: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    sportsGame: { findMany: h.gamesFind },
    sportsDataCache: { findFirst: h.ledgerFind, create: h.ledgerCreate },
  },
}))
vi.mock('@/lib/notifications/NotificationDispatcher', () => ({ dispatchNotification: h.dispatch }))
vi.mock('@/lib/follows/teamFollows', () => ({
  getTeamIndex: h.getIndex,
  listTeamsForSport: h.listTeams,
  listFollowerIdsForTeam: h.followers,
}))
vi.mock('@/lib/follows/teamFollowAlerts', () => ({ withinDailyCap: h.cap }))

import { buildTeamIndex, resolveTeam, type CanonicalTeam } from '@/lib/follows/teamResolver'
import {
  detectScoreEvents,
  dispatchTeamScoreAlerts,
  easternDateKey,
  ledgerKey,
  scoreAlertText,
  TEAM_SCORE_ALERTS_PER_DAY,
  type GameRow,
} from '@/lib/follows/teamScoreAlerts'
import { NOTIFICATION_CATEGORY_IDS, NOTIFICATION_CATEGORY_LABELS } from '@/lib/notification-settings/types'
import { isPushCategory } from '@/lib/push-notifications/categories'

const T = (s: string): CanonicalTeam[] =>
  s.split(';').map((p) => {
    const i = p.indexOf('|')
    return { abbr: p.slice(0, i), name: p.slice(i + 1) }
  })

const NFL_TEAMS = T('BUF|Buffalo Bills;MIA|Miami Dolphins;KC|Kansas City Chiefs;NYJ|New York Jets')
const NCAAF_TEAMS = T(
  'ALA|University of Alabama;TEX|University of Texas at Austin;TAMU|Texas A&M University;OHIO|Ohio University;OSU|Ohio State University;UK|University of Kentucky;' +
    'TOL|University of Toledo;SDST|San Diego State University;SDSU|South Dakota State University;WKU|Western Kentucky University;' +
    'UCLA|University of California, Los Angeles;MD|University of Maryland',
)
const NFL = buildTeamIndex('NFL', NFL_TEAMS)
const NCAAF = buildTeamIndex('NCAAF', NCAAF_TEAMS)
const INDEX = new Map([
  ['NFL', NFL],
  ['NCAAF', NCAAF],
])

// Saturday 2026-10-03, 20:00 Eastern. Kickoff 17:00 Eastern = 21:00Z.
const NOW = new Date('2026-10-04T00:00:00Z')
const KICK = new Date('2026-10-03T21:00:00Z')

const row = (o: Partial<GameRow>): GameRow => ({
  sport: 'NFL',
  source: 'api_sports',
  homeTeam: 'BUF',
  awayTeam: 'MIA',
  homeScore: 24,
  awayScore: 17,
  status: 'FT',
  startTime: KICK,
  raw: null,
  ...o,
})
const college = (o: Partial<GameRow>) => row({ sport: 'NCAAF', ...o })

/** One NFL game as three providers write it — each with its own team spelling. */
const BILLS_FINAL = [
  row({ source: 'api_sports', homeTeam: 'BUF', awayTeam: 'MIA', status: 'FT' }),
  row({ source: 'espn', homeTeam: 'Buffalo Bills', awayTeam: 'Miami Dolphins', status: 'STATUS_FINAL' }),
  row({ source: 'thesportsdb', homeTeam: 'Buffalo Bills', awayTeam: 'Miami Dolphins', status: 'Match Finished' }),
]

describe('resolveTeam for schedule fields', () => {
  it('a bare school name is trusted in a schedule field, not in news', () => {
    expect(resolveTeam(NCAAF, 'ALABAMA', { exactNames: true, noPrefix: true })).toBe('ALA')
    expect(resolveTeam(NCAAF, 'Alabama', { exactNames: true, noPrefix: true })).toBe('ALA')
    expect(resolveTeam(NCAAF, 'ALABAMA')).toBeNull()
  })

  it('a bare CODE never matches exactly — providers do not share codes (ESPN "SDSU" is San Diego State)', () => {
    expect(resolveTeam(NCAAF, 'SDSU', { exactNames: true, noPrefix: true })).toBeNull()
    expect(resolveTeam(NCAAF, 'ALA', { exactNames: true, noPrefix: true })).toBeNull()
    expect(resolveTeam(NCAAF, 'San Diego State Aztecs', { exactNames: true })).toBe('SDST')
    expect(resolveTeam(NCAAF, 'South Dakota State', { exactNames: true, noPrefix: true })).toBe('SDSU')
  })

  it('a school whose NAME is an acronym still resolves', () => {
    expect(resolveTeam(NCAAF, 'UCLA', { exactNames: true, noPrefix: true })).toBe('UCLA')
    expect(resolveTeam(NCAAF, 'UCLA Bruins', { exactNames: true })).toBe('UCLA')
  })

  it('a lower-division school that STARTS with a big school name is not that school under noPrefix', () => {
    for (const s of ['Texas Lutheran', 'Ohio Wesleyan', 'Kentucky Wesleyan']) {
      expect(resolveTeam(NCAAF, s, { exactNames: true, noPrefix: true }), s).toBeNull()
    }
    // The hazard noPrefix exists for: with prefixing allowed, these DO mis-map.
    expect(resolveTeam(NCAAF, 'Texas Lutheran', { exactNames: true })).toBe('TEX')
  })

  it('ESPN "<School> <Mascot>" still resolves by prefix', () => {
    expect(resolveTeam(NCAAF, 'Alabama Crimson Tide', { exactNames: true })).toBe('ALA')
    expect(resolveTeam(NCAAF, 'Ohio State Buckeyes', { exactNames: true })).toBe('OSU')
    expect(resolveTeam(NCAAF, 'Ohio Bobcats', { exactNames: true })).toBe('OHIO')
  })

  it('"A and M" spellings reach Texas A&M, and "and" elsewhere is not rewritten into a team', () => {
    expect(resolveTeam(NCAAF, 'Texas A and M', { exactNames: true, noPrefix: true })).toBe('TAMU')
    expect(resolveTeam(NCAAF, 'Texas A&M', { exactNames: true, noPrefix: true })).toBe('TAMU')
    expect(resolveTeam(NCAAF, 'Texas A&M Aggies', { exactNames: true })).toBe('TAMU')
    // "…a AND M…" inside ordinary words must not fuse ("ALABAMA AND MISSOURI" → "ALABAMA&MISSOURI").
    expect(resolveTeam(NCAAF, 'Alabama and Missouri', { exactNames: true })).toBe('ALA')
  })
})

describe('detectScoreEvents', () => {
  it('three providers, three spellings, one game → ONE final', () => {
    const ev = detectScoreEvents(BILLS_FINAL, INDEX, NOW)
    expect(ev).toEqual([
      { kind: 'final', sport: 'NFL', dateKey: '2026-10-03', home: 'BUF', away: 'MIA', homeScore: 24, awayScore: 17 },
    ])
  })

  it('providers that disagree on the final score send nothing (yet)', () => {
    const rows = [...BILLS_FINAL.slice(0, 2), row({ source: 'thesportsdb', homeTeam: 'Buffalo Bills', awayTeam: 'Miami Dolphins', homeScore: 21 })]
    expect(detectScoreEvents(rows, INDEX, NOW)).toEqual([])
  })

  it('a provider with home and away swapped (neutral site) is the same game, its scores lined up', () => {
    const swapped = row({ source: 'thesportsdb', homeTeam: 'Miami Dolphins', awayTeam: 'Buffalo Bills', homeScore: 17, awayScore: 24 })
    const ev = detectScoreEvents([...BILLS_FINAL.slice(0, 2), swapped], INDEX, NOW)
    expect(ev).toHaveLength(1)
    expect(ev[0]).toMatchObject({ home: 'BUF', away: 'MIA', homeScore: 24, awayScore: 17 })
  })

  it('a row still live does not veto a final the others agree on', () => {
    const rows = [...BILLS_FINAL, row({ source: 'espn_live', homeTeam: 'Buffalo Bills', awayTeam: 'Miami Dolphins', status: 'Q4', homeScore: 21 })]
    expect(detectScoreEvents(rows, INDEX, NOW)).toHaveLength(1)
  })

  it('halftime comes only from ESPN’s own live state', () => {
    const half = { status: { type: { name: 'STATUS_HALFTIME' } } }
    const espn = row({ source: 'espn', homeTeam: 'Buffalo Bills', awayTeam: 'Miami Dolphins', status: 'in progress', homeScore: 10, awayScore: 14, raw: half })
    const at = new Date(KICK.getTime() + 90 * 60 * 1000)
    expect(detectScoreEvents([espn], INDEX, at)).toEqual([
      { kind: 'halftime', sport: 'NFL', dateKey: '2026-10-03', home: 'BUF', away: 'MIA', homeScore: 10, awayScore: 14 },
    ])
    expect(detectScoreEvents([{ ...espn, source: 'thesportsdb' }], INDEX, at)).toEqual([])
    expect(detectScoreEvents([{ ...espn, raw: { status: { type: { name: 'STATUS_IN_PROGRESS' } } } }], INDEX, at)).toEqual([])
  })

  it('stale and future games are not news', () => {
    expect(detectScoreEvents(BILLS_FINAL, INDEX, new Date(KICK.getTime() + 10 * 60 * 60 * 1000))).toEqual([])
    expect(detectScoreEvents(BILLS_FINAL, INDEX, new Date(KICK.getTime() - 60 * 1000))).toEqual([])
  })

  it('a game where NEITHER side resolves sends nothing — no alert beats a wrong one', () => {
    const d3 = college({ source: 'cfbd', homeTeam: 'Texas Lutheran', awayTeam: 'Trinity (TX)', homeScore: 31, awayScore: 3 })
    expect(detectScoreEvents([d3], INDEX, NOW)).toEqual([])
  })

  it('a followable team against a school outside our list still gets its final (Western Kentucky vs Mercyhurst, 2026-09-26)', () => {
    const rows = [
      college({ source: 'api_sports', homeTeam: 'WESTERN KENTUCKY', awayTeam: 'MERCYHURST', homeScore: 52, awayScore: 7 }),
      college({ source: 'cfbd', homeTeam: 'Western Kentucky', awayTeam: 'Mercyhurst', homeScore: 52, awayScore: 7, status: 'completed' }),
    ]
    expect(detectScoreEvents(rows, INDEX, NOW)).toEqual([
      { kind: 'final', sport: 'NCAAF', dateKey: '2026-10-03', home: 'WKU', away: null, awayName: 'Mercyhurst', homeScore: 52, awayScore: 7 },
    ])
  })

  it('a one-sided row is dropped when another source names both teams — no second alert', () => {
    const rows = [
      college({ source: 'cfbd', homeTeam: 'Toledo', awayTeam: 'San Diego State', homeScore: 41, awayScore: 16, status: 'completed' }),
      // ESPN's live feed: a mascot name on one side, a code (its own "SDSU") on the other → only Toledo resolves.
      college({ source: 'espn_live', homeTeam: 'Toledo Rockets', awayTeam: 'SDSU', homeScore: 41, awayScore: 16, status: 'final' }),
    ]
    const ev = detectScoreEvents(rows, INDEX, NOW)
    expect(ev).toHaveLength(1)
    expect(ev[0]).toMatchObject({ home: 'TOL', away: 'SDST' })
  })

  it('a team that lands in TWO games on one date sends neither (a mis-merge or mis-map)', () => {
    const rows = [
      college({ source: 'cfbd', homeTeam: 'Toledo', awayTeam: 'San Diego State', homeScore: 41, awayScore: 16, status: 'completed' }),
      college({ source: 'thesportsdb', homeTeam: 'Toledo', awayTeam: 'South Dakota State', homeScore: 41, awayScore: 16, status: 'Match Finished' }),
      college({ source: 'cfbd', homeTeam: 'Alabama', awayTeam: 'Kentucky', homeScore: 30, awayScore: 10, status: 'completed' }),
    ]
    const ev = detectScoreEvents(rows, INDEX, NOW)
    expect(ev.map((e) => `${e.away}@${e.home}`)).toEqual(['UK@ALA'])
  })

  it('college rows from bare-name and mascot sources collapse to one game', () => {
    const rows = [
      college({ source: 'cfbd', homeTeam: 'Alabama', awayTeam: 'Texas A&M', homeScore: 27, awayScore: 20, status: 'completed' }),
      college({ source: 'espn', homeTeam: 'Alabama Crimson Tide', awayTeam: 'Texas A&M Aggies', homeScore: 27, awayScore: 20, status: 'STATUS_FINAL' }),
      college({ source: 'api_sports', homeTeam: 'ALABAMA', awayTeam: 'TEXAS A and M', homeScore: 27, awayScore: 20, status: 'FT' }),
    ]
    const ev = detectScoreEvents(rows, INDEX, NOW)
    expect(ev).toHaveLength(1)
    expect(ev[0]).toMatchObject({ sport: 'NCAAF', home: 'ALA', away: 'TAMU' })
  })

  it('dates on the US Eastern calendar — a primetime kickoff is still Saturday’s game', () => {
    expect(easternDateKey(new Date('2026-10-04T01:30:00Z'))).toBe('2026-10-03')
  })
})

describe('scoreAlertText', () => {
  const names = new Map([
    ['BUF', 'Buffalo Bills'],
    ['MIA', 'Miami Dolphins'],
    ['WKU', 'Western Kentucky University'],
  ])
  it('final names the winner; halftime the leader', () => {
    const e = { kind: 'final' as const, sport: 'NFL', dateKey: '2026-10-03', home: 'BUF', away: 'MIA', homeScore: 24, awayScore: 17 }
    expect(scoreAlertText(e, names)).toEqual({ title: 'Final: Miami Dolphins 17, Buffalo Bills 24', body: 'Buffalo Bills win 24–17.' })
    expect(scoreAlertText({ ...e, kind: 'halftime', homeScore: 7, awayScore: 10 }, names).body).toBe('Miami Dolphins lead at the half.')
    expect(scoreAlertText({ ...e, kind: 'halftime', homeScore: 7, awayScore: 7 }, names).body).toBe('Tied at the half.')
  })
  it('an unlisted opponent is named as the provider spelled it', () => {
    const e = { kind: 'final' as const, sport: 'NCAAF', dateKey: '2026-09-26', home: 'WKU', away: null, awayName: 'Mercyhurst', homeScore: 52, awayScore: 7 }
    expect(scoreAlertText(e, names).title).toBe('Final: Mercyhurst 7, Western Kentucky University 52')
  })
})

describe('dispatchTeamScoreAlerts', () => {
  const key = (team: string, date = '2026-10-03') => ledgerKey('final', 'NFL', date, team)

  beforeEach(() => {
    for (const f of Object.values(h)) f.mockReset()
    h.gamesFind.mockResolvedValue(BILLS_FINAL)
    h.ledgerFind.mockResolvedValue(null)
    h.ledgerCreate.mockResolvedValue({})
    h.getIndex.mockImplementation(async (s: string) => INDEX.get(s) ?? null)
    h.listTeams.mockImplementation(async (s: string) => (s === 'NFL' ? NFL_TEAMS : NCAAF_TEAMS))
    h.followers.mockImplementation(async (_s: string, abbr: string) => (abbr === 'BUF' ? ['u1', 'u2'] : abbr === 'MIA' ? ['u2', 'u3'] : []))
    h.cap.mockImplementation(async (ids: string[]) => ids)
    h.dispatch.mockResolvedValue(undefined)
  })

  it('tells followers of EITHER team once, under followed_team_scores, with no league', async () => {
    const out = await dispatchTeamScoreAlerts({ now: NOW })
    expect(out).toMatchObject({ events: 1, sent: 1, recipients: 3, alreadySent: 0 })
    expect(h.dispatch).toHaveBeenCalledTimes(1)
    const p = h.dispatch.mock.calls[0][0]
    expect([...p.userIds].sort()).toEqual(['u1', 'u2', 'u3'])
    expect(p).toMatchObject({ category: 'followed_team_scores', type: 'team_final_score', leagueId: null })
    expect(p.title).toBe('Final: Miami Dolphins 17, Buffalo Bills 24')
    expect(h.cap).toHaveBeenCalledWith(expect.any(Array), { provider: 'team_score_alerts', limit: TEAM_SCORE_ALERTS_PER_DAY })
    expect(h.ledgerCreate.mock.calls.map((c) => c[0].data.cacheKey).sort()).toEqual([key('BUF'), key('MIA')])
  })

  it('a game whose teams another run already claimed is not sent again', async () => {
    h.ledgerCreate.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }))
    const out = await dispatchTeamScoreAlerts({ now: NOW })
    expect(out.alreadySent).toBe(1)
    expect(h.dispatch).not.toHaveBeenCalled()
  })

  it('one team already told (from a row that named only it) — only the other team’s followers, minus anyone already told', async () => {
    h.ledgerCreate.mockImplementation(async ({ data }: { data: { cacheKey: string } }) => {
      if (data.cacheKey === key('BUF')) throw new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' })
      return {}
    })
    await dispatchTeamScoreAlerts({ now: NOW })
    // u2 follows both and was told with BUF's alert; u3 follows only MIA.
    expect([...h.dispatch.mock.calls[0][0].userIds]).toEqual(['u3'])
  })

  it('a claim on an ADJACENT date (providers disagreeing on the calendar day) also counts as sent', async () => {
    h.ledgerFind.mockResolvedValue({ cacheKey: key('BUF', '2026-10-02') })
    await dispatchTeamScoreAlerts({ now: NOW })
    expect(h.ledgerFind.mock.calls[0][0].where.cacheKey.in).toEqual([key('BUF', '2026-10-02'), key('BUF', '2026-10-04')])
    expect(h.ledgerCreate).not.toHaveBeenCalled()
    expect(h.dispatch).not.toHaveBeenCalled()
  })

  it('people over the daily cap are left out; nobody left means no send', async () => {
    h.cap.mockImplementation(async (ids: string[]) => ids.filter((id) => id !== 'u2'))
    const out = await dispatchTeamScoreAlerts({ now: NOW })
    expect(out.capped).toBe(1)
    expect([...h.dispatch.mock.calls[0][0].userIds].sort()).toEqual(['u1', 'u3'])

    h.dispatch.mockClear()
    h.cap.mockResolvedValue([])
    await dispatchTeamScoreAlerts({ now: NOW })
    expect(h.dispatch).not.toHaveBeenCalled()
  })

  it('a team nobody follows is not claimed, so a later follower is not locked out', async () => {
    h.followers.mockImplementation(async (_s: string, abbr: string) => (abbr === 'BUF' ? ['u1'] : []))
    await dispatchTeamScoreAlerts({ now: NOW })
    expect(h.ledgerCreate.mock.calls.map((c) => c[0].data.cacheKey)).toEqual([key('BUF')])

    h.ledgerCreate.mockClear()
    h.dispatch.mockClear()
    h.followers.mockResolvedValue([])
    const out = await dispatchTeamScoreAlerts({ now: NOW })
    expect(h.ledgerCreate).not.toHaveBeenCalled()
    expect(h.dispatch).not.toHaveBeenCalled()
    expect(out.alreadySent).toBe(0)
  })

  it('reads only recent NFL + NCAAF games', async () => {
    await dispatchTeamScoreAlerts({ now: NOW })
    const where = h.gamesFind.mock.calls[0][0].where
    expect(where.sport).toEqual({ in: ['NFL', 'NCAAF'] })
    expect(where.startTime.lte).toEqual(NOW)
  })
})

describe('the followed_team_scores category', () => {
  it('is a real, push-capable category with its own label', () => {
    expect(NOTIFICATION_CATEGORY_IDS).toContain('followed_team_scores')
    expect(NOTIFICATION_CATEGORY_LABELS.followed_team_scores).toMatch(/scores/i)
    expect(isPushCategory('followed_team_scores')).toBe(true)
  })
})
