/**
 * Guilly rules: one settings page, one Save (owner's decision, 2026-11-25).
 *
 * It was three pages reached from five rows. The server keeps its three writers (first chop week, rules, chop
 * schedule), each with its own lock, plan check and "What changed" event; the page sends only the ones that
 * changed, in that order, and says what was and was not saved when one is refused.
 */
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { GuillotineRulesPage } from '@/components/league-settings/home/GuillotineRulesPage'
import { DEFAULT_ADVANCED, type GuillotineAdvanced } from '@/lib/guillotine/chopSchedule'
import type { GuillotineRules } from '@/lib/guillotine/guillotineRules'

const RULES: GuillotineRules = {
  teamsPerChop: 1,
  eliminationEndWeek: 18,
  endgame: 'last_team_standing',
  tiebreakerOrder: ['bench_points', 'season_points', 'previous_period', 'draft_slot', 'commissioner', 'random'],
  statCorrectionHours: 48,
  dangerMarginPoints: 10,
  rosterReleaseTiming: 'next_waiver_run',
  aiRecapAuto: true,
  faabOnChop: 'keep',
  faabOnChopPercent: 100,
  bestBall: false,
  periodWeeks: 1,
  chopListOrder: 'chop_top',
  freeAgencyFromWeek: null,
}

const view = (over: Record<string, unknown> = {}) => ({
  rules: RULES,
  startWeek: 1,
  seasonWeeks: 18,
  endgameLocked: false,
  bestBallLocked: false,
  periodWeeksAvailable: false,
  canEditPaid: true,
  aiRecapAvailable: true,
  advanced: DEFAULT_ADVANCED,
  teamCount: 12,
  ...over,
})

type Call = { method: string; url: string; body: Record<string, unknown> | null }

/** GET answers `initial`; each PATCH is answered by `answer` (default: the server accepting it as sent). */
function mount(initial: ReturnType<typeof view>, answer?: (body: Record<string, unknown>) => { status?: number; body: Record<string, unknown> } | null) {
  const calls: Call[] = []
  // The server's state: each accepted PATCH changes it, and the rules answer is read back from it, as the route does.
  let stored = { ...initial }
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const method = (init?.method ?? 'GET').toUpperCase()
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null
    calls.push({ method, url: String(url), body })
    if (method === 'GET') return { ok: true, json: async () => initial }
    const custom = answer?.(body!)
    if (custom) return { ok: (custom.status ?? 200) < 400, json: async () => custom.body }
    if (body && 'eliminationStartWeek' in body) {
      stored = { ...stored, startWeek: Number(body.eliminationStartWeek) }
      return { ok: true, json: async () => ({ ok: true, config: { eliminationStartWeek: stored.startWeek, eliminationEndWeek: 18 } }) }
    }
    if (body && 'rules' in body) {
      stored = { ...stored, rules: { ...stored.rules, ...(body.rules as object) } }
      return { ok: true, json: async () => ({ ok: true, ...stored }) }
    }
    stored = { ...stored, advanced: body!.advanced as GuillotineAdvanced }
    return { ok: true, json: async () => ({ ok: true, advanced: body!.advanced, scheduleLines: ['From week 1: 1 team a week.'] }) }
  }))
  const onSaved = vi.fn()
  render(<GuillotineRulesPage leagueId="L1" chopLabel="By Wednesday 7:00 AM ET" waiverLabel="Thursday 7:00 AM ET" onSaved={onSaved} />)
  return { calls, onSaved, patches: () => calls.filter((c) => c.method === 'PATCH').map((c) => c.body!) }
}
const ready = () => screen.findByTestId('guillotine-rules')
const set = (testId: string, value: string | number) => fireEvent.change(screen.getByTestId(testId), { target: { value: String(value) } })
const save = () => screen.getByTestId('lsh-save') as HTMLButtonElement

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('one page, grouped by question', () => {
  it('🛑 every Guilly rule is on it: the five groups, in order, read from one request', async () => {
    const { calls } = mount(view())
    await ready()
    expect(calls).toEqual([{ method: 'GET', url: '/api/leagues/L1/guillotine/summary?view=rules', body: null }])
    expect([...document.querySelectorAll('[data-testid^="guillotine-group-"] h2')].map((h) => h.textContent)).toEqual([
      'When teams get chopped',
      'After a chop',
      'Ties and fairness',
      'How the season ends',
      'Lineups and the Chop page',
    ])
    // What used to be the "First chop week" page and the "Chop rules" page is in the first group, with the base
    // teams-per-chop that lived on a third page.
    const chops = within(screen.getByTestId('guillotine-group-chops'))
    for (const id of ['lsh-first-chop-input', 'guillotine-rules-end-week', 'guillotine-rules-teams-per-chop', 'guillotine-add-step', 'guillotine-pattern', 'guillotine-season-preview']) {
      expect(chops.getByTestId(id), id).toBeTruthy()
    }
    expect(within(screen.getByTestId('guillotine-group-after')).getByTestId('guillotine-faab-mode')).toBeTruthy()
    expect(within(screen.getByTestId('guillotine-group-fairness')).getByTestId('guillotine-immunity')).toBeTruthy()
    expect(within(screen.getByTestId('guillotine-group-ending')).getByTestId('guillotine-rules-endgame')).toBeTruthy()
    expect(within(screen.getByTestId('guillotine-group-page')).getByTestId('guillotine-rules-list-order')).toBeTruthy()
    // It says when the chop and the waivers run, once, in words.
    expect(screen.getByTestId('guillotine-rules').textContent).toContain('The chop runs by Wednesday 7:00 AM ET; waivers run Thursday 7:00 AM ET.')
    // One Save, and nothing to save yet.
    expect(screen.getAllByTestId('lsh-save').length).toBe(1)
    expect(save().disabled).toBe(true)
  })

  it('nothing on the page says "playoffs"', async () => {
    mount(view())
    expect((await ready()).textContent).not.toMatch(/playoff/i)
  })
})

describe('one Save sends only what changed, to the writer that owns it', () => {
  it('🛑 a change to each part goes out as three requests, in order: first chop week, rules, chop schedule', async () => {
    const { patches, onSaved } = mount(view())
    await ready()
    set('lsh-first-chop-input', 3)
    set('guillotine-rules-endgame', 'final_four')
    fireEvent.click(screen.getByTestId('guillotine-immunity'))
    expect(save().disabled).toBe(false)
    fireEvent.click(save())
    await screen.findByTestId('guillotine-rules-saved')
    expect(patches()).toEqual([
      { eliminationStartWeek: 3 },
      { rules: { endgame: 'final_four' } },
      { advanced: { ...DEFAULT_ADVANCED, immunity: 'top_scorer' } },
    ])
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ firstChopWeek: 3, advanced: { ...DEFAULT_ADVANCED, immunity: 'top_scorer' } }))
    // Saved means saved: nothing left to send.
    expect(save().disabled).toBe(true)
  })

  it('a change to one rule sends one request, with that field and nothing else', async () => {
    const { patches } = mount(view())
    await ready()
    set('guillotine-rules-list-order', 'chop_bottom')
    fireEvent.click(save())
    await screen.findByTestId('guillotine-rules-saved')
    expect(patches()).toEqual([{ rules: { chopListOrder: 'chop_bottom' } }])
  })

  it('"skip waivers late in the season": picking a week sends it, and "Never" sends null', async () => {
    const { patches } = mount(view())
    await ready()
    expect(screen.getByTestId('guillotine-rules-free-agency-from')).toBeTruthy()
    set('guillotine-rules-free-agency-from', '12')
    expect(screen.getByText('From week 12, chopped players are free agents as soon as the chop is final.')).toBeTruthy()
    fireEvent.click(save())
    await screen.findByTestId('guillotine-rules-saved')
    expect(patches()).toEqual([{ rules: { freeAgencyFromWeek: 12 } }])
  })

  it('"skip waivers" is not offered when chopped players are already free agents every week', async () => {
    mount(view({ rules: { ...RULES, rosterReleaseTiming: 'immediate' } }))
    await ready()
    expect(screen.queryByTestId('guillotine-rules-free-agency-from')).toBeNull()
  })

  it('🛑 when one part is refused it stops, and says what was saved and what was not', async () => {
    const { patches, onSaved } = mount(view(), (body) => ('rules' in body ? { status: 400, body: { error: 'With 12 teams this chop schedule still has 5 alive after week 8.' } } : null))
    await ready()
    set('lsh-first-chop-input', 2)
    set('guillotine-rules-end-week', 8)
    fireEvent.click(screen.getByTestId('guillotine-immunity'))
    fireEvent.click(save())
    const alert = await screen.findByTestId('guillotine-rules-error')
    expect(alert.textContent).toBe('Saved: first chop week. Not saved (league rules): With 12 teams this chop schedule still has 5 alive after week 8.')
    // The schedule was never sent: it comes after the part that was refused.
    expect(patches()).toEqual([{ eliminationStartWeek: 2 }, { rules: { eliminationEndWeek: 8 } }])
    expect(screen.queryByTestId('guillotine-rules-saved')).toBeNull()
    expect(onSaved).not.toHaveBeenCalled()
    // What is still unsaved can be sent again.
    expect(save().disabled).toBe(false)
  })

  it('a refusal with nothing saved before it shows the server’s words alone', async () => {
    mount(view(), () => ({ status: 402, body: { error: 'These rules are part of AF Commissioner.' } }))
    await ready()
    set('guillotine-rules-list-order', 'chop_bottom')
    fireEvent.click(save())
    expect((await screen.findByTestId('guillotine-rules-error')).textContent).toBe('These rules are part of AF Commissioner.')
  })
})

describe('repeating weeks are set in one go', () => {
  it('🛑 "2 teams, odd weeks, 5 to 11" writes four special weeks and the preview shows the double chops', async () => {
    const { patches } = mount(view())
    await ready()
    set('guillotine-pattern-kind', 'odd_weeks')
    set('guillotine-pattern-from', 5)
    set('guillotine-pattern-to', 11)
    set('guillotine-pattern-chops', 2)
    expect(screen.getByTestId('guillotine-pattern-weeks').textContent).toBe('Weeks 5, 7, 9 and 11: 2 teams chopped.')
    // Nothing changes until the button is pressed.
    expect(screen.queryByTestId('guillotine-special-5')).toBeNull()
    fireEvent.click(screen.getByTestId('guillotine-pattern-apply'))
    for (const w of [5, 7, 9, 11]) expect(screen.getByTestId(`guillotine-special-${w}`), `week ${w}`).toBeTruthy()
    expect(screen.queryByTestId('guillotine-special-6')).toBeNull()
    // 12 teams: single chops through week 4, then 2 in week 5, 1 in week 6, 2 in week 7.
    expect(screen.getByTestId('guillotine-preview-week-5').textContent).toBe('Wk 5−26 left')
    expect(screen.getByTestId('guillotine-preview-week-6').textContent).toBe('Wk 6−15 left')
    expect(screen.getByTestId('guillotine-preview-week-7').textContent).toBe('Wk 7−23 left')
    fireEvent.click(save())
    await screen.findByTestId('guillotine-rules-saved')
    expect(patches()).toEqual([{ advanced: { ...DEFAULT_ADVANCED, overrides: { 5: 2, 7: 2, 9: 2, 11: 2 } } }])
  })

  it('a range with no matching week cannot be applied', async () => {
    mount(view())
    await ready()
    set('guillotine-pattern-kind', 'odd_weeks')
    set('guillotine-pattern-from', 6)
    set('guillotine-pattern-to', 6)
    expect(screen.getByTestId('guillotine-pattern-weeks').textContent).toBe('No week in that range matches.')
    expect((screen.getByTestId('guillotine-pattern-apply') as HTMLButtonElement).disabled).toBe(true)
  })

  it('special weeks can be cleared in one press', async () => {
    mount(view({ advanced: { ...DEFAULT_ADVANCED, overrides: { 5: 2, 7: 2 } } }))
    await ready()
    fireEvent.click(screen.getByTestId('guillotine-clear-special'))
    expect(screen.queryByTestId('guillotine-special-5')).toBeNull()
    expect(save().disabled).toBe(false)
  })
})

describe('the season preview is what Save will check', () => {
  it('shows the season the rules on screen make, and when it is decided', async () => {
    mount(view())
    await ready()
    const strip = screen.getByTestId('guillotine-season-preview')
    expect(strip.getAttribute('data-fits')).toBe('true')
    expect(within(strip).getAllByRole('listitem').length).toBe(11)
    expect(screen.getByTestId('guillotine-preview-result').textContent).toBe('The last team standing is decided in week 11.')
  })

  it('🛑 a schedule that cannot reach a champion is said before Save, in the save’s own words', async () => {
    mount(view({ teamCount: 20, rules: { ...RULES, eliminationEndWeek: 10 }, seasonWeeks: 18 }))
    await ready()
    const strip = screen.getByTestId('guillotine-season-preview')
    expect(strip.getAttribute('data-fits')).toBe('false')
    expect(within(strip).getByRole('alert').textContent).toBe('With 20 teams this chop schedule still has 10 alive after week 10. Add double-chop weeks or move the last chop week later.')
    // A double chop every week fixes it, on screen, before anything is saved.
    set('guillotine-rules-teams-per-chop', 2)
    expect(screen.getByTestId('guillotine-season-preview').getAttribute('data-fits')).toBe('true')
  })

  it('a Final Four shows its three final weeks', async () => {
    mount(view({ teamCount: 8 }))
    await ready()
    set('guillotine-rules-endgame', 'final_four')
    expect(screen.getByTestId('guillotine-preview-week-5').getAttribute('data-kind')).toBe('final')
    expect(screen.getByTestId('guillotine-preview-result').textContent).toBe('The final 4 is decided in week 7.')
  })

  it('[control] an older server that sends no team count draws no preview rather than a wrong one', async () => {
    mount(view({ teamCount: undefined }))
    await ready()
    expect(screen.queryByTestId('guillotine-season-preview')).toBeNull()
  })
})

describe('what a commissioner cannot change is locked, not hidden', () => {
  it('without AF Commissioner the paid rules show a lock and are disabled; the free ones still save', async () => {
    const { patches } = mount(view({ canEditPaid: false }))
    await ready()
    expect(screen.getByTestId('guillotine-rules-upgrade')).toBeTruthy()
    for (const id of ['guillotine-rules-teams-per-chop', 'guillotine-rules-end-week', 'guillotine-add-step', 'guillotine-pattern-apply', 'guillotine-add-special', 'guillotine-faab-mode', 'guillotine-immunity', 'guillotine-rules-stat-hours', 'guillotine-rules-danger-margin']) {
      expect((screen.getByTestId(id) as HTMLInputElement).disabled, id).toBe(true)
    }
    for (const id of ['lsh-first-chop-input', 'guillotine-rules-endgame', 'guillotine-rules-release', 'guillotine-rules-list-order', 'guillotine-rules-best-ball', 'guillotine-rules-free-agency-from']) {
      expect((screen.getByTestId(id) as HTMLInputElement).disabled, id).toBe(false)
    }
    set('guillotine-rules-release', 'immediate')
    fireEvent.click(save())
    await screen.findByTestId('guillotine-rules-saved')
    expect(patches()).toEqual([{ rules: { rosterReleaseTiming: 'immediate' } }])
  })

  it('a league left on a schedule by a lapsed plan can go back to the standard one', async () => {
    const lapsed: GuillotineAdvanced = { ...DEFAULT_ADVANCED, steps: [{ fromWeek: 9, chops: 2 }], immunity: 'top_scorer' }
    const { patches } = mount(view({ canEditPaid: false, advanced: lapsed }))
    await ready()
    fireEvent.click(screen.getByTestId('guillotine-schedule-reset'))
    fireEvent.click(save())
    await screen.findByTestId('guillotine-rules-saved')
    expect(patches()).toEqual([{ advanced: DEFAULT_ADVANCED }])
  })

  it('[control] with the plan there is no reset button and no upgrade note', async () => {
    mount(view({ advanced: { ...DEFAULT_ADVANCED, immunity: 'top_scorer' } }))
    await ready()
    expect(screen.queryByTestId('guillotine-schedule-reset')).toBeNull()
    expect(screen.queryByTestId('guillotine-rules-upgrade')).toBeNull()
  })

  it('once the first chop has happened, the first chop week and the endgame are fixed and say so', async () => {
    mount(view({ endgameLocked: true, startWeek: 7 }))
    await ready()
    expect((screen.getByTestId('lsh-first-chop-input') as HTMLSelectElement).disabled).toBe(true)
    expect((screen.getByTestId('guillotine-rules-endgame') as HTMLSelectElement).disabled).toBe(true)
    expect(screen.getAllByText('Fixed for this season: the first chop has happened.').length).toBe(2)
  })
})

describe('a chopped team’s FAAB: who gets it, and how much', () => {
  it('🛑 offers the five rules, and asks "how much" only when a rule moves the money', async () => {
    mount(view())
    await ready()
    const select = screen.getByTestId('guillotine-rules-faab-on-chop') as HTMLSelectElement
    expect([...select.options].map((o) => o.textContent)).toEqual([
      'It leaves with the team',
      'Split it among the survivors',
      "To the week's highest scorer",
      "To the week's lowest surviving scorer",
      'One team at a time, in waiver order',
    ])
    expect(screen.queryByTestId('guillotine-rules-faab-percent')).toBeNull()
    set('guillotine-rules-faab-on-chop', 'top_scorer')
    const percent = screen.getByTestId('guillotine-rules-faab-percent') as HTMLSelectElement
    expect([...percent.options].map((o) => o.textContent)).toEqual(['All of it', '75%', '50%', '25%'])
    expect(percent.value).toBe('100')
  })

  it('saves the rule and the share together, as one rules request', async () => {
    const { patches } = mount(view())
    await ready()
    set('guillotine-rules-faab-on-chop', 'waiver_order')
    set('guillotine-rules-faab-percent', 50)
    expect(within(screen.getByTestId('guillotine-group-after')).getByText(/50% of it leaves with the chopped team\./)).toBeTruthy()
    fireEvent.click(save())
    await screen.findByTestId('guillotine-rules-saved')
    expect(patches()).toEqual([{ rules: { faabOnChop: 'waiver_order', faabOnChopPercent: 50 } }])
  })

  it('a stored share that is not one of the offered ones is still shown, not silently changed', async () => {
    mount(view({ rules: { ...RULES, faabOnChop: 'split', faabOnChopPercent: 40 } }))
    await ready()
    const percent = screen.getByTestId('guillotine-rules-faab-percent') as HTMLSelectElement
    expect(percent.value).toBe('40')
    expect([...percent.options].map((o) => o.value)).toEqual(['100', '75', '50', '40', '25'])
    expect(save().disabled).toBe(true)
  })

  it('without AF Commissioner the new rules are shown locked, and the share cannot be changed', async () => {
    mount(view({ canEditPaid: false, rules: { ...RULES, faabOnChop: 'top_scorer', faabOnChopPercent: 50 } }))
    await ready()
    const select = screen.getByTestId('guillotine-rules-faab-on-chop') as HTMLSelectElement
    // The league's current rule stays selectable so the page shows it; the others it cannot move to are disabled.
    expect([...select.options].filter((o) => o.disabled).map((o) => o.value)).toEqual(['split', 'low_scorer', 'waiver_order'])
    expect((screen.getByTestId('guillotine-rules-faab-percent') as HTMLSelectElement).disabled).toBe(true)
  })
})

describe('FAAB after a chop', () => {
  it('saves a top-up amount through the chop schedule', async () => {
    const { patches } = mount(view())
    await ready()
    set('guillotine-faab-mode', 'add')
    set('guillotine-faab-amount', 250)
    fireEvent.click(save())
    await screen.findByTestId('guillotine-rules-saved')
    expect(patches()).toEqual([{ advanced: { ...DEFAULT_ADVANCED, faab: { mode: 'add', amount: 250 } } }])
  })

  it('rules saved before FAAB existed read as unchanged', async () => {
    mount(view({ advanced: { steps: [], overrides: {}, immunity: 'off' } }))
    await ready()
    expect((screen.getByTestId('guillotine-faab-mode') as HTMLSelectElement).value).toBe('unchanged')
    expect(screen.queryByTestId('guillotine-faab-amount')).toBeNull()
  })
})

describe('loading', () => {
  it('a failed load says why and draws no form', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({ error: 'Only the commissioner can edit league rules.' }) })))
    render(<GuillotineRulesPage leagueId="L1" />)
    expect((await screen.findByRole('alert')).textContent).toBe('Only the commissioner can edit league rules.')
    await waitFor(() => expect(screen.queryByTestId('guillotine-rules')).toBeNull())
  })
})
