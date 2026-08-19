import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The panel is where the server's honesty either reaches a person or is thrown
 * away at the last step.
 *
 * Every score column is `Float @default(0)`, and this panel used to print
 * `Math.round(profile.riskToleranceScore)`. So a manager nobody had ever
 * observed rendered as a confident "Risk 0" — the exact fabrication the evidence
 * gate exists to prevent, reintroduced in the final render. The server now sends
 * `displayScores` with nulls for unmeasured dimensions; these tests pin that the
 * UI shows them as unmeasured.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))

const OWN = {
  id: 'p-own',
  managerId: '9',
  sport: 'NFL',
  sportLabel: 'NFL',
  profileLabels: ['trade-heavy'],
  aggressionScore: 61,
  activityScore: 40,
  tradeFrequencyScore: 55,
  waiverFocusScore: 12,
  riskToleranceScore: 48,
  updatedAt: new Date(0).toISOString(),
  displayScores: {
    aggressionScore: 61,
    activityScore: 40,
    tradeFrequencyScore: 55,
    waiverFocusScore: 12,
    riskToleranceScore: 48,
  },
  evidenceSummary: {
    dimensions: {
      trade: { evidenceCount: 29, sufficient: true, confidence: 'high' as const },
      draft: { evidenceCount: 44, sufficient: true, confidence: 'high' as const },
      roster: { evidenceCount: 0, sufficient: false, confidence: null },
    },
    observedDimensions: ['trade', 'draft'],
    missingDimensions: ['roster'],
    anySufficient: true,
  },
}

// Watched drafting, never watched trading. The scores that rest on trading must
// come back unmeasured even though the manager is well observed overall.
const PARTIAL = {
  ...OWN,
  id: 'p-partial',
  managerId: '3',
  profileLabels: ['early-round focused'],
  displayScores: {
    aggressionScore: null,
    activityScore: null,
    tradeFrequencyScore: null,
    waiverFocusScore: null,
    riskToleranceScore: null,
  },
  evidenceSummary: {
    dimensions: {
      trade: { evidenceCount: 0, sufficient: false, confidence: null },
      draft: { evidenceCount: 44, sufficient: true, confidence: 'high' as const },
      roster: { evidenceCount: 0, sufficient: false, confidence: null },
    },
    observedDimensions: ['draft'],
    missingDimensions: ['trade', 'roster'],
    anySufficient: true,
  },
}

const LOCKED = {
  id: 'p-locked',
  managerId: '5',
  sport: 'NFL',
  sportLabel: 'NFL',
  profileLabels: [],
  aggressionScore: 0,
  activityScore: 0,
  tradeFrequencyScore: 0,
  waiverFocusScore: 0,
  riskToleranceScore: 0,
  updatedAt: new Date(0).toISOString(),
  locked: true,
  lockedReason: 'Manager psychology for other managers is a premium capability.',
  displayScores: null,
  evidenceSummary: {
    dimensions: {
      trade: { evidenceCount: 8, sufficient: true, confidence: 'moderate' as const },
      draft: { evidenceCount: 44, sufficient: true, confidence: 'high' as const },
      roster: { evidenceCount: 0, sufficient: false, confidence: null },
    },
    observedDimensions: ['trade', 'draft'],
    missingDimensions: ['roster'],
    anySufficient: true,
  },
}

async function renderPanel(profiles: unknown[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ profiles }),
    })) as unknown as typeof fetch
  )
  const { default: BehaviorProfilesPanel } = await import(
    '@/components/app/settings/BehaviorProfilesPanel'
  )
  render(<BehaviorProfilesPanel leagueId="L1" />)
  // Anchor on rendered card content — a bare manager id also matches the season
  // <option> values in the filter row.
  await waitFor(() => expect(screen.getAllByText(/Risk /).length).toBeGreaterThan(0))
}

beforeEach(() => vi.resetModules())
afterEach(() => vi.unstubAllGlobals())

describe('the panel never prints a score it did not measure', () => {
  it('shows a dash, not 0, for unmeasured scores', async () => {
    await renderPanel([OWN, PARTIAL])
    // The manager with no trading observed must not read "Risk 0".
    expect(screen.getByText('Risk —')).toBeTruthy()
    expect(screen.queryByText('Risk 0')).toBeNull()
  })

  it('still prints scores that were measured', async () => {
    // The fix must be a gate, not a blanket redaction.
    await renderPanel([OWN, PARTIAL])
    expect(screen.getByText('Risk 48')).toBeTruthy()
    expect(screen.getByText('Agg 61')).toBeTruthy()
  })

  it('says what it observed in plain words', async () => {
    await renderPanel([OWN])
    expect(screen.getByText(/44 picks/)).toBeTruthy()
    expect(screen.getByText(/29 trade actions/)).toBeTruthy()
  })
})

describe('absence and locking are stated, not implied', () => {
  it('labels an unobserved manager as unobserved rather than blank', async () => {
    await renderPanel([OWN, LOCKED])
    // An empty label strip reads as "nothing notable about them".
    expect(screen.getByText('Locked')).toBeTruthy()
  })

  it('shows the locked reason and a way to unlock', async () => {
    await renderPanel([OWN, LOCKED])
    expect(screen.getByText(/premium capability/)).toBeTruthy()
    expect(screen.getByText('Unlock')).toBeTruthy()
  })

  it('shows coverage on a locked card without revealing what it means', async () => {
    // "8 trade actions observed" is honest about how much we watched; the labels
    // and scores stay withheld.
    await renderPanel([LOCKED, OWN])
    expect(screen.getByText(/8 trade actions/)).toBeTruthy()
    expect(screen.queryByText('trade-heavy')).toBeTruthy() // OWN's label, not LOCKED's
  })
})
