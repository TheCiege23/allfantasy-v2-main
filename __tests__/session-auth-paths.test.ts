import { describe, expect, it } from 'vitest'

import { requiresSessionAuth } from '@/lib/auth/session-auth-paths'

/**
 * This rule decides who can open 15 league pages, and it carries one deliberate
 * exception. Both halves need pinning: a gate that stops gating is a silent
 * exposure, and an exception that stops applying silently breaks a share flow.
 */

const LEAGUE = '3146ae38-fb3b-4de8-b4dc-0c0945ec52d8'

describe('the /app/league surface is gated', () => {
  const gated = [
    `/app/league/${LEAGUE}`,
    `/app/league/${LEAGUE}/psychological-profiles`,
    `/app/league/${LEAGUE}/psychological-profiles/compare`,
    `/app/league/${LEAGUE}/psychological-profiles/abc123`,
    `/app/league/${LEAGUE}/drama`,
    `/app/league/${LEAGUE}/relationship-insights`,
    `/app/league/${LEAGUE}/legacy/breakdown`,
    `/app/league/${LEAGUE}/hall-of-fame/moments/m1`,
  ]

  for (const path of gated) {
    it(`requires a session for ${path.replace(LEAGUE, ':id')}`, () => {
      expect(requiresSessionAuth(path)).toBe(true)
    })
  }

  it('gates the same league consistently on both surfaces', () => {
    // The defect was that these two routes described the same league and
    // disagreed about who could see it.
    expect(requiresSessionAuth(`/league/${LEAGUE}`)).toBe(true)
    expect(requiresSessionAuth(`/app/league/${LEAGUE}`)).toBe(true)
  })
})

describe('shared news articles stay reachable', () => {
  it('does not gate an article page', () => {
    // The news page builds a share URL pointing at itself. Gating it would bounce
    // every recipient to a login screen, which reads as the share button being
    // broken rather than as a policy decision.
    expect(requiresSessionAuth(`/app/league/${LEAGUE}/news/article-42`)).toBe(false)
  })

  it('does not let the exception leak beyond article paths', () => {
    // A looser pattern — "contains /news" — would open anything with news in the
    // path, which is how an exception quietly becomes a hole.
    expect(requiresSessionAuth(`/app/league/${LEAGUE}/newsroom`)).toBe(true)
    expect(requiresSessionAuth(`/app/league/${LEAGUE}/drama/news-recap`)).toBe(true)
    expect(requiresSessionAuth(`/app/league/${LEAGUE}/psychological-profiles?tab=news`)).toBe(true)
  })

  it('does not exempt a news path outside the league surface', () => {
    expect(requiresSessionAuth(`/league/${LEAGUE}/news/article-42`)).toBe(true)
  })
})

describe('the existing gates are unchanged', () => {
  it('still gates rankings routes', () => {
    expect(requiresSessionAuth('/af-rankings')).toBe(true)
    expect(requiresSessionAuth('/dashboard/rankings')).toBe(true)
  })

  it('still leaves public routes open', () => {
    for (const path of ['/', '/pricing', '/login', '/signup', '/dashboard', '/players']) {
      expect(requiresSessionAuth(path)).toBe(false)
    }
  })
})
