import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { DraftDecisionOsCard, type DraftDecisionPayload } from '@/components/app/draft-room/DraftDecisionOsCard'

function decision(overrides: Partial<DraftDecisionPayload> = {}): DraftDecisionPayload {
  return {
    decisionId: 'dec_1',
    fourAnswers: {
      what_happened: '3 players ranked for pick 14; the top choice is Atlas Runner (RB, NYJ).',
      why_it_matters: 'Best value.',
      how_confident: 'High confidence.',
      what_to_do: 'Draft Atlas Runner.',
    },
    recommendedActions: [
      { rank: 1, playerName: 'Atlas Runner', position: 'RB', team: 'NYJ', adp: 13, reason: 'Best value.', confidence: 81 },
      { rank: 2, playerName: 'Blaze Catcher', position: 'WR', team: 'DAL', adp: 15, reason: 'Ceiling.', confidence: 74 },
    ],
    ruleVerdicts: [{ rule: 'draft.legality.pick', verdict: 'legal', message: 'This pick would be accepted.' }],
    confidence: 81,
    dataCompleteness: 100,
    uncertaintySources: [],
    forOverall: 14,
    ...overrides,
  }
}

function respond(status: number, body: unknown) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body } as Response)
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

describe('DraftDecisionOsCard', () => {
  it('shows the decision: what to do, the verdict, the confidence and the alternatives', async () => {
    fetchMock.mockReturnValue(respond(200, { decision: decision() }))
    render(<DraftDecisionOsCard leagueId="lg1" refreshKey="14:in_progress:13" />)
    expect(await screen.findByTestId('draft-decision-os-what-to-do')).toHaveProperty('textContent', 'Draft Atlas Runner.')
    expect(screen.getByTestId('draft-decision-os-confidence').textContent).toBe('High · 81')
    expect(screen.getByTestId('draft-decision-os-verdicts').textContent).toContain('This pick would be accepted.')
    expect(screen.getByTestId('draft-decision-os-alternatives').textContent).toContain('Blaze Catcher')
    expect(fetchMock).toHaveBeenCalledWith('/api/leagues/lg1/draft/decision', { cache: 'no-store' })
  })

  it('shows only the blocking verdicts when the top choice cannot be drafted now', async () => {
    fetchMock.mockReturnValue(
      respond(200, {
        decision: decision({
          ruleVerdicts: [{ rule: 'draft.legality.not_on_clock', verdict: 'temporarily_illegal', message: 'You are not on the clock yet.' }],
          fourAnswers: { ...decision().fourAnswers, what_to_do: 'Queue Atlas Runner so the pick is ready when you are on the clock.' },
        }),
      }),
    )
    render(<DraftDecisionOsCard leagueId="lg1" refreshKey="k" />)
    expect((await screen.findByTestId('draft-decision-os-verdicts')).textContent).toBe('You are not on the clock yet.')
  })

  it('stays out of the way when there is no pick decision for this viewer', async () => {
    fetchMock.mockReturnValue(respond(409, { reason: 'no_roster' }))
    const { container } = render(<DraftDecisionOsCard leagueId="lg1" refreshKey="k" />)
    await waitFor(() => expect(container.querySelector('[data-testid="draft-decision-os-card"]')).toBeNull())
  })

  it('says so when the decision cannot be read', async () => {
    fetchMock.mockReturnValue(respond(500, { error: 'boom' }))
    render(<DraftDecisionOsCard leagueId="lg1" refreshKey="k" />)
    expect((await screen.findByTestId('draft-decision-os-error')).textContent).toBe('boom')
  })

  it('refetches when the board moves', async () => {
    fetchMock.mockReturnValue(respond(200, { decision: decision() }))
    const { rerender } = render(<DraftDecisionOsCard leagueId="lg1" refreshKey="14:in_progress:13" />)
    await screen.findByTestId('draft-decision-os-what-to-do')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    rerender(<DraftDecisionOsCard leagueId="lg1" refreshKey="15:in_progress:14" />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
  })
})
