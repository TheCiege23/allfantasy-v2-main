/**
 * Two create-wizard choices made on 2026-10-12:
 *   - specialty formats (Survivor, Guillotine, Big Brother…) lead the Basics step and the four
 *     classics follow as a compact row — both always visible, nothing behind a "more" toggle;
 *   - the draft date can be "Schedule later", because requiring it blocked managers who want to
 *     invite friends before anyone has agreed a draft night.
 */
import React from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_V2_STATE } from '@/lib/create-league-v2/state'
import { analyzeCreateLeagueCompletion } from '@/lib/create-league-v2/form-completion'

vi.mock('@/components/i18n/LanguageProviderClient', () => ({ useLanguage: () => ({ t: (key: string) => key }) }))
vi.mock('@/components/create-league-v2/CreateLeagueVideoTile', () => ({
  CreateLeagueVideoTile: ({ testId, onSelect, title }: { testId: string; onSelect: () => void; title: string }) => (
    <button data-testid={testId} onClick={onSelect}>{title}</button>
  ),
}))

import { DraftStep, LeagueBasicsStep, ReviewCreateStep, freshCreateLeagueState } from '@/components/create-league-v2/CreateLeagueWizard'
import { submitCreateLeagueV2 } from '@/lib/create-league-v2/submit'
import { validateCreatePayload } from '@/lib/league-creation/canonical/validateCreateLeague'

// Format tiles only — the group heading also carries a "?" help button.
const ids = (group: HTMLElement) =>
  within(group).getAllByRole('button')
    .map((b) => b.getAttribute('data-testid') ?? '')
    .filter((id) => id.startsWith('g30-league-type-'))
    .map((id) => id.replace('g30-league-type-', ''))

describe('specialty formats lead the Basics step', () => {
  it('NBA: specialties first with Survivor leading, classics after in their usual order', () => {
    const state = { ...DEFAULT_V2_STATE, sport: 'NBA' as const, leagueType: 'redraft' as const }
    render(<LeagueBasicsStep state={state} onChange={vi.fn()} fieldErrors={null} />)
    const specialty = screen.getByTestId('g30-specialty-formats')
    const classic = screen.getByTestId('g30-classic-formats')
    expect(ids(classic)).toEqual(['redraft', 'dynasty', 'keeper', 'best_ball'])
    const special = ids(specialty)
    expect(special[0]).toBe('survivor')
    expect(special).toEqual(expect.arrayContaining(['guillotine', 'big_brother', 'zombie']))
    expect(special).not.toContain('idp')
    expect(special).not.toEqual(expect.arrayContaining(['redraft']))
    // The specialty group comes before the classics in the page.
    expect(specialty.compareDocumentPosition(classic) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('every format the sport allows is still offered exactly once', () => {
    const state = { ...DEFAULT_V2_STATE, sport: 'NBA' as const, leagueType: 'redraft' as const }
    render(<LeagueBasicsStep state={state} onChange={vi.fn()} fieldErrors={null} />)
    const all = screen.getAllByRole('button').map((b) => b.getAttribute('data-testid') ?? '').filter((id) => id.startsWith('g30-league-type-'))
    expect(new Set(all).size).toBe(all.length)
    expect(all).toHaveLength(9)
  })

  it('choosing a specialty tile selects that format', () => {
    const onChange = vi.fn()
    const state = { ...DEFAULT_V2_STATE, sport: 'NBA' as const, leagueType: 'redraft' as const }
    render(<LeagueBasicsStep state={state} onChange={onChange} fieldErrors={null} />)
    fireEvent.click(screen.getByTestId('g30-league-type-survivor'))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ leagueType: 'survivor' }))
  })
})

describe('a fresh NBA create starts on Survivor', () => {
  it('offers the cast, tribe, and commissioner participation choices in the active wizard', () => {
    const onChange = vi.fn()
    const state = freshCreateLeagueState({ ...DEFAULT_V2_STATE, sport: 'NBA' })
    render(<LeagueBasicsStep state={state} onChange={onChange} fieldErrors={null} />)
    expect(screen.getByTestId('g30-survivor-setup')).toBeTruthy()
    fireEvent.click(screen.getByTestId('g30-survivor-role-participating_player'))
    expect(onChange).toHaveBeenCalledWith({ survivorCommissionerParticipationMode: 'participating_player' })
    fireEvent.click(screen.getByTestId('g30-survivor-tribes-2'))
    expect(onChange).toHaveBeenCalledWith({ survivorTribeCount: 2 })
  })

  it('starts on Survivor with a draft type, team size and preset Survivor accepts', async () => {
    const fresh = freshCreateLeagueState({ ...DEFAULT_V2_STATE, sport: 'NBA' })
    expect(fresh.leagueType).toBe('survivor')
    // Only the manager's own inputs are missing — nothing left over from Redraft blocks it.
    const codes = analyzeCreateLeagueCompletion(fresh).map((i) => i.code).sort()
    expect(codes).toEqual(['draft_date_required', 'draft_time_required', 'league_name_invalid'])

    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ success: true, league: { id: 'l1' }, homepageUrl: '/league/l1' }) }) as Response)
    vi.stubGlobal('fetch', fetchMock)
    try {
      await submitCreateLeagueV2({ ...fresh, name: 'Island League', nameTouched: true, draftScheduleLater: true })
      const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body)) as Record<string, unknown>
      expect(body.concept).toBe('survivor')
      expect(body.conceptSetup).toMatchObject({ commissionerParticipationMode: 'non_participating_host', survivorTribeCount: fresh.survivorTribeCount })
      expect(validateCreatePayload(body).ok).toBe(true)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('persists playing-commissioner choice and rejects an invalid tribe split', async () => {
    const fresh = freshCreateLeagueState({ ...DEFAULT_V2_STATE, sport: 'NBA' })
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ success: true, league: { id: 'l1' } }) }) as Response)
    vi.stubGlobal('fetch', fetchMock)
    try {
      await submitCreateLeagueV2({ ...fresh, name: 'Playing League', draftScheduleLater: true,
        survivorCommissionerParticipationMode: 'participating_player', survivorTribeCount: 2 })
      const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body)) as Record<string, unknown>
      expect(body.conceptSetup).toMatchObject({ commissionerParticipationMode: 'participating_player', survivorTribeCount: 2 })
      expect(validateCreatePayload(body).ok).toBe(true)
      expect(validateCreatePayload({ ...body, conceptSetup: { ...body.conceptSetup as object, survivorTribeCount: 99 } }).ok).toBe(false)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('a sport without Survivor starts on Guillotine, and one without either on Big Brother', () => {
    expect(freshCreateLeagueState({ ...DEFAULT_V2_STATE, sport: 'NFL' }).leagueType).toBe('guillotine')
    expect(freshCreateLeagueState({ ...DEFAULT_V2_STATE, sport: 'NHL' }).leagueType).toBe('guillotine')
    expect(freshCreateLeagueState({ ...DEFAULT_V2_STATE, sport: 'MLB' }).leagueType).toBe('guillotine')
    expect(freshCreateLeagueState({ ...DEFAULT_V2_STATE, sport: 'NCAAB' }).leagueType).toBe('big_brother')
    expect(freshCreateLeagueState({ ...DEFAULT_V2_STATE, sport: 'SOCCER' }).leagueType).toBe('big_brother')
  })
})

describe('"Schedule later" for the draft date', () => {
  const base = { ...DEFAULT_V2_STATE, sport: 'NFL' as const, leagueType: 'redraft' as const, name: 'Later League', draftDate: '', draftTime: '' }

  it('hides the date and time and says where to set them', () => {
    const view = render(<DraftStep state={base} onChange={vi.fn()} fieldErrors={null} />)
    expect(screen.getByTestId('g30-draft-date')).toBeTruthy()
    view.rerender(<DraftStep state={{ ...base, draftScheduleLater: true }} onChange={vi.fn()} fieldErrors={null} />)
    expect(screen.queryByTestId('g30-draft-date')).toBeNull()
    expect(screen.queryByTestId('g30-draft-time')).toBeNull()
    expect(screen.getByTestId('g30-draft-schedule-later-note').textContent).toMatch(/Commissioner settings/)
    expect(screen.getByTestId('g30-timezone')).toBeTruthy()
  })

  it('the toggle reports the choice', () => {
    const onChange = vi.fn()
    render(<DraftStep state={base} onChange={onChange} fieldErrors={null} />)
    fireEvent.click(screen.getByTestId('g30-draft-schedule-later'))
    expect(onChange).toHaveBeenLastCalledWith({ draftScheduleLater: true })
    fireEvent.click(screen.getByTestId('g30-draft-schedule-now'))
    expect(onChange).toHaveBeenLastCalledWith({ draftScheduleLater: false })
  })

  it('Review offers "Schedule later" beside a missing date', () => {
    const issues = analyzeCreateLeagueCompletion(base)
    expect(issues.map((i) => i.code)).toContain('draft_date_required')
    const onScheduleLater = vi.fn()
    render(<ReviewCreateStep state={base} completionIssues={issues} submitError={null} onFixIssue={vi.fn()} onScheduleLater={onScheduleLater} />)
    fireEvent.click(screen.getByTestId('g30-review-later-draft_date_required'))
    expect(onScheduleLater).toHaveBeenCalledTimes(1)
    expect(analyzeCreateLeagueCompletion({ ...base, draftScheduleLater: true }).map((i) => i.code))
      .not.toEqual(expect.arrayContaining(['draft_date_required', 'draft_time_required']))
  })
})
