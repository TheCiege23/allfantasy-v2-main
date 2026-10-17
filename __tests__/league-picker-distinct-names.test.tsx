// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * Leagues that share a name must be tellable apart in every league PICKER.
 *
 * 🛑 MEASURED 2026-09-28 on a real account: the pickers showed six entries that read identically —
 * two "TheCiege26's 8-Team NFL Redraft League (manual)" and four "…12-Team…". The rule that fixes it
 * already existed (lib/core-app/leagueNameCollision.ts: `<name> · <last 4 of id>` only when a name
 * repeats in the list shown), but the one component rendering it, `LeagueTile`, is mounted only by
 * app/dev/handoff-preview — no user ever saw the suffix. These pin that the pickers users DO see
 * apply that same rule, and leave unique names alone.
 */

const nav = vi.hoisted(() => ({
  router: { push: () => {}, replace: () => {}, prefetch: () => {}, refresh: () => {} },
}))
vi.mock('next/navigation', () => ({
  useRouter: () => nav.router,
  usePathname: () => '/core',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/components/core-app/comms/CommsDock', () => ({ default: () => null }))
vi.mock('@/components/core-app/SyncNowButton', () => ({ default: () => null }))
vi.mock('@/components/core-app/GeoRestrictionNotice', () => ({ GeoRestrictionNotice: () => null }))
vi.mock('@/components/core-app/AfCrest', () => ({ AfCrest: () => null }))
vi.mock('@/components/MiniPlayerImg', () => ({ default: () => null }))

import { distinctLeagueLabels } from '@/lib/core-app/leagueNameCollision'
import { LeagueScopePicker } from '@/components/core-app/comms/LeagueScopePicker'
import { ScopeSwitcher } from '@/components/core-app/ScopeSwitcher'
import { LeaguePicker } from '@/components/core-app/player-finder/LeaguePicker'
import AfCoreShell from '@/components/core-app/AfCoreShell'

afterEach(cleanup)

const EIGHT = "TheCiege26's 8-Team NFL Redraft League (manual)"
const TWELVE = "TheCiege26's 12-Team NFL Redraft League (manual)"

/** The measured account's shape: 2 + 4 colliding, plus one unique league. */
const ACCOUNT = [
  { id: 'lg-8a-00a1', name: EIGHT },
  { id: 'lg-8b-00b2', name: EIGHT },
  { id: 'lg-12a-0c31', name: TWELVE },
  { id: 'lg-12b-0d42', name: TWELVE },
  { id: 'lg-12c-0e53', name: TWELVE },
  { id: 'lg-12d-0f64', name: TWELVE },
  { id: 'lg-kbfl-9999', name: 'KBFL' },
]

const EXPECTED = [
  `${EIGHT} · 00a1`,
  `${EIGHT} · 00b2`,
  `${TWELVE} · 0c31`,
  `${TWELVE} · 0d42`,
  `${TWELVE} · 0e53`,
  `${TWELVE} · 0f64`,
  'KBFL',
]

describe('distinctLeagueLabels — the shared rule applied to one whole list', () => {
  it('suffixes every repeated name with the last four of its id and leaves a unique one alone', () => {
    const labels = distinctLeagueLabels(ACCOUNT)
    expect(ACCOUNT.map((l) => labels.get(l.id))).toEqual(EXPECTED)
  })

  it('judges collisions over the list it is given, so a name alone in THIS list stays clean', () => {
    const labels = distinctLeagueLabels([ACCOUNT[0], ACCOUNT[2], ACCOUNT[6]])
    expect([...labels.values()]).toEqual([EIGHT, TWELVE, 'KBFL'])
  })
})

describe('the comms drawer league scope <select>', () => {
  const leagues = ACCOUNT.map((l) => ({ ...l, platform: 'manual', platformLeagueId: null })) as never

  it('gives colliding leagues distinct option labels and leaves unique names unchanged', () => {
    render(<LeagueScopePicker leagues={leagues} value={null} onChange={() => {}} allowGlobal />)
    const options = within(screen.getByRole('combobox', { name: 'League scope' })).getAllByRole('option')
    expect(options.map((o) => o.textContent)).toEqual([
      'All leagues',
      ...EXPECTED.map((label) => `${label} (manual)`),
    ])
  })

  it('matches the filter against the suffix, so a colliding league can be found by it', () => {
    const many = [...ACCOUNT, { id: 'x1', name: 'Other 1' }, { id: 'x2', name: 'Other 2' }].map((l) => ({
      ...l,
      platform: 'manual',
      platformLeagueId: null,
    })) as never
    render(<LeagueScopePicker leagues={many} value={null} onChange={() => {}} allowGlobal />)
    fireEvent.change(screen.getByRole('searchbox', { name: 'Filter leagues' }), { target: { value: '0d42' } })
    const options = within(screen.getByRole('combobox', { name: 'League scope' })).getAllByRole('option')
    expect(options.map((o) => o.textContent)).toEqual(['All leagues', `${TWELVE} · 0d42 (manual)`])
  })
})

describe('the /core scope switcher list', () => {
  it('lists colliding leagues distinctly and unique names unchanged', () => {
    render(
      <ScopeSwitcher
        leagues={ACCOUNT.map((l) => ({ ...l, platform: 'manual', sport: 'NFL' }))}
        scopeValue={null}
        label="All leagues"
        selectedLeagueId={null}
        favoriteIds={[]}
        leagueScreen={false}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /Viewing/ }))
    const names = Array.from(document.querySelectorAll('.af-scope-league-name')).map((n) => n.textContent)
    expect(names).toEqual(EXPECTED)
  })
})

describe('the Player Finder league pick', () => {
  it('lists colliding leagues distinctly and unique names unchanged', () => {
    render(<LeaguePicker leagues={ACCOUNT.map((l) => ({ ...l, platform: 'manual' }))} saved={null} />)
    fireEvent.click(screen.getByRole('button', { name: /Leagues/ }))
    const names = Array.from(document.querySelectorAll('.af-pf-picker-name')).map((n) => n.textContent)
    expect(names).toEqual(EXPECTED)
  })
})

describe('the /core rail and its header league switcher', () => {
  const rail = ACCOUNT.map((l) => ({ ...l, platform: 'manual', mark: 'M' }))
  const shell = (props: Record<string, unknown> = {}) => (
    <AfCoreShell
      active="home"
      leagues={rail as never}
      syncAge={{ label: 'just now', stale: false }}
      syncEligibleCount={0}
      {...props}
    >
      <div>screen</div>
    </AfCoreShell>
  )

  it('draws each colliding rail row distinctly and leaves a unique name unchanged', () => {
    const { container } = render(shell())
    const names = Array.from(container.querySelectorAll('.af-rail-row-name')).map((n) => n.textContent)
    expect(names).toEqual(EXPECTED)
    const tile = container.querySelector('.af-rail-tile[href*="lg-12c-0e53"]')
    expect(tile?.getAttribute('aria-label')).toBe(`${TWELVE} · 0e53 on manual`)
  })

  it('marks only the league you commission with the blue C (CommissionerBadge)', () => {
    const withCommish = rail.map((l, i) => ({ ...l, isCommissioner: i === 6 }))
    const { container } = render(shell({ leagues: withCommish }))
    const badged = Array.from(container.querySelectorAll('.af-rail-row'))
      .filter((row) => row.querySelector('[data-testid="commissioner-badge"]'))
      .map((row) => row.querySelector('.af-rail-row-name')?.textContent)
    expect(badged).toEqual([EXPECTED[6]])
  })

  it('names the selected league in the header switcher with the same label the rail shows', () => {
    const { container } = render(shell({ leagueFirst: true, selectedLeagueId: 'lg-12b-0d42' }))
    expect(container.querySelector('.af-lf-switch-name')?.textContent).toBe(`${TWELVE} · 0d42`)
  })

  it('leaves a unique selected league name alone in the header switcher', () => {
    const { container } = render(shell({ leagueFirst: true, selectedLeagueId: 'lg-kbfl-9999' }))
    expect(container.querySelector('.af-lf-switch-name')?.textContent).toBe('KBFL')
  })
})
