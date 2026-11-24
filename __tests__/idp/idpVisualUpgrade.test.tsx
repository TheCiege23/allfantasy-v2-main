// @vitest-environment jsdom
/**
 * IDP after the 2026-11-23 visual audit (DB-free harness at /e2e/idp-league/[tab]):
 * 1. The IDP tab asked for week 1 every week (it read `data.week`; the overview carries `leagueWeek`) and counted a
 *    19-player roster as 0 (the roster is an object, not an array), which also hid the Chimmy Analysis button.
 * 2. A long opponent name pushed the matchup card, and the whole phone page, past the screen edge.
 * 3. Defender cards showed "—" and an empty "proj" while the defense total was 73.5, and a "Start" button that did
 *    nothing.
 * 4. Developer output: a raw data dump, the league's internal id as a stat, drama codes like RIVALRY_CLASH, and an
 *    every-sport picker in an NFL league.
 * 5. Light mode: dark team cards with dark text; the cap screens were always dark.
 * 6. Cap Room / Contract Center: the year's numbers three times, a table and timeline cut off on a phone, a narrow
 *    desktop column, and "No dead money entries" before anything had loaded.
 * 7. Wording: "priced 17/19" twice under a caveat paragraph, "Set lineups in Roster" (the tab is Team),
 *    "185 pts13/15", "Total dead (displayed)", "this pass".
 * 8. The waiver card stretched to the matchup's height, preseason showed 0-point totals, a broken headshot
 *    spilled its alt text.
 */
import React from 'react'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'

vi.mock('next-auth/react', () => ({ useSession: () => ({ data: { user: { id: 'e2e-idp-league-viewer' } }, status: 'authenticated' }) }))
vi.mock('next/link', () => ({ default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => <a href={href} {...rest}>{children}</a> }))
vi.mock('next/navigation', async (orig) => ({
  ...(await orig<typeof import('next/navigation')>()),
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, prefetch: () => {} }),
  usePathname: () => '/league/e2e-idp-league',
  useSearchParams: () => new URLSearchParams(),
}))

import {
  idpLeagueHarnessApi, playerMapFor, lineupFor, IDP_LEAGUE_ID as LID, type IdpLeagueHarnessMood,
} from '@/app/e2e/idp-league/fixtures'
import IDPHome from '@/components/idp/IDPHome'
import { IDPTeamDashboard } from '@/app/idp/components/IDPTeamDashboard'
import { LeagueDramaWidget } from '@/components/app/league/LeagueDramaWidget'

const read = (p: string) => readFileSync(path.join(process.cwd(), p), 'utf8')
let calls: string[] = []
function serve(mood: IdpLeagueHarnessMood) {
  const routes = idpLeagueHarnessApi(mood)
  calls = []
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const u = new URL(String(input), 'http://localhost')
    calls.push(u.pathname + u.search)
    const hit = routes.find((r) => r.path === u.pathname && Object.entries(r.query ?? {}).every(([k, v]) => u.searchParams.get(k) === v))
    return new Response(JSON.stringify(hit ? hit.body : { error: 'unfed' }), { status: hit ? 200 : 503 })
  }))
}
beforeEach(() => {
  serve('in_season')
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener: () => {}, removeEventListener: () => {} })) as never
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('the IDP tab', () => {
  it('asks for the league’s current week and counts the roster', async () => {
    render(<IDPHome leagueId={LID} />)
    await screen.findByText('Players')
    await waitFor(() => expect(calls.some((c) => c.includes('view=idp-matchup') && c.includes('week=10'))).toBe(true))
    expect(calls.some((c) => /week=1(&|$)/.test(c))).toBe(false)
    expect(screen.getByTestId('idp-roster-count').textContent).toBe('19')
    expect(screen.getByTestId('idp-open-player-ai-modal')).toBeTruthy()
  })

  it('shows no developer output', async () => {
    const { container } = render(<IDPHome leagueId={LID} />)
    await screen.findByText('Players')
    const txt = container.textContent ?? ''
    expect(txt).not.toMatch(/Current context|ROSTERID|rosterId|SOURCE|e2e-idp-league\b/)
    expect(read('components/idp/IDPHome.tsx')).not.toMatch(/SmartDataView/)
  })

  it('says where lineups are set by the tab’s real name', () => {
    expect(read('components/idp/IDPHome.tsx')).not.toMatch(/Set lineups in Roster/)
  })

  it('the waiver card does not stretch to the matchup’s height', () => {
    expect(read('components/idp/IDPHome.tsx')).toMatch(/grid gap-3 lg:grid-cols-2 lg:items-start/)
  })
})

describe('the drama widget', () => {
  it('names storylines in words, with no sport picker and no codes', async () => {
    render(<LeagueDramaWidget leagueId={LID} sport="NFL" season={2026} />)
    await screen.findByText(/meet again with first place/)
    expect(screen.queryByLabelText(/sport filter/i)).toBeNull()
    expect(document.body.textContent).not.toMatch(/RIVALRY|STREAK|_CLASH|Score: \d/)
    expect(screen.getByText('Rivalry')).toBeTruthy()
  })
})

describe('the matchup card', () => {
  it('lets a long team name shrink instead of widening the card', () => {
    expect(read('app/idp/components/IDPMatchupView.tsx')).toMatch(/grid min-w-0 grid-cols-\[minmax\(0,1fr\)_auto_minmax\(0,1fr\)\]/)
  })
  it('says how many players were scored once, in words', async () => {
    const { IDPMatchupView } = await import('@/app/idp/components/IDPMatchupView')
    render(<IDPMatchupView leagueId={LID} week={10} />)
    await screen.findByText('Week 10')
    const txt = document.body.textContent ?? ''
    expect(txt).not.toMatch(/priced \d+\/\d+/)
    expect(txt.match(/of \d+ players scored/g)?.length ?? 0).toBeLessThanOrEqual(2)
  })
})

describe('the Team tab', () => {
  function team(mood: IdpLeagueHarnessMood) {
    serve(mood)
    const { starterIds, benchIds } = lineupFor(mood)
    return render(
      <IDPTeamDashboard leagueId={LID} week={10} sport="NFL" players={playerMapFor(mood)} playersLoading={false}
        idpViewMode="full" positionMode="standard" starterIds={starterIds} benchIds={benchIds} onOffensePlayerClick={() => {}} />,
    )
  }
  it('defenders show their points, no empty projection, no dead Start button', async () => {
    team('in_season')
    await waitFor(() => expect(screen.getByTestId('idp-card-5850').textContent).toContain('16.5'))
    expect(screen.getByTestId('idp-card-5850').textContent).not.toMatch(/proj/)
    expect(screen.queryAllByRole('button', { name: /^(Start|Sit)$/ })).toHaveLength(0)
  })
  it('the totals line reads with spaces and words', async () => {
    const { container } = team('in_season')
    await waitFor(() => expect(container.textContent).toMatch(/of 15 starters scored/))
    expect(container.textContent).not.toMatch(/pts\d/)
  })
  it('before the draft: no zero totals', async () => {
    const { container } = team('preseason')
    await waitFor(() => expect(container.textContent).toMatch(/after your draft/i))
    expect(container.textContent).not.toMatch(/TOTAL: 0 pts/)
  })
})

describe('light mode', () => {
  it('IDP cards take the light surface', () => {
    expect(read('app/globals.css')).toMatch(/html\[data-mode="light"\] \{[^}]*--idp-panel:/)
  })
  it('the cap screens follow the app mode', () => {
    for (const f of ['app/idp/cap/layout.tsx', 'app/idp/contracts/layout.tsx']) expect(read(f)).not.toMatch(/af-draft-dark"/)
    for (const f of ['app/idp/cap/[leagueId]/CapRoomClient.tsx', 'app/idp/contracts/[leagueId]/ContractCenterClient.tsx', 'app/idp/components/cap/ContractsTable.tsx', 'app/idp/components/cap/CapOverviewBar.tsx']) {
      expect(read(f), f).not.toMatch(/bg-\[#0|\btext-white\b/)
    }
  })
})

describe('the cap screens', () => {
  it('Cap Room lists only later years under Future years, on a wide page', () => {
    const src = read('app/idp/cap/[leagueId]/CapRoomClient.tsx')
    expect(src).toMatch(/projectionYear !== year/)
    expect(src).not.toMatch(/max-w-3xl/)
  })
  it('contracts read as a list on a phone', () => {
    expect(read('app/idp/components/cap/ContractsTable.tsx')).toMatch(/data-testid="contracts-list"/)
  })
  it('Contract Center waits before saying there is nothing, in plain words', () => {
    const src = read('app/idp/contracts/[leagueId]/ContractCenterClient.tsx')
    expect(src).not.toMatch(/\(displayed\)|this pass/)
    expect(src).toMatch(/loaded \?/)
  })
})

describe('headshots', () => {
  it('a broken image never paints its alt text', () => {
    expect(read('app/components/PlayerImage.tsx')).toMatch(/className="h-full w-full object-cover text-transparent"/)
  })
})
