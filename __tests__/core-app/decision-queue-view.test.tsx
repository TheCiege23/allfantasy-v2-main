// @vitest-environment jsdom
import type { ReactNode } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CoreIssue } from '@/lib/core-app/outstandingIssues'

vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

import { DecisionQueue } from '@/components/core-app/home/DecisionQueue'

const NOW = '2026-09-16T12:00:00.000Z'

function issue(n: number, overrides: Partial<CoreIssue> = {}): CoreIssue {
  return {
    id: `i${n}`,
    severity: 'warn',
    glyph: '•',
    title: `Decision ${n}`,
    meta: `meta ${n}`,
    leagueId: `L${n}`,
    leagueName: `League ${n}`,
    platform: 'sleeper',
    deadline: new Date(Date.parse(NOW) + n * 3_600_000),
    action: { label: 'Open', href: `/core/my-team?league=L${n}`, external: false },
    ...overrides,
  }
}

beforeEach(() => {
  window.sessionStorage.clear()
})
afterEach(() => cleanup())

describe('DecisionQueue', () => {
  it('shows the five most urgent first, names its scope, and holds the rest behind one control', () => {
    const issues = Array.from({ length: 8 }, (_, n) => issue(n + 1))
    render(<DecisionQueue issues={issues} scopeLabel="NFL leagues" scopeKey="sport:NFL" nowIso={NOW} />)

    expect(screen.getByRole('heading', { name: 'Top decisions' })).toBeTruthy()
    expect(screen.getByText('NFL leagues')).toBeTruthy()
    expect(screen.getByText('8 OPEN')).toBeTruthy()
    // Every row here is a `warn` inside a week, so all five sit in one tier (lib/core-app/homeGuide.ts).
    expect(screen.getByText('Before this week’s games')).toBeTruthy()
    const top = screen.getByRole('list', { name: 'Before this week’s games · The 5 most urgent' })
    expect(top.querySelectorAll(':scope > li')).toHaveLength(5)
    expect(top.textContent).toContain('Decision 1')
    expect(top.textContent).not.toContain('Decision 6')

    const toggle = screen.getByRole('button', { name: 'Show 3 more' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    const rest = document.getElementById(toggle.getAttribute('aria-controls')!)!
    expect(rest.hidden).toBe(true)
  })

  it('groups rows by tier, teaches each kind once, and drops the UTC verification stamp', () => {
    const slot = (n: number): CoreIssue =>
      issue(n, {
        severity: 'bad',
        deadline: null,
        meta: `Sleeper › Lineup · a slot with nobody in it scores zero · Checked 21:27 UTC · 2026-11-12`,
        parts: { kind: 'empty-slot', count: 1, leagueName: `League ${n}`, platform: 'Sleeper', checkedAt: null },
      })
    const draft = issue(9, {
      severity: 'info',
      parts: { kind: 'draft-upcoming', today: false, leagueName: 'League 9', platform: 'Sleeper', at: NOW, actionPlatform: null },
    })
    render(<DecisionQueue issues={[slot(1), slot(2), draft]} scopeLabel="All leagues" scopeKey="all" nowIso={NOW} />)

    expect(screen.getByRole('list', { name: /^Costs points now/ }).querySelectorAll(':scope > li')).toHaveLength(2)
    expect(screen.getByRole('list', { name: /^Good to know/ }).querySelectorAll(':scope > li')).toHaveLength(1)
    // Two empty-slot rows, one lesson: the line teaches once instead of repeating down the list.
    expect(screen.getAllByText(/An empty starting slot scores zero/)).toHaveLength(1)
    expect(screen.getAllByText(/Set your queue before the draft starts/)).toHaveLength(1)
    expect(document.body.textContent).not.toContain('UTC')
    expect(document.body.textContent).toContain('a slot with nobody in it scores zero')
  })

  it('remembers "show more" for this scope across a remount — the home unmounts when you leave it', () => {
    const issues = Array.from({ length: 7 }, (_, n) => issue(n + 1))
    const first = render(<DecisionQueue issues={issues} scopeLabel="All leagues" scopeKey="all" nowIso={NOW} />)
    fireEvent.click(screen.getByRole('button', { name: 'Show 2 more' }))
    expect(screen.getByRole('button', { name: 'Show fewer' }).getAttribute('aria-expanded')).toBe('true')
    first.unmount()

    render(<DecisionQueue issues={issues} scopeLabel="All leagues" scopeKey="all" nowIso={NOW} />)
    const toggle = screen.getByRole('button', { name: 'Show fewer' })
    expect(document.getElementById(toggle.getAttribute('aria-controls')!)!.hidden).toBe(false)
    cleanup()

    // Another scope has its own memory.
    render(<DecisionQueue issues={issues} scopeLabel="NBA leagues" scopeKey="sport:NBA" nowIso={NOW} />)
    expect(screen.getByRole('button', { name: 'Show 2 more' })).toBeTruthy()
  })

  it('still works when storage throws', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    try {
      render(<DecisionQueue issues={[1, 2, 3, 4, 5, 6].map((n) => issue(n))} scopeLabel="All leagues" scopeKey="all" nowIso={NOW} />)
      act(() => {
        fireEvent.click(screen.getByRole('button', { name: 'Show 1 more' }))
      })
      expect(screen.getByRole('button', { name: 'Show fewer' })).toBeTruthy()
    } finally {
      spy.mockRestore()
      set.mockRestore()
    }
  })

  it('opens provider actions in a new tab, and says nothing is waiting when nothing is', () => {
    render(
      <DecisionQueue
        issues={[issue(1, { action: { label: 'Open in Yahoo', href: 'https://yahoo.example/l/1', external: true } })]}
        scopeLabel="All leagues"
        scopeKey="all"
        nowIso={NOW}
      />,
    )
    const link = screen.getByRole('link', { name: /Open in Yahoo/ })
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toContain('noopener')
    cleanup()

    render(<DecisionQueue issues={[]} scopeLabel="All leagues" scopeKey="all" nowIso={NOW} />)
    expect(screen.getByText('Nothing is waiting on you.')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })
})
