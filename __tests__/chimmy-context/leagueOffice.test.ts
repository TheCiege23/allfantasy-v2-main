/**
 * The league office slice Chimmy reads (lib/chimmy-context/leagueOfficeSummary.ts and
 * providers/LeagueOfficeContextProvider.ts): what it says, and that each viewer is told only what the
 * app already shows them.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  role: vi.fn(),
  prizes: vi.fn(),
  log: vi.fn(),
  corrections: vi.fn(),
  inactive: vi.fn(),
  prisma: {
    league: { findUnique: vi.fn() },
    redraftRoster: { findFirst: vi.fn(), findMany: vi.fn() },
    roster: { findFirst: vi.fn() },
    redraftTradeProposal: { findMany: vi.fn() },
  },
}))

vi.mock('@/lib/prisma', () => ({ prisma: m.prisma }))
vi.mock('@/lib/league/permissions', () => ({ getLeagueRole: m.role }))
vi.mock('@/lib/side-contests/sideContestsService', () => ({ readSideContestsView: m.prizes }))
vi.mock('@/lib/league-log/leagueLogService', () => ({ readLeagueLog: m.log }))
vi.mock('@/lib/stat-corrections/statCorrectionService', () => ({ readStatCorrections: m.corrections }))
vi.mock('@/lib/inactive-manager/inactiveManagerService', () => ({ readInactiveManagerView: m.inactive }))

import { buildLeagueOfficeSummary, type LeagueOfficeInput } from '@/lib/chimmy-context/leagueOfficeSummary'
import { LeagueOfficeContextProvider } from '@/lib/chimmy-context/providers/LeagueOfficeContextProvider'

const ON = { high_score: { enabled: true, prizeCents: 2000 }, closest_loss: { enabled: true, prizeCents: 0 } }
const PRIZES = {
  config: ON,
  weeks: [{
    week: 7,
    contests: {
      high_score: [{ rosterId: 'A', value: 141.2, prizeCents: 2000, teamName: 'Aces' }],
      closest_loss: [{ rosterId: 'D', value: 1.5, prizeCents: 0, teamName: 'Dogs', opponentRosterId: 'C', opponentName: 'Cats' }],
    },
  }],
  totals: [{ rosterId: 'A', teamName: 'Aces', wins: { high_score: 2, closest_loss: 0 }, prizeCents: 4000 }, { rosterId: 'D', teamName: 'Dogs', wins: { high_score: 0, closest_loss: 1 }, prizeCents: 0 }],
}
const base: LeagueOfficeInput = { viewerRole: 'member', prizes: null, trades: [], correction: null, inactive: null, viewerTeamManaged: false, log: null }

describe('buildLeagueOfficeSummary', () => {
  it('says nothing when nothing is in use', () => {
    expect(buildLeagueOfficeSummary(base)).toBeNull()
    expect(buildLeagueOfficeSummary({ ...base, prizes: { ...PRIZES, config: { high_score: { enabled: false, prizeCents: 0 }, closest_loss: { enabled: false, prizeCents: 0 } } } })).toBeNull()
  })

  it('words the weekly prizes: what is on, last week’s winners, and the money', () => {
    expect(buildLeagueOfficeSummary({ ...base, prizes: PRIZES })).toBe(
      'Weekly prizes: weekly high score ($20 a week) and closest loss. Regular-season weeks only; a tie splits the prize.\n' +
        'Week 7: high score Aces with 141.20 points; closest loss Dogs, by 1.50 to Cats.\n' +
        'Season prize money so far: Aces $40.',
    )
    expect(buildLeagueOfficeSummary({ ...base, prizes: { ...PRIZES, weeks: [], totals: [] } })).toMatch(/No week has finished yet/)
  })

  it('a stat correction reads differently for each state', () => {
    const c = { week: 7, changed: 2, unapplied: 2, flips: 1, automatic: false, refused: false }
    expect(buildLeagueOfficeSummary({ ...base, correction: c })).toBe(
      'Week 7 stat correction: the league office changed stats after the week was final, moving 2 matchups and flipping a result. ' +
        '2 still to apply: the commissioner applies it in League settings > Score adjustments, which updates results and standings.',
    )
    expect(buildLeagueOfficeSummary({ ...base, correction: { ...c, unapplied: 0 } })).toMatch(/It has been applied/)
    expect(buildLeagueOfficeSummary({ ...base, correction: { ...c, automatic: true } })).toMatch(/applies it automatically/)
    expect(buildLeagueOfficeSummary({ ...base, correction: { ...c, refused: true } })).toMatch(/never applies corrections/)
  })

  it('trades, inactive teams, the viewer’s own managed lineup and the log', () => {
    const text = buildLeagueOfficeSummary({
      ...base,
      trades: [{ teams: 'Aces and Bees', explainer: 'Under commissioner review.' }],
      inactive: { managed: ['Cats'], suggested: ['Dogs', 'Elks'] },
      viewerTeamManaged: true,
      log: [{ at: '2026-10-24T10:00:00Z', title: 'Commissioner set FAAB', detail: 'Aces 100 → 60' }],
    })!
    expect(text.split('\n')).toEqual([
      'Trade between Aces and Bees: Under commissioner review.',
      'AllFantasy is setting the lineup for Cats while the manager is away; it stops when the manager saves a lineup.',
      'Dogs and Elks look inactive; the commissioner can let AllFantasy set their lineups from the Commissioner Hub.',
      'AllFantasy is setting your lineup while you are away; saving a lineup yourself stops it.',
      'Latest league log:',
      '- 2026-10-24: Commissioner set FAAB (Aces 100 → 60)',
    ])
  })
})

const NOW = Date.now()
const proposal = (id: string, vetoMode: string, a: string, b: string) => ({
  id, status: 'pending', vetoMode, vetoThreshold: 4, acceptedAt: new Date(NOW - 3600_000), expiresAt: new Date(NOW + 30 * 3600_000), proposerRosterId: a, receiverRosterId: b, votes: [],
})

describe('LeagueOfficeContextProvider', () => {
  const provider = new LeagueOfficeContextProvider()
  const load = () => provider.load({ userId: 'u1', leagueId: 'L' })

  beforeEach(() => {
    vi.clearAllMocks()
    m.prisma.league.findUnique.mockResolvedValue({ platform: 'allfantasy', settings: { af_managed_lineups: { 'r-mine': { since: '2026-10-01T00:00:00Z', byUserId: 'c' } } } })
    m.role.mockResolvedValue('member')
    m.prizes.mockResolvedValue({ ok: true, native: true, canEdit: false, season: 2026, ...PRIZES })
    m.log.mockResolvedValue({ ok: true, canManage: false, visibility: 'league', hidden: false, entries: [{ id: 'e', at: '2026-10-24T10:00:00Z', actor: 'c', category: null, title: 'Commissioner set FAAB', detail: null }], nextCursor: null })
    m.prisma.redraftRoster.findFirst.mockResolvedValue({ id: 'rr-mine' })
    m.prisma.roster.findFirst.mockResolvedValue({ id: 'r-mine' })
    m.prisma.redraftTradeProposal.findMany.mockResolvedValue([
      proposal('t-mine', 'commissioner', 'rr-mine', 'rr-b'),
      proposal('t-vote', 'league_vote', 'rr-c', 'rr-d'),
      proposal('t-other', 'commissioner', 'rr-c', 'rr-d'),
    ])
    m.prisma.redraftRoster.findMany.mockResolvedValue([
      { id: 'rr-mine', teamName: 'Mine', ownerName: 'me' }, { id: 'rr-b', teamName: 'Bees', ownerName: 'b' },
      { id: 'rr-c', teamName: 'Cats', ownerName: 'c' }, { id: 'rr-d', teamName: 'Dogs', ownerName: 'd' },
    ])
    m.corrections.mockResolvedValue({ covered: true, latest: { week: 7, changes: [{}], matchups: [{ fullyApplied: false, resultFlipped: true }] } })
    m.inactive.mockResolvedValue({ native: true, teams: [{ teamName: 'Cats', managerName: 'c', managed: null, suggested: true }] })
  })

  it('a member: prizes, the log, their own trade and league-vote trades — never another team’s commissioner review', async () => {
    const r = await load()
    expect(r.ok).toBe(true)
    const text = r.data!.summary
    expect(r.data!.viewerRole).toBe('member')
    expect(text).toMatch(/Weekly prizes:/)
    expect(text).toMatch(/Trade between Mine and Bees: Under commissioner review/)
    expect(text).toMatch(/Trade between Cats and Dogs: Under league review/)
    expect(text.match(/Trade between/g)).toHaveLength(2)
    expect(text).toMatch(/AllFantasy is setting your lineup/)
    expect(text).toMatch(/Latest league log:/)
    expect(text).not.toMatch(/stat correction/i)
    expect(text).not.toMatch(/look(s)? inactive/)
    expect(m.corrections).not.toHaveBeenCalled()
    expect(m.inactive).not.toHaveBeenCalled()
  })

  it('a commissioner also sees every trade in review, the stat correction and the inactive teams', async () => {
    m.role.mockResolvedValue('commissioner')
    const text = (await load()).data!.summary
    expect(text.match(/Trade between/g)).toHaveLength(3)
    expect(text).toMatch(/Week 7 stat correction: .* flipping a result\. 1 still to apply/)
    expect(text).toMatch(/Cats looks inactive/)
  })

  it('a log set commish-only is not read out to a member', async () => {
    m.log.mockResolvedValue({ ok: true, canManage: false, visibility: 'commish_only', hidden: true, entries: [], nextCursor: null })
    expect((await load()).data!.summary).not.toMatch(/league log/)
  })

  it('nothing outside leagues AllFantasy runs, and nothing without a league', async () => {
    m.prisma.league.findUnique.mockResolvedValue({ platform: 'sleeper', settings: {} })
    expect(await load()).toMatchObject({ ok: true, data: null })
    expect(await provider.load({ userId: 'u1' })).toMatchObject({ ok: true, data: null })
    expect(m.prizes).not.toHaveBeenCalled()
  })

  it('never throws: a failed read is a failed provider result', async () => {
    m.prisma.redraftTradeProposal.findMany.mockRejectedValue(new Error('db down'))
    expect(await load()).toMatchObject({ ok: false, data: null, error: 'db down' })
  })
})
