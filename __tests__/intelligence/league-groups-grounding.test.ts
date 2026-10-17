import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * Survivor All-Stars Guillotine, as production stores it (read-only, 2026-09-28): leagueType
 * 'guillotine', confirmed 'survivor_guillotine', and the Sleeper divisions "Old School" / "New Era",
 * keyed by roster id. The commissioner's pairing sheet for the league lists the same 11 + 11, so the
 * divisions ARE the tribes. Rosters 6 and 12 have no owner on file.
 *
 * Chimmy was asked "which teams are New Era and which are the old heads?" and said guillotine has no
 * factions: it had the concept's name, none of its rules, and no team list anywhere.
 */

const h = vi.hoisted(() => ({ league: vi.fn(), teams: vi.fn() }))

vi.mock('@/lib/prisma', () => ({ prisma: { league: { findFirst: h.league }, leagueTeam: { findMany: h.teams } } }))
vi.mock('@/lib/league-context/leagueContextService', () => ({
  getLeagueContext: vi.fn(async () => ({
    name: 'Survivor All-Stars Guillotine',
    teams: 22,
    scoring: { format: 'ppr', idp: { emphasis: null } },
    variant: { idp: false, superflex: false, dynasty: false, keeper: false, bestBall: false },
    houseRules: { pirate: null },
  })),
}))
vi.mock('@/lib/trade-intel/marketValueService', () => ({ getMarketValues: vi.fn(async () => null) }))
vi.mock('@/lib/league-history/sleeperH2HService', () => ({ getLeagueH2H: vi.fn(async () => null) }))
vi.mock('@/lib/trade-intel/sleeperTradeGradeService', () => ({ getTradeGrades: vi.fn(async () => null) }))

import { resolveLeagueIntelligenceGrounding } from '@/lib/intelligence/chimmy/leagueIntelligenceGrounding'

const DIVISIONS = {
  source: 'sleeper',
  names: { '1': 'Old School', '2': 'New Era' },
  teams: { '1': '1', '2': '2', '3': '1', '4': '1', '5': '1', '6': '1', '7': '2', '8': '1', '9': '2', '10': '1', '11': '1', '12': '2', '13': '2', '14': '2', '15': '1', '16': '1', '17': '2', '18': '2', '19': '1', '20': '2', '21': '2', '22': '2' },
}

/* Synthetic names: the real league's managers are real people, and this repo is public. */
const TEAMS: Array<[string, string, string]> = [
  ['1', 'owner01', 'owner01'], ['2', 'owner02', 'owner02'], ['3', 'owner03', 'Team 03 Name'], ['4', 'owner04', 'owner04'],
  ['5', 'owner05', 'owner05'], ['6', 'Unknown', 'Unknown'], ['7', 'owner07', 'owner07'], ['8', 'owner08', 'owner08'],
  ['9', 'owner09', 'Team 09 Name'], ['10', 'owner10', 'owner10'], ['11', 'owner11', 'owner11'], ['12', 'Unknown', 'Unknown'],
  ['13', 'owner13', 'owner13'], ['14', 'owner14', 'owner14'], ['15', 'owner15', 'Team 15 Name'], ['16', 'owner16', 'owner16'],
  ['17', 'owner17', 'owner17'], ['18', 'owner18', 'Team 18 Name'], ['19', 'owner19', 'owner19'], ['20', 'owner20', 'owner20'],
  ['21', 'owner21', 'Team 21 Name'], ['22', 'owner22', 'owner22'],
]

function league(settings: Record<string, unknown>) {
  h.league.mockResolvedValue({ name: 'Survivor All-Stars Guillotine', platform: 'sleeper', platformLeagueId: '100000000000000001', leagueType: 'guillotine', settings })
}

beforeEach(() => {
  vi.clearAllMocks()
  h.teams.mockResolvedValue(TEAMS.map(([externalId, ownerName, teamName]) => ({ externalId, ownerName, teamName })))
})

describe('league groups and format rules in Chimmy grounding', () => {
  it('names both tribes and every team in each, as synced', async () => {
    league({ leagueTypeConfirmation: { type: 'survivor_guillotine' }, standings_divisions: DIVISIONS })
    const text = (await resolveLeagueIntelligenceGrounding({ userId: 'u1', leagueId: 'L1' }))!

    const line = text.split('\n').find((l) => l.startsWith('Team groups'))!
    expect(line).toContain('Old School (11):')
    expect(line).toContain('New Era (11):')
    const oldSchool = line.slice(line.indexOf('Old School (11):'), line.indexOf('New Era (11):'))
    for (const name of ['owner01', 'Team 03 Name (owner03)', 'owner04', 'owner08', 'Team 15 Name (owner15)', 'owner19']) {
      expect(oldSchool).toContain(name)
    }
    const newEra = line.slice(line.indexOf('New Era (11):'))
    for (const name of ['owner02', 'Team 09 Name (owner09)', 'owner14', 'owner22', 'Team 21 Name (owner21)', 'owner18']) {
      expect(newEra).toContain(name)
    }
    // No owner on file is said, not guessed and not dropped.
    expect(oldSchool).toContain('roster 6, owner not on file')
    expect(newEra).toContain('roster 12, owner not on file')
    expect(line).toMatch(/usually the tribes/)
    expect(line).toMatch(/may predate a shuffle/)
  })

  it('says what the format is, not just its name, including that it has no trades', async () => {
    league({ leagueTypeConfirmation: { type: 'survivor_guillotine' }, standings_divisions: DIVISIONS })
    const text = (await resolveLeagueIntelligenceGrounding({ userId: 'u1', leagueId: 'L1' }))!
    expect(text).toMatch(/What Survivor[^:]*means: .*two tribes of 11/)
    expect(text).toMatch(/Not part of this format: Trade/)
  })

  it('does not call divisions tribes outside a survivor-style league', async () => {
    league({ standings_divisions: DIVISIONS })
    const text = (await resolveLeagueIntelligenceGrounding({ userId: 'u1', leagueId: 'L1' }))!
    expect(text).toContain('Team groups')
    expect(text).not.toMatch(/tribe/i)
  })

  it('adds no group line, and reads no teams, when the league has no divisions', async () => {
    league({ leagueTypeConfirmation: { type: 'survivor_guillotine' } })
    const text = (await resolveLeagueIntelligenceGrounding({ userId: 'u1', leagueId: 'L1' }))!
    expect(text).not.toContain('Team groups')
    expect(h.teams).not.toHaveBeenCalled()
  })

  it('keeps the rest of the grounding when the team read fails', async () => {
    league({ leagueTypeConfirmation: { type: 'survivor_guillotine' }, standings_divisions: DIVISIONS })
    h.teams.mockRejectedValue(new Error('db down'))
    const text = await resolveLeagueIntelligenceGrounding({ userId: 'u1', leagueId: 'L1' })
    expect(text).toContain('AllFantasy league concept')
    expect(text).not.toContain('Team groups')
  })
})
