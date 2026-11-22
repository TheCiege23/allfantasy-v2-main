/**
 * The commissioner's invite rows count rounds from 1 and keep league names readable (2026-11-09, tournament gaps
 * audit item 6). Each row printed the 0-based `roundIndex`, so the first round read "Round 0"; and at 820 the three
 * actions beside the name squeezed "Gridiron South of the Mississippi" onto three lines. The name now keeps a 14rem
 * basis and the actions wrap below it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { TournamentControlDashboard } from '@/components/tournament/TournamentControlDashboard'

vi.mock('next/link', () => ({ default: ({ children, ...props }: any) => <a {...props}>{children}</a> }))
vi.mock('@/hooks/useUserTimezone', () => ({ useUserTimezone: () => ({ formatInTimezone: (d: unknown) => String(d), timezone: 'UTC' }) }))
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const row = (i: number, roundIndex: number, name: string) => ({
  tournamentLeagueId: `tl-${i}`, leagueId: `lg-${i}`, leagueName: name, conferenceName: 'Gridiron Conference', roundIndex,
  phase: 'qualification', inviteCode: `C${i}`, joinUrl: `https://example.test/join/C${i}`, leagueSize: 8, rosterCount: 8, fillStatus: 'full',
})

describe('Tournament invite rows', () => {
  it('count rounds from 1 and let the actions wrap below the name', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ tournamentId: 't1', tournamentName: 'T', leagues: [row(1, 0, 'Gridiron North'), row(2, 1, 'Gridiron South of the Mississippi')] }),
    })))
    render(<TournamentControlDashboard tournamentId="t1" hideLocalBackLink />)
    const first = await screen.findByText('Gridiron North', {}, { timeout: 3000 })
    const meta = (el: HTMLElement) => el.nextElementSibling!.textContent!
    // "Round 1" is followed directly by "Fill" in textContent (a margin separates them on screen), so no \b here.
    expect(meta(first)).toMatch(/Round 1(?!\d)/)
    expect(meta(screen.getByText('Gridiron South of the Mississippi'))).toMatch(/Round 2(?!\d)/)
    expect(document.body.textContent).not.toMatch(/Round 0(?!\d)/)

    const nameCol = first.parentElement as HTMLElement
    expect(nameCol.className).toMatch(/\bbasis-56\b/)
    const actions = nameCol.nextElementSibling as HTMLElement
    expect(actions.className).toMatch(/\bflex-wrap\b/)
  })
})
