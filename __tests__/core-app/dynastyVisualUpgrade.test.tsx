// @vitest-environment jsdom
/**
 * Dynasty after the 2026-11-24 visual audit (DB-free harness at /e2e/dynasty-core/*):
 * 1. Between seasons Home still said "This week vs …", "Review your starters · Check before the first
 *    kickoff" and drew a week's scoreboard.
 * 2. My team said the same lineup problem four times; Roster health repeated the lineup check.
 * 3. "Lineup could not be verified … advice is paused" sat above full lineup advice.
 * 4. My team on a wide screen was one narrow column beside an empty one.
 * 5. Taxi squad: blank boxes on Home and Draft HQ; "years left unknown" on every taxi row.
 * 6. Draft HQ: "you pick 9th of 12" while your first pick is 1.03; rounds and status said twice.
 * 7. Home: "Points for" alone across the whole row; the standings preview put 4th above 1st–3rd.
 * 8. Wording: "We need prices for most …", "Verify provider lineup", "Injury labels alone do not
 *    establish your provider's IR eligibility".
 */
import React from 'react'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

vi.mock('server-only', () => ({}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/core',
  useSearchParams: () => new URLSearchParams(),
}))

import { LeagueHome } from '@/components/core-app/screens/LeagueHome'
import { MyTeam } from '@/components/core-app/screens/MyTeam'
import { DraftHq } from '@/components/core-app/screens/DraftHq'
import { dynastyHomeFixture } from '@/app/e2e/dynasty-core/home/fixture'
import { dynastyMyTeamFixture } from '@/app/e2e/dynasty-core/myteam/fixture'
import { dynastyDraftHqFixture } from '@/app/e2e/dynasty-core/draft-hq/fixture'

const read = (p: string) => readFileSync(path.join(process.cwd(), p), 'utf8')
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 503 })))
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('Home between seasons', () => {
  it('has no "this week", no week card and no week scoreboard', () => {
    const { container } = render(<LeagueHome data={dynastyHomeFixture({ identity: true, sparse: false, offseason: true })} otherLeagueIssueCount={0} identityInShell />)
    expect(screen.queryByTestId('league-overview-week')).toBeNull()
    expect(container.querySelector('#af-lh-week-summary-title')).toBeNull()
    expect(container.querySelector('.af-lh-scoreboard-panel')).toBeNull()
    expect(container.textContent).not.toMatch(/Check before the first kickoff/)
  })
  it('in season keeps them', () => {
    const { container } = render(<LeagueHome data={dynastyHomeFixture({ identity: true, sparse: false })} otherLeagueIssueCount={0} identityInShell />)
    expect(screen.getByTestId('league-overview-week')).toBeTruthy()
    expect(container.querySelector('#af-lh-week-summary-title')).toBeTruthy()
  })
})

describe('Home standings and points', () => {
  it('the preview lists 1st, 2nd, 3rd … in order, you among them', () => {
    const { container } = render(<LeagueHome data={dynastyHomeFixture({ identity: true, sparse: false })} otherLeagueIssueCount={0} identityInShell />)
    const ranks = [...container.querySelectorAll('.af-standings-rank')].map((e) => Number(e.textContent))
    expect(ranks).toEqual([1, 2, 3, 4, 5, 6])
  })
  it('a lone KPI tile is tile-sized, not a full-width row', () => {
    expect(read('components/core-app/af-league-home.css')).toMatch(/\.af-lh-kpis:has\(> \.af-lh-kpi:only-child\)\s*\{[^}]*grid-template-columns:\s*minmax\(/)
  })
})

describe('My team says each problem once', () => {
  it('Roster health does not repeat the lineup check, and the check does not repeat the card title', () => {
    const { container } = render(<MyTeam data={dynastyMyTeamFixture({ markers: true })} />)
    const title = container.querySelector('#af-mt-decision-title')?.textContent ?? ''
    expect(title).toMatch(/Logan Kowalski/)
    const check = container.querySelector('.af-mt-check--embedded')
    expect(check?.textContent ?? '').not.toMatch(/Logan Kowalski/)
    const workspace = container.querySelector('.af-tw')?.textContent ?? ''
    expect(workspace).not.toMatch(/Logan Kowalski: bye|K is empty/)
  })
  it('no paused-advice line above advice, no "years left unknown", plain words', () => {
    const { container } = render(<MyTeam data={dynastyMyTeamFixture({ markers: true })} />)
    const t = container.textContent ?? ''
    expect(t).not.toMatch(/advice is paused/)
    expect(t).not.toMatch(/years left unknown/)
    expect(t).not.toMatch(/We need prices for most|Verify provider lineup|Injury labels alone/)
  })
  it('a side column holding only the folded detail does not squeeze the roster', () => {
    expect(read('components/core-app/af-my-team.css')).toMatch(/\.af-mt-body:not\(:has\(> \.af-mt-aside > :not\(\.af-mt-more\)\)\)\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)\s*;/)
  })
  it('Roster decisions reads like the rest of the page', () => {
    expect(read('components/core-app/af-team-workspace.css')).toMatch(/\.af-tw-panel li strong\s*\{[^}]*font-size:\s*14px/)
  })
})

describe('Taxi squad', () => {
  it('no empty slot boxes on Home or Draft HQ; the count once', () => {
    const home = render(<LeagueHome data={dynastyHomeFixture({ identity: true, sparse: false })} otherLeagueIssueCount={0} identityInShell />)
    expect(home.container.querySelector('.af-lh-dy-slots')).toBeNull()
    cleanup()
    const hq = render(<DraftHq data={dynastyDraftHqFixture({ identity: true, noDraft: false })} />)
    expect(hq.container.querySelector('.af-dh-dy-slots')).toBeNull()
    const taxi = screen.getByTestId('draft-hq-rookie-taxi').textContent ?? ''
    expect(taxi).toMatch(/2 of 4/)
    expect(taxi.match(/2 of 4/g)?.length).toBe(1)
  })
})

describe('Draft HQ', () => {
  it('names your first pick, and says rounds and status once', () => {
    const { container } = render(<DraftHq data={dynastyDraftHqFixture({ identity: true, noDraft: false })} />)
    const h1 = container.querySelector('h1')?.textContent ?? ''
    expect(h1).toMatch(/your first pick is 1\.03/)
    expect(h1).not.toMatch(/9th of 12/)
    const t = container.textContent ?? ''
    expect(t.match(/Not started/g)?.length).toBe(1)
    expect(container.querySelectorAll('.af-dh-fact').length + container.querySelectorAll('[data-testid="draft-hq-rookie-rounds"]').length).toBeLessThanOrEqual(2)
    expect(read('components/core-app/af-draft-hq.css')).toMatch(/\.af-dh-facts:has\(> \.af-dh-fact:only-child\)\s*\{[^}]*minmax\(/)
    expect([...container.querySelectorAll('.af-label, dt')].filter((e) => /^Rounds?$/i.test(e.textContent?.trim() ?? '')).length).toBe(1)
  })
})
