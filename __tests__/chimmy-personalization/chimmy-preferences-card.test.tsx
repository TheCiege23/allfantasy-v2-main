import fs from 'node:fs'
import path from 'node:path'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import ChimmyPreferencesCard from '@/components/settings/ChimmyPreferencesCard'

/**
 * Chimmy item 6, the user-control half: see what Chimmy uses, change it, and make it forget.
 */

function snapshot(over: Record<string, unknown> = {}) {
  return {
    ok: true,
    profile: {
      userId: 'u1',
      explicit: { explanationStyle: 'detailed' },
      inferred: { riskPreference: 'upside', confidence: 0.5, evidence: [], signals: {} },
      effective: {
        explanationStyle: 'detailed',
        riskPreference: 'upside',
        leagueStylePreference: 'redraft-first',
        actionPreference: 'top-3-options',
        alertPreference: 'balanced-alerts',
        storyContentPreferences: [],
      },
      sources: {
        explanationStyle: 'explicit',
        riskPreference: 'inferred',
        leagueStylePreference: 'default',
        actionPreference: 'default',
        alertPreference: 'default',
        storyContentPreferences: 'default',
      },
      transparency: { note: 'You can override any setting.', editable: true, generatedAt: '' },
    },
    remembered: [
      { leagueId: null, leagueName: null, teamDirection: null, learned: { detailLevel: 'concise' }, updatedAt: null },
      {
        leagueId: 'L1',
        leagueName: 'Dynasty Degens',
        teamDirection: 'rebuilder',
        learned: { scoringPreference: 'ppr' },
        updatedAt: null,
      },
    ],
    leagues: [
      { leagueId: 'L1', name: 'Dynasty Degens', season: 2026 },
      { leagueId: 'L2', name: 'Work League', season: 2026 },
    ],
    ...over,
  }
}

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  fetchMock.mockImplementation(async () => ({ ok: true, status: 200, json: async () => snapshot() }))
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const patchBodies = () =>
  fetchMock.mock.calls.filter(([, init]) => init?.method === 'PATCH').map(([, init]) => JSON.parse(init.body))

describe('how Chimmy answers', () => {
  it('says where each value came from', async () => {
    render(<ChimmyPreferencesCard />)
    await screen.findByTestId('chimmy-pref-explanationStyle')
    expect(screen.getByTestId('chimmy-pref-source-explanationStyle').textContent).toBe('Set by you')
    expect(screen.getByTestId('chimmy-pref-source-riskPreference').textContent).toBe('Learned')
    expect(screen.getByTestId('chimmy-pref-source-actionPreference').textContent).toBe('Default')
  })

  it('names what "let Chimmy decide" would mean, from the learned value when one exists', async () => {
    render(<ChimmyPreferencesCard />)
    const risk = within(await screen.findByTestId('chimmy-pref-riskPreference')).getByRole('combobox')
    expect(within(risk).getByRole('option', { name: /Let Chimmy decide \(Chase upside/ })).toBeTruthy()
    // An explicit choice falls back to the DEFAULT when nothing was learned for it.
    const depth = within(screen.getByTestId('chimmy-pref-explanationStyle')).getByRole('combobox')
    expect(within(depth).getByRole('option', { name: /Let Chimmy decide \(Balanced\)/ })).toBeTruthy()
  })

  it('clears a setting with null, not with an empty string', async () => {
    render(<ChimmyPreferencesCard />)
    const depth = within(await screen.findByTestId('chimmy-pref-explanationStyle')).getByRole('combobox')
    fireEvent.change(depth, { target: { value: '' } })
    await waitFor(() => expect(patchBodies()).toEqual([{ explanationStyle: null }]))
  })

  it('saves a chosen value', async () => {
    render(<ChimmyPreferencesCard />)
    const shape = within(await screen.findByTestId('chimmy-pref-actionPreference')).getByRole('combobox')
    fireEvent.change(shape, { target: { value: 'quick-one-move' } })
    await waitFor(() => expect(patchBodies()).toEqual([{ actionPreference: 'quick-one-move' }]))
  })
})

describe('what Chimmy remembers', () => {
  it('lists all-leagues first, then each league, with its learned flags in words', async () => {
    render(<ChimmyPreferencesCard />)
    const all = await screen.findByTestId('chimmy-remembered-all')
    expect(all.textContent).toContain('All leagues')
    expect(all.textContent).toContain('Detail: concise')
    const league = screen.getByTestId('chimmy-remembered-L1')
    expect(league.textContent).toContain('Dynasty Degens')
    expect(league.textContent).toContain('Scoring: PPR')
    expect((within(league).getByRole('combobox') as HTMLSelectElement).value).toBe('rebuilder')
  })

  it('changes the rebuilding status for that league', async () => {
    render(<ChimmyPreferencesCard />)
    const league = await screen.findByTestId('chimmy-remembered-L1')
    fireEvent.change(within(league).getByRole('combobox'), { target: { value: 'contender' } })
    await waitFor(() => expect(patchBodies()).toEqual([{ teamDirection: { leagueId: 'L1', value: 'contender' } }]))
  })

  it('forgets only after a second click', async () => {
    render(<ChimmyPreferencesCard />)
    const league = await screen.findByTestId('chimmy-remembered-L1')
    fireEvent.click(within(league).getByRole('button', { name: 'Forget' }))
    expect(patchBodies()).toEqual([])
    fireEvent.click(within(league).getByRole('button', { name: 'Confirm forget' }))
    await waitFor(() => expect(patchBodies()).toEqual([{ forget: { leagueId: 'L1' } }]))
  })

  it('offers only leagues not already listed for a new direction', async () => {
    render(<ChimmyPreferencesCard />)
    const picker = await screen.findByRole('combobox', { name: /league to set a team direction for/i })
    const names = within(picker).getAllByRole('option').map((o) => o.textContent)
    expect(names).toEqual(['Set team direction for a league…', 'Work League (2026)'])
    fireEvent.change(picker, { target: { value: 'L2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Rebuilding' }))
    await waitFor(() => expect(patchBodies()).toEqual([{ teamDirection: { leagueId: 'L2', value: 'rebuilder' } }]))
  })

  it('explains the empty state instead of rendering nothing', async () => {
    fetchMock.mockImplementation(async () => ({ ok: true, status: 200, json: async () => snapshot({ remembered: [] }) }))
    render(<ChimmyPreferencesCard />)
    expect((await screen.findByTestId('chimmy-remembered-empty')).textContent).toMatch(/I.m rebuilding/)
  })
})

describe('it is actually on the settings screen', () => {
  it('is mounted in the Preferences section, beside the voice card', () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), 'app', 'settings', 'components', 'sections', 'PreferencesSettingsSection.tsx'),
      'utf8',
    )
    expect(src).toContain('import ChimmyPreferencesCard from "@/components/settings/ChimmyPreferencesCard"')
    expect(src.indexOf('<ChimmyPreferencesCard />')).toBeGreaterThan(src.indexOf('<ChimmyVoiceSettingsCard />'))
  })
})

describe('the chat route reads and writes the proven league', () => {
  const ROUTE = fs.readFileSync(path.join(process.cwd(), 'app', 'api', 'chat', 'chimmy', 'route.ts'), 'utf8')

  it('merges the all-leagues profile with the proven league\'s', () => {
    expect(ROUTE).toMatch(/getAiMemory\(userId, 'user_preferences', \{ leagueId: null, key: COACHING_PROFILE_KEY \}\)/)
    expect(ROUTE).toMatch(/getAiMemory\(userId, 'user_preferences', \{ leagueId: leagueSnapshot\.id, key: COACHING_PROFILE_KEY \}\)/)
    expect(ROUTE).toContain('coachingProfileForOrchestration = mergeCoachingProfiles(globalCoaching, leagueCoaching)')
  })

  it('remembers declarations under the proven league, never the client field', () => {
    const at = ROUTE.indexOf('rememberChimmyUserMessageMemory({')
    // Just this call — the NEXT one (the assistant-memory writer) is a different store.
    const call = ROUTE.slice(at, ROUTE.indexOf('}),', at))
    expect(call).toContain('leagueId: leagueSnapshot?.id ?? null')
    expect(call).not.toMatch(/leagueId: leagueId \?\? null/)
  })
})
