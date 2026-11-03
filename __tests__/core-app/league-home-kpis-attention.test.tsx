import { render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { LeagueHome } from '@/components/core-app/screens/LeagueHome'
import { homeFixture } from '@/app/e2e/redraft-core/home/fixture'
import { buildHomeKpis } from '@/lib/core-app/homeKpis'
import type { LeagueHomeData, LeagueStanding } from '@/lib/core-app/leagueHome'
import type { CoreIssue } from '@/lib/core-app/outstandingIssues'
import type { TradeDeadlineCountdown } from '@/lib/trade-deadline/tradeDeadlineCountdown'

/**
 * The league Home redesign's KPI row ("Your season at a glance") and "Needs your attention" list.
 * Every tile is built from data the loader already read and is ABSENT when that data is — never a
 * zero standing in for "unknown".
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ prefetch() {}, push() {}, replace() {}, refresh() {} }),
  usePathname: () => '/core',
  useSearchParams: () => new URLSearchParams('league=e2e-redraft-core-home'),
}))

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('{}', { status: 200 }))))
})
afterEach(() => {
  vi.unstubAllGlobals()
})

const text = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim()

function row(over: Partial<LeagueStanding>): LeagueStanding {
  return {
    teamId: 't',
    teamName: 'Team',
    ownerName: null,
    wins: 0,
    losses: 0,
    ties: 0,
    pointsFor: 0,
    rank: 1,
    isYou: false,
    faabRemaining: null,
    ...over,
  } as LeagueStanding
}

const SIX_TWO = [
  row({ teamId: 'a', teamName: 'Brown Pig Bandits', wins: 6, losses: 2, pointsFor: 1012.4, rank: 2, isYou: true, faabRemaining: 64 }),
  row({ teamId: 'b', teamName: 'Sunday Scaries', wins: 7, losses: 1, pointsFor: 1040.2, rank: 1, faabRemaining: 12 }),
  row({ teamId: 'c', teamName: 'Bench Mob', wins: 3, losses: 5, pointsFor: 901.0, rank: 3, faabRemaining: 80 }),
  row({ teamId: 'd', teamName: 'Taco Tuesday', wins: 0, losses: 8, pointsFor: 850.0, rank: 4, faabRemaining: 100 }),
]
const yourTeam = { available: true as const, data: { teamName: 'Brown Pig Bandits', record: '6-2', rank: 2, pointsFor: 1012.4 } }
const standings = { available: true as const, data: SIX_TWO }

describe('buildHomeKpis', () => {
  it('record + rank of N, points-for rank and distance from the league average, FAAB left', () => {
    const k = buildHomeKpis({ yourTeam, standings, faabEnabled: true })
    expect(k.record).toEqual({ record: '6-2', rank: 2, teams: 4 })
    // Average 950.9 → +61.5; second-most points in the league.
    expect(k.pointsFor).toEqual({ points: 1012.4, rank: 2, teams: 4, vsAverage: 61.5 })
    expect(k.faab).toEqual({ remaining: 64 })
  })

  it('FAAB is absent — not $0 — when the league does not run it or the budget is unknown', () => {
    expect(buildHomeKpis({ yourTeam, standings, faabEnabled: false }).faab).toBeNull()
    expect(buildHomeKpis({ yourTeam, standings }).faab).toBeNull()
    const unknown = { available: true as const, data: SIX_TWO.map((r) => (r.isYou ? { ...r, faabRemaining: null } : r)) }
    expect(buildHomeKpis({ yourTeam, standings: unknown, faabEnabled: true }).faab).toBeNull()
  })

  it('nothing to say before a game is scored, and nothing at all without the data', () => {
    const preseason = { available: true as const, data: SIX_TWO.map((r) => ({ ...r, wins: 0, losses: 0, pointsFor: 0 })) }
    const zero = { available: true as const, data: { ...yourTeam.data, record: '0-0', pointsFor: 0 } }
    expect(buildHomeKpis({ yourTeam: zero, standings: preseason }).pointsFor).toBeNull()
    const none = buildHomeKpis({
      yourTeam: { available: false, reason: 'not read yet' } as LeagueHomeData['yourTeam'],
      standings: { available: false, reason: 'not read yet' } as LeagueHomeData['standings'],
    })
    expect(none).toEqual({ record: null, pointsFor: null, faab: null })
  })
})

describe('LeagueHome KPI row', () => {
  it('draws record, points for and FAAB from the loader data, and the trade deadline tile from the countdown', () => {
    const { data } = homeFixture('nfl', { identity: false })
    const withFaab = { ...data, yourTeam, standings, faabEnabled: true }
    const deadline: TradeDeadlineCountdown = { state: 'weeks', deadlineWeek: 11, currentWeek: 9, weeksLeft: 2 }
    const { container } = render(
      <LeagueHome data={withFaab} otherLeagueIssueCount={0} identityInShell tradeDeadline={deadline} />,
    )
    const kpis = container.querySelector('[data-testid=league-home-kpis]')
    expect(kpis?.getAttribute('aria-label')).toBe('Your season at a glance')
    const tile = (k: string) => text(container.querySelector(`[data-kpi=${k}]`))
    expect(tile('record')).toBe('Record6-22nd of 4')
    expect(tile('points-for')).toContain('1012.4')
    expect(tile('points-for')).toContain('+61.5 vs league average')
    expect(tile('faab')).toContain('$64')
    expect(tile('trade-deadline')).toContain('Week 11')
    expect(container.querySelector('[data-kpi=trade-deadline]')?.getAttribute('href')).toContain('/core/trades?league=')
  })

  it('a league with no FAAB and no deadline shows only the tiles it has data for', () => {
    const { data } = homeFixture('nfl', { identity: false })
    const { container } = render(<LeagueHome data={data} otherLeagueIssueCount={0} identityInShell />)
    expect(container.querySelector('[data-kpi=record]')).not.toBeNull()
    expect(container.querySelector('[data-kpi=faab]')).toBeNull()
    expect(container.querySelector('[data-kpi=trade-deadline]')).toBeNull()
  })

  it('the row is absent when no tile has data', () => {
    const { data } = homeFixture('nfl', { identity: false })
    const blank = {
      ...data,
      yourTeam: { available: false, reason: 'not read yet' } as LeagueHomeData['yourTeam'],
      standings: { available: false, reason: 'not read yet' } as LeagueHomeData['standings'],
    }
    const { container } = render(
      <LeagueHome data={blank} otherLeagueIssueCount={0} identityInShell tradeDeadline={{ state: 'none' }} />,
    )
    expect(container.querySelector('[data-testid=league-home-kpis]')).toBeNull()
  })
})

function issue(n: number, label: string | null): CoreIssue {
  return {
    id: `i${n}`,
    severity: n === 1 ? 'urgent' : 'warn',
    glyph: '!',
    title: `Issue ${n}`,
    meta: `Sleeper › Lineup · ${n}`,
    leagueId: 'L',
    leagueName: 'League',
    platform: 'sleeper',
    deadline: null,
    action: label ? { label, href: `/core/lineup?i=${n}`, external: false } : null,
  } as CoreIssue
}

describe('LeagueHome "Needs your attention"', () => {
  it('lists the top three issues, each with its verb, most urgent first', () => {
    const { data } = homeFixture('nfl', { identity: false })
    const issues = [issue(1, 'Set lineup'), issue(2, 'Review trade'), issue(3, null), issue(4, 'Claim player')]
    const { container } = render(<LeagueHome data={data} otherLeagueIssueCount={0} identityInShell issues={issues} />)
    const list = container.querySelector('[data-testid=league-home-attention]')
    expect(text(list?.querySelector('h2') ?? null)).toBe('Needs your attention')
    const items = [...(list?.querySelectorAll('li') ?? [])]
    expect(items.map((li) => text(li.querySelector('h3')))).toEqual(['Issue 1', 'Issue 2', 'Issue 3'])
    expect(items.map((li) => text(li.querySelector('a')))).toEqual(['Set lineup', 'Review trade', ''])
    expect(items[0].className).not.toContain('af-lh-urgent--minor')
    expect(items[1].className).toContain('af-lh-urgent--minor')
  })

  it('is absent when nothing needs attention', () => {
    const { data } = homeFixture('nfl', { identity: false })
    const { container } = render(<LeagueHome data={data} otherLeagueIssueCount={0} identityInShell issues={[]} />)
    expect(container.querySelector('[data-testid=league-home-attention]')).toBeNull()
  })
})
