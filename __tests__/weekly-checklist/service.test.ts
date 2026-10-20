import { beforeEach, describe, expect, it, vi } from 'vitest'

/** The checklist's reads, against a fake store that filters by the `where` actually sent. */

const m = vi.hoisted(() => ({
  league: null as Record<string, unknown> | null,
  season: null as Record<string, unknown> | null,
  matchups: [] as Array<{ seasonId: string; week: number; status: string }>,
  claims: [] as Array<{ seasonId: string; status: string; submittedAt: Date; processedAt: Date | null }>,
  rosters: [] as Array<{ id: string; seasonId: string; teamName: string | null; ownerName: string; players: Array<Record<string, unknown>> }>,
  tradeWhere: null as unknown,
  tradeCount: 0,
  teams: [] as Array<{ id: string; teamName: string | null }>,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: vi.fn(async () => m.league) },
    redraftSeason: { findFirst: vi.fn(async () => m.season) },
    redraftMatchup: { findMany: vi.fn(async ({ where }: { where: { seasonId: string; week: number } }) => m.matchups.filter((x) => x.seasonId === where.seasonId && x.week === where.week)) },
    redraftWaiverClaim: {
      findMany: vi.fn(async ({ where }: { where: { seasonId: string; status: string } }) => m.claims.filter((c) => c.seasonId === where.seasonId && c.status === where.status)),
      count: vi.fn(async ({ where }: { where: { seasonId: string; processedAt: { gte: Date } } }) =>
        m.claims.filter((c) => c.seasonId === where.seasonId && c.status !== 'pending' && c.processedAt && c.processedAt >= where.processedAt.gte).length),
    },
    redraftRoster: {
      findMany: vi.fn(async ({ where }: { where: { seasonId: string } }) =>
        m.rosters.filter((r) => r.seasonId === where.seasonId).map((r) => ({ ...r, players: r.players.filter((p) => p.droppedAt == null) }))),
    },
    redraftTradeProposal: { count: vi.fn(async ({ where }: { where: unknown }) => { m.tradeWhere = where; return m.tradeCount }) },
    leagueTeam: { findMany: vi.fn(async () => m.teams) },
  },
}))

import { isPlainRedraft, readDues, readWeeklyChecklist } from '@/lib/commissioner/weeklyChecklistService'

const NOW = new Date('2026-10-21T15:00:00Z')
const plain = { platform: 'native', leagueType: 'redraft', leagueVariant: null, isDynasty: false, bestBallMode: false, guillotineMode: false }
const starter = (name: string, slotType: string, extra: Record<string, unknown> = {}) => ({ playerName: name, slotType, injuryStatus: null, byeWeek: null, droppedAt: null, ...extra })

beforeEach(() => {
  m.league = { ...plain, sport: 'NFL', settings: {}, tradeDeadlineWeek: 11 }
  m.season = { id: 'S', season: 2026, status: 'in_season', currentWeek: 7, totalWeeks: 17, playoffStartWeek: 15 }
  m.matchups = [{ seasonId: 'S', week: 6, status: 'final' }, { seasonId: 'S', week: 6, status: 'in_progress' }, { seasonId: 'S', week: 7, status: 'scheduled' }]
  m.claims = [
    { seasonId: 'S', status: 'pending', submittedAt: new Date(NOW.getTime() - 40 * 3_600_000), processedAt: null },
    { seasonId: 'S', status: 'processed', submittedAt: NOW, processedAt: new Date(NOW.getTime() - 86_400_000) },
  ]
  // The resolver's default NFL layout with no league settings: QB, RB, 2 WR, TE, DEF = 6 starters.
  const full = ['QB', 'RB', 'WR', 'WR', 'TE', 'DEF'].map((s, i) => starter(`P${i}`, s))
  m.rosters = [
    { id: 'r1', seasonId: 'S', teamName: 'Aces', ownerName: 'a', players: [...full, starter('Bench Guy', 'BN')] },
    { id: 'r2', seasonId: 'S', teamName: null, ownerName: 'Bo', players: [...full.slice(0, 5), starter('Gone', 'DEF', { droppedAt: new Date() })] },
    { id: 'r3', seasonId: 'S', teamName: 'Comets', ownerName: 'c', players: [...full.slice(1), starter('Hurt QB', 'QB', { injuryStatus: 'Out' })] },
  ]
  m.tradeCount = 1
  m.teams = [{ id: 't1', teamName: 'Aces' }, { id: 't2', teamName: 'Bolts' }]
})

describe('isPlainRedraft', () => {
  it('admits only AllFantasy-run plain redraft', () => {
    expect(isPlainRedraft(plain)).toBe(true)
    expect(isPlainRedraft({ ...plain, leagueVariant: 'redraft' })).toBe(true)
    expect(isPlainRedraft({ ...plain, platform: 'sleeper' })).toBe(false)
    expect(isPlainRedraft({ ...plain, leagueType: 'dynasty' })).toBe(false)
    expect(isPlainRedraft({ ...plain, leagueVariant: 'guillotine' })).toBe(false)
    expect(isPlainRedraft({ ...plain, leagueVariant: 'some_new_variant' })).toBe(false) // allow-list
    expect(isPlainRedraft({ ...plain, bestBallMode: true })).toBe(false)
    expect(isPlainRedraft({ ...plain, guillotineMode: true })).toBe(false)
  })
})

describe('readWeeklyChecklist', () => {
  it('builds the week from the stored rows', async () => {
    const view = await readWeeklyChecklist('L', NOW)
    expect(view).toMatchObject({ applies: true, week: 7 })
    const items = Object.fromEntries((view as { items: Array<{ id: string }> }).items.map((i) => [i.id, i]))
    expect(items.scores).toMatchObject({ status: 'todo' })
    expect(items.waivers).toMatchObject({ status: 'todo' })
    // r2 is a starter short (the dropped DEF does not count); r3 starts a QB who is out; the bench player is not a starter.
    expect(items.lineups).toMatchObject({ status: 'todo', title: { en: '2 teams need a lineup fix for week 7' } })
    expect((items.lineups as { detail: { en: string } }).detail.en).toContain('Empty starting slots: Bo.')
    expect((items.lineups as { detail: { en: string } }).detail.en).toContain("Starting someone who can't play: Comets.")
    expect(items.trades).toMatchObject({ status: 'todo' })
    expect(m.tradeWhere).toEqual({ seasonId: 'S', status: 'pending', acceptedAt: { not: null }, vetoMode: 'commissioner' })
  })

  it('says why it does not apply: other formats, no season, or not in season', async () => {
    m.league = { ...m.league, leagueVariant: 'survivor' }
    expect(await readWeeklyChecklist('L', NOW)).toEqual({ applies: false, reason: 'not_redraft' })
    m.league = { ...plain, sport: 'NFL', settings: {}, tradeDeadlineWeek: null }
    m.season = null
    expect(await readWeeklyChecklist('L', NOW)).toEqual({ applies: false, reason: 'no_season' })
    m.season = { id: 'S', season: 2026, status: 'setup', currentWeek: 0, totalWeeks: 17, playoffStartWeek: 15 }
    expect(await readWeeklyChecklist('L', NOW)).toEqual({ applies: false, reason: 'not_in_season' })
    m.league = null
    expect(await readWeeklyChecklist('L', NOW)).toBeNull()
  })
})

describe('readDues', () => {
  it('uses the action queue’s rule: paid, or this season listed in paidSeasons', () => {
    const settings = { dues_tracker: { enabled: true, entries: [{ teamId: 't1', paid: true }, { teamId: 't2', paidSeasons: [2025] }, { teamId: 't3', paidSeasons: [2026] }] } }
    const teams = [{ id: 't1', teamName: 'A' }, { id: 't2', teamName: 'B' }, { id: 't3', teamName: 'C' }, { id: 't4', teamName: null }]
    expect(readDues(settings, teams, 2026)).toEqual({ unpaid: ['B', 'Unnamed team'], total: 4 })
    expect(readDues({ dues_tracker: { enabled: false } }, teams, 2026)).toBeNull()
    expect(readDues({}, teams, 2026)).toBeNull()
  })
})
