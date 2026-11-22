// @vitest-environment jsdom
/**
 * Every clickable box shows a check mark (follow-up A1).
 *
 * Selectable cards used to signal "selected" with a border/background tint only, and the draft-room
 * queue "+" did not change at all once a player was queued. These pin, per changed surface, that a
 * selected item draws a tick (`data-selection-check="on"`, or a lucide check svg) and exposes its
 * state to assistive tech (`aria-pressed`, a real radio's `checked`, or `aria-current`).
 */
import React, { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), message: vi.fn() } }))
vi.mock('@/components/i18n/LanguageProviderClient', async () => {
  const { translations: dict } = await import('@/lib/i18n/translations')
  const t = (k: string) => dict.en[k] ?? k
  const tInterpolate = (k: string, vars: Record<string, string | number> = {}) =>
    t(k).replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(vars[name] ?? ''))
  const value = { language: 'en', t, tInterpolate, setLanguage: () => {} }
  return { useLanguage: () => value, useOptionalLanguage: () => value }
})

import { SelectionCheck } from '@/components/ui/selection-check'
import { CheckBox } from '@/components/ui/checkbox'
import { CheckBox as WizardCheckBox } from '@/components/create-league-v2/WizardControls'
import { SurvivorTribePicker } from '@/components/league/survivor/SurvivorTribePicker'
import { SleeperPoolTable } from '@/components/app/draft-room/SleeperPoolTable'
import { PlayerPanel } from '@/components/app/draft-room/PlayerPanel'
import { KeeperSelectionTab } from '@/app/league/[leagueId]/tabs/KeeperSelectionTab'
import { LeagueBasicsStep, freshCreateLeagueState } from '@/components/create-league-v2/CreateLeagueWizard'
import { translations } from '@/lib/i18n/translations'
import { DEFAULT_V2_STATE } from '@/lib/create-league-v2/state'
import { SurvivorTwistPresetPicker } from '@/app/league/[leagueId]/components/settings/survivor/SurvivorTwistPresetPicker'
import { survivorTwistFoundationPatch } from '@/lib/survivor/survivorTwistPresets'
import { SURVIVOR_DEFAULT_FOUNDATION_SETTINGS } from '@/lib/survivor/survivorSettings'
import type { SurvivorTribeSlot } from '@/lib/survivor/survivorTribeIdentity'
import type { PlayerEntry } from '@/components/app/draft-room/PlayerPanel'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const tick = (el: Element | null) => el?.getAttribute('data-selection-check') ?? null

describe('SelectionCheck primitive', () => {
  it('draws a check only when selected, an empty ring otherwise, and is hidden from assistive tech', () => {
    const view = render(<SelectionCheck selected={false} testId="c" />)
    const off = screen.getByTestId('c')
    expect(tick(off)).toBe('off')
    expect(off.querySelector('svg')).toBeNull()
    expect(off.getAttribute('aria-hidden')).toBe('true')
    view.rerender(<SelectionCheck selected testId="c" />)
    expect(tick(screen.getByTestId('c'))).toBe('on')
    expect(screen.getByTestId('c').querySelector('svg')).not.toBeNull()
  })

  it('hideWhenOff renders nothing for an unselected tile', () => {
    render(<SelectionCheck selected={false} hideWhenOff testId="c" />)
    expect(screen.queryByTestId('c')).toBeNull()
  })
})

describe('CheckBox primitive (moved to components/ui/checkbox)', () => {
  it('is the same component the wizard re-exports, so existing callers are unchanged', () => {
    expect(WizardCheckBox).toBe(CheckBox)
  })

  it('draws a tick from state, exposes checked, and takes an accessible name', () => {
    const onChange = vi.fn()
    const view = render(<CheckBox checked={false} onChange={onChange} testId="box" ariaLabel="Median game" />)
    const input = screen.getByRole('checkbox', { name: 'Median game' }) as HTMLInputElement
    expect(input.checked).toBe(false)
    expect(view.container.querySelector('[data-checked]')?.getAttribute('data-checked')).toBe('false')
    expect(view.container.querySelector('svg')).toBeNull()
    fireEvent.click(input)
    expect(onChange).toHaveBeenCalledWith(true)
    view.rerender(<CheckBox checked onChange={onChange} testId="box" ariaLabel="Median game" />)
    expect((screen.getByRole('checkbox', { name: 'Median game' }) as HTMLInputElement).checked).toBe(true)
    expect(view.container.querySelector('[data-checked]')?.getAttribute('data-checked')).toBe('true')
    expect(view.container.querySelector('svg')).not.toBeNull()
  })
})

describe('Survivor tribe catalogue tiles', () => {
  function Harness() {
    const [slots, setSlots] = useState<SurvivorTribeSlot[]>([{ catalogId: 'crab', managerCount: 6 }, { catalogId: 'shark', managerCount: 6 }])
    return <SurvivorTribePicker sport="NHL" managers={12} tribeCount={2} value={slots} onChange={setSlots} />
  }

  it('the chosen tribe carries a tick and aria-pressed; the tick moves with the choice', () => {
    render(<Harness />)
    fireEvent.click(screen.getAllByRole('button', { name: 'Choose tribe' })[0])
    const crab = screen.getByTestId('survivor-tribe-option-crab')
    expect(crab.getAttribute('aria-pressed')).toBe('true')
    expect(tick(within(crab).getByTestId('survivor-tribe-option-crab-check'))).toBe('on')
    // Unselected tiles draw no ring (dense grid) — but are still pressable.
    const options = screen.getAllByTestId(/^survivor-tribe-option-/).filter((el) => el.tagName === 'BUTTON')
    const other = options.find((b) => b !== crab && !(b as HTMLButtonElement).disabled)!
    expect(other.getAttribute('aria-pressed')).toBe('false')
    expect(other.querySelector('[data-selection-check]')).toBeNull()
    fireEvent.click(other)
    expect(other.getAttribute('aria-pressed')).toBe('true')
    expect(tick(other.querySelector('[data-selection-check]'))).toBe('on')
    expect(screen.getByTestId('survivor-tribe-option-crab').querySelector('[data-selection-check]')).toBeNull()
  })
})

describe('Create league: Survivor role and starting tribes', () => {
  it('the selected role and tribe count each draw a tick alongside aria-pressed', () => {
    const fresh = freshCreateLeagueState({ ...DEFAULT_V2_STATE, sport: 'NBA' })
    const state = { ...fresh, survivorCommissionerParticipationMode: 'participating_player', survivorTribeCount: 2 } as typeof fresh
    render(<LeagueBasicsStep state={state} onChange={vi.fn()} fieldErrors={null} />)
    const playing = screen.getByTestId('g30-survivor-role-participating_player')
    const host = screen.getByTestId('g30-survivor-role-non_participating_host')
    expect(playing.getAttribute('aria-pressed')).toBe('true')
    expect(tick(screen.getByTestId('g30-survivor-role-participating_player-check'))).toBe('on')
    expect(host.getAttribute('aria-pressed')).toBe('false')
    expect(tick(screen.getByTestId('g30-survivor-role-non_participating_host-check'))).toBe('off')
    expect(screen.getByTestId('g30-survivor-tribes-2').getAttribute('aria-pressed')).toBe('true')
    expect(tick(screen.getByTestId('g30-survivor-tribes-2-check'))).toBe('on')
  })
})

describe('draft room pool table: the queue button', () => {
  const players: PlayerEntry[] = [
    { id: 'a', name: 'Alpha Back', position: 'RB', team: 'MIA', adp: 10 },
    { id: 'b', name: 'Bravo Wide', position: 'WR', team: 'DAL', adp: 20 },
  ]

  it('a queued player shows a check and aria-pressed=true, and keeps the same accessible name', () => {
    render(
      <SleeperPoolTable
        filtered={players}
        draftedNames={new Set()}
        selectedPlayer={null}
        isPlayerQueued={(p) => p.name === 'Alpha Back'}
        isPlayerDrafted={() => false}
        canDraft
        useAiAdp={false}
        draftSport="NFL"
        onDraftRequest={vi.fn()}
        onAddToQueue={vi.fn()}
        onPlayerSelect={vi.fn()}
        onCompareTap={vi.fn()}
        scrollRef={{ current: null }}
        compareAnchor={null}
        disableVirtualization
      />,
    )
    const queued = screen.getByTestId('sleeper-pool-row-0-queue')
    const idle = screen.getByTestId('sleeper-pool-row-1-queue')
    expect(queued.getAttribute('aria-pressed')).toBe('true')
    expect(queued.getAttribute('aria-label')).toBe('Queue Alpha Back')
    expect(queued.querySelector('svg')?.getAttribute('class')).toContain('lucide-check')
    expect(idle.getAttribute('aria-pressed')).toBe('false')
    expect(idle.getAttribute('aria-label')).toBe('Queue Bravo Wide')
    expect(idle.querySelector('svg')?.getAttribute('class')).toContain('lucide-plus')
  })
})

describe('draft room player cards: the queue button', () => {
  it('turns from + into a check, with aria-pressed, once the player is queued; the name stays Add X to queue', async () => {
    vi.stubGlobal('matchMedia', vi.fn((media: string) => ({
      matches: false, media, onchange: null,
      addEventListener: vi.fn(), removeEventListener: vi.fn(),
      addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
    })))
    const players: PlayerEntry[] = [
      { id: 'a', name: 'Alpha Back', position: 'RB', team: 'MIA', adp: 10 },
      { id: 'b', name: 'Bravo Wide', position: 'WR', team: 'DAL', adp: 20 },
    ]
    render(
      <PlayerPanel
        players={players}
        draftedNames={new Set()}
        sport="NFL"
        canDraft
        onAddToQueue={vi.fn()}
        onMakePick={vi.fn()}
        poolLayout="card"
        isPlayerQueued={(p) => p.name === 'Alpha Back'}
      />,
    )
    const queued = await screen.findByRole('button', { name: 'Add Alpha Back to queue' })
    expect(queued.getAttribute('aria-pressed')).toBe('true')
    expect(queued.getAttribute('data-queued')).toBe('true')
    expect(queued.querySelector('svg')?.getAttribute('class')).toContain('lucide-check')
    const idle = screen.getByRole('button', { name: 'Add Bravo Wide to queue' })
    expect(idle.getAttribute('aria-pressed')).toBe('false')
    expect(idle.querySelector('svg')?.getAttribute('class')).toContain('lucide-plus')
  })
})

describe('keeper declaration rows', () => {
  it('a selected keeper carries aria-pressed=true; an unselected one false', async () => {
    const json = (body: unknown) => Promise.resolve({ ok: true, json: async () => body })
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if (url.startsWith('/api/keeper/context')) {
        return json({
          league: { keeperCount: 2 },
          session: { id: 's', seasonId: 'S', status: 'open', deadline: new Date(Date.now() + 864e5).toISOString(), teamsSubmitted: 0, totalTeams: 10 },
          viewerRoster: { id: 'r1', seasonId: 'S' },
        })
      }
      if (url.startsWith('/api/keeper/eligibility')) return json({ raw: [] })
      if (url.startsWith('/api/redraft/roster')) {
        return json({ roster: { players: [
          { playerId: 'p1', playerName: 'Kept Guy', position: 'QB', team: 'KC' },
          { playerId: 'p2', playerName: 'Other Guy', position: 'TE', team: 'SF' },
        ] } })
      }
      return json({ records: [{ id: 'k1', playerId: 'p1', playerName: 'Kept Guy', status: 'pending', costRound: 3, costLabel: null }] })
    }))
    render(<KeeperSelectionTab leagueId="L" />)
    await waitFor(() => expect(screen.getByTestId('keeper-select-p1')).toBeTruthy())
    expect(screen.getByTestId('keeper-select-p1').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('keeper-select-p2').getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(screen.getByTestId('keeper-select-p2'))
    expect(screen.getByTestId('keeper-select-p2').getAttribute('aria-pressed')).toBe('true')
  })
})

describe('Survivor twist presets', () => {
  it('the preset in use is marked aria-current and draws a tick; the others do not', async () => {
    const settings = { ...SURVIVOR_DEFAULT_FOUNDATION_SETTINGS, tribeCount: 3, ...survivorTwistFoundationPatch('classic', 3) }
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ config: { mode: 'random', count: 0, pickedTypeIds: [] }, saved: false, locked: false }) })))
    render(<SurvivorTwistPresetPicker leagueId="L" canEdit settings={settings as never} onApplied={vi.fn()} />)
    await waitFor(() => expect(tick(screen.getByTestId('survivor-twist-classic-check'))).toBe('on'))
    const classic = screen.getByTestId('survivor-twist-classic')
    expect(classic.getAttribute('aria-current')).toBe('true')
    expect(screen.getByRole('group', { name: /Classic/ })).toBe(classic)
    expect(screen.getByTestId('survivor-twist-simple').getAttribute('aria-current')).toBeNull()
    expect(tick(screen.getByTestId('survivor-twist-simple-check'))).toBe('off')
  })
})

describe('new queue strings', () => {
  it('exist in English and Spanish, keep their placeholder, and never say waiver in Spanish', () => {
    for (const key of ['draftRoom.queue.addPlayer', 'draftRoom.queue.queuePlayer']) {
      expect(translations.en[key]).toContain('{{name}}')
      expect(translations.es[key]).toContain('{{name}}')
      expect(translations.es[key]).not.toBe(translations.en[key])
      expect(translations.es[key].toLowerCase()).not.toContain('waiver')
    }
  })
})
