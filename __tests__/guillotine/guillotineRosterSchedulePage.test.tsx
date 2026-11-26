/**
 * Scheduled roster changes on the Guilly rules page (lib/guillotine/rosterSchedule.ts): the controls, what they
 * send, and what the page says before Save. The rules themselves are tested in rosterSchedule.test.ts, the
 * weekly run on a real database in roster-schedule-db.test.ts.
 */
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { GuillotineRulesPage } from '@/components/league-settings/home/GuillotineRulesPage'
import { DEFAULT_ADVANCED } from '@/lib/guillotine/chopSchedule'
import type { GuillotineRules } from '@/lib/guillotine/guillotineRules'
import { getAllNflSlots } from '@/lib/nfl-roster/NflRosterTemplates'
import { rosterSpotsFromDefinitions, type RosterChange, type RosterScheduleView } from '@/lib/guillotine/rosterSchedule'

const RULES: GuillotineRules = {
  teamsPerChop: 1,
  eliminationEndWeek: 17,
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
}
const LAYOUT = { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DEF: 1, BN: 6, IR: 1 }
const roster = (over: Partial<RosterScheduleView> = {}): RosterScheduleView => ({
  changes: [],
  done: [],
  skipped: [],
  layout: LAYOUT,
  spots: rosterSpotsFromDefinitions(getAllNflSlots(), LAYOUT),
  fromWeek: 4,
  toWeek: 17,
  supported: true,
  ...over,
})
const view = (over: Record<string, unknown> = {}) => ({
  rules: RULES,
  startWeek: 1,
  seasonWeeks: 17,
  endgameLocked: false,
  canEditPaid: true,
  aiRecapAvailable: true,
  advanced: DEFAULT_ADVANCED,
  teamCount: 12,
  roster: roster(),
  ...over,
})

function mount(initial: ReturnType<typeof view>, answer?: (body: Record<string, unknown>) => { status: number; body: Record<string, unknown> } | null) {
  const patches: Array<Record<string, unknown>> = []
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
    if ((init?.method ?? 'GET').toUpperCase() === 'GET') return { ok: true, json: async () => initial }
    const body = JSON.parse(String(init!.body)) as Record<string, unknown>
    patches.push(body)
    const custom = answer?.(body)
    if (custom) return { ok: custom.status < 400, json: async () => custom.body }
    if ('rosterSchedule' in body) {
      const sent = body.rosterSchedule as RosterChange[]
      const base = initial.roster as RosterScheduleView
      const history = base.changes.filter((c) => base.done.includes(c.id))
      return { ok: true, json: async () => ({ ok: true, roster: { ...base, changes: [...history, ...sent] } }) }
    }
    // As the route answers: the rules view, which has no roster schedule in it.
    if ('rules' in body) return { ok: true, json: async () => ({ ok: true, ...initial, rules: { ...RULES, ...(body.rules as object) }, roster: null }) }
    return { ok: true, json: async () => ({ ok: true }) }
  }))
  render(<GuillotineRulesPage leagueId="L1" />)
  return { patches }
}
const ready = () => screen.findByTestId('guillotine-rules')
const rows = () => screen.queryAllByTestId('guillotine-roster-change')
const inRow = (i: number, testId: string) => rows()[i]!.querySelector(`[data-testid="${testId}"]`) as HTMLSelectElement
const set = (el: HTMLElement, value: string | number) => fireEvent.change(el, { target: { value: String(value) } })
const add = () => fireEvent.click(screen.getByTestId('guillotine-roster-add'))
const save = () => screen.getByTestId('lsh-save') as HTMLButtonElement
const result = () => screen.getByTestId('guillotine-roster-result').textContent

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('where it lives', () => {
  it('its own group on the rules page, after "After a chop", saying what every team has today', async () => {
    mount(view())
    await ready()
    expect([...document.querySelectorAll('[data-testid^="guillotine-group-"] h2')].map((h) => h.textContent)).toEqual([
      'When teams get chopped',
      'After a chop',
      'Roster changes during the season',
      'Ties and fairness',
      'How the season ends',
      'Lineups and the Chop page',
    ])
    expect(screen.getByTestId('guillotine-roster-now').textContent).toBe('Right now every team has 9 starters, 6 bench.')
    expect(rows()).toHaveLength(0)
    expect(save().disabled).toBe(true)
  })

  it.each([
    ['an older server that sends no roster', { roster: undefined }],
    ['a failed read', { roster: null }],
    ['a sport the roster engine does not run', { roster: roster({ supported: false }) }],
  ])('is hidden for %s', async (_name, over) => {
    mount(view(over))
    await ready()
    expect(screen.queryByTestId('guillotine-group-roster')).toBeNull()
  })

  it('offers four changes, and none that makes the roster smaller', async () => {
    mount(view())
    await ready()
    add()
    expect([...inRow(0, 'guillotine-roster-kind').options].map((o) => o.textContent)).toEqual(['Add a starting spot', 'Add bench spots', 'Turn a bench spot into a starter', 'Take away a starting spot'])
    expect([...inRow(0, 'guillotine-roster-slot').options].map((o) => o.value)).not.toEqual(expect.arrayContaining(['BN', 'IR', 'TAXI']))
  })
})

describe('setting a change', () => {
  it('a new change starts on the first week it can be set for, as one more Flex', async () => {
    const { patches } = mount(view())
    await ready()
    add()
    expect([...inRow(0, 'guillotine-roster-week').options].map((o) => o.value)).toEqual(['4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15', '16', '17'])
    expect([inRow(0, 'guillotine-roster-week').value, inRow(0, 'guillotine-roster-kind').value, inRow(0, 'guillotine-roster-slot').value, inRow(0, 'guillotine-roster-count').value]).toEqual(['4', 'add_starter', 'FLEX', '1'])
    expect(result()).toBe('From week 4: 10 starters, 6 bench.')
    fireEvent.click(save())
    await waitFor(() => expect(screen.getByTestId('guillotine-rules-saved')).toBeTruthy())
    // One request, and only the roster changes: nothing else on the page was touched.
    expect(patches).toHaveLength(1)
    expect(patches[0]).toEqual({ rosterSchedule: [{ id: expect.stringMatching(/^rc_[a-z0-9]+$/), week: 4, kind: 'add_starter', slot: 'FLEX', count: 1 }] })
    expect(save().disabled).toBe(true)
  })

  it('"week 10, the SF position gets added plus 1 bench spot"', async () => {
    const { patches } = mount(view())
    await ready()
    add()
    set(inRow(0, 'guillotine-roster-week'), 10)
    set(inRow(0, 'guillotine-roster-slot'), 'SUPERFLEX')
    add()
    set(inRow(1, 'guillotine-roster-week'), 10)
    set(inRow(1, 'guillotine-roster-kind'), 'add_bench')
    // A bench change has no spot to pick.
    expect(inRow(1, 'guillotine-roster-slot')).toBeNull()
    expect(result()).toBe('From week 10: 10 starters, 7 bench.')
    fireEvent.click(save())
    await waitFor(() => expect(patches).toHaveLength(1))
    expect(patches[0]!.rosterSchedule).toEqual([
      expect.objectContaining({ week: 10, kind: 'add_starter', slot: 'SUPERFLEX', count: 1 }),
      expect.objectContaining({ week: 10, kind: 'add_bench', slot: null, count: 1 }),
    ])
  })

  it('"week 11 a bench spot turns into a starting spot": the roster stays the same size', async () => {
    mount(view())
    await ready()
    add()
    set(inRow(0, 'guillotine-roster-week'), 11)
    set(inRow(0, 'guillotine-roster-kind'), 'bench_to_starter')
    set(inRow(0, 'guillotine-roster-slot'), 'WR')
    expect(result()).toBe('From week 11: 10 starters, 5 bench.')
  })

  it('"week 7 a starter is taken away": one fewer starter, one more bench spot, and the page says who moves', async () => {
    const { patches } = mount(view())
    await ready()
    add()
    set(inRow(0, 'guillotine-roster-week'), 7)
    set(inRow(0, 'guillotine-roster-kind'), 'starter_to_bench')
    expect(inRow(0, 'guillotine-roster-slot').value).toBe('FLEX')
    expect(result()).toBe('From week 7: 8 starters, 7 bench.')
    expect(screen.getByTestId('guillotine-group-roster').textContent).toContain('the player in it moves to the bench between weeks')
    fireEvent.click(save())
    await waitFor(() => expect(patches).toHaveLength(1))
    expect(patches[0]!.rosterSchedule).toEqual([expect.objectContaining({ week: 7, kind: 'starter_to_bench', slot: 'FLEX', count: 1 })])
  })

  it('taking away a spot the league does not have is said on the page', async () => {
    mount(view())
    await ready()
    add()
    set(inRow(0, 'guillotine-roster-kind'), 'starter_to_bench')
    set(inRow(0, 'guillotine-roster-slot'), 'SUPERFLEX')
    expect(screen.getByRole('alert').textContent).toBe('Week 4: the league has no Super Flex (QB/WR/RB/TE) starting spot to take away.')
    expect(save().disabled).toBe(true)
  })

  it('says what each week leaves, in week order, whatever order the rows are in', async () => {
    mount(view())
    await ready()
    add()
    set(inRow(0, 'guillotine-roster-week'), 12)
    set(inRow(0, 'guillotine-roster-kind'), 'add_bench')
    add()
    set(inRow(1, 'guillotine-roster-week'), 6)
    expect([...screen.getByTestId('guillotine-roster-result').querySelectorAll('li')].map((li) => li.textContent)).toEqual([
      'From week 6: 10 starters, 6 bench.',
      'From week 12: 10 starters, 7 bench.',
    ])
  })

  it('a change the roster cannot take is said on the page, and Save waits for it to be fixed', async () => {
    mount(view())
    await ready()
    add()
    set(inRow(0, 'guillotine-roster-slot'), 'SUPERFLEX')
    set(inRow(0, 'guillotine-roster-count'), 3)
    expect(screen.getByRole('alert').textContent).toBe('Week 4: a league can have at most 2 Super Flex (QB/WR/RB/TE) spots, and this would make 3.')
    expect(save().disabled).toBe(true)
    set(inRow(0, 'guillotine-roster-count'), 2)
    expect(result()).toBe('From week 4: 11 starters, 6 bench.')
    expect(save().disabled).toBe(false)
  })

  it('removing the last change sends an empty list', async () => {
    const stored: RosterChange = { id: 'kept', week: 9, kind: 'add_bench', slot: null, count: 2 }
    const { patches } = mount(view({ roster: roster({ changes: [stored] }) }))
    await ready()
    expect(rows()).toHaveLength(1)
    expect(result()).toBe('From week 9: 9 starters, 8 bench.')
    fireEvent.click(screen.getByTestId('guillotine-roster-remove'))
    fireEvent.click(save())
    await waitFor(() => expect(patches).toEqual([{ rosterSchedule: [] }]))
  })
})

describe('what a commissioner cannot do', () => {
  it('a change that has run is shown as done, cannot be edited, and is not sent back', async () => {
    const ran: RosterChange = { id: 'ran', week: 3, kind: 'add_starter', slot: 'FLEX', count: 1 }
    const { patches } = mount(view({ roster: roster({ changes: [ran], done: ['ran'], layout: { ...LAYOUT, FLEX: 2 } }) }))
    await ready()
    expect(screen.getByTestId('guillotine-roster-done-ran').textContent).toBe('Week 3: Add 1 Flex starting spot. Done.')
    expect(rows()).toHaveLength(0)
    expect(screen.getByTestId('guillotine-roster-now').textContent).toBe('Right now every team has 10 starters, 6 bench.')
    add()
    fireEvent.click(save())
    await waitFor(() => expect(patches).toHaveLength(1))
    expect((patches[0]!.rosterSchedule as RosterChange[]).map((c) => c.id)).not.toContain('ran')
  })

  it('a change that could not be made when its week came is not called done', async () => {
    const missed: RosterChange = { id: 'missed', week: 3, kind: 'bench_to_starter', slot: 'WR', count: 1 }
    mount(view({ roster: roster({ changes: [missed], done: ['missed'], skipped: [{ id: 'missed', reason: 'the league has 0 bench spots, so 1 cannot become a starter.' }] }) }))
    await ready()
    expect(screen.getByTestId('guillotine-roster-done-missed').textContent).toBe(
      'Week 3: Turn 1 bench spot into a Wide Receiver starting spot. Not made: the league has 0 bench spots, so 1 cannot become a starter.',
    )
  })

  it('without AF Commissioner the controls are locked, but a stored change can still be removed', async () => {
    const stored: RosterChange = { id: 'kept', week: 9, kind: 'add_bench', slot: null, count: 1 }
    const { patches } = mount(view({ canEditPaid: false, roster: roster({ changes: [stored] }) }))
    await ready()
    expect((screen.getByTestId('guillotine-roster-add') as HTMLButtonElement).disabled).toBe(true)
    expect(inRow(0, 'guillotine-roster-week').disabled).toBe(true)
    expect(inRow(0, 'guillotine-roster-kind').disabled).toBe(true)
    const remove = screen.getByTestId('guillotine-roster-remove') as HTMLButtonElement
    expect(remove.disabled).toBe(false)
    fireEvent.click(remove)
    fireEvent.click(save())
    await waitFor(() => expect(patches).toEqual([{ rosterSchedule: [] }]))
  })

  it('in the last week of the season there is nothing to schedule, and the page says so', async () => {
    mount(view({ roster: roster({ fromWeek: 18, toWeek: 17 }) }))
    await ready()
    expect(screen.getByTestId('guillotine-roster-closed').textContent).toMatch(/last week/)
    expect(screen.queryByTestId('guillotine-roster-add')).toBeNull()
  })

  it("the server's refusal is shown, with what was saved before it", async () => {
    const { patches } = mount(view(), (body) => ('rosterSchedule' in body ? { status: 402, body: { error: 'Scheduled roster changes are part of AF Commissioner.', code: 'not_entitled' } } : null))
    await ready()
    fireEvent.change(screen.getByTestId('guillotine-rules-danger-margin'), { target: { value: '15' } })
    add()
    fireEvent.click(save())
    await waitFor(() => expect(screen.getByTestId('guillotine-rules-error')).toBeTruthy())
    expect(screen.getByTestId('guillotine-rules-error').textContent).toBe('Saved: league rules. Not saved (roster changes): Scheduled roster changes are part of AF Commissioner.')
    // The rules went first; the roster changes are still on the page to try again.
    expect(patches.map((p) => Object.keys(p)[0])).toEqual(['rules', 'rosterSchedule'])
    expect(rows()).toHaveLength(1)
    expect(save().disabled).toBe(false)
  })
})
