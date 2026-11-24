/**
 * Big Brother after the 2026-11-23 audit: the Voting tab stops telling safe players they are ineligible; the finale
 * reads as the finale; the phone house view keeps the HOH / block / Veto spots and your real status; no engine or
 * developer wording; holding the Veto comes with the decision; the desktop rail spreads across; a season that has not
 * started says so plainly; and Big Brother follows light mode.
 */
import React from 'react'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'

vi.mock('next/link', () => ({ default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => <a href={href} {...rest}>{children}</a> }))
vi.mock('@/hooks/useUserTimezone', () => ({ useUserTimezone: () => ({ formatInTimezone: (d: string) => `fmt(${d})`, formatDateInTimezone: (d: string) => d }) }))

import { summary, bigBrotherHarnessApi, BIG_BROTHER_LEAGUE_ID as LID, type BigBrotherHarnessMood } from '@/app/e2e/big-brother-league/fixtures'
import { BigBrotherVotingBallot } from '@/components/big-brother/BigBrotherVotingBallot'
import { BigBrotherSpecialtyHome } from '@/components/big-brother/BigBrotherSpecialtyHome'
import { BigBrotherHome } from '@/components/big-brother/BigBrotherHome'
import { BigBrotherJuryCenter } from '@/components/big-brother/BigBrotherJuryCenter'
import { BigBrotherCommandDashboard } from '@/components/big-brother/BigBrotherCommandDashboard'

const read = (p: string) => readFileSync(path.join(process.cwd(), p), 'utf8')
function serve(mood: BigBrotherHarnessMood) {
  const routes = bigBrotherHarnessApi(mood)
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const u = new URL(String(input), 'http://localhost')
    const hit = routes.find((r) => r.path === u.pathname)
    return new Response(JSON.stringify(hit ? hit.body : { error: 'unfed' }), { status: hit ? 200 : 503 })
  }))
}
beforeEach(() => serve('eviction_vote'))
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('Voting', () => {
  it('a safe player with no vote open is told when it opens, not that they are ineligible', () => {
    render(<BigBrotherVotingBallot leagueId="L" summary={summary('veto') as never} onVoted={() => {}} />)
    expect(document.body.textContent).not.toMatch(/Not eligible to vote/)
    expect(document.body.textContent).toMatch(/opens/i)
  })
})

describe('the finale', () => {
  it('reads as the finale: no "Live eviction", finalists tagged, a way to the jury vote', () => {
    render(<BigBrotherSpecialtyHome leagueId="L" summary={summary('jury_finale') as never} />)
    const txt = document.body.textContent ?? ''
    expect(txt).not.toMatch(/Live eviction/)
    expect(txt).toMatch(/Finale/)
    expect(screen.getAllByText('Finalist').length).toBeGreaterThan(0)
    expect(screen.getAllByRole('link', { name: /finale vote/i }).length).toBeGreaterThan(0)
  })
})

describe('the house view', () => {
  it('a short title, not the league name, and the three spots on a phone', () => {
    render(<BigBrotherSpecialtyHome leagueId="L" summary={summary('nominations') as never} />)
    expect(screen.getAllByRole('heading').map((h) => h.textContent)).not.toContain('Big Brother: The Gridiron House of Questionable Alliances and Backdoor Plans')
    const phone = screen.getByTestId('bb-phone-home')
    expect(phone.querySelector('[data-testid="bb-phone-spots"]')).toBeTruthy()
    // Your own tile says what you are, not only "You".
    expect(phone.textContent).toMatch(/You · Nominee/)
  })
  it('holding the Veto comes with the decision', async () => {
    serve('veto')
    render(<BigBrotherHome leagueId={LID} initialView="house" shellNav />)
    await waitFor(() => expect(screen.getAllByTestId('bb-veto-decision-card').length).toBeGreaterThan(0))
  })
  it('the rail spreads across when it wraps under the grid', () => {
    expect(read('components/big-brother/BigBrotherSpecialtyHome.tsx')).toMatch(/railClassName=\{bb\.railWide\}/)
  })
  it('before the season: no "safe this week", and no admin instructions for a manager', async () => {
    serve('empty')
    render(<BigBrotherHome leagueId={LID} initialView="house" shellNav />)
    await waitFor(() => expect(screen.getAllByTestId('bb-specialty-home').length).toBeGreaterThan(0))
    expect(document.body.textContent).not.toMatch(/You’re safe this week|Start week 1/)
  })
})

describe('plain words', () => {
  it('no engine wording on the house view or the jury; no placeholder X; plural Veto win', async () => {
    serve('jury_finale')
    render(<BigBrotherHome leagueId={LID} initialView="house" shellNav />)
    await waitFor(() => expect(screen.getAllByTestId('bb-specialty-home').length).toBeGreaterThan(0))
    expect(document.body.textContent).not.toMatch(/Competition engine|league engine|Chimmy and Chimmy/)
    cleanup()
    render(<BigBrotherJuryCenter leagueId="L" summary={summary('jury_finale') as never} />)
    const txt = document.body.textContent ?? ''
    expect(txt).not.toMatch(/game engine|Chimmy \/ Big Brother Chimmy|\b1 Veto wins|\dx nominated/)
    expect(read('components/big-brother/BigBrotherJuryCenter.tsx')).not.toMatch(/after X eliminations/)
  })
  it('the command dashboard speaks plainly', () => {
    render(<BigBrotherCommandDashboard leagueId="L" />)
    expect(document.body.textContent).not.toMatch(/cinematic hub|ballot strip|inside the league shell|left rail in the shell|Enter league hub/)
  })
})

describe('light mode', () => {
  it('Big Brother joins the shared light rule and drops the always-dark wrapper', () => {
    expect(read('components/league/specialty/specialty.module.css')).toMatch(/:global\(html\[data-mode='light'\]\) \.sp\[data-specialty='bigbrother'\]/)
    expect(read('components/big-brother/BigBrotherHome.tsx')).not.toMatch(/className="af-draft-dark/)
    for (const f of ['BigBrotherHome', 'BigBrotherVotingBallot', 'BigBrotherJuryCenter', 'BigBrotherHistoryPanel', 'BigBrotherTwistsPanel', 'BigBrotherCeremonyCenter', 'BigBrotherCommandDashboard']) {
      expect(read(`components/big-brother/${f}.tsx`), f).not.toMatch(/\btext-white\b|text-white\//)
    }
  })
})
