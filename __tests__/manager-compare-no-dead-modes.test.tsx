// @vitest-environment jsdom
/**
 * /manager-compare offered "Manager DNA", "Trade Style" and "Opponent Tendencies" tabs whose data
 * came from /api/ai/manager-dna and /api/ai/opponent-tendencies — thin wrappers over handlers
 * retired to a constant 410 PROFILE_SURFACE_RETIRED (Milestone 32). Every one of those tabs was a
 * dead button. The page now offers head-to-head only, and never calls a profile route.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

vi.mock('next-auth/react', () => ({ useSession: () => ({ data: { user: { id: 'u_1' } }, status: 'authenticated' }) }))
vi.mock('@/components/navigation/HomeTopNav', () => ({ default: () => null }))
vi.mock('@/components/landing/SeoLandingFooter', () => ({ default: () => null }))
vi.mock('@/components/landing/LandingToolVisitTracker', () => ({ LandingToolVisitTracker: () => null }))
vi.mock('@/components/ManagerRoleBadge', () => ({ ManagerRoleBadge: () => null }))

import ManagerComparePage from '@/app/manager-compare/page'

function manager(username: string) {
  const grade = { grade: 'B', record: '30-20', championships: 1, leagues_played: 4, note: '' }
  return {
    username,
    role: 'member',
    overall_grade: 'B',
    grades_by_type: { redraft: grade, dynasty: grade, specialty: grade },
    specialty_formats_note: '',
    strengths: ['Drafts well'],
    weaknesses: ['Slow on waivers'],
  }
}

function snapshot(username: string) {
  return {
    username,
    grading_note: 'Graded on five seasons.',
    total_standard_leagues: 4,
    total_specialty_leagues: 0,
    total_leagues_all: 4,
    total_seasons: 5,
    overall_record: '30-20',
    win_percentage: 60,
    championships: 1,
    championship_rate: 25,
    playoffs: 2,
    playoff_rate: 50,
  }
}

const fetchMock = vi.fn()

beforeEach(() => {
  window.localStorage.clear()
  fetchMock.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      ok: true,
      comparison: {
        manager_a: manager('alpha'),
        manager_b: manager('bravo'),
        fair_comparison_possible: true,
        comparable_formats: ['redraft', 'dynasty'],
        winner: 'A',
        winner_username: 'alpha',
        margin: 'SLIGHT',
        verdict: 'Alpha edges it.',
        head_to_head_breakdown: { redraft_winner: 'A', dynasty_winner: 'TIE', specialty_winner: 'N/A' },
      },
      snapshots: { a: snapshot('alpha'), b: snapshot('bravo') },
      remaining: 4,
    }),
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  fetchMock.mockReset()
})

describe('/manager-compare — head-to-head only', () => {
  it('offers no Manager DNA, Trade Style or Opponent Tendencies tab', () => {
    render(<ManagerComparePage />)
    for (const name of [/manager dna/i, /trade style/i, /opponent tendencies/i]) {
      expect(screen.queryByRole('button', { name })).toBeNull()
    }
  })

  it('runs a comparison through the compare route alone and renders the head-to-head result', async () => {
    render(<ManagerComparePage />)
    fireEvent.change(screen.getAllByPlaceholderText('Sleeper username')[0]!, { target: { value: 'alpha' } })
    fireEvent.change(screen.getAllByPlaceholderText('Sleeper username')[1]!, { target: { value: 'bravo' } })
    fireEvent.click(screen.getByRole('button', { name: /compare managers/i }))

    // Positive control: the head-to-head result really rendered.
    await waitFor(() => expect(screen.getByText('Format winners')).toBeTruthy())
    const urls = fetchMock.mock.calls.map(([url]) => String(url))
    expect(urls).toEqual(['/api/legacy/compare'])
    expect(urls.some((u) => u.includes('/api/ai/'))).toBe(false)
  })
})
