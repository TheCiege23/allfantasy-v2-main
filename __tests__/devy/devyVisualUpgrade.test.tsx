/**
 * Devy after the 2026-11-23 audit: the Promotion Center offers Promote only on your own players and never asks for a
 * raw pro player id; the taxi count is right; the words say what they mean (no "3 pros" for college players, no
 * "Declared" on a drafted player, no "Open" deadline mid-season, no unnamed feed lines, no raw override codes);
 * nothing is said twice; the roster fits a phone and a desktop; and the Devy screens follow light mode.
 */
import React from 'react'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'

vi.mock('next/link', () => ({ default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => <a href={href} {...rest}>{children}</a> }))
vi.mock('@/hooks/useAfSubGate', () => ({ useAfSubGate: () => ({ handleApiResponse: async () => true }) }))
vi.mock('@/hooks/useUserTimezone', () => ({ useUserTimezone: () => ({ formatDateInTimezone: (d: string) => d }) }))

import { HARNESS_API, HARNESS_USER_ID } from '@/app/e2e/devy/fixtures'
import { DevyRosterClient } from '@/app/devy/[leagueId]/roster/DevyRosterClient'
import { DevyPicksClient } from '@/app/devy/[leagueId]/picks/DevyPicksClient'
import { DevyPromotionPanel } from '@/components/devy/DevyPromotionPanel'
import { DevyCommissionerTools } from '@/components/devy/DevyCommissionerTools'
import { DevyDraftCenter } from '@/components/devy/DevyDraftCenter'
import { devyYearTag, devyFeedItems } from '@/lib/devy/devyHomeView'

const read = (p: string) => readFileSync(path.join(process.cwd(), p), 'utf8')
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

function serveFixtures() {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const u = new URL(String(input), 'http://localhost')
    const hit = HARNESS_API.find((r) => r.path === u.pathname && Object.entries(r.query ?? {}).every(([k, v]) => u.searchParams.get(k) === v))
    return json(hit ? hit.body : { error: 'unfed' }, hit ? 200 : 503)
  }))
}

beforeEach(() => serveFixtures())
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('the Promotion Center', () => {
  const item = (rightsId: string, name: string, canPromote: boolean, promotedProPlayerId: string | null) => ({
    rightsId, rosterId: canPromote ? 'mine' : 'theirs', platformUserId: 'x', devyPlayerId: `dp-${rightsId}`,
    devyPlayer: { name, position: 'WR', school: 'Ohio State', draftEligibleYear: 2027 }, promotedProPlayerId, seasonYear: 2027, canPromote,
  })
  it('Promote only on players you can promote, and no raw "Pro player ID" box', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({
      eligible: [item('r1', 'Jeremiah Smith', true, 'pro-1'), item('r2', 'Arch Manning', true, null), item('r3', 'Other Team Guy', false, 'pro-3')],
      seasonYear: 2027, config: { promotionTiming: 'manager_choice_before_rookie_draft', maxYearlyDevyPromotions: null },
    })))
    render(<DevyPromotionPanel leagueId="L1" />)
    await screen.findByText('Jeremiah Smith')
    expect(screen.queryByText('Other Team Guy')).toBeNull()
    expect(screen.getAllByRole('button', { name: 'Promote' })).toHaveLength(1)
    expect(screen.queryByPlaceholderText(/pro player id/i)).toBeNull()
    expect(document.body.textContent).toMatch(/waiting for his pro match/i)
  })
  it('the route marks each player promotable and limits a manager to their own team', () => {
    const src = read('app/api/leagues/[leagueId]/devy/promotion/route.ts')
    expect(src).toMatch(/canPromote/)
    expect(src).toMatch(/managerUserId: true/)
  })
})

describe('the /devy roster', () => {
  it('counts one taxi player once, shows prospects without a click, and drops repeated labels', async () => {
    render(<DevyRosterClient leagueId="e2e-devy" userId={HARNESS_USER_ID} />)
    await screen.findByText('Jayden Daniels')
    expect(document.body.textContent).not.toMatch(/Show taxi \(2\)/)
    expect(screen.getByText('Bryce Underwood')).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/STARTER|Points shown — do not count|Drop \(soon\)/)
  })
  it('summary tiles wrap instead of running off a phone; the page is wide on desktop', () => {
    expect(read('app/devy/components/TeamSummaryBar.tsx')).not.toMatch(/flex gap-2 overflow-x-auto/)
    expect(read('app/devy/[leagueId]/roster/DevyRosterClient.tsx')).toMatch(/max-w-6xl/)
  })
})

describe('picks', () => {
  it('your picks say who a pick came from, not "You / You / Owned by you"', async () => {
    render(<DevyPicksClient leagueId="e2e-devy" userId={HARNESS_USER_ID} />)
    await waitFor(() => expect(document.body.textContent).toMatch(/Round 1/))
    expect(document.body.textContent).not.toMatch(/Owned by you/)
    expect(document.body.textContent).toMatch(/via The Long Game/)
    expect(document.body.textContent).not.toMatch(/Hover a cell for pick id/)
  })
})

describe('plain words on the Devy tab', () => {
  it('a drafted player is "Drafted", a promotable one "Ready to promote"', () => {
    expect(devyYearTag({ declared: true, draftEligibleYear: 2027, state: 'DRAFTED_RIGHTS_HELD' } as never)).toBe('Drafted')
    expect(devyYearTag({ declared: true, draftEligibleYear: 2027, state: 'PROMOTION_ELIGIBLE' } as never)).toBe('Ready to promote')
    expect(devyYearTag({ declared: true, draftEligibleYear: 2027, state: 'DECLARED' } as never)).toBe('Declared')
  })
  it('the feed names the player or leaves the line out', () => {
    const out = devyFeedItems([{ id: 'e1', eventType: 'force_promote', devyPlayerId: null, createdAt: '2026-11-01' }], () => null)
    expect(out).toEqual([])
  })
  it('no "pros" for college players and no "Open" deadline fallback', () => {
    const src = read('components/league/specialty/devy/DevySpecialtyHome.tsx')
    expect(src).not.toMatch(/'pro' : 'pros'/)
    expect(src).not.toMatch(/fallback=\{win\?\.timingLabel \? 'Open'/)
    expect(src).not.toMatch(/slotGrid/)
  })
  it('commissioner overrides read as a name and plain words, never raw ids or codes', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => String(input).includes('overrides')
      ? json({ overrides: [{ id: 'o1', devyPlayerId: 'dp-other', playerName: 'Arch Manning', proPlayerId: null, action: 'manual_map_pending', notes: null, createdAt: '2026-11-01' }] })
      : json({})))
    render(<DevyCommissionerTools leagueId="L1" />)
    await screen.findByText(/Arch Manning/)
    expect(document.body.textContent).not.toMatch(/dp-other|manual_map_pending/)
  })
  it('Draft Center does not repeat the stash’s slot count', () => {
    render(<DevyDraftCenter leagueId="L1" rookieRounds={4} devyRounds={3} devySlotsUsed={6} devySlotCount={8} current={null} />)
    expect(document.body.textContent).not.toMatch(/Devy slots/)
  })
})

describe('light mode', () => {
  it('the Devy specialty home has light tokens and no always-dark wrapper', () => {
    expect(read('components/league/specialty/specialty.module.css')).toMatch(/\.sp\[data-specialty='devy'\]/)
    expect(read('components/devy/DevyHome.tsx')).not.toMatch(/className="af-draft-dark/)
  })
  it('the /devy pages follow the mode with /core tokens', () => {
    expect(read('app/devy/[leagueId]/layout.tsx')).toMatch(/af-core/)
    for (const f of ['app/devy/[leagueId]/roster/DevyRosterClient.tsx', 'app/devy/[leagueId]/picks/DevyPicksClient.tsx', 'app/devy/components/DevyPlayerCard.tsx', 'app/devy/components/TeamSummaryBar.tsx', 'components/devy/DevyDraftCenter.tsx', 'components/devy/DevyPromotionPanel.tsx', 'components/devy/DevyCommissionerTools.tsx']) {
      expect(read(f), f).not.toMatch(/\btext-white\b|text-white\//)
    }
  })
})
