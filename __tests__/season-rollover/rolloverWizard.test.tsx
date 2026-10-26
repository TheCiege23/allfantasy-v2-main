/**
 * The season rollover wizard (lib/season-rollover): each step's state, the drafted announcement,
 * the league read (head commissioner, native redraft only, AF Commissioner extras), the carry of
 * next season's dues into the payout buy-in, and the Commissioner Hub card in English and Spanish.
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const m = vi.hoisted(() => ({
  plan: vi.fn(),
  payouts: vi.fn(),
  patch: vi.fn(),
  modal: vi.fn(),
  prisma: {
    league: { findUnique: vi.fn() },
    redraftSeason: { findFirst: vi.fn() },
    redraftPlayoffBracket: { findUnique: vi.fn() },
    redraftRoster: { findUnique: vi.fn() },
    leagueSettings: { findUnique: vi.fn() },
    redraftTradeProposal: { count: vi.fn() },
    redraftWaiverClaim: { count: vi.fn() },
    appUser: { findUnique: vi.fn() },
  },
}))
const lang = vi.hoisted(() => ({ language: 'en' as 'en' | 'es' }))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: m.prisma }))
vi.mock('@/lib/entitlements/afCommissionerPlan', () => ({ hasAfCommissionerPlan: m.plan }))
vi.mock('@/lib/payouts/payoutService', () => ({ readPayoutsView: m.payouts }))
vi.mock('@/lib/league/execute-league-settings-patch', () => ({ executeLeagueSettingsPatch: m.patch }))
vi.mock('next-auth', () => ({ getServerSession: vi.fn().mockResolvedValue({ user: { id: 'boss' } }) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/components/i18n/LanguageProviderClient', () => ({ useOptionalLanguage: () => ({ language: lang.language }) }))
vi.mock('@/components/commish/BroadcastModal', () => ({
  default: (p: { open: boolean; defaultMessage?: string }) => {
    m.modal(p)
    return p.open ? <div data-testid="broadcast-modal">{p.defaultMessage}</div> : null
  },
}))

import { ANNOUNCEMENT_LIMIT, buildRolloverAnnouncement, buildRolloverPlan, type RolloverInput } from '@/lib/season-rollover/rolloverWizard'
import { carryDuesIntoPayouts, readRolloverDue, readRolloverView } from '@/lib/season-rollover/rolloverService'
import { POST } from '@/app/api/leagues/[leagueId]/rollover/handler'
import { RolloverWizard } from '@/components/core-app/commissioner/RolloverWizard'

const input = (over: Partial<RolloverInput> = {}): RolloverInput => ({
  season: 2026,
  nextSeason: 2027,
  seasonOver: true,
  renewed: false,
  champion: 'Aces',
  payouts: { configured: true, final: true, places: [{ place: 1, cents: 60_000, team: 'Aces' }, { place: 2, cents: 30_000, team: 'Bees' }] },
  managers: { active: 10, orphanTeams: [] },
  dues: { enabled: true, amountDollars: 100, unpaidTeams: 0 },
  draftOrder: 'standings',
  pendingTrades: 2,
  pendingClaims: 1,
  ...over,
})
const stateOf = (plan: ReturnType<typeof buildRolloverPlan>, key: string) => plan.steps.find((s) => s.key === key)!.state

describe('the steps', () => {
  it('in season, everything waits for the champion and renew is locked', () => {
    const p = buildRolloverPlan(input({ seasonOver: false }))
    expect(p.steps.map((s) => s.state)).toEqual(['blocked', 'blocked', 'blocked', 'blocked', 'blocked', 'blocked', 'blocked'])
    expect(p.canRenew).toBe(false)
  })

  it('once it is over: what is settled reads done, what needs a hand reads to do, and renew opens', () => {
    const p = buildRolloverPlan(input({ managers: { active: 9, orphanTeams: ['Ghosts'] }, dues: { enabled: true, amountDollars: 100, unpaidTeams: 3 } }))
    expect(stateOf(p, 'season')).toBe('done')
    expect(stateOf(p, 'payouts')).toBe('todo')
    expect(stateOf(p, 'managers')).toBe('todo')
    expect(stateOf(p, 'renew')).toBe('todo')
    expect(p.canRenew).toBe(true)
    expect(p.willCancel).toEqual({ trades: 2, claims: 1 })
  })

  it('no payouts and no dues are optional, not to-dos', () => {
    const p = buildRolloverPlan(input({ payouts: { configured: false, final: false, places: [] }, dues: { enabled: false, amountDollars: null, unpaidTeams: 0 } }))
    expect(stateOf(p, 'payouts')).toBe('optional')
    expect(stateOf(p, 'dues')).toBe('optional')
  })

  it('after the renew it reads done and cannot renew twice', () => {
    const p = buildRolloverPlan(input({ seasonOver: false, renewed: true }))
    expect(stateOf(p, 'renew')).toBe('done')
    expect(stateOf(p, 'season')).toBe('done')
    expect(p.canRenew).toBe(false)
  })
})

describe('the announcement', () => {
  const base = { leagueName: 'The League', season: 2026, nextSeason: 2027, champion: 'Aces', places: input().payouts.places, duesDollars: 100, draftOrder: 'standings' as const, language: 'en' as const }

  it('says who won, what was paid, the dues and how the draft goes', () => {
    expect(buildRolloverAnnouncement(base)).toBe(
      'The League is back for 2027! Congratulations to Aces, our 2026 champion. Payouts: 1st Aces $600, 2nd Bees $300. ' +
        'Dues for 2027 are $100. The draft goes by worst record picks first. Let us know you’re in.',
    )
  })

  it('in Spanish', () => {
    expect(buildRolloverAnnouncement({ ...base, language: 'es', draftOrder: 'random' })).toBe(
      '¡The League vuelve para 2027! Felicidades a Aces, campeón de 2026. Premios: 1.º Aces $600, 2.º Bees $300. ' +
        'La cuota de 2027 es $100. El draft sigue un orden aleatorio. Confirma que vuelves.',
    )
  })

  it('fits the broadcast limit: the payout line goes first, never mid-word', () => {
    const long = buildRolloverAnnouncement({
      ...base,
      leagueName: 'L'.repeat(40),
      places: Array.from({ length: 10 }, (_, i) => ({ place: i + 1, cents: 12_345, team: `A team with a long name ${i}` })),
    })
    expect(long.length).toBeLessThanOrEqual(ANNOUNCEMENT_LIMIT)
    expect(long).not.toMatch(/Payouts:/)
    expect(long).toMatch(/Let us know you’re in\.$/)
    const huge = buildRolloverAnnouncement({ ...base, leagueName: 'word '.repeat(150).trim() })
    expect(huge.length).toBeLessThanOrEqual(ANNOUNCEMENT_LIMIT)
    expect(huge).toMatch(/word$|\.$/)
  })
})

describe('the league read', () => {
  const league = (over: Record<string, unknown> = {}) => ({
    userId: 'boss', name: 'The League', season: 2026, status: 'complete', platform: 'allfantasy',
    leagueVariant: 'redraft', isDynasty: false, lifecycleState: 'completed', lifecycleMetadata: {},
    settings: { dues_tracker: { enabled: true, amount: 120, entries: [{ teamId: 't1', paid: true }] }, payout_plan: { buyInCents: 10_000, placePercents: [100] } },
    teams: [{ teamName: 'Aces', ownerName: 'a', isOrphan: false }, { teamName: 'Ghosts', ownerName: null, isOrphan: true }],
    ...over,
  })
  beforeEach(() => {
    vi.clearAllMocks()
    m.prisma.league.findUnique.mockResolvedValue(league())
    m.prisma.redraftSeason.findFirst.mockResolvedValue({ id: 's1', season: 2026, currentWeek: 17, playoffStartWeek: 15 })
    m.prisma.redraftPlayoffBracket.findUnique.mockResolvedValue({ structure: { championRosterId: 'rA' } })
    m.prisma.redraftRoster.findUnique.mockResolvedValue({ teamName: 'Aces', ownerName: 'a' })
    m.prisma.leagueSettings.findUnique.mockResolvedValue({ draftOrderMethod: 'prev_standings' })
    m.prisma.redraftTradeProposal.count.mockResolvedValue(1)
    m.prisma.redraftWaiverClaim.count.mockResolvedValue(4)
    m.prisma.appUser.findUnique.mockResolvedValue({ id: 'boss', email: 'b@x', username: 'b' })
    m.plan.mockResolvedValue(false)
    m.payouts.mockResolvedValue({
      ok: true, native: true, plan: { buyInCents: 10_000, placePercents: [100] },
      result: { final: true, places: [{ place: 1, cents: 20_000, rosterId: 'rA' }], names: { rA: 'Aces' } },
    })
  })

  it('a free league: every step, measured, and no extras', async () => {
    const r = await readRolloverView('L', 'boss')
    if (!r.ok || !r.view.applies) throw new Error('expected a view')
    expect(r.view.show).toBe(true)
    expect(r.view.input).toMatchObject({
      champion: 'Aces',
      managers: { active: 1, orphanTeams: ['Ghosts'] },
      dues: { enabled: true, amountDollars: 120, unpaidTeams: 1 },
      draftOrder: 'reverse_standings',
      pendingTrades: 1,
      pendingClaims: 4,
      payouts: { configured: true, final: true, places: [{ place: 1, cents: 20_000, team: 'Aces' }] },
    })
    expect(r.view.plan.canRenew).toBe(true)
    expect(r.view.extras).toBeNull()
  })

  it('AF Commissioner: the drafted announcement in both languages, and the dues-to-payouts carry', async () => {
    m.plan.mockResolvedValue(true)
    const r = await readRolloverView('L', 'boss')
    if (!r.ok || !r.view.applies) throw new Error('expected a view')
    expect(r.view.extras!.announcement.en).toMatch(/^The League is back for 2027!/)
    expect(r.view.extras!.announcement.es).toMatch(/^¡The League vuelve para 2027!/)
    expect(r.view.extras!.payoutCarry).toEqual({ fromCents: 10_000, toCents: 12_000 })
  })

  it('only the head commissioner; never outside native redraft leagues', async () => {
    expect(await readRolloverView('L', 'someone')).toEqual({ ok: false, status: 403 })
    expect(await readRolloverView('L', null)).toEqual({ ok: false, status: 401 })
    m.prisma.league.findUnique.mockResolvedValueOnce(league({ platform: 'sleeper' }))
    expect(await readRolloverView('L', 'boss')).toEqual({ ok: true, view: { applies: false, reason: 'not_native' } })
    m.prisma.league.findUnique.mockResolvedValueOnce(league({ leagueVariant: 'dynasty', isDynasty: true }))
    expect(await readRolloverView('L', 'boss')).toEqual({ ok: true, view: { applies: false, reason: 'not_redraft' } })
  })

  it('mid-season the card stays out of the way', async () => {
    m.prisma.league.findUnique.mockResolvedValue(league({ status: 'in_season', lifecycleState: 'in_season' }))
    m.prisma.redraftSeason.findFirst.mockResolvedValue({ id: 's1', season: 2026, currentWeek: 6, playoffStartWeek: 15 })
    const r = await readRolloverView('L', 'boss')
    expect(r.ok && r.view.applies && r.view.show).toBe(false)
  })

  it('carry: refused without the plan, written through the settings patch with it', async () => {
    expect(await carryDuesIntoPayouts('L', 'boss')).toMatchObject({ ok: false, status: 402 })
    expect(m.patch).not.toHaveBeenCalled()
    m.plan.mockResolvedValue(true)
    m.patch.mockResolvedValue(new Response('{}'))
    expect((await carryDuesIntoPayouts('L', 'boss')).ok).toBe(true)
    expect(m.patch).toHaveBeenCalledWith('boss', { leagueId: 'L', settingsMerge: { payout_plan: { buyInCents: 12_000, placePercents: [100] } } })
  })

  it('the handler takes one action and refuses others', async () => {
    const res = await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ action: 'renew' }) }) as never, { params: { leagueId: 'L' } })
    expect(res.status).toBe(400)
  })

  it('the workspace check: a finished, unrenewed season', async () => {
    expect(await readRolloverDue('L')).toEqual({ season: 2026 })
    m.prisma.league.findUnique.mockResolvedValueOnce(league({ status: 'in_season', lifecycleState: 'in_season' }))
    expect(await readRolloverDue('L')).toBeNull()
    m.prisma.league.findUnique.mockResolvedValueOnce(
      league({ settings: { renewal_completed_for_season: 2026, renewal_completed_at: new Date().toISOString() }, status: 'pre_draft', lifecycleState: 'pre_draft' }),
    )
    expect(await readRolloverDue('L')).toBeNull()
  })
})

describe('the hub card', () => {
  const VIEW = {
    applies: true,
    leagueName: 'The League',
    season: 2026,
    nextSeason: 2027,
    show: true,
    input: input({ managers: { active: 9, orphanTeams: ['Ghosts'] } }),
    plan: buildRolloverPlan(input({ managers: { active: 9, orphanTeams: ['Ghosts'] } })),
    extras: null as null | { announcement: { en: string; es: string }; payoutCarry: { fromCents: number | null; toCents: number } | null },
  }
  const stub = (v: unknown) => {
    const f = vi.fn(async (_url: string, init?: { method?: string }) => ({ ok: true, json: async () => (init?.method === 'POST' ? {} : v) }))
    vi.stubGlobal('fetch', f)
    return f
  }
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    lang.language = 'en'
  })

  it('walks the steps and renews only after the commissioner confirms', async () => {
    const f = stub(VIEW)
    render(<RolloverWizard leagueId="L" />)
    expect((await screen.findByTestId('rollover-step-season')).textContent).toContain('Aces won 2026.')
    expect(screen.getByTestId('rollover-step-managers').textContent).toContain('Ghosts has no manager.')
    expect(screen.getByTestId('rollover-step-renew').textContent).toContain('2 pending trades and 1 waiver claim are cancelled')
    const button = screen.getByTestId('rollover-renew') as HTMLButtonElement
    expect(button.disabled).toBe(true)
    fireEvent.change(screen.getByTestId('rollover-dues'), { target: { value: '150' } })
    fireEvent.change(screen.getByTestId('rollover-order'), { target: { value: 'random' } })
    fireEvent.click(screen.getByTestId('rollover-confirm'))
    fireEvent.click(button)
    await waitFor(() => expect(f.mock.calls.some((c) => c[0] === '/api/commissioner/leagues/L/renew')).toBe(true))
    const call = f.mock.calls.find((c) => c[0] === '/api/commissioner/leagues/L/renew')! as unknown as [string, { body: string }]
    expect(JSON.parse(call[1].body)).toEqual({ expectedSeason: 2026, draftOrder: 'random', duesEnabled: true, duesAmount: 150 })
  })

  it('a free league is told what AF Commissioner adds; a plan league gets the draft and the carry', async () => {
    stub(VIEW)
    render(<RolloverWizard leagueId="L" />)
    expect((await screen.findByTestId('rollover-upsell')).textContent).toMatch(/drafts your .*announcement/)
    cleanup()
    stub({ ...VIEW, extras: { announcement: { en: 'We are back!', es: '¡Volvemos!' }, payoutCarry: { fromCents: 10_000, toCents: 15_000 } } })
    render(<RolloverWizard leagueId="L" />)
    expect((await screen.findByTestId('rollover-announcement')).textContent).toBe('We are back!')
    expect(screen.getByTestId('rollover-extras').textContent).toContain('next season’s dues are $150')
    fireEvent.click(screen.getByTestId('rollover-announce'))
    expect(screen.getByTestId('broadcast-modal').textContent).toBe('We are back!')
  })

  it('hidden mid-season and outside the leagues it applies to', async () => {
    stub({ ...VIEW, show: false })
    const { container } = render(<RolloverWizard leagueId="L" />)
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled())
    expect(container.textContent).toBe('')
  })

  it('in Spanish', async () => {
    lang.language = 'es'
    stub({ ...VIEW, extras: { announcement: { en: 'We are back!', es: '¡Volvemos!' }, payoutCarry: null } })
    const { container } = render(<RolloverWizard leagueId="L" />)
    expect((await screen.findByTestId('rollover-step-season')).textContent).toContain('Aces ganó 2026.')
    expect(screen.getByText('Próxima temporada')).toBeTruthy()
    expect(screen.getByTestId('rollover-announcement').textContent).toBe('¡Volvemos!')
    expect(container.textContent).not.toMatch(/\b(Next season|Renew for|Draft order|To do|Done)\b/)
  })
})
