/**
 * The dynasty rollover wizard (lib/season-rollover/dynastyRolloverWizard.ts and its service): each
 * step's state in the spec's order, which seasons it reads, the drafted announcement, Chimmy's
 * words, next season's dues, and the Commissioner Hub card in English and Spanish.
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const m = vi.hoisted(() => ({
  patch: vi.fn(),
  modal: vi.fn(),
  draftState: vi.fn(),
  preview: vi.fn(),
  payouts: vi.fn(),
  plan: vi.fn(),
  prisma: {
    league: { findUnique: vi.fn() },
    redraftSeason: { findMany: vi.fn() },
    redraftPlayoffBracket: { findUnique: vi.fn() },
    redraftRoster: { findUnique: vi.fn() },
    dynastyLeagueConfig: { findUnique: vi.fn() },
    salaryCapLeagueConfig: { findUnique: vi.fn() },
    playerContract: { findMany: vi.fn() },
    redraftMatchup: { count: vi.fn() },
    appUser: { findUnique: vi.fn() },
  },
}))
const lang = vi.hoisted(() => ({ language: 'en' as 'en' | 'es' }))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: m.prisma }))
vi.mock('@/lib/league/execute-league-settings-patch', () => ({ executeLeagueSettingsPatch: m.patch }))
vi.mock('@/lib/redraft/offseason/startDynastyNewSeason', () => ({ rookieDraftState: m.draftState }))
vi.mock('@/lib/redraft/offseason/dynastyRolloverHousekeeping', () => ({
  DYNASTY_ROLLOVER_METADATA_KEY: 'dynastyRollover',
  previewDynastyRolloverHousekeeping: m.preview,
}))
vi.mock('@/lib/payouts/payoutService', () => ({ readPayoutsView: m.payouts }))
vi.mock('@/lib/entitlements/afCommissionerPlan', () => ({ hasAfCommissionerPlan: m.plan }))
vi.mock('@/components/i18n/LanguageProviderClient', async () => {
  const { translations } = await import('@/lib/i18n/translations')
  const t = (key: string) => translations[lang.language][key] ?? translations.en[key] ?? key
  return {
    useOptionalLanguage: () => ({
      language: lang.language,
      t,
      tInterpolate: (key: string, vars: Record<string, string | number>) =>
        t(key).replace(/\{\{(\w+)\}\}/g, (_: string, k: string) => String(vars[k] ?? '')),
    }),
  }
})
vi.mock('@/components/commish/BroadcastModal', () => ({
  default: (p: { open: boolean; defaultMessage?: string }) => {
    m.modal(p)
    return p.open ? <div data-testid="broadcast-modal">{p.defaultMessage}</div> : null
  },
}))

import { ANNOUNCEMENT_LIMIT } from '@/lib/season-rollover/rolloverWizard'
import {
  buildDynastyRolloverAnnouncement,
  buildDynastyRolloverPlan,
  describeDynastyOffseason,
  type DynastyRolloverInput,
} from '@/lib/season-rollover/dynastyRolloverWizard'
import {
  readDynastyRolloverDue,
  readDynastyRolloverView,
  resolveDynastyRolloverSeasons,
  setDynastyNextSeasonDues,
  type DynastyRolloverView,
} from '@/lib/season-rollover/dynastyRolloverService'
import { buildLeagueOfficeSummary } from '@/lib/chimmy-context/leagueOfficeSummary'
import { DynastyRolloverWizard } from '@/components/core-app/commissioner/DynastyRolloverWizard'

const input = (over: Partial<DynastyRolloverInput> = {}): DynastyRolloverInput => ({
  season: 2026,
  nextSeason: 2027,
  seasonOver: true,
  started: false,
  champion: 'Aces',
  rookieDraft: 'none',
  draftOrder: { source: 'max_pf', finalOrderSaved: false },
  taxi: { slots: 3, yearsLimit: 2, allowNonRookies: false, toBench: 2, unverified: 1 },
  contracts: null,
  dues: { enabled: true, amountDollars: 100, unpaidTeams: 0, setForNextSeason: false },
  schedule: { matchups: 0, weeks: 0 },
  overLimitTeams: 0,
  ...over,
})
const states = (i: DynastyRolloverInput) => Object.fromEntries(buildDynastyRolloverPlan(i).steps.map((s) => [s.key, s.state]))

describe('the steps', () => {
  it('in the spec order: draft order, taxi, contracts, dues, schedule, then the start', () => {
    const keys = buildDynastyRolloverPlan(input({ contracts: { active: 40, expiring: 5 } })).steps.map((s) => s.key)
    expect(keys).toEqual(['season', 'draft_order', 'taxi', 'contracts', 'dues', 'schedule', 'start'])
  })

  it('in season, everything waits for the champion and the start is locked', () => {
    const plan = buildDynastyRolloverPlan(input({ seasonOver: false }))
    expect(plan.steps.every((s) => s.state === 'blocked')).toBe(true)
    expect(plan.canStart).toBe(false)
  })

  it('once it is over: the rookie draft and the taxi moves are to-dos; dues and schedule are optional', () => {
    expect(states(input())).toEqual({
      season: 'done', draft_order: 'todo', taxi: 'todo', dues: 'optional', schedule: 'optional', start: 'todo',
    })
    expect(states(input({ taxi: { slots: 3, yearsLimit: null, allowNonRookies: false, toBench: 0, unverified: 0 } })).taxi).toBe('done')
    expect(states(input({ taxi: { slots: 0, yearsLimit: null, allowNonRookies: false, toBench: 0, unverified: 0 } })).taxi).toBe('optional')
    expect(states(input({ dues: { enabled: true, amountDollars: 120, unpaidTeams: 0, setForNextSeason: true } })).dues).toBe('done')
    expect(states(input({ schedule: { matchups: 70, weeks: 14 } })).schedule).toBe('done')
  })

  it('contracts appear only in a league that has them, and expiring ones are a to-do', () => {
    expect(states(input()).contracts).toBeUndefined()
    expect(states(input({ contracts: { active: 40, expiring: 5 } })).contracts).toBe('todo')
    expect(states(input({ contracts: { active: 40, expiring: 0 } })).contracts).toBe('done')
  })

  it('no rookie draft: the start needs a second yes; an open draft holds it; a finished one does not', () => {
    expect(buildDynastyRolloverPlan(input())).toMatchObject({ canStart: true, startSkipsRookieDraft: true })
    expect(buildDynastyRolloverPlan(input({ rookieDraft: 'open' }))).toMatchObject({ canStart: false, startSkipsRookieDraft: false })
    expect(states(input({ rookieDraft: 'open' })).start).toBe('blocked')
    expect(buildDynastyRolloverPlan(input({ rookieDraft: 'complete' }))).toMatchObject({ canStart: true, startSkipsRookieDraft: false })
    expect(states(input({ rookieDraft: 'complete' })).draft_order).toBe('done')
  })

  it('once next season has started everything reads done and it cannot start twice', () => {
    const plan = buildDynastyRolloverPlan(input({ started: true, rookieDraft: 'complete', contracts: { active: 4, expiring: 2 } }))
    expect(plan.canStart).toBe(false)
    expect(plan.steps.find((s) => s.key === 'start')!.state).toBe('done')
    expect(plan.steps.find((s) => s.key === 'taxi')!.state).toBe('done')
    expect(plan.steps.find((s) => s.key === 'contracts')!.state).toBe('done')
  })
})

describe('which seasons it reads', () => {
  const row = (season: number, status: string, over: Record<string, unknown> = {}) => ({
    id: `s${season}`, season, status, createdAt: new Date(season, 0), currentWeek: 1, playoffStartWeek: 15, totalWeeks: 17, ...over,
  })
  it('a finished season with nothing after it', () => {
    expect(resolveDynastyRolloverSeasons([row(2026, 'complete')])).toMatchObject({ outgoing: { season: 2026 }, incoming: null, seasonOver: true, started: false })
  })
  it('next season set up but not started', () => {
    expect(resolveDynastyRolloverSeasons([row(2027, 'setup'), row(2026, 'complete')])).toMatchObject({
      outgoing: { season: 2026 }, incoming: { season: 2027 }, seasonOver: true, started: false,
    })
  })
  it('next season in its first week is "started"; after that the card steps aside for that season', () => {
    expect(resolveDynastyRolloverSeasons([row(2027, 'active'), row(2026, 'complete')])).toMatchObject({ started: true, outgoing: { season: 2026 } })
    expect(resolveDynastyRolloverSeasons([row(2027, 'active', { currentWeek: 5 }), row(2026, 'complete')])).toMatchObject({
      outgoing: { season: 2027 }, seasonOver: false, inPlayoffs: false,
    })
  })
  it('the playoffs show it ahead of time; a first season being drafted does not', () => {
    expect(resolveDynastyRolloverSeasons([row(2026, 'active', { currentWeek: 16 })])).toMatchObject({ seasonOver: false, inPlayoffs: true })
    expect(resolveDynastyRolloverSeasons([row(2026, 'setup')])).toBeNull()
    expect(resolveDynastyRolloverSeasons([])).toBeNull()
  })
  it('the workspace check: due between the seasons only', async () => {
    m.prisma.redraftSeason.findMany.mockResolvedValueOnce([row(2027, 'setup'), row(2026, 'complete')])
    expect(await readDynastyRolloverDue('L')).toEqual({ season: 2026 })
    m.prisma.redraftSeason.findMany.mockResolvedValueOnce([row(2027, 'active'), row(2026, 'complete')])
    expect(await readDynastyRolloverDue('L')).toBeNull()
    m.prisma.redraftSeason.findMany.mockResolvedValueOnce([row(2026, 'active', { currentWeek: 16 })])
    expect(await readDynastyRolloverDue('L')).toBeNull()
  })
})

describe('the announcement and Chimmy', () => {
  const base = {
    leagueName: 'Dynasty Den', season: 2026, nextSeason: 2027, champion: 'Aces',
    places: [{ place: 1, cents: 60_000, team: 'Aces' }], duesDollars: 150, orderSource: 'lottery' as const,
    rookieDraft: 'none' as const, taxiToBench: 2,
  }
  it('says who won, how the rookie draft is ordered, the taxi check and the dues', () => {
    const text = buildDynastyRolloverAnnouncement({ ...base, language: 'en' })
    expect(text).toBe(
      'Dynasty Den is back for 2027! Congratulations to Aces, our 2026 champion. Payouts: 1st Aces $600. ' +
        'The rookie draft is ordered by a weighted lottery. Check your taxi squad: 2 players no longer qualify and move to the bench. ' +
        'Dues for 2027 are $150. Let us know you’re in.',
    )
    expect(buildDynastyRolloverAnnouncement({ ...base, rookieDraft: 'complete', taxiToBench: 0, language: 'en' })).toContain('The rookie draft is done.')
  })
  it('in Spanish, and within the broadcast limit', () => {
    expect(buildDynastyRolloverAnnouncement({ ...base, language: 'es' })).toContain('El draft de novatos se ordena por una lotería ponderada.')
    const long = buildDynastyRolloverAnnouncement({ ...base, leagueName: 'L'.repeat(300), places: Array.from({ length: 12 }, (_, i) => ({ place: i + 1, cents: 1000, team: `Team ${i}` })), language: 'en' })
    expect(long.length).toBeLessThanOrEqual(ANNOUNCEMENT_LIMIT)
    expect(long).not.toContain('Payouts:')
  })
  it('Chimmy: members hear what affects their team; the commissioner also hears what is left', () => {
    const i = input({ contracts: { active: 30, expiring: 3 } })
    const member = describeDynastyOffseason(i, 'member')
    expect(member.join(' ')).toContain('Rosters carry over')
    expect(member.join(' ')).toContain('2 taxi players no longer meet')
    expect(member.join(' ')).not.toContain('Commissioner:')
    const commish = describeDynastyOffseason(i, 'commissioner').join(' ')
    expect(commish).toContain('still to do in the rollover wizard on the Commissioner Hub: create the rookie draft, review the taxi squads, expiring contracts.')
    expect(commish).toContain('3 contracts run out with the 2026 season.')
    expect(describeDynastyOffseason(input({ seasonOver: false }), 'member')).toEqual([])
    expect(describeDynastyOffseason(input({ started: true }), 'member')).toEqual([])
  })
  it('the league office slice carries it', () => {
    const summary = buildLeagueOfficeSummary({
      viewerRole: 'member', prizes: null, trades: [], correction: null, inactive: null, viewerTeamManaged: false, log: null,
      offseason: ['The 2026 season is over and 2027 has not started.'],
    })
    expect(summary).toBe('The 2026 season is over and 2027 has not started.')
  })
})

describe('the league read', () => {
  const season = (yr: number, status: string, over: Record<string, unknown> = {}) => ({
    id: `s${yr}`, season: yr, status, createdAt: new Date(yr, 0), currentWeek: 1, playoffStartWeek: 15, totalWeeks: 17, ...over,
  })
  beforeEach(() => {
    vi.clearAllMocks()
    m.prisma.league.findUnique.mockResolvedValue({
      name: 'Dynasty Den', lifecycleMetadata: {}, taxiSlots: 3, taxiAllowNonRookies: false, taxiYearsLimit: 2,
      teams: [{ id: 't1' }, { id: 't2' }, { id: 't3' }],
      settings: {
        dues_tracker: { enabled: true, amount: 100, entries: [{ teamId: 't1', paid: true }] },
        payout_plan: { buyInCents: 10_000, placePercents: [100] },
        rookie_draft_order: { live: { enabled: true, finalOrder: { basedOnSeason: 2026, slots: [], savedAt: 'x' } } },
      },
    })
    m.prisma.redraftSeason.findMany.mockResolvedValue([season(2027, 'setup'), season(2026, 'complete')])
    m.prisma.redraftPlayoffBracket.findUnique.mockResolvedValue({ structure: { championRosterId: 'rA' } })
    m.prisma.redraftRoster.findUnique.mockResolvedValue({ teamName: 'Aces', ownerName: 'a' })
    m.prisma.dynastyLeagueConfig.findUnique.mockResolvedValue({ rookiePickOrderMethod: 'max_pf' })
    m.prisma.salaryCapLeagueConfig.findUnique.mockResolvedValue({ id: 'cap1' })
    m.prisma.playerContract.findMany.mockResolvedValue([
      { yearSigned: 2024, yearsTotal: 3 }, // ends 2026
      { yearSigned: 2026, yearsTotal: 1 }, // ends 2026
      { yearSigned: 2026, yearsTotal: 3 }, // ends 2028
    ])
    m.prisma.redraftMatchup.count.mockResolvedValue(0)
    m.prisma.appUser.findUnique.mockResolvedValue({ id: 'boss' })
    m.draftState.mockResolvedValue('none')
    m.preview.mockResolvedValue({
      moves: [{ reason: 'taxi_years_exceeded' }, { reason: 'ir_ineligible_status' }],
      needsCutDown: [{ rosterId: 'r1' }],
      taxiUnverified: 1,
      maxRosterSize: 25,
    })
    m.payouts.mockResolvedValue({ ok: true, native: true, result: { final: true, places: [{ place: 1, cents: 30_000, rosterId: 'rA' }], names: { rA: 'Aces' } } })
    m.plan.mockResolvedValue(false)
  })

  it('between the seasons: every step measured from the league’s rows', async () => {
    const v = (await readDynastyRolloverView('L', 'boss'))!
    expect(v.show).toBe(true)
    expect(v.input).toEqual({
      season: 2026,
      nextSeason: 2027,
      seasonOver: true,
      started: false,
      champion: 'Aces',
      rookieDraft: 'none',
      draftOrder: { source: 'live_order', finalOrderSaved: true },
      taxi: { slots: 3, yearsLimit: 2, allowNonRookies: false, toBench: 1, unverified: 1 },
      contracts: { active: 3, expiring: 2 },
      dues: { enabled: true, amountDollars: 100, unpaidTeams: 2, setForNextSeason: false },
      schedule: { matchups: 0, weeks: 17 },
      overLimitTeams: 1,
    })
    // The preview reads next season's carried rosters, not last season's.
    expect(m.preview).toHaveBeenCalledWith('L', 's2027')
    expect(v.extras).toBeNull()
  })

  it('a lottery league is ordered by its lottery, whatever the live order saved', async () => {
    m.prisma.dynastyLeagueConfig.findUnique.mockResolvedValue({ rookiePickOrderMethod: 'weighted_lottery' })
    expect((await readDynastyRolloverView('L', 'boss'))!.input.draftOrder.source).toBe('lottery')
  })

  it('AF Commissioner: the drafted announcement, and the carry once next season’s dues are set', async () => {
    m.plan.mockResolvedValue(true)
    const settings = (await m.prisma.league.findUnique()).settings
    m.prisma.league.findUnique.mockResolvedValue({
      name: 'Dynasty Den', lifecycleMetadata: {}, taxiSlots: 0, taxiAllowNonRookies: false, taxiYearsLimit: null, teams: [],
      settings: { ...settings, dues_tracker: { enabled: true, amount: 150, entries: [], season: 2027 } },
    })
    const v = (await readDynastyRolloverView('L', 'boss'))!
    expect(v.extras!.announcement.en).toContain('Dues for 2027 are $150.')
    expect(v.extras!.payoutCarry).toEqual({ fromCents: 10_000, toCents: 15_000 })
  })

  it('once next season is under way it shows what the start did, and no preview runs', async () => {
    m.prisma.redraftSeason.findMany.mockResolvedValue([season(2027, 'active'), season(2026, 'complete')])
    m.prisma.league.findUnique.mockResolvedValue({
      name: 'Dynasty Den', taxiSlots: 3, taxiAllowNonRookies: false, taxiYearsLimit: 2, teams: [], settings: {},
      lifecycleMetadata: { dynastyRollover: { seasonId: 's2027', movedToBench: [{ reason: 'taxi_not_rookie' }, { reason: 'taxi_not_rookie' }], needsCutDown: [], taxiUnverified: 0 } },
    })
    m.draftState.mockResolvedValue('complete')
    const v = (await readDynastyRolloverView('L', 'boss'))!
    expect(v.input).toMatchObject({ started: true, taxi: { toBench: 2 } })
    expect(v.plan.canStart).toBe(false)
    expect(m.preview).not.toHaveBeenCalled()
  })
})

const VIEW = (over: Partial<DynastyRolloverInput> = {}, extras: DynastyRolloverView['extras'] = null): DynastyRolloverView => ({
  applies: true, kind: 'dynasty', leagueName: 'Dynasty Den', season: 2026, nextSeason: 2027, show: true,
  input: input(over), plan: buildDynastyRolloverPlan(input(over)), extras,
})

describe('next season’s dues', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    m.prisma.league.findUnique.mockResolvedValue({ settings: { dues_tracker: { enabled: true, amount: 100, paymentLink: 'https://pay', entries: [{ teamId: 't1', paid: true }] } } })
    m.patch.mockResolvedValue(new Response('{}'))
  })
  it('a fresh list for next season, nobody paid, through the settings patch', async () => {
    expect((await setDynastyNextSeasonDues('L', 'boss', VIEW(), 150)).ok).toBe(true)
    expect(m.patch).toHaveBeenCalledWith('boss', {
      leagueId: 'L',
      settingsMerge: { dues_tracker: { enabled: true, amount: 150, paymentLink: 'https://pay', entries: [], season: 2027 } },
    })
  })
  it('no dues is a choice too', async () => {
    await setDynastyNextSeasonDues('L', 'boss', VIEW(), null)
    expect(m.patch.mock.calls[0][1].settingsMerge.dues_tracker).toMatchObject({ enabled: false, amount: null, season: 2027 })
  })
  it('only between the seasons, and only a sane amount', async () => {
    expect(await setDynastyNextSeasonDues('L', 'boss', VIEW({ seasonOver: false }), 150)).toMatchObject({ ok: false, status: 400 })
    expect(await setDynastyNextSeasonDues('L', 'boss', VIEW({ started: true }), 150)).toMatchObject({ ok: false, status: 400 })
    expect(await setDynastyNextSeasonDues('L', 'boss', VIEW(), -5)).toMatchObject({ ok: false, status: 400 })
    expect(m.patch).not.toHaveBeenCalled()
  })
})

describe('the hub card', () => {
  const stub = () => {
    const f = vi.fn(async () => ({ ok: true, json: async () => ({}) }))
    vi.stubGlobal('fetch', f)
    return f
  }
  const reload = vi.fn(async () => {})
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    lang.language = 'en'
  })

  it('walks the steps; the rookie draft is created through the draft controls', async () => {
    const f = stub()
    render(<DynastyRolloverWizard leagueId="L" view={VIEW()} reload={reload} />)
    expect(screen.getByTestId('dyn-rollover-step-season').textContent).toContain('Aces won 2026.')
    expect(screen.getByTestId('dyn-rollover-step-draft_order').textContent).toContain('Ordered by fewest points first')
    expect(screen.getByTestId('dyn-rollover-step-taxi').textContent).toContain('3 taxi spots, rookies only. Up to 2 seasons in the league.')
    expect(screen.getByTestId('dyn-rollover-step-taxi').textContent).toContain('2 taxi players no longer qualify')
    expect(screen.queryByTestId('dyn-rollover-step-contracts')).toBeNull()
    fireEvent.click(screen.getByTestId('dyn-rollover-create-draft'))
    await waitFor(() => expect(f).toHaveBeenCalledWith('/api/leagues/L/draft/controls', expect.objectContaining({ method: 'POST', body: JSON.stringify({ action: 'create_next_draft' }) })))
    await waitFor(() => expect(reload).toHaveBeenCalled())
  })

  it('starting without a rookie draft takes a second yes', async () => {
    const f = stub()
    render(<DynastyRolloverWizard leagueId="L" view={VIEW()} reload={reload} />)
    const start = screen.getByTestId('dyn-rollover-start') as HTMLButtonElement
    expect(start.textContent).toBe('Start 2027 without a rookie draft')
    expect(start.disabled).toBe(true)
    fireEvent.click(screen.getByTestId('dyn-rollover-confirm'))
    fireEvent.click(start)
    await waitFor(() => expect(f).toHaveBeenCalledWith('/api/leagues/L/season/start-new', expect.objectContaining({ body: JSON.stringify({ skipRookieDraft: true }) })))
  })

  it('with the rookie draft done it starts in one press; an open draft holds it', () => {
    stub()
    render(<DynastyRolloverWizard leagueId="L" view={VIEW({ rookieDraft: 'complete' })} reload={reload} />)
    expect((screen.getByTestId('dyn-rollover-start') as HTMLButtonElement).disabled).toBe(false)
    cleanup()
    render(<DynastyRolloverWizard leagueId="L" view={VIEW({ rookieDraft: 'open' })} reload={reload} />)
    expect(screen.queryByTestId('dyn-rollover-start')).toBeNull()
    expect(screen.getByTestId('dyn-rollover-step-start').textContent).toContain('Finish the rookie draft first')
  })

  it('dues are saved on the rollover route', async () => {
    const f = stub()
    render(<DynastyRolloverWizard leagueId="L" view={VIEW()} reload={reload} />)
    fireEvent.change(screen.getByTestId('dyn-rollover-dues'), { target: { value: '150' } })
    fireEvent.click(screen.getByTestId('dyn-rollover-dues-save'))
    await waitFor(() => expect(f).toHaveBeenCalledWith('/api/leagues/L/rollover', expect.objectContaining({ body: JSON.stringify({ action: 'set_dues', amount: 150 }) })))
  })

  it('a salary-cap league sees its expiring contracts; a plan league gets the drafted announcement', () => {
    stub()
    render(
      <DynastyRolloverWizard
        leagueId="L"
        view={VIEW({ contracts: { active: 40, expiring: 5 } }, { announcement: { en: 'Back for 2027!', es: '¡Volvemos en 2027!' }, payoutCarry: null })}
        reload={reload}
      />,
    )
    expect(screen.getByTestId('dyn-rollover-step-contracts').textContent).toContain('5 of 40 contracts run out with the 2026 season.')
    expect(screen.getByTestId('dyn-rollover-announcement').textContent).toBe('Back for 2027!')
    expect(screen.queryByTestId('dyn-rollover-upsell')).toBeNull()
  })

  it('in Spanish', () => {
    lang.language = 'es'
    stub()
    render(<DynastyRolloverWizard leagueId="L" view={VIEW()} reload={reload} />)
    expect(screen.getByTestId('dyn-rollover-step-season').textContent).toContain('Aces ganó 2026.')
    expect(screen.getByTestId('dyn-rollover-step-draft_order').textContent).toContain('Orden del draft de novatos')
    expect(screen.getByTestId('dyn-rollover-start').textContent).toBe('Iniciar 2027 sin draft de novatos')
    expect(screen.getByTestId('dyn-rollover-upsell').textContent).toContain('AF Commissioner redacta')
  })
})
