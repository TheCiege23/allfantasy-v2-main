import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SurvivorSummary } from '@/components/survivor/types'
import { SurvivorIslandControl } from '@/components/core-app/survivor/SurvivorIslandControl'
import { survivorIslandSettingsMessages } from '@/lib/core-app/messages/survivorIslandSettings'
import { missingMessages } from '@/lib/i18n/messages'
import { islandView } from '@/lib/core-app/survivorIsland'
import { ISLAND_SCENE_CHOICES, applyInlineEdits, exileTokenChoices, inlineRuleFields, sceneArt, withIslandScene, type IslandSettingsState } from '@/lib/core-app/survivorIslandSettings'
import { parseSettingsForm, readSurvivorIslandScene, type SurvivorSettingsForm } from '@/lib/survivor/survivorSettingsScreen'

/** Island control: the commissioner picks the banner scene and edits the safe rules in place. */

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const form = (over: Partial<SurvivorSettingsForm> = {}): SurvivorSettingsForm => ({
  tribeCount: 2, tribeFormation: 'random', voteDay: 'Tuesday', voteTime: '20:00', selfVotesAllowed: false, tieRule: 'revote_then_season_points',
  idolCount: 7, hideIdolsFromCommissioner: false, exileEnabled: true, exileReturnTokens: 3, exileBossMode: 'median', exileBossFixedScore: null, exileBossTopN: 3,
  swapEnabled: true, swapWeek: 5, mergeTrigger: 'week', mergeWeek: 8, mergeActivePlayerCount: 7, finalistCount: 3, shareCardsEnabled: true, publicMomentPages: true,
  spectatorPageEnabled: false, islandScene: 'auto', ...over,
})
const open = { draftStarted: false, finalistLocked: false, tribesLocked: false }
const started = { draftStarted: true, finalistLocked: true, tribesLocked: true }
const state = (over: Partial<SurvivorSettingsForm> = {}, locks = open): IslandSettingsState => ({ form: form(over), locks, context: { managers: 12, firstWeek: 1, lastWeek: 13 } })

describe('scene preference', () => {
  it('offers follow-the-season first, then all eight scenes', () => {
    expect(ISLAND_SCENE_CHOICES).toEqual(['auto', 'beach', 'tribal', 'merge', 'finale', 'exile', 'jungle', 'volcano', 'lagoon'])
    expect(sceneArt('auto')).toBe('/survivor/scenes/beach.svg')
    expect(sceneArt('volcano')).toBe('/survivor/scenes/volcano.svg')
  })

  it('reads only a known scene from league settings', () => {
    expect(readSurvivorIslandScene({ survivorIslandScene: 'lagoon' })).toBe('lagoon')
    expect(readSurvivorIslandScene({ survivorIslandScene: 'moon' })).toBe('auto')
    expect(readSurvivorIslandScene(null)).toBe('auto')
  })

  it('treats the scene as optional in a posted form, but never an unknown one', () => {
    const { islandScene: _x, ...older } = form()
    expect(parseSettingsForm(older)).not.toHaveProperty('islandScene')
    expect(parseSettingsForm(form({ islandScene: 'jungle' }))?.islandScene).toBe('jungle')
    expect(parseSettingsForm({ ...form(), islandScene: 'moon' })).toBeNull()
  })

  it('the banner wears a pinned scene but keeps the season’s headline and clock', () => {
    const s = {
      config: { islandScene: 'volcano' },
      currentWeek: 4,
      tribes: [{ id: 'tA', name: 'Vela', slotIndex: 0, members: [{ rosterId: 'r1', isLeader: false }] }],
      council: { id: 'c1', week: 4, phase: 'voting', attendingTribeId: 'tA', voteDeadlineAt: '2026-11-03T15:00:00Z', closedAt: null, eliminatedRosterId: null },
      challenges: [],
      merged: false,
    } as unknown as SurvivorSummary
    expect(islandView(s)).toMatchObject({ scene: 'volcano', moment: { kind: 'council' }, clock: { label: 'council' } })
    expect(islandView({ ...s, config: { islandScene: 'auto' } } as unknown as SurvivorSummary).scene).toBe('tribal')
    expect(islandView({ ...s, config: { islandScene: 'moon' } } as unknown as SurvivorSummary).scene).toBe('tribal')
  })
})

describe('inline rules', () => {
  it('locks everything but the vote deadline once the draft started', () => {
    expect(inlineRuleFields(state()).map((f) => [f.key, f.locked])).toEqual([
      ['voteDay', false], ['voteTime', false], ['selfVotesAllowed', false], ['idolCount', false], ['exileReturnTokens', false], ['mergeWeek', false],
    ])
    expect(inlineRuleFields(state({}, started)).filter((f) => !f.locked).map((f) => f.key)).toEqual(['voteDay', 'voteTime'])
  })

  it('hides Exile tokens without Exile and the merge week for a head-count merge', () => {
    const keys = inlineRuleFields(state({ exileEnabled: false, mergeTrigger: 'active_player_count' })).map((f) => f.key)
    expect(keys).toEqual(['voteDay', 'voteTime', 'selfVotesAllowed', 'idolCount'])
  })

  it('posts the whole saved form with only the inline keys replaced', () => {
    const saved = form()
    const next = applyInlineEdits(saved, { voteDay: 'Friday', tribeCount: 5 } as never)
    expect(next).toEqual({ ...saved, voteDay: 'Friday' })
    expect(withIslandScene(saved, 'merge')).toEqual({ ...saved, islandScene: 'merge' })
    expect(exileTokenChoices(3)).toEqual([1, 2, 3, 4, 5])
    expect(exileTokenChoices(7)).toEqual([1, 2, 3, 4, 5, 6, 7])
  })

  it('has every line in Spanish', () => {
    expect(missingMessages(survivorIslandSettingsMessages, 'es')).toEqual([])
  })
})

/** fetch routed by URL: the dashboard, the settings screen read, and the settings screen save. */
function stubFetch(settings: IslandSettingsState | null, saveReply?: (body: { form: SurvivorSettingsForm }) => Response) {
  const posts: { form: SurvivorSettingsForm }[] = []
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/commissioner-dashboard')) return new Response(JSON.stringify({ ok: true, config: { idolCount: 7 } }), { status: 200 })
    if (url.endsWith('/settings-screen') && init?.method === 'POST') {
      const body = JSON.parse(String(init.body))
      posts.push(body)
      return saveReply ? saveReply(body) : new Response(JSON.stringify({ ok: true, state: { ...settings, form: body.form } }), { status: 200 })
    }
    if (url.endsWith('/settings-screen')) return settings ? new Response(JSON.stringify(settings), { status: 200 }) : new Response('{"error":"Commissioner access required"}', { status: 403 })
    return new Response('{}', { status: 404 })
  })
  vi.stubGlobal('fetch', fn)
  return { fn, posts }
}
const dashboardReads = (fn: ReturnType<typeof vi.fn>) => fn.mock.calls.filter(([u]) => String(u).endsWith('/commissioner-dashboard')).length

describe('Island control editors', () => {
  it('saves a picked scene through the settings screen, changing nothing else', async () => {
    const { posts } = stubFetch(state())
    render(<SurvivorIslandControl leagueId="L1" />)
    await waitFor(() => expect(screen.getByTestId('survivor-scene-picker')).toBeTruthy())
    const auto = screen.getByRole('radio', { name: 'Follow the season' })
    expect(auto.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(screen.getByRole('radio', { name: 'Volcano' }))
    await waitFor(() => expect(screen.getByRole('radio', { name: 'Volcano' }).getAttribute('aria-checked')).toBe('true'))
    expect(posts).toHaveLength(1)
    expect(posts[0].form).toEqual({ ...form(), islandScene: 'volcano' })
    expect(screen.getAllByRole('radio')).toHaveLength(9)
  })

  it('edits the vote deadline inline, posts the whole form, then re-reads the rulebook', async () => {
    const { fn, posts } = stubFetch(state())
    render(<SurvivorIslandControl leagueId="L1" />)
    await waitFor(() => expect(screen.getByTestId('survivor-rules-editor')).toBeTruthy())
    expect(screen.getByText('Everything else is in the full settings →').getAttribute('href')).toBe('/survivor/L1/settings')
    fireEvent.click(screen.getByText('Edit here'))
    const save = screen.getByText('Save rules') as HTMLButtonElement
    expect(save.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Votes close on'), { target: { value: 'Thursday' } })
    fireEvent.click(screen.getByLabelText('Castaways may vote for themselves'))
    fireEvent.click(save)
    await waitFor(() => expect(screen.getByText('Saved.')).toBeTruthy())
    expect(posts[0].form).toEqual({ ...form(), voteDay: 'Thursday', selfVotesAllowed: true })
    await waitFor(() => expect(dashboardReads(fn)).toBe(2))
  })

  it('shows locked rules disabled after the draft, and the server’s refusal when it answers one', async () => {
    stubFetch(state({}, started), () => new Response(JSON.stringify({ error: 'These settings locked when the draft started.' }), { status: 409 }))
    render(<SurvivorIslandControl leagueId="L1" />)
    await waitFor(() => expect(screen.getByTestId('survivor-rules-editor')).toBeTruthy())
    fireEvent.click(screen.getByText('Edit here'))
    expect(screen.getByText('Locked since the draft started. The vote deadline can still change.')).toBeTruthy()
    expect((screen.getByLabelText(/Hidden idols/) as HTMLSelectElement).disabled).toBe(true)
    expect((screen.getByLabelText(/Merge in week/) as HTMLInputElement).disabled).toBe(true)
    expect((screen.getByLabelText('Votes close at') as HTMLSelectElement).disabled).toBe(false)
    fireEvent.change(screen.getByLabelText('Votes close at'), { target: { value: '21:00' } })
    fireEvent.click(screen.getByText('Save rules'))
    await waitFor(() => expect(screen.getByText('These settings locked when the draft started.')).toBeTruthy())
  })

  it('shows neither editor to someone without settings rights, keeping the rest of Island control', async () => {
    stubFetch(null)
    render(<SurvivorIslandControl leagueId="L1" />)
    await waitFor(() => expect(screen.getByTestId('survivor-island-control')).toBeTruthy())
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    expect(screen.queryByTestId('survivor-scene-picker')).toBeNull()
    expect(screen.queryByTestId('survivor-rules-editor')).toBeNull()
  })
})
