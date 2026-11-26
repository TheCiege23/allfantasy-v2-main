// @vitest-environment jsdom
/**
 * A college league can draft from a subset of schools (lib/college/conferenceScope.ts): Power 4, Group of 6,
 * FBS only, or the commissioner's conferences. Asked for on 2026-11-25 after a competitor review: picking
 * conferences is the first thing a college fantasy league sets up.
 *
 * The conference names and team counts below are the Rolling Insights rows in production `SportsTeam`.
 */
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({ league: { findUnique: vi.fn() }, sportsTeam: { findMany: vi.fn() } }))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

import {
  collegeScopeSignature,
  collegeSchoolFilter,
  describeCollegeScope,
  parseCollegeScopeInput,
  readCollegeConferenceScope,
} from '@/lib/college/conferenceScope'
import {
  conferenceOfSchool,
  filterPoolByCollegeScope,
  indexCollegeTeamConferences,
  loadLeagueCollegeScope,
} from '@/lib/college/collegeTeamConferences'
import { CollegePlayerPoolView, schoolCount } from '@/components/league-settings/CollegePlayerPoolPanel'
import { collegePlayerPoolMessages } from '@/lib/core-app/messages/collegePlayerPool'

afterEach(cleanup)

const team = (name: string, shortName: string, conference: string) => ({ name, shortName, conference })
const TEAMS = [
  team('University of Alabama', 'ALA', 'Southeastern Conference'),
  team('Ohio State University', 'OSU', 'Big Ten Conference'),
  team('Boise State University', 'BSU', 'Pac-12 Conference'),
  team('Liberty University', 'LIB', 'Conference USA'),
  team('University of Notre Dame', 'ND', 'Independent'),
  team('University of Connecticut', 'CONN', 'Independent'),
  team('East Tennessee State University', 'ETSU', 'Independent'),
  team('Campbell University', 'CAM', 'Coastal Athletic Association'),
]
const index = indexCollegeTeamConferences(TEAMS)
const player = (name: string, school: string | null, code: string | null = null) => ({ full_name: name, team: school, team_abbreviation: code })
const POOL = [
  player('Alabama QB', 'University of Alabama'),
  player('Ohio State WR', 'Ohio State University'),
  player('Boise State RB', 'Boise State University'),
  player('Liberty TE', 'Liberty University'),
  player('Notre Dame QB', 'University of Notre Dame'),
  player('UConn WR', 'University of Connecticut'),
  player('ETSU RB', 'East Tennessee State University'),
  player('Campbell WR', 'Campbell University'),
  player('No school', null),
]
const names = (pool: typeof POOL) => pool.map((p) => p.full_name)

describe('reading the setting', () => {
  it('reads nothing as every school, and only for college leagues', () => {
    expect(readCollegeConferenceScope({}, 'NCAAF')).toBeNull()
    expect(readCollegeConferenceScope({ collegeConferenceScope: { preset: 'all' } }, 'NCAAF')).toBeNull()
    expect(readCollegeConferenceScope({ collegeConferenceScope: { preset: 'power' } }, 'NFL')).toBeNull()
    expect(readCollegeConferenceScope({ collegeConferenceScope: { preset: 'power' } }, 'NCAAF')).toEqual({ preset: 'power', conferences: [] })
  })

  it('never lets a broken setting empty the pool', () => {
    // Basketball has no Group of 6; an empty custom list; junk.
    expect(readCollegeConferenceScope({ collegeConferenceScope: { preset: 'group' } }, 'NCAAB')).toBeNull()
    expect(readCollegeConferenceScope({ collegeConferenceScope: { preset: 'custom', conferences: [] } }, 'NCAAF')).toBeNull()
    expect(readCollegeConferenceScope({ collegeConferenceScope: 'power' }, 'NCAAF')).toBeNull()
    expect(readCollegeConferenceScope(null, 'NCAAF')).toBeNull()
  })

  it('cleans a custom list: trims, drops blanks and repeats, sorts', () => {
    const scope = readCollegeConferenceScope(
      { collegeConferenceScope: { preset: 'custom', conferences: [' Southeastern Conference', 'Big Ten Conference', '', 'Big Ten Conference'] } },
      'NCAAF',
    )
    expect(scope).toEqual({ preset: 'custom', conferences: ['Big Ten Conference', 'Southeastern Conference'] })
  })
})

describe('who is in the pool', () => {
  it('Power 4 takes the four conferences and Notre Dame', () => {
    expect(names(filterPoolByCollegeScope(POOL, 'NCAAF', { preset: 'power', conferences: [] }, index))).toEqual([
      'Alabama QB', 'Ohio State WR', 'Notre Dame QB',
    ])
  })

  it('Group of 6 includes the new Pac-12 and C-USA, and no Power 4 school', () => {
    expect(names(filterPoolByCollegeScope(POOL, 'NCAAF', { preset: 'group', conferences: [] }, index))).toEqual([
      'Boise State RB', 'Liberty TE',
    ])
  })

  it('FBS only takes both independents that are FBS, but not East Tennessee State, which is FCS', () => {
    expect(names(filterPoolByCollegeScope(POOL, 'NCAAF', { preset: 'fbs', conferences: [] }, index))).toEqual([
      'Alabama QB', 'Ohio State WR', 'Boise State RB', 'Liberty TE', 'Notre Dame QB', 'UConn WR',
    ])
  })

  it('a custom list takes exactly the conferences picked', () => {
    const scope = { preset: 'custom' as const, conferences: ['Southeastern Conference', 'Coastal Athletic Association'] }
    expect(names(filterPoolByCollegeScope(POOL, 'NCAAF', scope, index))).toEqual(['Alabama QB', 'Campbell WR'])
  })

  it('leaves out a player whose school cannot be placed', () => {
    const inScope = collegeSchoolFilter('NCAAF', { preset: 'fbs', conferences: [] })
    expect(inScope(conferenceOfSchool(index, null))).toBe(false)
    expect(inScope(conferenceOfSchool(index, 'Some Unknown College'))).toBe(false)
  })

  it('places a school by its code when the row has no full name', () => {
    expect(conferenceOfSchool(index, null, 'ala')).toEqual({ conference: 'Southeastern Conference', name: null })
    expect(conferenceOfSchool(index, 'OSU')).toEqual({ conference: 'Big Ten Conference', name: 'OSU' })
  })

  it('keeps every player when no team conferences are stored, rather than emptying the pool', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const empty = indexCollegeTeamConferences([])
    expect(filterPoolByCollegeScope(POOL, 'NCAAF', { preset: 'power', conferences: [] }, empty)).toHaveLength(POOL.length)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('basketball Power conferences include the Big East', () => {
    const inScope = collegeSchoolFilter('NCAAB', { preset: 'power', conferences: [] })
    expect(inScope({ conference: 'Big East Conference', name: 'University of Connecticut' })).toBe(true)
    expect(inScope({ conference: 'West Coast Conference', name: 'Gonzaga University' })).toBe(false)
  })
})

describe('the league lookup', () => {
  beforeEach(() => db.league.findUnique.mockReset())

  it('reads the league only for a college sport', async () => {
    db.league.findUnique.mockResolvedValue({ settings: { collegeConferenceScope: { preset: 'fbs' } } })
    expect(await loadLeagueCollegeScope('L1', 'NFL')).toBeNull()
    expect(db.league.findUnique).not.toHaveBeenCalled()
    expect(await loadLeagueCollegeScope('L1', 'NCAAF')).toEqual({ sport: 'NCAAF', scope: { preset: 'fbs', conferences: [] } })
  })
})

describe('saving and labels', () => {
  const known = ['Southeastern Conference', 'Big Ten Conference']

  it('accepts a preset, all schools, or a list of known conferences', () => {
    expect(parseCollegeScopeInput('NCAAF', { preset: 'all' }, known)).toEqual({ ok: true, scope: null })
    expect(parseCollegeScopeInput('NCAAF', { preset: 'power' }, known)).toEqual({ ok: true, scope: { preset: 'power', conferences: [] } })
    expect(parseCollegeScopeInput('NCAAF', { preset: 'custom', conferences: known }, known)).toEqual({
      ok: true, scope: { preset: 'custom', conferences: ['Big Ten Conference', 'Southeastern Conference'] },
    })
  })

  it('refuses a preset the sport lacks, an empty list and an unknown conference', () => {
    expect(parseCollegeScopeInput('NCAAB', { preset: 'fbs' }, known)).toMatchObject({ ok: false })
    expect(parseCollegeScopeInput('NCAAF', { preset: 'custom', conferences: [] }, known)).toEqual({ ok: false, error: 'Pick at least one conference.' })
    expect(parseCollegeScopeInput('NCAAF', { preset: 'custom', conferences: ['Made Up Conference'] }, known)).toEqual({
      ok: false, error: 'Unknown conference: Made Up Conference',
    })
  })

  it('names the scope in short words, and keys the draft-pool cache on it', () => {
    expect(describeCollegeScope('NCAAF', null)).toBe('All schools')
    expect(describeCollegeScope('NCAAF', { preset: 'power', conferences: [] })).toBe('Power 4')
    expect(describeCollegeScope('NCAAF', { preset: 'custom', conferences: ['Big Ten Conference', 'Southeastern Conference'] })).toBe('Big Ten + SEC')
    expect(collegeScopeSignature(null)).toBe('all')
    expect(collegeScopeSignature({ preset: 'custom', conferences: ['A', 'B'] })).not.toBe(collegeScopeSignature({ preset: 'custom', conferences: ['A'] }))
  })
})

describe('the settings card', () => {
  const copy = collegePlayerPoolMessages.en
  const conferences = [
    { conference: 'Big Ten Conference', teams: 18 },
    { conference: 'Atlantic Coast Conference', teams: 17 },
    { conference: 'Big 12 Conference', teams: 16 },
    { conference: 'Southeastern Conference', teams: 16 },
    { conference: 'Sun Belt Conference', teams: 14 },
  ]
  const view = (over: Record<string, unknown> = {}) => ({
    sport: 'NCAAF' as const,
    scope: { preset: 'all' as const, conferences: [] as string[] },
    summary: 'All schools',
    conferences,
    isCommissioner: true,
    ...over,
  })

  it('counts schools per choice from the stored team counts', () => {
    expect(schoolCount('NCAAF', 'power', [], conferences)).toBe(18 + 17 + 16 + 16 + 1)
    expect(schoolCount('NCAAF', 'custom', ['Southeastern Conference', 'Big Ten Conference'], conferences)).toBe(34)
    expect(schoolCount('NCAAF', 'all', [], conferences)).toBe(81)
  })

  it('lets the commissioner pick SEC + Big Ten and save exactly that', () => {
    const onSave = vi.fn()
    render(<CollegePlayerPoolView view={view()} copy={copy} onSave={onSave} />)
    expect((screen.getByTestId('college-player-pool-save') as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByTestId('college-player-pool-preset-custom'))
    expect(screen.getByTestId('college-player-pool-custom-count').textContent).toBe('Pick at least one conference.')
    expect((screen.getByTestId('college-player-pool-save') as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByTestId('college-player-pool-conference-Southeastern Conference'))
    fireEvent.click(screen.getByTestId('college-player-pool-conference-Big Ten Conference'))
    expect(screen.getByTestId('college-player-pool-custom-count').textContent).toBe('34 schools')
    fireEvent.click(screen.getByTestId('college-player-pool-save'))
    expect(onSave).toHaveBeenCalledWith({ preset: 'custom', conferences: ['Southeastern Conference', 'Big Ten Conference'] })
  })

  it('shows a manager the rule without letting them change it', () => {
    render(<CollegePlayerPoolView view={view({ isCommissioner: false, scope: { preset: 'power', conferences: [] }, summary: 'Power 4' })} copy={copy} onSave={vi.fn()} />)
    expect(screen.getByTestId('college-player-pool-summary').textContent).toBe('Now: Power 4')
    expect((screen.getByTestId('college-player-pool-preset-power') as HTMLInputElement).checked).toBe(true)
    expect((screen.getByTestId('college-player-pool-preset-fbs') as HTMLInputElement).disabled).toBe(true)
    expect(screen.queryByTestId('college-player-pool-save')).toBeNull()
  })

  it('offers basketball only the presets it has', () => {
    render(<CollegePlayerPoolView view={view({ sport: 'NCAAB' })} copy={copy} onSave={vi.fn()} />)
    expect(screen.getByTestId('college-player-pool-preset-power').closest('label')!.textContent).toContain('ACC, Big East, Big Ten, Big 12 and SEC.')
    expect(screen.queryByTestId('college-player-pool-preset-fbs')).toBeNull()
    expect(screen.queryByTestId('college-player-pool-preset-group')).toBeNull()
  })
})
