/**
 * Campus to Canton after the 2026-11-23 audit: players show this week's points (no permanent "Yds —" placeholders),
 * cards stop repeating their section, the matchup lines up slot by slot, the Campus/Canton views filter, picks are
 * listed once, desktop uses its width, the screens follow light mode, and the footer stops printing a season id.
 */
import React from 'react'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'

const db = vi.hoisted(() => ({
  c2CPlayerState: { findMany: vi.fn() },
  playerWeeklyScore: { findMany: vi.fn() },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db, default: db }))
vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => ({ user: { id: 'u1' } })) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/league/league-access', () => ({ assertLeagueMember: vi.fn(async () => ({ ok: true })) }))
vi.mock('@/lib/c2c/rosterEngine', () => ({ movePlayer: vi.fn() }))
vi.mock('next/link', () => ({ default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => <a href={href} {...rest}>{children}</a> }))
vi.mock('@/hooks/useAfSubGate', () => ({ useAfSubGate: () => ({ handleApiResponse: async () => true }) }))

import { HARNESS_API, HARNESS_USER_ID } from '@/app/e2e/c2c/fixtures'
import { C2CRosterClient } from '@/app/c2c/[leagueId]/roster/C2CRosterClient'
import { C2CMatchupClient } from '@/app/c2c/[leagueId]/matchup/C2CMatchupClient'
import { C2CPicksClient } from '@/app/c2c/[leagueId]/picks/C2CPicksClient'
import { C2CCampusPlayerCard } from '@/app/c2c/components/C2CCampusPlayerCard'
import { C2CCantonPlayerCard } from '@/app/c2c/components/C2CCantonPlayerCard'

const read = (p: string) => readFileSync(path.join(process.cwd(), p), 'utf8')

/** Answers the screens' reads from the harness fixtures, like scripts/e2e-harness-capture.mjs. */
function serveFixtures() {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const u = new URL(String(input), 'http://localhost')
    const hit = HARNESS_API.find((r) => r.path === u.pathname && Object.entries(r.query ?? {}).every(([k, v]) => u.searchParams.get(k) === v))
    return new Response(JSON.stringify(hit ? hit.body : { error: 'unfed' }), { status: hit ? 200 : 503 })
  }))
}

beforeEach(() => serveFixtures())
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('player points', () => {
  it('the roster route returns this week’s stored points per player when asked for a week', async () => {
    db.c2CPlayerState.findMany.mockResolvedValue([
      { playerId: 'n1', sport: 'NFL', bucketState: 'canton_starter' },
      { playerId: 'c1', sport: 'NCAAF', bucketState: 'campus_starter' },
    ])
    db.playerWeeklyScore.findMany.mockResolvedValue([{ playerId: 'n1', sport: 'NFL', fantasyPts: 24.6 }])
    const { GET } = await import('@/app/api/c2c/roster/route')
    const { NextRequest } = await import('next/server')
    const res = await GET(new NextRequest('http://x/api/c2c/roster?leagueId=L&rosterId=R&week=10&season=2026'))
    const body = await res.json()
    expect(body.points).toEqual({ n1: 24.6 })
    expect(db.playerWeeklyScore.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ week: 10, season: 2026 }) }))
  })

  it('a card shows its points, and never the placeholder stat chips', () => {
    const player = { playerId: 'n1', playerName: 'Jayden Daniels', position: 'QB', playerSide: 'canton', playerType: 'pro', bucketState: 'canton_starter', scoringEligibility: 'starter', nflNbaTeam: 'WAS' }
    render(<C2CCantonPlayerCard player={player} pointsThisWeek={24.6} />)
    expect(screen.getByText('24.6')).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/Yds —|TDs —|Recs —/)
  })
})

describe('cards say what the section does not', () => {
  const campus = { playerId: 'c1', playerName: 'Arch Manning', position: 'QB', playerSide: 'campus', playerType: 'college', bucketState: 'campus_starter', scoringEligibility: 'starter', school: 'Texas', classYear: 'JR' }
  it('a starter card has no side badge, no "Counts" and no "STARTER"', () => {
    render(<C2CCampusPlayerCard player={campus} />)
    expect(document.body.textContent).not.toMatch(/Campus|Counts/)
    cleanup()
    render(<C2CCantonPlayerCard player={{ ...campus, playerSide: 'canton', bucketState: 'canton_starter', nflNbaTeam: 'WAS' }} />)
    expect(document.body.textContent).not.toMatch(/STARTER|Counts|Canton/)
  })
  it('in a mixed list (the bench) the side shows once and "Display only" not at all', () => {
    render(<C2CCantonPlayerCard player={{ ...campus, playerSide: 'canton', bucketState: 'bench', nflNbaTeam: 'LAC' }} showSide />)
    expect(document.body.textContent).toMatch(/Canton/)
    expect(document.body.textContent).not.toMatch(/display only|BENCH/i)
  })
})

describe('the roster', () => {
  it('shows points from the fixtures, a plain slot label, and no season id in the footer', async () => {
    render(<C2CRosterClient leagueId="e2e-c2c" userId={HARNESS_USER_ID} />)
    const canton = await screen.findByTestId('c2c-canton-section')
    expect(within(canton).getByText('24.6')).toBeTruthy()
    expect(within(canton).queryByText(/QB · QB/)).toBeNull()
    expect(document.body.textContent).not.toMatch(/e2e-c2c-…|e2e-c2c-s/)
  })
  it('the Campus view lists only campus players (no Canton bench, taxi or IR)', async () => {
    render(<C2CRosterClient leagueId="e2e-c2c" userId={HARNESS_USER_ID} initialViewMode="campus" />)
    await screen.findByTestId('c2c-campus-section')
    expect(screen.queryByText('Ladd McConkey')).toBeNull()
    expect(screen.queryByText('Travis Hunter')).toBeNull()
    expect(screen.queryByText('Christian McCaffrey')).toBeNull()
    expect(screen.getByText('Dylan Raiola')).toBeTruthy()
  })
})

describe('the matchup', () => {
  it('lines the two teams up slot by slot, with no engine footnote or second back link', async () => {
    render(<C2CMatchupClient leagueId="e2e-c2c" userId={HARNESS_USER_ID} />)
    const lines = await screen.findAllByTestId(/^c2c-matchup-line-/)
    expect(lines.length).toBe(16)
    expect(within(lines[8]).getByText('Jayden Daniels')).toBeTruthy()
    expect(within(lines[8]).getByText('Josh Allen')).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/league engine|Back to league/)
  })
})

describe('picks', () => {
  it('each pick once: no second table, no dead Trade button, no second back link', async () => {
    render(<C2CPicksClient leagueId="e2e-c2c" rosterId="ro-me" />)
    await waitFor(() => expect(screen.getAllByTestId(/^c2c-pick-row-/).length).toBe(12))
    expect(document.body.textContent).not.toMatch(/Team × Round|League hub/)
    expect(screen.queryByRole('button', { name: 'Trade' })).toBeNull()
  })
})

describe('frame, width and light mode', () => {
  const files = [
    'app/c2c/[leagueId]/roster/C2CRosterClient.tsx', 'app/c2c/[leagueId]/matchup/C2CMatchupClient.tsx',
    'app/c2c/[leagueId]/picks/C2CPicksClient.tsx', 'app/c2c/components/C2CPicksBoard.tsx',
    'app/c2c/components/C2CCampusPlayerCard.tsx', 'app/c2c/components/C2CCantonPlayerCard.tsx',
    'app/c2c/components/C2CScoreSummaryBar.tsx', 'app/c2c/components/C2CPageFrame.tsx',
  ]
  it('the screens use the app’s colour tokens, not white-on-dark classes', () => {
    for (const f of files) expect(read(f), f).not.toMatch(/\btext-white\b|text-white\/|bg-\[#0/)
    expect(read('app/c2c/[leagueId]/layout.tsx')).toMatch(/af-core/)
    expect(read('app/c2c/[leagueId]/layout.tsx')).not.toMatch(/className="af-draft-dark"/)
  })
  it('one page frame for all five screens, wider than 768px on desktop', () => {
    expect(read('app/c2c/components/C2CPageFrame.tsx')).toMatch(/max-w-6xl/)
    for (const s of ['roster', 'campus', 'canton', 'matchup', 'picks']) expect(read(`app/c2c/[leagueId]/${s}/page.tsx`)).toMatch(/C2CPageFrame/)
  })
})
