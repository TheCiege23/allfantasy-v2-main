// @vitest-environment jsdom
/**
 * Survivor, second visual pass (2026-11-24, DB-free harness at /e2e/survivor/*):
 * 1. Tribal after the deadline still drew the ballot, the urn, "Play it before votes close" and "You can still
 *    vote with @Chimmy" under "Voting has closed".
 * 2. A closed challenge still said "Where to submit" and offered "Open chat for submissions".
 * 3. Episodes called a vote whose deadline had passed "still open".
 * 4. Home said the vote had closed three times, and the tribe card read "Tribal tonight" after it.
 * 5. Tribe: members with no score were a bare name; the score bar had no words.
 * 6. Home printed stored codes ("TRIBE · pick") and "Return path follows commissioner rules".
 * 7. Challenges ran ~4,100px on a phone with every past result open.
 * 8. Episodes: "2 episodes so far" above "Episode 9"; confessional dates read "11/6/2026".
 */
import React from 'react'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/survivor/e2e-survivor/tribal',
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({ leagueId: 'e2e-survivor' }),
}))

import { SurvivorVoteCast } from '@/components/survivor/weekly/SurvivorVoteCast'
import { TribeMemberCard } from '@/app/survivor/components/TribeMemberCard'
import { buildSurvivorStatusCard } from '@/lib/survivor/survivorStatusCard'
import { islandChallengeScopeWord, islandEpisodeTribalLine } from '@/lib/survivor/survivorIslandView'
import F from '@/app/e2e/survivor/fixture.json'

const read = (p: string) => readFileSync(path.join(process.cwd(), p), 'utf8')
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

function vote(deadline: string) {
  const view = { ...(F as any).state.tribalCouncil, votingDeadline: deadline }
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ tribalCouncil: view }), { status: 200 })))
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }))
  return render(
    <SurvivorVoteCast leagueId="e2e-survivor" backHref="/survivor/e2e-survivor" initialView={view as never} openFooter={<p data-testid="footer-line">Prefer chat?</p>} />,
  )
}

describe('1. Tribal after the deadline is not a ballot', () => {
  it('closed: no slip, no urn, no "play it before votes close", no chat-vote line', () => {
    const { container } = vote('2026-11-10T01:00:00.000Z')
    expect(screen.getByTestId('survivor-vote-closed')).toBeTruthy()
    expect(container.textContent).not.toMatch(/Choose a name/)
    expect(container.querySelector('img.swl-urn')).toBeNull()
    expect(container.textContent).not.toMatch(/before votes close/)
    expect(screen.queryByTestId('footer-line')).toBeNull()
    expect(screen.getByTestId('survivor-vote-sealed')).toBeTruthy()
  })
  it('open: the ballot and the chat line are there', () => {
    const { container } = vote(new Date(Date.now() + 864e5).toISOString())
    expect(container.textContent).toMatch(/Choose a name/)
    expect(screen.getByTestId('footer-line')).toBeTruthy()
  })
})

describe('2 & 7. Challenges', () => {
  const src = read('app/survivor/[leagueId]/challenges/page.tsx')
  it('a closed challenge does not say where to submit, nor offer the submission chat', () => {
    expect(src).toMatch(/\{automatic \|\| live \? <div className="mt-4 rounded-xl border border-white\/\[0\.08\] bg-black\/25 p-4" data-testid="survivor-challenge-how">/)
    expect(src).toMatch(/\{live && !automatic \? \(\s*<div className="mt-8 text-center md:hidden" data-testid="survivor-challenge-chat-cta">/)
  })
  it('past challenges fold', () => {
    expect(src).toMatch(/<details className="mt-8" data-testid="survivor-past-challenges">/)
  })
})

describe('3 & 8. Episodes', () => {
  it('a council past its deadline reads as waiting to be read, not open', () => {
    const ep = { week: 9, scenes: [] }
    expect(islandEpisodeTribalLine(ep, { openCouncilWeek: 9, votesClosed: true })).toBe('The votes are in. The host reads them next.')
    expect(islandEpisodeTribalLine(ep, { openCouncilWeek: 9, votesClosed: false })).toBe('The vote is still open.')
  })
  it('names the recaps by week, and dates confessionals in words', () => {
    const src = read('app/survivor/[leagueId]/episodes/page.tsx')
    expect(src).not.toMatch(/episodes so far/)
    expect(src).toMatch(/Recaps through week/)
    expect(src).toMatch(/toLocaleDateString\(getAppIntlLocale\(\), \{ month: 'short', day: 'numeric' \}\)/)
    expect(src).toMatch(/islandEpisodeTribalLine\(episode, \{ openCouncilWeek, votesClosed \}\)/)
  })
})

describe('4 & 6. Home', () => {
  it('the status card does not repeat "votes closed" for your own council', () => {
    const season = (F as any).season
    const card = buildSurvivorStatusCard({ season, base: '/survivor/e2e-survivor', now: Date.parse('2026-11-12T00:00:00Z') } as never)
    expect(card?.detail ?? '').toMatch(/Voting has closed/)
    expect((card?.facts ?? []).map((f: { label: string }) => f.label)).not.toContain('Votes closed')
  })
  it('the tribe card says where the tribe is, and no lone dash', () => {
    const src = read('app/survivor/components/TribeCard.tsx')
    expect(src).not.toMatch(/Tribal tonight/)
    expect(src).not.toMatch(/text-white\/35">—</)
  })
  it('scope in words, no stored codes, no "commissioner rules"', () => {
    expect(islandChallengeScopeWord('tribe')).toBe('Tribe challenge')
    expect(islandChallengeScopeWord('individual')).toBe('Individual challenge')
    const src = read('app/survivor/[leagueId]/page.tsx')
    expect(src).not.toMatch(/submissionMode \?\? 'tribe_chat'/)
    expect(src).not.toMatch(/Return path follows commissioner rules/)
  })
})

describe('5. Tribe', () => {
  it('a member with no score says so; an out member does not', () => {
    render(<TribeMemberCard name="Riley" avatarUrl={null} outWeek={null} />)
    expect(screen.getByTestId('survivor-member-no-score').textContent).toBe('No score yet')
    cleanup()
    render(<TribeMemberCard name="Drew" avatarUrl={null} outWeek={6} statusVariant="eliminated" />)
    expect(screen.queryByTestId('survivor-member-no-score')).toBeNull()
  })
  it('the score bar is put in words', () => {
    expect(read('app/survivor/[leagueId]/tribe/page.tsx')).toMatch(/data-testid="survivor-tribe-share"/)
  })
})
