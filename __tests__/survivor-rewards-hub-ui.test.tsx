/**
 * Survivor gaps (G2) — the screens: the Commissioner Hub rewards panel (list, grant with the reward
 * API's shape, reverse only after a confirm step, choose a pending target) in English and Spanish;
 * the manager's Camp card answering a sweep and a puzzle; the builder saying plainly when a kind is
 * "settled by the commissioner" for a sport; and the settings screen's older sections in Spanish.
 */
import React from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const lang = vi.hoisted(() => ({ language: 'en' }))
vi.mock('@/components/i18n/LanguageProviderClient', () => ({ useOptionalLanguage: () => ({ language: lang.language }) }))
vi.mock('next/link', () => ({ default: ({ children, ...props }: { children: React.ReactNode }) => <a {...props}>{children}</a> }))
vi.mock('@/components/survivor/SurvivorIdolSetup', () => ({ SurvivorIdolSetup: () => null }))
vi.mock('@/app/league/[leagueId]/components/settings/survivor/SurvivorTribesPanel', () => ({ SurvivorTribesPanel: () => null }))

import { SurvivorRewardsHubPanel, grantDraftToSpec } from '@/components/survivor/SurvivorRewardsHubPanel'
import { SurvivorChallengeBoardCard } from '@/components/survivor/SurvivorChallengeBoardCard'
import { SurvivorChallengeBuilderPanel } from '@/components/survivor/SurvivorChallengeBuilderPanel'
import { SurvivorSettingsScreen } from '@/components/survivor/SurvivorSettingsScreen'
import { defaultPrizePhaseRules } from '@/lib/survivor/survivorChallengeBuilderModel'

type Call = { url: string; body: Record<string, unknown> | null }
let calls: Call[] = []
let routes: Record<string, unknown> = {}
let postReply: (body: Record<string, unknown>) => { status: number; json: unknown } = () => ({ status: 200, json: { ok: true } })

beforeEach(() => {
  lang.language = 'en'
  calls = []
  routes = {}
  postReply = () => ({ status: 200, json: { ok: true } })
  vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
    const url = String(input)
    const body = init?.body ? JSON.parse(String(init.body)) : null
    calls.push({ url, body })
    if (body) { const r = postReply(body); return new Response(JSON.stringify(r.json), { status: r.status }) }
    const key = Object.keys(routes).sort((a, b) => b.length - a.length).find((k) => url.includes(k))
    return new Response(JSON.stringify(key ? routes[key] : {}), { status: 200 })
  }))
})
afterEach(() => { vi.unstubAllGlobals() })

const cast = {
  cast: [
    { rosterId: 'r1', name: 'Ana', tribeId: 't1', state: 'active' },
    { rosterId: 'r2', name: 'Ben', tribeId: 't1', state: 'active' },
    { rosterId: 'r3', name: 'Cy', tribeId: 't2', state: 'active' },
  ],
  tribes: [{ id: 't1', name: 'Koa' }, { id: 't2', name: 'Vela' }],
  currentWeek: 7, phase: 'pre_merge', allowedPrizeTypes: ['score_bonus', 'faab_grant'],
}
const rewards = [
  { rewardId: 'rw-paid', type: 'faab_grant', status: 'applied', week: 6, applyWeek: 6, spec: { type: 'faab_grant', rosterId: 'r1', amount: 20 }, source: { kind: 'challenge', label: 'SNF total' }, holderRosterIds: ['r1'], changes: [], note: null, createdAt: '', updatedAt: '' },
  { rewardId: 'rw-steal', type: 'steal', status: 'awaiting_choice', week: 7, applyWeek: 7, spec: { type: 'steal', thiefRosterId: 'r2', what: 'faab', amount: 10 }, source: { kind: 'commissioner' }, holderRosterIds: ['r2'], changes: [], note: null, createdAt: '', updatedAt: '' },
]

describe('Commissioner Hub → Rewards', () => {
  it('lists every reward with its state, source and holder', async () => {
    routes['type=rewards'] = { rewards }
    routes['type=reward_cast'] = cast
    render(<SurvivorRewardsHubPanel leagueId="L1" />)
    const paid = await screen.findByTestId('reward-row-rw-paid')
    expect(paid.textContent).toContain('$20 FAAB')
    expect(paid.textContent).toContain('Paid')
    expect(paid.textContent).toContain('Challenge · SNF total · Week 6 · Holder: Ana')
    expect(screen.getByTestId('rewards-phase-note').textContent).toContain('Points added, FAAB given')
  })

  it('grants a reward through grant_reward, with a request id that stays the same for a retry', async () => {
    routes['type=rewards'] = { rewards: [] }
    routes['type=reward_cast'] = cast
    render(<SurvivorRewardsHubPanel leagueId="L1" />)
    await screen.findByTestId('rewards-grant-form')
    const submit = screen.getByTestId('rewards-grant-submit') as HTMLButtonElement
    expect(submit.disabled).toBe(true)
    fireEvent.change(screen.getByTestId('rewards-grant-type'), { target: { value: 'faab_grant' } })
    fireEvent.change(screen.getByTestId('rewards-grant-recipient'), { target: { value: 'r3' } })
    fireEvent.change(screen.getByTestId('rewards-grant-amount'), { target: { value: '25' } })
    postReply = () => ({ status: 400, json: { error: 'FAAB cannot be given as a prize after the merge (league prize rules).' } })
    fireEvent.click(submit)
    expect((await screen.findByTestId('rewards-grant-error')).textContent).toMatch(/after the merge/)
    postReply = () => ({ status: 200, json: { ok: true } })
    fireEvent.click(submit)
    await screen.findByText('Reward granted.')
    const grants = calls.filter((c) => c.body?.action === 'grant_reward')
    expect(grants).toHaveLength(2)
    expect(grants[0]!.body).toMatchObject({ leagueId: 'L1', week: 7, reward: { type: 'faab_grant', rosterId: 'r3', amount: 25 }, deferToWeek: null })
    expect(grants[1]!.body!.requestId).toBe(grants[0]!.body!.requestId)
  })

  it('reverses only after the confirm step, and chooses a pending target', async () => {
    routes['type=rewards'] = { rewards }
    routes['type=reward_cast'] = cast
    render(<SurvivorRewardsHubPanel leagueId="L1" />)
    fireEvent.click(await screen.findByTestId('reward-reverse-rw-paid'))
    expect(calls.some((c) => c.body?.action === 'reverse_reward')).toBe(false)
    const confirm = screen.getByTestId('reward-reverse-confirm-rw-paid')
    fireEvent.change(within(confirm).getByLabelText('Reason (optional)'), { target: { value: 'wrong winner' } })
    fireEvent.click(within(confirm).getByRole('button', { name: 'Yes, reverse it' }))
    await waitFor(() => expect(calls.find((c) => c.body?.action === 'reverse_reward')?.body).toEqual({ leagueId: 'L1', action: 'reverse_reward', rewardId: 'rw-paid', notes: 'wrong winner' }))
    const pick = await screen.findByTestId('reward-choose-rw-steal')
    // The thief is not offered as their own target.
    expect([...pick.querySelectorAll('option')].map((o) => o.textContent)).toEqual(['Choose who', 'Ana', 'Cy'])
    fireEvent.change(pick, { target: { value: 'r3' } })
    fireEvent.click(screen.getByRole('button', { name: 'Choose target' }))
    await waitFor(() => expect(calls.find((c) => c.body?.action === 'choose_reward_target')?.body).toEqual({ leagueId: 'L1', action: 'choose_reward_target', rewardId: 'rw-steal', targetRosterId: 'r3' }))
  })

  it('speaks Spanish', async () => {
    lang.language = 'es'
    routes['type=rewards'] = { rewards }
    routes['type=reward_cast'] = cast
    render(<SurvivorRewardsHubPanel leagueId="L1" />)
    expect((await screen.findByTestId('reward-row-rw-paid')).textContent).toContain('$20 de FAAB')
    expect(screen.getByText('Recompensas')).toBeTruthy()
    expect(screen.getByText('Conceder una recompensa')).toBeTruthy()
    expect(screen.getByTestId('reward-row-rw-steal').textContent).toContain('Esperando una elección')
  })

  it('grantDraftToSpec builds the reward API’s shapes', () => {
    const d = { type: 'faab_transfer', rosterId: '', fromTribeId: 't1', toTribeId: 't2', amount: '30', basis: 'total', what: 'faab', targetRosterId: '', samePositionOnly: true, powerType: 'extra_vote', week: '7', deferToWeek: '', notes: '' } as const
    expect(grantDraftToSpec(d as never)).toEqual({ type: 'faab_transfer', fromTribeId: 't1', toTribeId: 't2', amount: 30, basis: 'total' })
    expect(grantDraftToSpec({ ...d, type: 'steal', rosterId: 'r1', what: 'points', targetRosterId: '' } as never)).toEqual({ type: 'steal', thiefRosterId: 'r1', what: 'points', amount: 30, targetRosterId: null })
  })
})

const challenge = (over: Record<string, unknown>) => ({
  id: 'c1', week: 9, title: 'T', question: 'Q', kind: 'sweep', scope: 'individual', status: 'open', opensAt: '2026-11-01T14:00:00Z', locksAt: '2026-11-02T01:00:00Z',
  inputKind: 'sweep', options: [], prizeText: '+20 points', wager: null, uniqueAnswers: false, sealed: false, mine: null, answers: null, resultSummary: null, myResult: null, ...over,
})

describe('Camp card: the new answer types', () => {
  it('a sweep needs one pick on every prop', async () => {
    routes['challenge-board'] = { challenges: [challenge({ props: [{ id: 'p1', question: 'Chiefs win?', options: [{ id: 'o1', label: 'Yes' }, { id: 'o2', label: 'No' }] }, { id: 'p2', question: 'Over 44.5?', options: [{ id: 'o1', label: 'Over' }, { id: 'o2', label: 'Under' }] }] })] }
    routes['/api/survivor/rewards'] = { rewards: [] }
    render(<SurvivorChallengeBoardCard leagueId="L1" />)
    await screen.findByTestId('challenge-sweep')
    const submit = screen.getByRole('button', { name: 'Submit — no take backs' }) as HTMLButtonElement
    fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Chiefs win?' })).getByRole('radio', { name: 'Yes' }))
    expect(submit.disabled).toBe(true)
    fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Over 44.5?' })).getByRole('radio', { name: 'Under' }))
    expect(submit.disabled).toBe(false)
    fireEvent.click(submit)
    await waitFor(() => expect(calls.find((c) => c.body?.challengeId === 'c1')?.body).toEqual({ leagueId: 'L1', challengeId: 'c1', answer: { picks: { p1: 'o1', p2: 'o2' } } }))
  })

  it('a puzzle takes a typed answer', async () => {
    routes['challenge-board'] = { challenges: [challenge({ kind: 'puzzle', inputKind: 'text' })] }
    routes['/api/survivor/rewards'] = { rewards: [] }
    render(<SurvivorChallengeBoardCard leagueId="L1" />)
    fireEvent.change(await screen.findByLabelText('Your answer'), { target: { value: 'Tom Brady' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit — no take backs' }))
    await waitFor(() => expect(calls.find((c) => c.body?.challengeId === 'c1')?.body).toEqual({ leagueId: 'L1', challengeId: 'c1', answer: { text: 'Tom Brady' } }))
  })
})

describe('Builder: says plainly how a kind settles for the sport', () => {
  it('an NBA anytime prop is "settled by the commissioner"; the existing rows say how they settle', async () => {
    routes['type=challenges'] = {
      challenges: [{ id: 'b1', week: 9, title: 'NBA anytime', status: 'open', answers: 0, entrants: [], resultSummary: null, autoSource: 'manual', config: { kind: 'anytime_td', scope: 'individual', options: [], prizes: [], locksAt: '2026-11-02T01:00:00Z', opensAt: '2026-11-01T01:00:00Z' } }],
      meta: { currentWeek: 9, season: 2026, sport: 'NBA', merged: false, lang: 'en', faabWeeklyCap: 40 },
    }
    routes['type=challenge_players'] = { players: [{ playerId: 'p1', playerName: 'Luka', position: 'PG', team: 'LAL', sport: 'NBA' }] }
    render(<SurvivorChallengeBuilderPanel leagueId="L1" />)
    expect((await screen.findByTestId('builder-row-settles-b1')).textContent).toMatch(/Settled by the commissioner/)
    fireEvent.click(screen.getByRole('button', { name: 'New challenge' }))
    const form = await screen.findByTestId('challenge-builder-form')
    fireEvent.change(within(form).getByLabelText('Title'), { target: { value: 'Luka scores?' } })
    fireEvent.change(within(form).getByLabelText('Question or instructions'), { target: { value: 'Anytime?' } })
    fireEvent.change(within(form).getByLabelText('Type'), { target: { value: 'player_stat_over_under' } })
    await waitFor(() => expect(within(form).getByTestId('builder-player').querySelectorAll('option').length).toBe(2))
    fireEvent.change(within(form).getByTestId('builder-player'), { target: { value: 'p1' } })
    // NBA's own stats first; the football ones stay pickable, marked for the commissioner.
    const stats = [...within(form).getByTestId('builder-stat').querySelectorAll('option')].map((o) => o.textContent)
    expect(stats.slice(0, 3)).toEqual(['fantasy points', 'pts', 'reb'])
    expect(stats).toContain('rush yds (settled by the commissioner for this sport)')
    fireEvent.change(within(form).getByLabelText('Line'), { target: { value: '25.5' } })
    fireEvent.change(within(form).getByTestId('builder-stat'), { target: { value: 'pts' } })
    expect((await within(form).findByTestId('challenge-builder-settles')).textContent).toBe('Settles itself from the stored player stats.')
    fireEvent.change(within(form).getByTestId('builder-stat'), { target: { value: 'rush_yds' } })
    expect(within(form).getByTestId('challenge-builder-settles').textContent).toMatch(/^Settled by the commissioner/)
  })
})

describe('Settings screen in Spanish (gap 5)', () => {
  it('renders the older sections, the header and the season summary in Spanish, with the new reward rules', async () => {
    lang.language = 'es'
    const form = {
      tribeCount: 2, tribeFormation: 'random', voteDay: 'Tuesday', voteTime: '20:00', selfVotesAllowed: false, tieRule: 'revote_then_rocks',
      idolCount: 7, hideIdolsFromCommissioner: false, exileEnabled: true, exileReturnTokens: 3, exileBossMode: 'median', exileBossFixedScore: null, exileBossTopN: 3,
      swapEnabled: true, swapWeek: 5, mergeTrigger: 'week', mergeWeek: 8, mergeActivePlayerCount: 7, finalistCount: 3, shareCardsEnabled: true, publicMomentPages: true, spectatorPageEnabled: false,
      coCommissionerMode: 'disabled', mergeNamingMode: 'commissioner', juryEnabled: true, tribeChatsEnabled: true, exileHarshTokenLoss: false, houseRules: '',
      winningTribeFaabPerPlayer: 50, topScorerReward: 'none', topScorerAmount: 0, topScorerPowerType: 'extra_vote', tribeTieBreakPosition: 'none',
      realGameEnabled: true, realGamePerWeek: 2, realGamePrizeType: 'faab', realGamePrizeAmount: 5, challengeFaabWeeklyCap: 40,
      payInTribeWeeksAfterMerge: false, thievesCannotStealFromEachOther: false, prizePhaseRules: defaultPrizePhaseRules(),
    }
    routes['settings-screen'] = { leagueName: 'Liga', form, context: { managers: 12, firstWeek: 1, lastWeek: 13, sport: 'NFL' }, locks: { draftStarted: false, finalistLocked: false, tribesLocked: false }, chimmyBossAvailable: false, commissionerPlays: false }
    render(<SurvivorSettingsScreen leagueId="L1" backHref="/league/L1" />)
    await screen.findByTestId('survivor-settings-screen')
    expect(screen.getByRole('heading', { name: 'Ajustes de Survivor' })).toBeTruthy()
    expect(screen.getByTestId('survivor-settings-unsaved').textContent).toBe('Todo guardado')
    expect(screen.getAllByText('Número de tribus').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Empate de votos').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Isla del Exilio').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Tarjetas para compartir').length).toBeGreaterThan(0)
    expect([...screen.getByTestId('survivor-settings-vote-day').querySelectorAll('option')].map((o) => o.textContent)).toContain('Martes')
    const summary = screen.getByTestId('survivor-settings-summary').textContent ?? ''
    expect(summary).toContain('2 tribus de 6, formadas al azar')
    expect(summary).toContain('Premio semanal de tribu: $50 de FAAB por jugador')
    expect(summary).not.toMatch(/tribes of|Weekly tribe prize/)
    // The new reward rules: a toggle each and the per-phase grid (tribe FAAB fixed to before the merge).
    fireEvent.click(screen.getByTestId('survivor-settings-thieves'))
    expect(screen.getByTestId('survivor-settings-unsaved').textContent).toBe('1 cambio sin guardar')
    expect(screen.getByTestId('survivor-settings-summary').textContent).toContain('Los ladrones no se roban entre sí en la misma semana')
    expect((screen.getByTestId('prize-phase-post_merge-faab_transfer') as HTMLInputElement).disabled).toBe(true)
    fireEvent.click(screen.getByTestId('prize-phase-finale-steal'))
    expect(screen.getByTestId('survivor-settings-unsaved').textContent).toBe('2 cambios sin guardar')
  })
})
