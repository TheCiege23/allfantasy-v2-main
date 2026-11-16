/**
 * Room v2 league notes (2026-11): the one rule a league type drafts under, said beside its chip
 * (Guillotine chops, Pirate protections, a salary cap, a tournament's conference and round), and a
 * snake salary-cap board's slot salaries — the SAME number the pick's contract is written with.
 */
import React from 'react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  capConfig: null as null | Record<string, unknown>,
  guillotine: null as null | Record<string, unknown>,
  tournamentRow: null as unknown,
  leagueSettings: {} as unknown,
  leagueSize: 10 as number | null,
  created: [] as Array<Record<string, unknown>>,
}))

vi.mock('next/image', () => ({
  default: (props: Record<string, unknown>) => <img alt={String(props.alt ?? '')} src={String(props.src ?? '')} />,
}))
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: {
      findUnique: vi.fn(async ({ select }: { select: Record<string, unknown> }) =>
        select?.settings ? { settings: h.leagueSettings } : { leagueSize: h.leagueSize },
      ),
    },
    // No custom scale row: the sport default applies.
    $queryRaw: vi.fn(async () => []),
    tournamentLeague: {
      findUnique: vi.fn(async () => {
        if (h.tournamentRow instanceof Error) throw h.tournamentRow
        return h.tournamentRow
      }),
    },
    playerContract: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        h.created.push(data)
        return { id: `c-${h.created.length}` }
      }),
    },
  },
}))
vi.mock('@/lib/salary-cap/SalaryCapLeagueConfig', () => ({ getSalaryCapConfig: vi.fn(async () => h.capConfig) }))
vi.mock('@/lib/guillotine/GuillotineLeagueConfig', () => ({ getGuillotineConfig: vi.fn(async () => h.guillotine) }))

import { assignRookieContract, loadRookieContractTerms } from '@/lib/salary-cap/RookieContractService'
import { getDefaultSnakeSalaryConfig, getSalaryForPick } from '@/lib/salary-cap/SnakeSalaryScaleEngine'
import { loadDraftRoomLeagueFacts } from '@/lib/draft-room/loadDraftRoomLeagueFacts'
import { NO_LEAGUE_FACTS } from '@/lib/draft-room/leagueNote'
import { DraftTopBar } from '@/components/app/draft-room/DraftTopBar'
import { DraftBoard } from '@/components/app/draft-room/DraftBoard'
import { LanguageFallbackBoundary } from '@/components/i18n/LanguageProviderClient'
import { leagueAccentFor } from '@/lib/draft-room/leagueAccent'
import { draftRoomHeaderMessages } from '@/lib/core-app/messages/draftRoomHeader'

const CAP = {
  leagueId: 'L', configId: 'cfg-1', sport: 'NFL', startupCap: 300, minimumSalary: 1, rookieContractYears: 0,
  startupDraftType: 'snake',
}

beforeEach(() => {
  h.capConfig = null
  h.guillotine = null
  h.tournamentRow = null
  h.leagueSettings = {}
  h.leagueSize = 10
  h.created = []
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const src = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

describe('slot salaries are the contract', () => {
  it('termsFor reproduces the old in-line calculation exactly (sport scale, min salary, rookie years)', async () => {
    h.capConfig = { ...CAP, minimumSalary: 2, rookieContractYears: 0 }
    const terms = await loadRookieContractTerms('L')
    const scale = getDefaultSnakeSalaryConfig('NFL', 10, 15)
    for (const slot of [1, 2, 10, 11, 37, 150]) {
      const { salary, contractYears } = getSalaryForPick(slot, scale)
      expect(terms?.termsFor(slot)).toEqual({ salary: Math.max(2, Math.round(salary)), years: contractYears })
    }
    // The league's rookie years win over the scale's, as before.
    // 7 is outside every default scale's range, so this cannot pass by coincidence.
    h.capConfig = { ...CAP, rookieContractYears: 7 }
    expect((await loadRookieContractTerms('L'))?.termsFor(1).years).toBe(7)
    expect((await loadRookieContractTerms('L'))?.termsFor(150).years).toBe(7)
  })

  it('assignRookieContract writes the same salary and years the board shows', async () => {
    h.capConfig = CAP
    const terms = await loadRookieContractTerms('L')
    for (const slot of [1, 7, 33]) await assignRookieContract('L', 'r1', `p${slot}`, 'P', 'RB', slot, 2026)
    expect(h.created.map((d) => [d.salary, d.yearsTotal, d.configId])).toEqual(
      [1, 7, 33].map((slot) => [terms!.termsFor(slot).salary, terms!.termsFor(slot).years, 'cfg-1']),
    )
  })

  it('no cap config, no terms', async () => {
    expect(await loadRookieContractTerms('L')).toBeNull()
    expect(await assignRookieContract('L', 'r1', 'p', 'P', 'RB', 1, 2026)).toEqual({ ok: false, error: 'Not a salary cap league' })
  })
})

describe('what the server reads for each league type', () => {
  const base = { leagueId: 'L', draftType: 'snake', rounds: 3, teamCount: 10 }

  it('guillotine: when chops start and how many', async () => {
    h.guillotine = { eliminationStartWeek: 3, teamsPerChop: 2 }
    expect((await loadDraftRoomLeagueFacts({ ...base, concept: 'guillotine' })).note).toEqual({ kind: 'guillotine', startWeek: 3, perChop: 2 })
    expect((await loadDraftRoomLeagueFacts({ ...base, concept: 'survivor_guillotine' })).note?.kind).toBe('guillotine')
    h.guillotine = null
    expect(await loadDraftRoomLeagueFacts({ ...base, concept: 'guillotine' })).toEqual(NO_LEAGUE_FACTS)
  })

  it('pirate: the protection count from the league settings', async () => {
    h.leagueSettings = { conceptRules: { extensions: { pirate: { protectionLimit: 4 } } } }
    expect((await loadDraftRoomLeagueFacts({ ...base, concept: 'pirate' })).note).toEqual({ kind: 'pirate', protect: 4 })
  })

  it('tournament: conference and round; a failed read is no note, not a broken page', async () => {
    h.tournamentRow = { conference: { name: 'Atlantic' }, round: { roundLabel: 'Round 1' } }
    expect((await loadDraftRoomLeagueFacts({ ...base, concept: 'tournament' })).note).toEqual({ kind: 'tournament', conference: 'Atlantic', round: 'Round 1' })
    h.tournamentRow = new Error('db down')
    expect(await loadDraftRoomLeagueFacts({ ...base, concept: 'tournament' })).toEqual(NO_LEAGUE_FACTS)
  })

  it('salary cap snake: the cap, and every slot on the board priced', async () => {
    h.capConfig = CAP
    const facts = await loadDraftRoomLeagueFacts({ ...base, concept: 'salary_cap' })
    expect(facts.note).toEqual({ kind: 'salary_cap', cap: 300 })
    expect(Object.keys(facts.slotSalaryByOverall ?? {})).toHaveLength(30)
    const terms = await loadRookieContractTerms('L')
    expect(facts.slotSalaryByOverall?.[1]).toEqual(terms?.termsFor(1))
    expect(facts.slotSalaryByOverall?.[30]).toEqual(terms?.termsFor(30))
  })

  it('slot salaries follow submitPick: any snake cap config, never an auction or an auction startup', async () => {
    h.capConfig = CAP
    // A dynasty-concept league with a snake cap config still signs contracts, so it shows them.
    expect((await loadDraftRoomLeagueFacts({ ...base, concept: 'dynasty' })).slotSalaryByOverall?.[1]).toBeTruthy()
    expect((await loadDraftRoomLeagueFacts({ ...base, concept: 'salary_cap', draftType: 'auction' })).slotSalaryByOverall).toBeNull()
    h.capConfig = { ...CAP, startupDraftType: 'auction' }
    expect((await loadDraftRoomLeagueFacts({ ...base, concept: 'salary_cap' })).slotSalaryByOverall).toBeNull()
  })

  it('every other type reads nothing', async () => {
    expect(await loadDraftRoomLeagueFacts({ ...base, concept: 'redraft' })).toEqual(NO_LEAGUE_FACTS)
    expect(await loadDraftRoomLeagueFacts({ ...base, concept: 'big_brother' })).toEqual(NO_LEAGUE_FACTS)
  })

  it('both draft pages load the facts and hand them to the room', () => {
    const page = src('app/drafts/[draftId]/page.tsx')
    expect(page).toContain('loadDraftRoomLeagueFacts({')
    expect(page).toContain('leagueFacts={leagueFacts}')
    const auction = src('app/draft/[draftId]/auction/page.tsx')
    expect(auction).toContain('loadDraftRoomLeagueFacts({')
    expect(auction).toContain('leagueFacts={leagueFacts}')
    const room = src('components/app/draft-room/DraftRoomPageClient.tsx')
    expect(room).toContain('leagueNote={leagueFacts?.note ?? null}')
    expect(room).toContain('slotSalaryByOverall={leagueFacts?.slotSalaryByOverall ?? undefined}')
  })
})

describe('the note beside the league chip', () => {
  const bar = {
    leagueName: 'Sunday League', sport: 'NFL', draftType: 'snake', teamCount: 12, rounds: 15,
    currentManagerOnClock: 'Two-Point Try', pickLabel: '3.04', overallPickNumber: 28,
    timerStatus: 'running' as const, timerRemainingSeconds: 40, isCommissioner: false, draftStatus: 'in_progress',
  }
  const renderBar = (props: Record<string, unknown>) =>
    render(<LanguageFallbackBoundary><DraftTopBar {...bar} {...props} /></LanguageFallbackBoundary>)

  it('says each rule in words', () => {
    renderBar({ leagueAccent: leagueAccentFor('guillotine'), leagueNote: { kind: 'guillotine', startWeek: 3, perChop: 1 } })
    expect(screen.getByTestId('draft-topbar-league-note').textContent).toBe('Chops start Week 3 · 1 team a week')
    cleanup()
    renderBar({ leagueAccent: leagueAccentFor('pirate'), leagueNote: { kind: 'pirate', protect: 3 } })
    expect(screen.getByTestId('draft-topbar-league-note').textContent).toBe('Protect 3 players a week')
    cleanup()
    renderBar({ leagueAccent: leagueAccentFor('salary_cap'), leagueNote: { kind: 'salary_cap', cap: 300 } })
    expect(screen.getByTestId('draft-topbar-league-note').textContent).toBe('$300 cap')
    cleanup()
    renderBar({ leagueAccent: leagueAccentFor('tournament'), leagueNote: { kind: 'tournament', conference: 'Atlantic', round: 'Round 1' } })
    const note = screen.getByTestId('draft-topbar-league-note')
    expect(note.textContent).toBe('Atlantic · Round 1')
    // First on the rules line (md+), whole: beside the chip it truncated mid-word at 1440px.
    expect(note.className).toContain('whitespace-nowrap')
    expect(note.parentElement?.className).toContain('md:flex')
    expect(note.style.color).toBe('rgb(129, 140, 248)')
  })

  it('no note, or no chip to sit beside, draws nothing', () => {
    renderBar({ leagueAccent: leagueAccentFor('redraft') })
    expect(screen.queryByTestId('draft-topbar-league-note')).toBeNull()
    cleanup()
    renderBar({ leagueNote: { kind: 'pirate', protect: 3 } })
    expect(screen.queryByTestId('draft-topbar-league-note')).toBeNull()
  })

  it('Spanish says the same rules', () => {
    const es = draftRoomHeaderMessages.es
    expect(es.noteGuillotine(3, 2)).toBe('Eliminaciones desde la semana 3 · 2 equipos por semana')
    expect(es.notePirate(1)).toBe('Protege 1 jugador por semana')
    expect(es.noteCap(300)).toBe('Tope de $300')
    expect(es.slotSalary(45, 3)).toBe('Salario de $45 por 3 años')
  })
})

describe('the board prices every slot', () => {
  const drafted = {
    id: 'p1', overall: 1, round: 1, slot: 1, rosterId: 'r1', displayName: 'Team 1', playerName: 'Atlas Runner',
    position: 'RB', team: 'NYJ', byeWeek: 9, playerId: 'a1', tradedPickMeta: null, pickLabel: '1.01', createdAt: '',
  } as unknown as Parameters<typeof DraftBoard>[0]['picks'][number]
  const salaries = { 1: { salary: 45, years: 4 }, 2: { salary: 41, years: 4 }, 3: { salary: 38, years: 4 }, 4: { salary: 36, years: 3 }, 5: { salary: 33, years: 3 }, 6: { salary: 31, years: 3 } }
  const renderBoard = (props: Partial<Parameters<typeof DraftBoard>[0]> = {}) =>
    render(
      <DraftBoard
        picks={[drafted]}
        slotOrder={[1, 2, 3].map((slot) => ({ slot, rosterId: `r${slot}`, displayName: `Team ${slot}` }))}
        teamCount={3}
        rounds={2}
        draftType="snake"
        thirdRoundReversal={false}
        {...props}
      />,
    )

  it('an empty slot shows what it costs; a made pick carries its salary on one row', () => {
    renderBoard({ slotSalaryByOverall: salaries, currentOverallPick: 2 })
    const empty = screen.getByTestId('draft-board-cell-slot-salary-3')
    expect(empty.textContent).toBe('$38')
    expect(empty.getAttribute('title')).toBe('Salary $38 for 4 years')
    // The pick on the clock still shows its price, under "On the clock".
    expect(screen.getByTestId('draft-board-cell-slot-salary-2').textContent).toBe('$41')
    const made = screen.getByTestId('draft-board-cell-salary-1')
    expect(made.textContent).toBe('$45')
    expect(screen.getByTestId('draft-board-cell-info-1').className).toContain('flex-nowrap')
    // A made pick does not repeat it as the empty-slot label.
    expect(screen.queryByTestId('draft-board-cell-slot-salary-1')).toBeNull()
  })

  it('a kept player is not a draft-slot contract', () => {
    const lock = { round: 2, slot: 2, overall: 5, rosterId: 'r2', displayName: 'Team 2', playerName: 'Kept Guy', position: 'WR', team: 'GB', playerId: 'k1', isKeeper: true as const }
    renderBoard({ slotSalaryByOverall: salaries, keeperLocks: [lock] })
    expect(screen.queryByTestId('draft-board-cell-salary-5')).toBeNull()
    expect(screen.queryByTestId('draft-board-cell-slot-salary-5')).toBeNull()
  })

  it('no salaries, no prices', () => {
    renderBoard()
    expect(screen.queryAllByTestId(/^draft-board-cell-(slot-)?salary-/)).toHaveLength(0)
  })
})
