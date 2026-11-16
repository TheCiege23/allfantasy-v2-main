/**
 * Room v2 league-type accents (2026-11): every league concept gets its own accent color, a chip
 * naming the type in the header, a stripe under the header, and the on-the-clock tile in that
 * color. Redraft keeps the room's cyan.
 */
import React from 'react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/image', () => ({
  default: (props: Record<string, unknown>) => <img alt={String(props.alt ?? '')} src={String(props.src ?? '')} />,
}))
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}))

import { LEAGUE_CONCEPT_OPTIONS } from '@/lib/league/leagueConceptOptions'
import { leagueAccentColor, leagueAccentFor, normalizeLeagueConcept } from '@/lib/draft-room/leagueAccent'
import { DraftRoomShell } from '@/components/app/draft-room/DraftRoomShell'
import { DraftTopBar } from '@/components/app/draft-room/DraftTopBar'
import { LanguageFallbackBoundary } from '@/components/i18n/LanguageProviderClient'

beforeEach(() => {
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('which league type a room is', () => {
  it('reads League.leagueType in any spelling the database has used', () => {
    expect(normalizeLeagueConcept('best_ball')).toBe('best_ball')
    expect(normalizeLeagueConcept('best-ball')).toBe('best_ball')
    expect(normalizeLeagueConcept('Best Ball')).toBe('best_ball')
    expect(normalizeLeagueConcept('bestball')).toBe('best_ball')
    expect(normalizeLeagueConcept('Guilly')).toBe('guillotine')
    expect(normalizeLeagueConcept('survivor-guilly')).toBe('survivor_guillotine')
    expect(normalizeLeagueConcept('Salary Cap')).toBe('salary_cap')
    expect(normalizeLeagueConcept('campus-to-canton')).toBe('c2c')
    expect(normalizeLeagueConcept('BIG_BROTHER')).toBe('big_brother')
  })

  it('an empty or unknown type falls back to dynasty for a dynasty league, redraft otherwise', () => {
    expect(normalizeLeagueConcept(null)).toBe('redraft')
    expect(normalizeLeagueConcept('', { isDynasty: true })).toBe('dynasty')
    expect(normalizeLeagueConcept('seasonal')).toBe('redraft')
    expect(normalizeLeagueConcept('mystery', { isDynasty: true })).toBe('dynasty')
    // A stored concept wins over the dynasty flag.
    expect(normalizeLeagueConcept('devy', { isDynasty: true })).toBe('devy')
  })

  it('every league concept has its own accent, and redraft keeps the room cyan', () => {
    const colors = LEAGUE_CONCEPT_OPTIONS.map((option) => leagueAccentColor(option.id))
    for (const color of colors) expect(color).toMatch(/^#[0-9a-f]{6}$/)
    expect(new Set(colors).size).toBe(colors.length)
    expect(leagueAccentColor('redraft')).toBe('#22d3ee')
    expect(leagueAccentFor('dynasty').label).toBe('Dynasty')
  })
})

describe('the accent in the room', () => {
  const slots = {
    topBar: <div>top</div>, managerStrip: null, draftBoard: <div>board</div>, playerPanel: <div />, queuePanel: <div />,
    chatPanel: <div />, mobileTab: 'board' as const, onMobileTabChange: () => {},
  }

  it('the shell sets --af-league-accent and draws a stripe under the header', () => {
    render(<LanguageFallbackBoundary><DraftRoomShell {...slots} leagueAccent={leagueAccentFor('guillotine')} /></LanguageFallbackBoundary>)
    const shell = screen.getByTestId('draft-room-shell')
    expect(shell.style.getPropertyValue('--af-league-accent')).toBe('#f87171')
    expect(shell.getAttribute('data-league-type')).toBe('guillotine')
    expect(screen.getByTestId('draft-league-accent-strip')).toBeTruthy()
  })

  it('without an accent the room is unchanged: no variable, no stripe', () => {
    render(<LanguageFallbackBoundary><DraftRoomShell {...slots} /></LanguageFallbackBoundary>)
    expect(screen.getByTestId('draft-room-shell').style.getPropertyValue('--af-league-accent')).toBe('')
    expect(screen.queryByTestId('draft-league-accent-strip')).toBeNull()
  })

  const bar = {
    leagueName: 'Sunday League', sport: 'NFL', draftType: 'snake', teamCount: 12, rounds: 15,
    currentManagerOnClock: 'Two-Point Try', pickLabel: '3.04', overallPickNumber: 28,
    timerStatus: 'running' as const, timerRemainingSeconds: 40, isCommissioner: false, draftStatus: 'in_progress',
  }

  it('the header names the league type in its accent color', () => {
    render(<LanguageFallbackBoundary><DraftTopBar {...bar} leagueAccent={leagueAccentFor('Big Brother')} /></LanguageFallbackBoundary>)
    const chip = screen.getByTestId('draft-topbar-league-type')
    expect(chip.textContent).toBe('Big Brother')
    expect(chip.getAttribute('data-league-type')).toBe('big_brother')
    expect(chip.style.color).toBe('rgb(232, 121, 249)')
    // From sm up: on a 390px phone the chip ran into the Pause button.
    expect(chip.className).toContain('hidden')
    expect(chip.className).toContain('sm:inline-flex')
  })

  it('no accent, no chip', () => {
    render(<LanguageFallbackBoundary><DraftTopBar {...bar} /></LanguageFallbackBoundary>)
    expect(screen.queryByTestId('draft-topbar-league-type')).toBeNull()
  })

  it('the on-the-clock tile, its label, its pulse and the legend all read the accent, cyan by default', () => {
    const src = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')
    const cell = src('components/app/draft-room/DraftBoardCell.tsx')
    expect(cell).toContain('ring-[color:var(--af-league-accent,#67e8f9)]')
    expect(cell).toContain('text-[color:var(--af-league-accent,#67e8f9)]')
    expect(src('components/app/draft-room/DraftBoard.tsx')).toContain('border-[color:var(--af-league-accent,#67e8f9)]')
    const css = src('app/globals.css')
    const pulse = css.slice(css.indexOf('@keyframes draft-current-pick-pulse'), css.indexOf('@keyframes draft-recent-pick-flash'))
    expect(pulse).toContain('var(--af-league-accent, #22d3ee)')
    expect(pulse).not.toContain('rgba(34, 211, 238')
  })

  it('the live draft route carries the league concept all the way to the room', () => {
    const src = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')
    // The confirmed concept, then the pirate / survivor-guilly variant, then the column (league-signatures).
    expect(src('lib/draft/resolve-draft-context.ts')).toContain('leagueType: draftRoomLeagueConceptRaw(resolvedLeague)')
    expect(src('app/drafts/[draftId]/page.tsx')).toContain('leagueType={context.leagueType}')
    expect(src('components/draft/DraftBoard.tsx')).toContain('leagueType={props.leagueType ?? null}')
    const room = src('components/app/draft-room/DraftRoomPageClient.tsx')
    expect(room).toContain('leagueAccentFor(leagueType, { isDynasty })')
    expect(room).toMatch(/<DraftRoomShell\s+layout="premium"\s+leagueAccent=\{leagueAccent\}/)
    expect(room).toMatch(/<DraftTopBar\s+leagueName=\{leagueName\}\s+leagueAccent=\{leagueAccent\}/)
  })
})
