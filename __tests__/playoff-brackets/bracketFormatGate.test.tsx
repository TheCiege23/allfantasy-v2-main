import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

const { mockEvaluate } = vi.hoisted(() => ({ mockEvaluate: vi.fn() }))
vi.mock('@/lib/subscription/FeatureGateService', () => ({
  FeatureGateService: class {
    evaluateUserFeatureAccess = mockEvaluate
  },
}))

const lang = vi.hoisted(() => ({ language: 'en' as 'en' | 'es' }))
vi.mock('@/components/i18n/LanguageProviderClient', async () => {
  const { translations: dict } = await import('@/lib/i18n/translations')
  const t = (k: string) => dict[lang.language]?.[k] ?? dict.en[k] ?? k
  return { useLanguage: () => ({ language: lang.language, t, setLanguage: () => {} }) }
})

import { customPlayoffBracketRefusal } from '@/lib/league/execute-league-settings-patch'
import { PlayoffBracketFormatCard } from '@/components/league-settings/PlayoffBracketFormatCard'
import { checkByePlan, naturalByePlan, validByePlans } from '@/lib/playoff-brackets/byePlan'
import { translations } from '@/lib/i18n/translations'

const body = (o: Record<string, unknown>) => ({ leagueId: 'L', ...o })

describe('AF Commissioner gate on playoff brackets (settings patch)', () => {
  beforeEach(() => mockEvaluate.mockReset())
  const cur = (playoffTeams: number, byePlan: unknown = null) => ({ playoffTeams, byePlan })

  it('free: any team count, odd included, with the standard byes', async () => {
    mockEvaluate.mockResolvedValue({ allowed: false })
    expect(await customPlayoffBracketRefusal('u', body({ playoffTeams: 7 }), cur(6))).toBeNull()
    expect(await customPlayoffBracketRefusal('u', body({ playoffTeams: 9, settingsMerge: { playoff_bye_plan: null } }), cur(6))).toBeNull()
    expect(await customPlayoffBracketRefusal('u', body({ playoffTeams: 5, settingsMerge: { playoff_bye_plan: [1, 1, 1, 0, 0] } }), cur(6))).toBeNull()
    expect(mockEvaluate).not.toHaveBeenCalled()
  })

  it('free: commissioner-granted byes are refused with 403', async () => {
    mockEvaluate.mockResolvedValue({ allowed: false })
    expect(
      await customPlayoffBracketRefusal('u', body({ playoffTeams: 8, settingsMerge: { playoff_bye_plan: [2, 2, 1, 1, 0, 0, 0, 0] } }), cur(8)),
    ).toMatchObject({ status: 403, message: expect.stringMatching(/byes/) })
  })

  it('a plan saved before the sub lapsed can be saved again unchanged', async () => {
    mockEvaluate.mockResolvedValue({ allowed: false })
    const plan = [3, 2, 1, 0, 0]
    expect(await customPlayoffBracketRefusal('u', body({ playoffTeams: 5, settingsMerge: { playoff_bye_plan: plan } }), cur(5, plan))).toBeNull()
  })

  it('AF Commissioner may save custom byes', async () => {
    mockEvaluate.mockResolvedValue({ allowed: true })
    expect(await customPlayoffBracketRefusal('u', body({ playoffTeams: 5, settingsMerge: { playoff_bye_plan: [3, 2, 1, 0, 0] } }), cur(6))).toBeNull()
  })

  it('an invalid plan is a 400 for everyone', async () => {
    mockEvaluate.mockResolvedValue({ allowed: true })
    expect(await customPlayoffBracketRefusal('u', body({ playoffTeams: 7, settingsMerge: { playoff_bye_plan: [2, 0, 0, 0, 0, 0, 0] } }), cur(6))).toMatchObject({ status: 400 })
  })
})

// ── The card ──

function option(teams: number, plan: number[]) {
  const c = checkByePlan(teams, plan)
  if (!c.ok) throw new Error(c.error)
  const natural = plan.join() === naturalByePlan(teams).join()
  return { plan, natural, rounds: c.rounds, roundCount: c.roundCount, finalWeek: 14 + c.roundCount, fitsSeason: 14 + c.roundCount <= 18, description: '' }
}
function view(teams: number, over: Record<string, unknown> = {}) {
  return {
    playoffTeams: teams, savedPlayoffTeams: teams, maxTeams: 12,
    plan: naturalByePlan(teams), options: validByePlans(teams).map((p) => option(teams, p)),
    playoffStartWeek: 15, weeksPerRound: 1, lastWeek: 18, isPremium: true, locked: false, ...over,
  }
}
const fetchMock = vi.fn()
const json = (b: unknown, status = 200) => Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(b) })

describe('PlayoffBracketFormatCard', () => {
  beforeEach(() => { lang.language = 'en'; fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock) })
  afterEach(() => { cleanup(); vi.unstubAllGlobals() })

  it('lists the standard bracket first and draws each round', async () => {
    fetchMock.mockReturnValueOnce(json(view(5)))
    render(<PlayoffBracketFormatCard leagueId="L" playoffTeams={5} canEdit />)
    await screen.findByText('Standard bracket')
    expect(String(fetchMock.mock.calls[0][0])).toContain('/playoff-bracket?teams=5')
    expect(screen.getAllByText('#4, #5 start here').length).toBeGreaterThan(0)
    expect(screen.getByText('#1 sits out 3 rounds · #2 sits out 2 rounds · #3 gets a bye')).toBeTruthy()
  })

  it('saves the chosen plan with PUT', async () => {
    fetchMock.mockReturnValueOnce(json(view(5))).mockReturnValueOnce(json({ ok: true })).mockReturnValueOnce(json(view(5, { plan: [3, 2, 1, 0, 0] })))
    render(<PlayoffBracketFormatCard leagueId="L" playoffTeams={5} canEdit />)
    fireEvent.click(await screen.findByText('#1 sits out 3 rounds · #2 sits out 2 rounds · #3 gets a bye'))
    fireEvent.click(screen.getByText('Save bracket format'))
    await screen.findByText('Bracket format saved')
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ playoffTeams: 5, byePlan: [3, 2, 1, 0, 0] })
  })

  it('without AF Commissioner a gated format offers the upgrade instead of Save', async () => {
    fetchMock.mockReturnValueOnce(json(view(6, { isPremium: false })))
    render(<PlayoffBracketFormatCard leagueId="L" playoffTeams={6} canEdit />)
    await screen.findByText('Standard bracket')
    expect(screen.getByText('Save bracket format')).toBeTruthy()
    const radios = screen.getAllByRole('radio')
    expect(radios.length).toBeGreaterThan(1) // 6 teams also has a stepladder format
    fireEvent.click(radios[1])
    expect(screen.queryByText('Save bracket format')).toBeNull()
    expect(screen.getByText('Upgrade to AF Commissioner').getAttribute('href')).toBe('/upgrade?plan=commissioner')
  })

  it('renders in Spanish', async () => {
    lang.language = 'es'
    fetchMock.mockReturnValueOnce(json(view(5)))
    render(<PlayoffBracketFormatCard leagueId="L" playoffTeams={5} canEdit />)
    await screen.findByText(translations.es['lsHub.po.br.standard'])
    expect(screen.getByText(translations.es['lsHub.po.br.title'])).toBeTruthy()
    expect(screen.queryByText('Standard bracket')).toBeNull()
  })
})
