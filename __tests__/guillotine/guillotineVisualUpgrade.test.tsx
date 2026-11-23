/**
 * Guillotine after the 2026-11-23 audit: the War Room reads in light mode (no hard-coded hex colours in a
 * className) and in plain words; the phone hero's margin takes its tier's colour; a chopped manager is not
 * offered "Set lineup" on a phone either; the survival table fits a phone; the hub stops repeating its waiver
 * and Chimmy links; and the Chimmy card drops its engine wording.
 */
import React from 'react'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'

vi.mock('next/link', () => ({ default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => <a href={href} {...rest}>{children}</a> }))

const client = vi.hoisted(() => ({
  fetchGuillotineWarRoomState: vi.fn(),
  analyzeGuillotineWarRoomTrade: vi.fn(), askGuillotineWarRoom: vi.fn(), fetchGuillotineDroppedPlayers: vi.fn(),
  fetchGuillotineFaabPlan: vi.fn(), fetchGuillotineLineupSafety: vi.fn(), fetchGuillotineRosterRisk: vi.fn(), fetchGuillotineWaivers: vi.fn(),
}))
vi.mock('@/lib/guillotine-war-room/client', () => client)
vi.mock('@/hooks/useAfSubGate',() => ({ useAfSubGate: () => ({ handleApiResponse: async () => true }) }))
vi.mock('@/components/subscription/FeatureGate', () => ({ FeatureGate: ({ children }: { children: React.ReactNode }) => <>{children}</>, default: ({ children }: { children: React.ReactNode }) => <>{children}</> }))

import { GuillotineWarRoomPanel } from '@/app/league/[leagueId]/tabs/guillotine/GuillotineWarRoomPanel'
import { GuillotineSurvivalHistory } from '@/components/guillotine/GuillotineSurvivalHistory'
import { GuillotineAIPanel } from '@/components/guillotine/GuillotineAIPanel'

const read = (p: string) => readFileSync(path.join(process.cwd(), p), 'utf8')
const classHex = (src: string) => (src.match(/className=(?:"[^"]*"|\{`[^`]*`\}|\{[^}]*\})/g) ?? []).filter((c) => /#[0-9a-fA-F]{3,8}\b/.test(c))

afterEach(() => cleanup())

describe('the Guillotine War Room panel', () => {
  beforeEach(() => {
    client.fetchGuillotineWarRoomState.mockResolvedValue({
      context: {
        sport: 'NFL', currentWeek: 4, activeTeamCount: 9, eliminatedTeamCount: 3,
        guillotine: { tradesEnabled: false, teamsPerChop: 1, dangerMarginPoints: 12 },
        availability: { eliminationLine: 'available', periodScores: 'available', droppedPlayerPool: 'available' },
        standings: [
          { rosterId: 'r1', teamName: 'Gridiron Ghosts', ownerName: 'you', isUserTeam: true, eliminated: false, tier: 'danger', seasonPointsCumul: 376, pointsFromChopZone: 5 },
          { rosterId: 'r2', teamName: 'Taco Tuesday FC', ownerName: 'x', isUserTeam: false, eliminated: true, choppedInPeriod: 3, tier: 'unknown', seasonPointsCumul: 300, pointsFromChopZone: null },
        ],
        teams: [], missingDataFlags: [], featureAvailability: { lineupSafety: true },
      },
      survival: { riskLevel: 'high', safetyMargin: 5.3 },
      weeklyPlan: { headline: 'High elimination risk', steps: [] },
    })
  })

  it('plain words, no AF Legacy or data checkmarks, no trade tool in a league without trades, and asks Chimmy', async () => {
    render(<GuillotineWarRoomPanel leagueId="L1" />)
    const panel = await screen.findByTestId('guillotine-war-room-panel')
    expect(within(panel).getByRole('heading', { level: 2 }).textContent).toBe('Guilly War Room')
    expect(panel.textContent).not.toMatch(/AF Legacy|line ✓|\/period|margin 12|\(P3\)| PF/)
    expect(screen.queryByTestId('guillotine-war-room-tool-trade-analyze')).toBeNull()
    expect(panel.textContent).toMatch(/Ask Chimmy/)
    expect(panel.textContent).toMatch(/chopped in week 3/)
  })

  it('no hard-coded hex colour in a className (the panel was a dark box on a light page)', () => {
    expect(classHex(read('app/league/[leagueId]/tabs/guillotine/GuillotineWarRoomPanel.tsx'))).toEqual([])
    expect(read('app/league/[leagueId]/tabs/guillotine/GuillotineWarRoomPanel.tsx')).not.toMatch(/text-white|bg-white\/|border-white\//)
  })
})

describe('the phone hero', () => {
  const src = () => read('components/guillotine/GuillotineSpecialtyHome.tsx')
  it('colours the margin by tier, not "safe" green for a manager in the danger tier', () => {
    expect(src()).toMatch(/phoneMarginDanger/)
    expect(read('components/guillotine/guillotine-specialty.module.css')).toMatch(/\.phoneMarginDanger\s*\{[^}]*--gl-danger-big/)
  })
  it('offers no "Set lineup" to a chopped manager on a phone either', () => {
    expect(src()).toMatch(/myChopped \? null : \(\s*<Link className=\{`\$\{sp\.btn\}/)
  })
})

describe('the survival table on a phone', () => {
  const history = {
    weeks: [{ week: 1, chopLine: 80, chopped: [{ rosterId: 'b', name: 'Bench Mob', points: 80 }], closestEscape: null, topScorer: null }],
    teams: [
      { rosterId: 'a', name: 'Alpha', status: 'alive', weeksSurvived: 3, closeCalls: 0, bestEscape: 12, path: [{ week: 1, points: 100, margin: 20, chopped: false }] },
      { rosterId: 'b', name: 'Bench Mob', status: 'chopped', choppedWeek: 1, weeksSurvived: 0, closeCalls: 0, bestEscape: null, path: [{ week: 1, points: 80, margin: 0, chopped: true }] },
    ],
  }
  it('says "Alive" once, not "Alive · 3 chops survived" in every row; the path stays on one line; plain caption', () => {
    render(<GuillotineSurvivalHistory history={history as never} closeCallMargin={12} />)
    expect(screen.getByTestId('guillotine-history-team-a').textContent).toContain('Alive')
    expect(screen.getByTestId('guillotine-history-team-a').textContent).not.toMatch(/chops survived/)
    const path = screen.getByLabelText('Alpha, week by week')
    expect(path.className).toMatch(/flex-nowrap/)
    const caption = screen.getByTestId('guillotine-history-teams').querySelector('caption')!
    expect(caption.className).not.toMatch(/uppercase/)
  })
})

describe('the hub says each thing once', () => {
  const src = () => read('components/guillotine/GuillotineHome.tsx')
  it('no second waivers card or "Open Waivers →", no "More research & Chimmy tools →"', () => {
    expect(src()).not.toMatch(/data-testid="guillotine-open-waivers"/)
    expect(src()).not.toMatch(/More research &amp; Chimmy tools/)
    // The release timing moved into Rules & Settings rather than disappearing.
    expect(src()).toMatch(/data-testid="guillotine-release-timing"/)
  })
  it('the escape banner does not repeat the chop card\'s numbers for the same week', () => {
    expect(src()).toMatch(/escapeShownInChop/)
  })
})

describe('the Chimmy card', () => {
  it('no engine wording', async () => {
    vi.stubGlobal('fetch', vi.fn())
    render(<GuillotineAIPanel leagueId="L1" weekOrPeriod={4} deterministicSummary={{ survivalStandings: [], dangerTiers: [], choppedThisWeek: [], recentChopEvents: [] }} />)
    await waitFor(() => expect(screen.getAllByText(/Chimmy/).length).toBeGreaterThan(0))
    const text = document.body.textContent ?? ''
    expect(text).not.toMatch(/Deterministic|league engine|Orphan/)
    vi.unstubAllGlobals()
  })
})
