/**
 * Redraft waiver options (owner's decision, after #2608): $0-bid toggle and minimum bid, FAAB
 * tiebreak picker, "Free agency only" preset, weekly priority reset, superflex FAAB default, and a
 * create-wizard waiver preview that matches what creation writes.
 */
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'

const patches = vi.hoisted(() => [] as Array<Record<string, unknown>>)
vi.mock('@/components/i18n/LanguageProviderClient', async () => {
  const { translations: dict } = await import('@/lib/i18n/translations')
  const t = (k: string) => dict.en[k] ?? k
  return { useLanguage: () => ({ language: 'en', t, setLanguage: () => {} }), useOptionalLanguage: () => ({ language: 'en', t }) }
})
vi.mock('@/hooks/useLeagueSettingsSectionAutosave', () => ({
  useLeagueSettingsSectionAutosave: () => ({ queuePatch: (p: Record<string, unknown>) => patches.push(p), saving: false }),
}))

import { WaiversSection, hubWaiverControlsFor } from '@/components/league-settings/tabs/WaiversTab'
import { parseHubWaiverOptions, isFreeAgencyOnly, readHubTiebreakRule } from '@/lib/waiver-wire/hub-waiver-options'
import {
  applyWeeklyWaiverPriorityReset,
  planWeeklyPriorityReset,
  reverseStandingsOrder,
  WEEKLY_PRIORITY_RESET_SETTINGS_KEY,
} from '@/lib/waiver-wire/weekly-priority-reset'
import { getWaiverDefaults } from '@/lib/sport-defaults/SportDefaultsRegistry'
import { wizardWaiverPreviewDefaults } from '@/lib/league-creation/wizardWaiverPreview'
import { translations } from '@/lib/i18n/translations'

describe('settings validation for the new waiver fields', () => {
  const parse = (body: Record<string, unknown>, budget: number | null = 100) => parseHubWaiverOptions(body, { budget })

  it('minimum bid: a whole dollar amount from $0 to the budget', () => {
    expect(parse({ waiverMinBid: 0 }).ok).toBe(true)
    expect(parse({ waiverMinBid: 5 }).ok).toBe(true)
    expect(parse({ waiverMinBid: 100 }).ok).toBe(true)
    expect(parse({ waiverMinBid: null }).ok).toBe(true)
    expect(parse({ waiverMinBid: -1 }).ok).toBe(false)
    expect(parse({ waiverMinBid: 2.5 }).ok).toBe(false)
    expect(parse({ waiverMinBid: '5' }).ok).toBe(false)
    expect(parse({ waiverMinBid: 101 })).toEqual({ ok: false, error: expect.stringContaining('$100') })
    // No known budget: only the absolute ceiling applies.
    expect(parse({ waiverMinBid: 500 }, null).ok).toBe(true)
  })

  it('$0 bids allowed: a boolean', () => {
    expect(parse({ waiverAllowZeroBid: false })).toEqual({ ok: true, options: { allowZeroFaabBid: false } })
    expect(parse({ waiverAllowZeroBid: true })).toEqual({ ok: true, options: { allowZeroFaabBid: true } })
    expect(parse({ waiverAllowZeroBid: 'no' }).ok).toBe(false)
  })

  it('tiebreak: priority, reverse standings or earliest claim', () => {
    for (const v of ['priority_lowest_first', 'reverse_standings', 'earliest_claim']) {
      expect(parse({ waiverTiebreakRule: v })).toEqual({ ok: true, options: { tiebreakRule: v } })
    }
    expect(parse({ waiverTiebreakRule: 'faab_highest' }).ok).toBe(false)
    expect(parse({ waiverTiebreakRule: 'coin_flip' }).ok).toBe(false)
    // The registry default `faab_highest` is no tiebreak at all; the engine falls to priority.
    expect(readHubTiebreakRule('faab_highest')).toBe('priority_lowest_first')
    expect(readHubTiebreakRule('earliest_claim_timestamp')).toBe('earliest_claim')
  })

  it('priority reset: rolling or weekly', () => {
    expect(parse({ waiverOrderResetPolicy: 'weekly' })).toEqual({ ok: true, options: { waiverOrderResetPolicy: 'weekly' } })
    expect(parse({ waiverOrderResetPolicy: 'rolling' })).toEqual({ ok: true, options: { waiverOrderResetPolicy: 'rolling' } })
    expect(parse({ waiverOrderResetPolicy: 'reset_to_draft_order' }).ok).toBe(false)
  })

  it('a body with none of them passes and carries no options', () => {
    expect(parse({ waiverType: 'faab' })).toEqual({ ok: true, options: {} })
  })

  it('every new hub label exists in English and Spanish', () => {
    const keys = Object.keys(translations.en).filter((k) => /^lsHub\.wv\.(allowZero|minBidHint|tiebreak|tb\.|reset|faOnly)/.test(k))
    expect(keys.length).toBe(17)
    expect(keys.filter((k) => !translations.es[k])).toEqual([])
  })
})

/* ---------------------------------------------------------------------------------------------- */

function ctx(league: Record<string, unknown>) {
  return {
    league: { id: 'l1', sport: 'NBA', settings: {}, waiverBudget: 100, waiverMinBid: 0, waiverHours: 24, ...league },
  } as never
}
const renderHub = (league: Record<string, unknown>) =>
  render(<WaiversSection ctx={ctx(league)} canEdit timezone="America/New_York" />)

describe('the hub renders the controls each waiver type uses', () => {
  afterEach(() => {
    cleanup()
    patches.length = 0
    vi.unstubAllGlobals()
  })

  it.each([
    ['faab', { faab: true, tiebreak: true, reset: false }],
    ['rolling', { faab: false, tiebreak: false, reset: true }],
    ['standard', { faab: false, tiebreak: false, reset: true }],
    ['reverse_standings', { faab: false, tiebreak: false, reset: false }],
    ['fcfs', { faab: false, tiebreak: false, reset: false }],
  ])('%s', (waiverType, want) => {
    const r = renderHub({ waiverType })
    expect(Boolean(r.queryByTestId('league-settings-faab-fields')), 'faab').toBe(want.faab)
    expect(Boolean(r.queryByTestId('league-settings-faab-allow-zero')), 'allow zero').toBe(want.faab)
    expect(Boolean(r.queryByTestId('league-settings-waiver-tiebreak')), 'tiebreak').toBe(want.tiebreak)
    expect(Boolean(r.queryByTestId('league-settings-waiver-reset-policy')), 'reset').toBe(want.reset)
    // The preset is offered on every type.
    expect(r.getByTestId('league-settings-waiver-fa-only-preset')).toBeTruthy()
  })

  it('the pure rule matches', () => {
    expect(hubWaiverControlsFor({ waiverType: 'faab', showFaab: true })).toEqual({ faabFields: true, tiebreak: true, resetPolicy: false })
    expect(hubWaiverControlsFor({ waiverType: 'standard', showFaab: false })).toEqual({ faabFields: false, tiebreak: false, resetPolicy: true })
  })

  it('a FAAB change saves the option keys the server validates', () => {
    const r = renderHub({ waiverType: 'faab' })
    fireEvent.change(r.getByTestId('league-settings-waiver-tiebreak'), { target: { value: 'earliest_claim' } })
    fireEvent.click(r.getByTestId('league-settings-faab-allow-zero').querySelector('button')!)
    expect(patches).toEqual([{ waiverTiebreakRule: 'earliest_claim' }, { waiverAllowZeroBid: false }])
  })

  it('a minimum bid above $0 disables the $0 toggle', () => {
    const r = renderHub({ waiverType: 'faab', waiverMinBid: 2 })
    expect(r.getByTestId('league-settings-faab-allow-zero').querySelector('button')!.hasAttribute('disabled')).toBe(true)
  })

  it('weekly reset saves from the rolling picker', () => {
    const r = renderHub({ waiverType: 'rolling' })
    fireEvent.change(r.getByTestId('league-settings-waiver-reset-policy'), { target: { value: 'weekly' } })
    expect(patches).toEqual([{ waiverOrderResetPolicy: 'weekly' }])
  })

  it('reads the stored options from the effective waiver settings', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ allowZeroFaabBid: false, tiebreakRule: 'reverse_standings', waiverOrderResetPolicy: 'weekly' }) })))
    const r = renderHub({ waiverType: 'faab' })
    await vi.waitFor(() => expect((r.getByTestId('league-settings-waiver-tiebreak') as HTMLSelectElement).value).toBe('reverse_standings'))
  })

  it('"Free agency only" sets FCFS and 0 waiver hours in one save, then shows as in use', () => {
    const r = renderHub({ waiverType: 'rolling', waiverHours: 24 })
    fireEvent.click(r.getByTestId('league-settings-waiver-fa-only-apply'))
    expect(patches).toEqual([{ waiverType: 'fcfs', waiverHours: 0 }])
    expect(r.queryByTestId('league-settings-waiver-fa-only-apply')).toBeNull()
    expect(r.getByTestId('league-settings-waiver-fa-only-preset').textContent).toContain('In use')
    expect(isFreeAgencyOnly('fcfs', 0)).toBe(true)
    expect(isFreeAgencyOnly('fcfs', 24)).toBe(false)
    expect(isFreeAgencyOnly('rolling', 0)).toBe(false)
  })
})

/* ---------------------------------------------------------------------------------------------- */

const standing = (id: string, ownerId: string, wins: number, losses: number, pointsFor: number, waiverPriority = 0) =>
  ({ id, ownerId, wins, losses, ties: 0, pointsFor, waiverPriority })

describe('weekly priority reset', () => {
  const standings = [
    standing('r-top', 'u-top', 3, 0, 400),
    standing('r-mid', 'u-mid', 1, 2, 350),
    standing('r-low', 'u-low', 1, 2, 300),
    standing('r-bot', 'u-bot', 0, 3, 320),
  ]

  it('orders worst record first, then fewer points', () => {
    expect(reverseStandingsOrder(standings)).toEqual(['r-bot', 'r-low', 'r-mid', 'r-top'])
  })

  it('maps league rosters by link, then by owner, unmatched last', () => {
    const plan = planWeeklyPriorityReset({
      standings,
      leagueRosters: [
        { id: 'L-top', platformUserId: 'u-top', redraftRosterId: null, waiverPriority: 1 },
        { id: 'L-bot', platformUserId: 'x', redraftRosterId: 'r-bot', waiverPriority: 4 },
        { id: 'L-ghost', platformUserId: 'nobody', redraftRosterId: null, waiverPriority: 2 },
        { id: 'L-mid', platformUserId: 'u-mid', redraftRosterId: null, waiverPriority: 3 },
        { id: 'L-low', platformUserId: 'u-low', redraftRosterId: null, waiverPriority: 5 },
      ],
    })
    expect(plan.redraft).toEqual([
      { id: 'r-bot', waiverPriority: 1 },
      { id: 'r-low', waiverPriority: 2 },
      { id: 'r-mid', waiverPriority: 3 },
      { id: 'r-top', waiverPriority: 4 },
    ])
    expect(plan.league.map((r) => r.id)).toEqual(['L-bot', 'L-low', 'L-mid', 'L-top', 'L-ghost'])
  })

  function fakeDb() {
    const state = {
      settings: {} as Record<string, unknown>,
      redraft: new Map(standings.map((s) => [s.id, { ...s, waiverPriority: 9 }])),
      roster: new Map([
        ['L-top', { id: 'L-top', platformUserId: 'u-top', redraftRosterId: 'r-top', waiverPriority: 4 }],
        ['L-bot', { id: 'L-bot', platformUserId: 'u-bot', redraftRosterId: 'r-bot', waiverPriority: 1 }],
      ]),
      writes: 0,
    }
    const db: any = {
      league: {
        findUnique: async () => ({ settings: state.settings }),
        update: async ({ data }: any) => {
          state.settings = data.settings
          state.writes++
        },
      },
      redraftRoster: {
        findMany: async () => [...state.redraft.values()],
        update: async ({ where, data }: any) => {
          Object.assign(state.redraft.get(where.id)!, data)
          state.writes++
        },
      },
      roster: {
        findMany: async () => [...state.roster.values()],
        update: async ({ where, data }: any) => {
          Object.assign(state.roster.get(where.id)!, data)
          state.writes++
        },
      },
    }
    db.$transaction = async (fn: (tx: any) => unknown) => fn(db)
    return { db, state }
  }
  const weekly = async () => ({ waiverOrderResetPolicy: 'weekly', normalizedWaiverType: 'rolling' })

  it('resets once per week, and a rerun is a no-op', async () => {
    const { db, state } = fakeDb()
    const first = await applyWeeklyWaiverPriorityReset({ leagueId: 'l1', seasonId: 's1', week: 5 }, { db, loadSettings: weekly })
    expect(first).toEqual({ applied: true, week: 5, rostersReset: 2 })
    expect(state.roster.get('L-bot')!.waiverPriority).toBe(1)
    expect(state.roster.get('L-top')!.waiverPriority).toBe(2)
    expect(state.redraft.get('r-bot')!.waiverPriority).toBe(1)
    expect((state.settings[WEEKLY_PRIORITY_RESET_SETTINGS_KEY] as any).week).toBe(5)

    // Claims during week 5 move the winner to the back…
    state.roster.get('L-bot')!.waiverPriority = 2
    state.roster.get('L-top')!.waiverPriority = 1
    const writes = state.writes
    // …and a rerun of the week-5 advance (or an older week) must not undo them.
    expect(await applyWeeklyWaiverPriorityReset({ leagueId: 'l1', seasonId: 's1', week: 5 }, { db, loadSettings: weekly })).toEqual({ applied: false, reason: 'already_applied' })
    expect(await applyWeeklyWaiverPriorityReset({ leagueId: 'l1', seasonId: 's1', week: 4 }, { db, loadSettings: weekly })).toEqual({ applied: false, reason: 'already_applied' })
    expect(state.writes).toBe(writes)
    expect(state.roster.get('L-top')!.waiverPriority).toBe(1)

    // The next week resets again; a new season starts its own count.
    expect((await applyWeeklyWaiverPriorityReset({ leagueId: 'l1', seasonId: 's1', week: 6 }, { db, loadSettings: weekly })).applied).toBe(true)
    expect(state.roster.get('L-bot')!.waiverPriority).toBe(1)
    expect((await applyWeeklyWaiverPriorityReset({ leagueId: 'l1', seasonId: 's2', week: 2 }, { db, loadSettings: weekly })).applied).toBe(true)
  })

  it('rolling (the default) and non-priority types never reset', async () => {
    const { db, state } = fakeDb()
    expect(
      await applyWeeklyWaiverPriorityReset({ leagueId: 'l1', seasonId: 's1', week: 5 }, { db, loadSettings: async () => ({ waiverOrderResetPolicy: null, normalizedWaiverType: 'rolling' }) }),
    ).toEqual({ applied: false, reason: 'policy_rolling' })
    expect(
      await applyWeeklyWaiverPriorityReset({ leagueId: 'l1', seasonId: 's1', week: 5 }, { db, loadSettings: async () => ({ waiverOrderResetPolicy: 'weekly', normalizedWaiverType: 'faab' }) }),
    ).toEqual({ applied: false, reason: 'waiver_type_not_priority' })
    expect(state.writes).toBe(0)
  })
})

/* ---------------------------------------------------------------------------------------------- */

describe('NFL superflex redraft defaults to FAAB $100', () => {
  it('the SUPERFLEX variant matches the redraft FAAB default', () => {
    expect(getWaiverDefaults('NFL', 'SUPERFLEX')).toMatchObject({
      waiver_type: 'faab',
      faab_enabled: true,
      FAAB_budget_default: 100,
      claim_priority_behavior: 'faab_highest',
    })
    expect(getWaiverDefaults('NFL', 'SUPERFLEX').waiver_type).toBe(getWaiverDefaults('NFL', 'redraft').waiver_type)
  })

  it('leaves the no-variant fallback alone', () => {
    expect(getWaiverDefaults('NFL').waiver_type).toBe(getWaiverDefaults('NFL', 'STANDARD').waiver_type)
  })
})

describe('the create wizard previews the waivers creation writes', () => {
  const variantPreset = { waiver_type: 'rolling', faab_enabled: false, FAAB_budget_default: null, processing_days: [1, 3, 5] }

  it.each(['NFL', 'NBA', 'NHL', 'MLB'])('%s redraft previews FAAB $100, as created', (sport) => {
    const preview = wizardWaiverPreviewDefaults(variantPreset, sport, 'redraft')
    expect(preview).toMatchObject({ waiver_type: 'faab', faab_enabled: true, FAAB_budget_default: 100 })
    expect(preview?.waiver_type).toBe(getWaiverDefaults(sport as never, 'redraft').waiver_type)
  })

  it('other formats keep the variant preset', () => {
    expect(wizardWaiverPreviewDefaults(variantPreset, 'NBA', 'dynasty')).toBe(variantPreset)
  })
})
