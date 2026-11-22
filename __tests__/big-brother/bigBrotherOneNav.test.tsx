/**
 * Big Brother inside the league workspace: one navigation, not four (2026-11-07, Big Brother audit item 3).
 *
 * The workspace sidebar (and the Section picker on a phone) already lists House, HOH, Veto, Voting, Jury, Twists,
 * History and Command, and links League chat, Settings and Chimmy. Every sub-view still drew a "Big Brother" header
 * card, a League Chat / Settings / Chimmy Host / Command button row, and its own tab row (desktop) or View menu
 * (phone) — measured content start ~380px into the frame at 390px wide. With `shellNav`, those go; a slim bar keeps
 * the view's name, your status, and the two views the sidebar does not list (Ceremony; Admin tools for the
 * commissioner). The Overview embed passes no `shellNav` and keeps the full chrome, its only navigation.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { BigBrotherHome } from '@/components/big-brother/BigBrotherHome'

vi.mock('next/link', () => ({ default: ({ children, ...props }: any) => <a {...props}>{children}</a> }))
vi.mock('@/hooks/useUserTimezone', () => ({ useUserTimezone: () => ({ formatInTimezone: (d: unknown) => String(d) }) }))
vi.mock('@/components/big-brother/BigBrotherTwistsPanel', () => ({ BigBrotherTwistsPanel: () => <section>Twist inventory</section> }))
vi.mock('@/components/big-brother/BigBrotherCeremonyCenter', () => ({ BigBrotherCeremonyCenter: () => <section>Nomination Ceremony</section> }))
vi.mock('@/components/big-brother/BigBrotherCommissionerPanel', () => ({ BigBrotherCommissionerPanel: () => <section>Automation</section> }))

const SUMMARY = {
  cycle: { id: 'c5', week: 5, phase: 'VOTING_OPEN' },
  myStatus: 'VETO_PLAYER',
  rosterDisplayNames: {},
  finalNomineeRosterIds: [],
  config: {},
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => SUMMARY }))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('inside the league workspace (shellNav)', () => {
  it('drops the header card, the button row and the in-page tab row / View menu', async () => {
    render(<BigBrotherHome leagueId="l" initialView="twists" isCommissioner shellNav />)
    await screen.findByText('Twist inventory')
    expect(screen.queryByRole('heading', { level: 1, name: 'Big Brother' })).toBeNull()
    for (const name of ['League Chat', 'Settings', 'Chimmy Host', 'Command']) expect(screen.queryByRole('link', { name })).toBeNull()
    expect(screen.queryByRole('combobox')).toBeNull()
    for (const name of ['House', 'HOH', 'Veto', 'Voting', 'Jury', 'History']) expect(screen.queryByRole('button', { name })).toBeNull()
  })

  it('keeps the view name and status, and reaches the two views the sidebar does not list', async () => {
    render(<BigBrotherHome leagueId="l" initialView="twists" isCommissioner shellNav />)
    const bar = await screen.findByTestId('bb-view-bar')
    expect(within(bar).getByRole('heading', { level: 2, name: 'Twists' })).toBeTruthy()
    fireEvent.click(within(bar).getByRole('button', { name: 'Ceremony' }))
    expect(await screen.findByText('Nomination Ceremony')).toBeTruthy()
    fireEvent.click(within(bar).getByRole('button', { name: 'Admin tools' }))
    expect(await screen.findByText('Automation')).toBeTruthy()
  })

  it('offers Admin tools to the commissioner only', async () => {
    render(<BigBrotherHome leagueId="l" initialView="twists" shellNav />)
    const bar = await screen.findByTestId('bb-view-bar')
    expect(within(bar).queryByRole('button', { name: 'Admin tools' })).toBeNull()
    expect(within(bar).getByRole('button', { name: 'Ceremony' })).toBeTruthy()
  })
})

describe('the Overview embed (no shellNav) keeps its own navigation', () => {
  it('still renders the button row and the tab row', async () => {
    render(<BigBrotherHome leagueId="l" initialView="twists" isCommissioner />)
    await screen.findByText('Twist inventory')
    expect(screen.getByRole('link', { name: /League Chat/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Jury' })).toBeTruthy()
    expect(screen.queryByTestId('bb-view-bar')).toBeNull()
  })
})

describe('call sites', () => {
  it('the league workspace passes shellNav; the Overview tab does not', () => {
    const shell = readFileSync('app/league/[leagueId]/LeagueShell.tsx', 'utf8')
    expect(shell).toMatch(/<BigBrotherHome leagueId=\{leagueId\} initialView=\{bbView\}[^>]*\bshellNav\b/)
    const overview = readFileSync('components/app/tabs/OverviewTab.tsx', 'utf8')
    expect(overview).not.toMatch(/<BigBrotherHome[^>]*shellNav/)
  })
})
