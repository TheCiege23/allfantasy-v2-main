import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const getServerSessionMock = vi.hoisted(() => vi.fn())
vi.mock('next-auth', () => ({ getServerSession: getServerSessionMock }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))

const prismaMock = vi.hoisted(() => ({
  league: { findMany: vi.fn(), findUnique: vi.fn() },
}))
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

const cookieStoreMock = vi.hoisted(() => ({ get: vi.fn(() => undefined) }))
vi.mock('next/headers', () => ({ cookies: () => Promise.resolve(cookieStoreMock) }))

import { liveSettingsClient } from '@/lib/commissioner-ui/settings/decision-os-client/live'
import { demoSettingsClient } from '@/lib/commissioner-ui/settings/decision-os-client/demo'
import { stubSettingsClient } from '@/lib/commissioner-ui/settings/decision-os-client/stub'

/**
 * Settings, the tab that was fifteen lines of placeholder card on top of 64 working routes.
 *
 * The assertions that matter here are all about one thing: this page must be incapable of stating a
 * default as a fact. Every other module can degrade to an error; Settings can degrade to a wrong
 * number, which is worse, because a commissioner has no way to tell it from a right one.
 */

const IMPORTED_SETTINGS = {
  leagueSize: 14,
  season: 2026,
  isDynasty: true,
  league_variant: 'DYNASTY_IDP',
  matchup_frequency: 'weekly',
  taxi_slots: 6,
  faab_budget: 250,
  playoff_team_count: 6,
  roster_positions: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'SUPER_FLEX', 'DL', 'LB', 'DB', 'BN', 'BN', 'BN'],
  rosterSettings: { irSlots: 6, taxiSlots: 6, benchSlots: 27, devyCollegeSlots: 2 },
  waiverSettings: { faabBudget: 250, waiverType: 'faab' },
  playoffSettings: { playoffTeams: 6, playoffStartWeek: 15 },
  draftSettings: { draftType: 'snake' },
  commissionerSettings: { tradeDeadlineWeek: 12 },
  scoringSettings: {
    format: 'custom',
    source: 'sleeper',
    scoringTemplateId: 'fb_half_ppr',
    rules: { pass_yd: 0.04, pass_td: 6, rec: 1, idp_tkl_solo: 2, fum_lost: -2 },
  },
  conceptRules: {
    concept: 'dynasty',
    extensions: { importSource: 'sleeper', importMetadata: { externalLeagueId: '1313569789435736064' } },
  },
}

function withLeague(settings: unknown, overrides: Record<string, unknown> = {}) {
  getServerSessionMock.mockResolvedValue({ user: { id: 'user-1' } })
  prismaMock.league.findMany.mockResolvedValue([{ id: 'lg-1', status: 'active' }])
  prismaMock.league.findUnique.mockResolvedValue({
    name: 'The Last IDP Dynasty!!',
    settings,
    platform: 'sleeper',
    platformLeagueId: '1313569789435736064',
    sport: 'nfl',
    ...overrides,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})
afterEach(() => {
  vi.clearAllMocks()
})

describe('Settings live client — reads captured rules, never defaults', () => {
  it('reads the real imported values for every group', async () => {
    withLeague(IMPORTED_SETTINGS)
    const { data, error } = await liveSettingsClient.getSnapshot()
    expect(error).toBeNull()

    const byLabel = new Map(
      (data?.groups ?? []).flatMap((g) => g.entries.map((e) => [`${g.id}:${e.label}`, e.value] as const)),
    )
    expect(byLabel.get('identity:Teams')).toBe('14')
    expect(byLabel.get('identity:Format')).toBe('Dynasty IDP')
    expect(byLabel.get('identity:Dynasty')).toBe('Yes')
    expect(byLabel.get('waivers:FAAB budget')).toBe('$250')
    expect(byLabel.get('waivers:Waiver type')).toBe('FAAB')
    expect(byLabel.get('playoffs:Playoff teams')).toBe('6')
    expect(byLabel.get('playoffs:Trade deadline')).toBe('12')
    expect(byLabel.get('roster:Taxi squad')).toBe('6')
    expect(byLabel.get('roster:Devy / college')).toBe('2')
    // Starters are the roster positions minus bench and IR — counted, not configured.
    expect(byLabel.get('roster:Starting slots')).toBe('11')
    expect(byLabel.get('roster:Total roster spots')).toBe('14')
  })

  /*
   * 🛑 THE ASSERTION THIS WHOLE MODULE EXISTS FOR. `UnifiedLeagueSettingsService.getLeagueSettings()`
   * returns sport DEFAULTS for any league whose settings blob lacks a `meta` key, and measured on
   * production 2026-09-09 that is **0 of 288** leagues carrying one — so a Settings page built on it
   * would have shown every commissioner on the platform a rule set belonging to no league at all.
   * A missing value has to stay missing all the way to the view.
   */
  it('reports an absent setting as null rather than substituting a default', async () => {
    withLeague({ leagueSize: 10, season: 2026 })
    const { data, error } = await liveSettingsClient.getSnapshot()
    expect(error).toBeNull()

    const entries = (data?.groups ?? []).flatMap((g) => g.entries)
    const faab = entries.find((e) => e.label === 'FAAB budget')
    const playoffTeams = entries.find((e) => e.label === 'Playoff teams')
    const draftType = entries.find((e) => e.label === 'Draft type')

    expect(faab?.value).toBeNull()
    expect(playoffTeams?.value).toBeNull()
    expect(draftType?.value).toBeNull()
    // And the ones we DO hold are still reported, so a partial capture is not an all-or-nothing failure.
    expect(entries.find((e) => e.label === 'Teams')?.value).toBe('10')
  })

  /*
   * ⚠ ZERO IS A RULE, NULL IS AN ABSENCE, AND CONFLATING THEM IS THE FAILURE MODE. A league that plays
   * with no FAAB budget is a different league from one whose budget we did not capture, and `$0` claims
   * the first about the second.
   */
  it('distinguishes a captured zero from an absent value', async () => {
    withLeague({ waiverSettings: { waiverType: 'faab', faabBudget: 0 } })
    const { data } = await liveSettingsClient.getSnapshot()
    const faab = (data?.groups ?? []).flatMap((g) => g.entries).find((e) => e.label === 'FAAB budget')
    expect(faab?.value).toBe('$0')
  })

  it('surfaces every scoring rule, ordered by impact, labelling the ones it knows', async () => {
    withLeague(IMPORTED_SETTINGS)
    const { data } = await liveSettingsClient.getSnapshot()
    expect(data?.scoring.ruleCount).toBe(5)
    expect(data?.scoring.templateId).toBe('fb_half_ppr')
    // Biggest absolute impact first: a 6-point TD above a 0.04 passing yard.
    expect(data?.scoring.rules[0]?.stat).toBe('pass_td')
    expect(data?.scoring.rules.at(-1)?.stat).toBe('pass_yd')
    // A known key gets a human label; an unknown one keeps the raw key rather than being dropped.
    expect(data?.scoring.rules.find((r) => r.stat === 'idp_tkl_solo')?.label).toBe('IDP solo tackle')
  })

  it('keeps an unlabelled provider stat rather than hiding it', async () => {
    withLeague({ scoringSettings: { rules: { some_future_stat: 3 } } })
    const { data } = await liveSettingsClient.getSnapshot()
    /*
     * The label table will always trail the provider's vocabulary. Dropping a rule because nobody has
     * named it yet would make the scoring list quietly incomplete — the one thing a commissioner
     * checking their import cannot afford.
     */
    expect(data?.scoring.rules).toEqual([{ stat: 'some_future_stat', label: 'some_future_stat', points: 3 }])
  })

  it('marks an imported league read-only, and names where its rules live', async () => {
    withLeague(IMPORTED_SETTINGS)
    const { data } = await liveSettingsClient.getSnapshot()
    expect(data?.provenance.editableHere).toBe(false)
    expect(data?.provenance.source).toBe('Sleeper')
    expect(data?.provenance.externalLeagueId).toBe('1313569789435736064')
  })

  it('returns a snapshot, not an error, for a league whose settings are empty', async () => {
    withLeague(null)
    const { data, error } = await liveSettingsClient.getSnapshot()
    /*
     * "We hold no rules for this league" is a true and actionable answer — it tells a commissioner the
     * import did not capture settings. An error would replace that specific finding with a generic
     * failure the commissioner can do nothing with.
     */
    expect(error).toBeNull()
    expect(data?.scoring.ruleCount).toBe(0)

    /*
     * Everything sourced from the settings blob is null. `Sport` is deliberately excluded from that
     * check because it is NOT from the blob — it is `leagues.sport`, a column we hold regardless of
     * what the import captured. Asserting "every entry is null" would have been asserting that a fact
     * we do hold gets thrown away, which is the opposite of this module's rule.
     */
    const entries = (data?.groups ?? []).flatMap((g) => g.entries)
    const fromBlob = entries.filter((e) => e.label !== 'Sport')
    expect(fromBlob.length).toBeGreaterThan(10)
    expect(fromBlob.every((e) => e.value === null)).toBe(true)
    expect(entries.find((e) => e.label === 'Sport')?.value).toBe('Nfl')
  })

  it('refuses when no active league resolves, without reading the league row', async () => {
    getServerSessionMock.mockResolvedValue(null)
    const { data, error } = await liveSettingsClient.getSnapshot()
    expect(data).toBeNull()
    expect(error?.category).toBe('upstream_unavailable')
    expect(prismaMock.league.findUnique).not.toHaveBeenCalled()
  })
})

describe('Settings client parity', () => {
  it('every mode satisfies the same surface and tags its own source', async () => {
    for (const [client, source] of [
      [stubSettingsClient, 'stub'],
      [demoSettingsClient, 'demo'],
    ] as const) {
      const response = await client.getSnapshot()
      expect(response.source).toBe(source)
      expect(response.error).toBeNull()
      expect(response.data?.groups.length).toBeGreaterThan(0)
    }
  })

  /*
   * A demo where every field is populated teaches a viewer that this page is always complete, and then
   * the first real league with a gap reads as broken. Sales and QA look at Demo Mode, so the
   * "not captured" state has to be visible in it.
   */
  it('demo and stub both exercise the not-captured state', async () => {
    for (const client of [stubSettingsClient, demoSettingsClient]) {
      const { data } = await client.getSnapshot()
      const entries = (data?.groups ?? []).flatMap((g) => g.entries)
      expect(entries.some((e) => e.value === null)).toBe(true)
    }
  })
})
