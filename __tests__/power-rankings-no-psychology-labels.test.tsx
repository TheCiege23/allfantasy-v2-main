/**
 * Milestone 32: a manager characterisation LABEL (archetype, trait scores, blind spot,
 * negotiation style) is shown to NOBODY. The power-rankings page used to offer one on every
 * team a viewer expanded — "Get My Coaching Insight" queued a `psychology` job that fetched
 * `/api/rankings/manager-psychology` and rendered `{emoji} {archetype}`, strengths, weaknesses
 * and a summary about that manager, whoever they were.
 *
 * These tests drive the REAL page, not a stub of it: pick a league, expand a team, and look at
 * the coach card. The roadmap button is the positive control — it proves the card rendered and
 * that the plan request still flows and renders, so "no insight button" cannot pass on an empty
 * screen. The plan is requested straight from `/api/rankings/dynasty-roadmap` under the viewer's
 * session; the BullMQ job route it once went through had no consumer in production.
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

import { LanguageProviderClient } from '@/components/i18n/LanguageProviderClient'

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { id: 'viewer-1' } }, status: 'authenticated' }),
}))

import PowerRankingsPage from '@/components/core-app/rankings/power/PowerRankingsPanel'

/** What the retired profile generator used to return — the label a viewer must never see. */
const LABEL_PAYLOAD = {
  archetype: 'The Aggressive Trader',
  emoji: '🔥',
  summary: 'Moves early and overpays for certainty.',
  traits: [{ trait: 'Risk appetite', score: 80, description: 'x' }],
  tendencies: ['Sells picks for vets', 'Reaches in drafts'],
  blindSpot: 'Ignores depth',
  negotiationStyle: 'Hardball',
  riskProfile: 'HIGH',
  decisionSpeed: 'IMPULSIVE',
}

const RAW_TEAM = {
  rosterId: 7,
  ownerId: 'owner-7',
  username: 'rival_manager',
  displayName: 'Rival Team',
  avatar: null,
  role: 'member',
  isOrphan: false,
  winScore: 60,
  powerScore: 55,
  luckScore: 50,
  marketValueScore: 58,
  managerSkillScore: 52,
  composite: 57,
  rank: 1,
  prevRank: 1,
  rankDelta: 0,
  record: { wins: 4, losses: 2, ties: 0 },
  pointsFor: 700,
  pointsAgainst: 650,
  expectedWins: 4,
  streak: 1,
  luckDelta: 0,
  shouldBeRecord: { wins: 4, losses: 2 },
  bounceBackIndex: 0,
  motivationalFrame: {
    headline: 'Steady',
    subtext: 'Record matches the points.',
    suggestedAction: 'Hold',
    tone: 'neutral',
    trigger: 'none',
  },
  starterValue: 5000,
  benchValue: 1200,
  totalRosterValue: 6200,
  pickValue: 0,
  positionValues: {
    QB: { starter: 1000, bench: 100, total: 1100 },
    RB: { starter: 1500, bench: 400, total: 1900 },
    WR: { starter: 2000, bench: 600, total: 2600 },
    TE: { starter: 500, bench: 100, total: 600 },
  },
  rosterExposure: { QB: 18, RB: 30, WR: 42, TE: 10 },
  marketAdj: 0,
  phase: 'Mid-Pack',
  explanation: {
    confidence: { score: 70, rating: 'MEDIUM', drivers: [] },
    drivers: [],
    nextActions: [],
    valid: true,
  },
  rankChangeDrivers: [],
  forwardOdds: { playoffPct: 60, top3Pct: 30, titlePct: 10, simCount: 1000 },
  confidenceBadge: { tier: 'SILVER', label: 'Fair', tooltip: '' },
  rankSparkline: [1, 1],
}

/** A roadmap answer that ALSO carries the retired label, so a render path that read it would show it. */
const ROADMAP = {
  horizon: '3-5 years',
  currentPhase: 'Contend',
  overallStrategy: 'Push for a title while the receiver room is young.',
  yearPlans: [{ year: 2026, label: 'Win now', priorities: ['Add a TE'], targetPositions: ['TE'], keyMoves: ['Trade a 2nd'] }],
  riskFactors: ['Thin at TE'],
  confidence: 'MEDIUM',
}

const RANKINGS = {
  leagueId: '999',
  leagueName: 'Test League',
  season: '2026',
  week: 6,
  phase: 'regular',
  isDynasty: true,
  isSuperFlex: false,
  computedAt: 0,
  teams: [RAW_TEAM],
}

type Call = { url: string; method: string; body: unknown }
let calls: Call[] = []

function json(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }))
}

beforeEach(() => {
  calls = []
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = (init?.method ?? 'GET').toUpperCase()
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null
      calls.push({ url, method, body })
      if (url.startsWith('/api/league/list')) {
        return json({
          leagues: [
            { id: 'L1', name: 'Test League', platform: 'sleeper', platformLeagueId: '999', season: '2026', sport: 'NFL' },
          ],
        })
      }
      if (url.startsWith('/api/rankings/league-v2')) return json(RANKINGS)
      if (url === '/api/rankings/dynasty-roadmap' && method === 'POST') {
        // Answer as if the retired generator had run alongside, so a surviving render path WOULD
        // put the label on screen. Only its absence from the page can make this pass.
        return json({ roadmap: ROADMAP, psychology: LABEL_PAYLOAD })
      }
      if (url.startsWith('/api/rankings/manager-psychology')) return json(LABEL_PAYLOAD)
      return json({ error: 'unexpected' }, 404)
    }),
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

async function openTeam() {
  render(
    <LanguageProviderClient>
      <PowerRankingsPage />
    </LanguageProviderClient>,
  )
  fireEvent.click(await screen.findByRole('button', { name: /Test League/ }))
  const toggles = await screen.findAllByRole('button', { name: /Rival Team/ })
  fireEvent.click(toggles[0])
  // Positive control: the coach card is on screen.
  return screen.findByRole('button', { name: /Generate 3-5 Year Plan/ })
}

describe('power rankings — no manager characterisation label', () => {
  it('offers no "coaching insight" (psychology) action on an expanded team', async () => {
    await openTeam()
    expect(screen.queryByRole('button', { name: /coaching insight/i })).toBeNull()
  })

  it('never asks for a psychology profile and never renders an archetype, whatever the plan returns', async () => {
    const plan = await openTeam()

    // Press every action the coach card offers. Before the retirement one of them queued the
    // psychology job, which fetched the profile and rendered its label.
    fireEvent.click(plan)
    for (const b of screen.queryAllByRole('button', { name: /insight/i })) fireEvent.click(b)

    // Positive control: the plan request went out and its answer rendered.
    expect(await screen.findByText(/Push for a title while the receiver room is young/)).toBeTruthy()
    const planRequests = calls.filter((c) => c.url === '/api/rankings/dynasty-roadmap' && c.method === 'POST')
    expect(planRequests).toHaveLength(1)
    expect(planRequests[0].body).toMatchObject({ sport: 'NFL', leagueType: 'Dynasty', isSF: false, leagueName: 'Test League' })

    expect(calls.some((c) => c.url.startsWith('/api/rankings/manager-psychology'))).toBe(false)
    expect(calls.some((c) => c.url.startsWith('/api/power-rankings/'))).toBe(false)

    expect(screen.queryByText(/The Aggressive Trader/)).toBeNull()
    expect(screen.queryByText(/Moves early and overpays/)).toBeNull()
    expect(screen.queryByText(/Ignores depth/)).toBeNull()
  })
})
