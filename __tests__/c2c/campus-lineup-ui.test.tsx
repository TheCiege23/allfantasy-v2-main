/**
 * The C2C campus lineup panel on the Team tab: the view the roster API sends, the start / sit buttons
 * and which are blocked, the save it makes, and its Spanish.
 */
import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

const lang = vi.hoisted(() => ({ language: 'en' as 'en' | 'es' }))
vi.mock('@/components/i18n/LanguageProviderClient', () => ({ useLanguage: () => ({ language: lang.language }) }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/merged-devy-c2c/C2CLeagueConfig', () => ({
  getC2CConfig: vi.fn(async () => ({ collegeActiveLineupSlots: { QB: 1, FLEX: 1 } })),
}))

import { CampusLineupPanel } from '@/app/league/[leagueId]/components/CampusLineupPanel'
import { campusToggles } from '@/lib/c2c/campusLineup'
import { loadCampusLineupView, type CampusLineupView } from '@/lib/c2c/campusLineupView'
import { CAMPUS_COPY, campusCopy } from '@/lib/i18n/c2c-campus-copy'

const VIEW: CampusLineupView = {
  seats: ['QB', 'FLEX'],
  starterIds: ['qb1'],
  players: [
    { id: 'qb1', name: 'Campus QB', position: 'QB', team: 'Vanderbilt' },
    { id: 'qb2', name: 'Backup QB', position: 'QB', team: 'Ohio State' },
    { id: 'wr1', name: 'Campus WR', position: 'WR', team: 'LSU' },
  ],
  cfbWeeks: [5],
  nflWeek: 4,
}

describe('campusToggles', () => {
  it('a starter can sit; a player with an open seat he fits can start; one without cannot', () => {
    const t = campusToggles(VIEW.seats, VIEW.starterIds, VIEW.players)
    expect(t).toEqual([
      { playerId: 'qb1', onCampus: true, canStart: true },
      { playerId: 'qb2', onCampus: false, canStart: false }, // FLEX takes no QB
      { playerId: 'wr1', onCampus: false, canStart: true },
    ])
  })

  it('a full campus lineup blocks every bench player', () => {
    const t = campusToggles(VIEW.seats, ['qb1', 'wr1'], VIEW.players)
    expect(t.filter((x) => !x.onCampus).every((x) => !x.canStart)).toBe(true)
  })
})

describe('CampusLineupPanel', () => {
  it('starting a player saves the new campus list', () => {
    lang.language = 'en'
    const onChange = vi.fn()
    render(<CampusLineupPanel view={VIEW} editable saving={false} onChange={onChange} />)
    expect(screen.getByText(/1 of 2 campus spots filled/)).toBeTruthy()
    expect(screen.getByText('Counts college week 5 (NFL week 4).')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Start Campus WR' }))
    expect(onChange).toHaveBeenCalledWith(['qb1', 'wr1'])
    fireEvent.click(screen.getByRole('button', { name: 'Sit Campus QB' }))
    expect(onChange).toHaveBeenLastCalledWith([])
  })

  it('a player with no open seat cannot be started, and says why', () => {
    lang.language = 'en'
    const onChange = vi.fn()
    render(<CampusLineupPanel view={VIEW} editable saving={false} onChange={onChange} />)
    const blocked = screen.getByRole('button', { name: 'Start Backup QB' }) as HTMLButtonElement
    expect(blocked.disabled).toBe(true)
    expect(screen.getByText('No open campus spot for a QB')).toBeTruthy()
  })

  it('a locked lineup cannot change', () => {
    lang.language = 'en'
    const onChange = vi.fn()
    render(<CampusLineupPanel view={VIEW} editable={false} saving={false} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'Start Campus WR' }))
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByText('Lineups are locked right now.')).toBeTruthy()
  })

  it('after the college season it says campus starters score 0', () => {
    lang.language = 'en'
    render(<CampusLineupPanel view={{ ...VIEW, cfbWeeks: [] }} editable saving={false} onChange={vi.fn()} />)
    expect(screen.getByText(/campus starters score 0/)).toBeTruthy()
  })

  it('Ask Chimmy sends the campus spots and college players', () => {
    lang.language = 'en'
    const onAskChimmy = vi.fn()
    render(<CampusLineupPanel view={VIEW} editable saving={false} onChange={vi.fn()} onAskChimmy={onAskChimmy} />)
    fireEvent.click(screen.getByRole('button', { name: /Ask Chimmy/ }))
    expect(onAskChimmy.mock.calls[0][0]).toContain('QB, FLEX')
    expect(onAskChimmy.mock.calls[0][0]).toContain('Campus WR (WR)')
  })

  it('reads in Spanish', () => {
    lang.language = 'es'
    render(<CampusLineupPanel view={VIEW} editable saving={false} onChange={vi.fn()} />)
    expect(screen.getByText('Alineación universitaria')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Alinear Campus WR' })).toBeTruthy()
    expect(screen.getByText(/1 de 2 puestos universitarios ocupados/)).toBeTruthy()
  })
})

describe('campus copy', () => {
  const placeholders = (s: string) => [...s.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort()
  it('every string has English and Spanish with the same placeholders, and the Spanish never says waiver', () => {
    for (const [key, v] of Object.entries(CAMPUS_COPY)) {
      expect(v.en, key).toBeTruthy()
      expect(v.es, key).toBeTruthy()
      expect(placeholders(v.es), key).toEqual(placeholders(v.en))
      expect(v.es.toLowerCase(), key).not.toMatch(/waiver/)
    }
    expect(campusCopy('en', 'filled', { n: 1, total: 3 })).toBe('1 of 3 campus spots filled')
  })
})

describe('loadCampusLineupView', () => {
  const db = {
    redraftRosterPlayer: {
      findMany: vi.fn(async () => [
        { playerId: 'qb1', playerName: 'Campus QB', position: 'QB', team: 'Vanderbilt' },
        { playerId: 'p1', playerName: 'Pro WR', position: 'WR', team: 'KC' },
      ]),
    },
    redraftRoster: { findUnique: vi.fn(async () => ({ season: { season: 2026, currentWeek: 1 } })) },
    sportsGame: {
      findMany: vi.fn(async ({ where }: { where: { sport: unknown } }) =>
        where.sport === 'NCAAF' ? [{ week: 2, startTime: '2026-09-12T16:00:00Z' }] : [{ week: 1, startTime: '2026-09-11T00:20:00Z' }],
      ),
    },
  }
  const league = { id: 'L1', platform: 'af', sport: 'NFL', leagueVariant: 'c2c' }
  const playerData = { lineup_sections: { starters: [{ id: 'p1' }], devy: [{ id: 'qb1' }], campus: ['qb1', 'gone'] } }

  it('a native football C2C team gets its seats, college players, campus starters and this week’s college weeks', async () => {
    expect(await loadCampusLineupView(db as never, { league, playerData, redraftRosterId: 'R1' })).toEqual({
      seats: ['QB', 'FLEX'],
      starterIds: ['qb1'],
      players: [{ id: 'qb1', name: 'Campus QB', position: 'QB', team: 'Vanderbilt' }],
      cfbWeeks: [2],
      nflWeek: 1,
    })
  })

  it('null for every other league', async () => {
    for (const over of [{ leagueVariant: 'devy_dynasty' }, { sport: 'NBA' }, { platform: 'sleeper' }]) {
      expect(await loadCampusLineupView(db as never, { league: { ...league, ...over }, playerData, redraftRosterId: 'R1' })).toBeNull()
    }
    expect(await loadCampusLineupView(db as never, { league, playerData, redraftRosterId: null })).toBeNull()
  })
})
