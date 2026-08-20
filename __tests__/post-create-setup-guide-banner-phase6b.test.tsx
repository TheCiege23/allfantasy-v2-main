import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PostCreateSetupGuideBanner } from '@/components/league/PostCreateSetupGuideBanner'

const nav = vi.hoisted(() => ({
  replace: vi.fn(),
  params: new URLSearchParams('guide=settings'),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: nav.replace }),
  useSearchParams: () => nav.params,
}))

describe('PostCreateSetupGuideBanner (Phase 6B dedupe)', () => {
  beforeEach(() => {
    nav.replace.mockClear()
    nav.params = new URLSearchParams('guide=settings')
  })

  it('hides when created=1 (first-run suite owns that handoff)', () => {
    nav.params = new URLSearchParams('created=1&guide=settings')
    render(<PostCreateSetupGuideBanner leagueId="abc" isCommissioner />)
    expect(screen.queryByText(/Your league is ready/i)).toBeNull()
  })

  it('shows for guide=settings without created=1', () => {
    nav.params = new URLSearchParams('guide=settings')
    render(<PostCreateSetupGuideBanner leagueId="abc" isCommissioner />)
    expect(screen.getByText(/Your league is ready/i)).toBeTruthy()
  })
})
