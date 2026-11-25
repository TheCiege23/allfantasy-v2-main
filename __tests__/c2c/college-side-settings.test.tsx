// @vitest-environment jsdom
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { planCollegeSidePatch, readCollegeSideSettings } from '@/lib/c2c/campusSeason/collegeSideSettings'
import { collegeStartWeek } from '@/lib/c2c/campusSeason/runCampusSeason'
import { CollegeSideSettingsForm } from '@/components/c2c/CollegeSideSettingsPanel'

afterEach(cleanup)

describe('readCollegeSideSettings', () => {
  it('a devy league with nothing set: scoring off, default seats, Cream Bowl season shape', () => {
    expect(readCollegeSideSettings({}, 'devy')).toEqual({ kind: 'devy', collegeScoring: false, lineupSlots: { QB: 1, RB: 1, WR: 2, TE: 1, FLEX: 1 }, regularSeasonWeeks: 10, playoffTeams: 6 })
  })
  it('a C2C league always scores and edits its seats elsewhere', () => {
    expect(readCollegeSideSettings({ c2c_college_regular_weeks: 8 }, 'c2c')).toMatchObject({ collegeScoring: true, lineupSlots: null, regularSeasonWeeks: 8 })
  })
})

describe('planCollegeSidePatch', () => {
  const plan = (patch: Record<string, unknown>, over: Partial<{ kind: 'c2c' | 'devy'; seasonCreated: boolean; teamCount: number }> = {}) =>
    planCollegeSidePatch({ kind: 'devy', teamCount: 12, seasonCreated: false, patch, ...over })

  it('turns devy college scoring on, any time', () => {
    expect(plan({ collegeScoring: true }, { seasonCreated: true })).toEqual({ ok: true, settingsPatch: { devy_college_scoring: true } })
  })
  it('a C2C league cannot turn college scoring off', () => {
    expect(plan({ collegeScoring: false }, { kind: 'c2c' })).toMatchObject({ ok: false, status: 400 })
  })
  it('validates the devy seats', () => {
    expect(plan({ lineupSlots: { qb: 1, wr: 3, flex: 0 } })).toEqual({ ok: true, settingsPatch: { devy_college_lineup_slots: { QB: 1, WR: 3 } } })
    expect(plan({ lineupSlots: { K: 1 } })).toMatchObject({ ok: false, field: 'lineupSlots' })
    expect(plan({ lineupSlots: { QB: 9 } })).toMatchObject({ ok: false })
    expect(plan({ lineupSlots: { QB: 0 } })).toMatchObject({ ok: false })
  })
  it('season length and playoff size change only before the college schedule is set', () => {
    expect(plan({ regularSeasonWeeks: 9, playoffTeams: 4 })).toEqual({ ok: true, settingsPatch: { c2c_college_regular_weeks: 9, c2c_college_playoff_teams: 4 } })
    expect(plan({ regularSeasonWeeks: 9 }, { seasonCreated: true })).toMatchObject({ ok: false, status: 409 })
  })
  it('playoff teams: none, or 2 up to the league size', () => {
    expect(plan({ playoffTeams: 0 })).toMatchObject({ ok: true })
    expect(plan({ playoffTeams: 1 })).toMatchObject({ ok: false })
    expect(plan({ playoffTeams: 13 })).toMatchObject({ ok: false })
    expect(plan({ regularSeasonWeeks: 15 })).toMatchObject({ ok: false })
  })
})

describe('collegeStartWeek', () => {
  const week = (w: number, day: number) => [w, { week: w, firstStart: day, lastStart: day + 1 }] as const
  const weeks = new Map([week(0, 0), week(1, 10), week(2, 20), week(3, 30)])
  it('before the season: week 1; after week 2 kicked off: week 3', () => {
    expect(collegeStartWeek(weeks, 5)).toBe(1)
    expect(collegeStartWeek(weeks, 21)).toBe(3)
    expect(collegeStartWeek(new Map(), 999)).toBe(1)
  })
})

describe('CollegeSideSettingsForm', () => {
  const state = (over: Partial<{ collegeScoring: boolean; seasonCreated: boolean }> = {}) => ({
    settings: { kind: 'devy' as const, collegeScoring: over.collegeScoring ?? true, lineupSlots: { QB: 1, RB: 1, WR: 2, TE: 1, FLEX: 1 }, regularSeasonWeeks: 10, playoffTeams: 6 },
    seasonCreated: over.seasonCreated ?? false,
    teamCount: 12,
  })

  it('turning devy college scoring off saves it', async () => {
    const onSave = vi.fn(async () => null)
    render(<CollegeSideSettingsForm state={state()} canEdit onSave={onSave} />)
    fireEvent.click(screen.getByLabelText('College players score'))
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ collegeScoring: false }))
    expect(await screen.findByText('Saved.')).toBeTruthy()
  })

  it('saves the college lineup and the season', async () => {
    const onSave = vi.fn(async () => null)
    render(<CollegeSideSettingsForm state={state()} canEdit onSave={onSave} />)
    fireEvent.change(screen.getByLabelText('WR starters'), { target: { value: '3' } })
    fireEvent.click(screen.getByText('Save college lineup'))
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ lineupSlots: { QB: 1, RB: 1, WR: 3, TE: 1, FLEX: 1 } }))
    fireEvent.change(screen.getByLabelText('College playoff teams'), { target: { value: '4' } })
    fireEvent.click(screen.getByText('Save college season'))
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ regularSeasonWeeks: 10, playoffTeams: 4 }))
  })

  it('once the schedule is set, the season shape is read-only and says when it applies', () => {
    render(<CollegeSideSettingsForm state={state({ seasonCreated: true })} canEdit onSave={vi.fn()} />)
    expect(screen.queryByText('Save college season')).toBeNull()
    expect(screen.getByText(/apply from next season/)).toBeTruthy()
  })

  it('shows a refusal from the server', async () => {
    render(<CollegeSideSettingsForm state={state()} canEdit onSave={vi.fn(async () => 'College playoff teams: none, or 2 to 12.')} />)
    fireEvent.click(screen.getByText('Save college season'))
    expect(await screen.findByText(/none, or 2 to 12/)).toBeTruthy()
  })

  it('a stash-only devy league shows only the switch; a member who cannot edit cannot change it', () => {
    render(<CollegeSideSettingsForm state={state({ collegeScoring: false })} canEdit={false} onSave={vi.fn()} />)
    expect((screen.getByLabelText('College players score') as HTMLInputElement).disabled).toBe(true)
    expect(screen.queryByText('College season')).toBeNull()
  })
})
