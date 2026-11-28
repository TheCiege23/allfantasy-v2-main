import { describe, expect, it } from 'vitest'
import {
  buildPostCreateLeagueHomeHref,
  isPostCreateLeagueShellHandoff,
} from '@/lib/league/post-create-navigation'

describe('post-create handoff normalization', () => {
  it('routes all specialty formats with leagueId to /league/[id] with shared query flags', () => {
    const base = buildPostCreateLeagueHomeHref({
      leagueId: 'lg_1',
      leagueType: 'survivor',
      allowInviteLink: true,
    })
    expect(base.startsWith('/league/lg_1?')).toBe(true)
    const u = new URL(base, 'http://localhost')
    expect(u.searchParams.get('created')).toBe('1')
    expect(u.searchParams.get('guide')).toBe('settings')
    // Chat no longer opens over a league you just made (owner, 2026-11-25).
    expect(u.searchParams.get('openChat')).toBeNull()
    expect(u.searchParams.get('showInvite')).toBe('1')
    expect(u.searchParams.get('playIntro')).toBe('1')
  })

  it('routes tournament create to /tournament/[id] even when a feeder leagueId is present', () => {
    const href = buildPostCreateLeagueHomeHref({
      leagueId: 'feeder_a',
      leagueType: 'tournament',
      tournamentId: 'tour_99',
      allowInviteLink: false,
    })
    const u = new URL(href, 'http://localhost')
    expect(u.pathname).toBe('/tournament/tour_99')
    expect(u.pathname.startsWith('/league/')).toBe(false)
    expect(u.searchParams.get('created')).toBe('1')
    expect(u.searchParams.get('showInvite')).toBe('1')
  })

  it('routes tournament create to /tournament/[id] when no feeder leagueId is returned', () => {
    const href = buildPostCreateLeagueHomeHref({
      leagueType: 'tournament',
      tournamentId: 'tour_only',
    })
    const u = new URL(href, 'http://localhost')
    expect(u.pathname).toBe('/tournament/tour_only')
    expect(u.searchParams.get('created')).toBe('1')
    expect(u.searchParams.get('showInvite')).toBe('1')
  })

  it('keeps non-tournament concepts on /league/[leagueId]', () => {
    for (const leagueType of ['redraft', 'dynasty', 'keeper', 'best_ball', 'survivor', 'guillotine'] as const) {
      const href = buildPostCreateLeagueHomeHref({
        leagueId: 'lg_non_tourn',
        leagueType,
        allowInviteLink: true,
      })
      const u = new URL(href, 'http://localhost')
      expect(u.pathname).toBe('/league/lg_non_tourn')
      expect(u.pathname.startsWith('/tournament/')).toBe(false)
    }
  })

  it('detects post-create shell handoff from search params', () => {
    expect(isPostCreateLeagueShellHandoff({ created: '1' })).toBe(true)
    expect(isPostCreateLeagueShellHandoff({ created: 'true' })).toBe(true)
    expect(isPostCreateLeagueShellHandoff({})).toBe(false)
  })

  it('encodes league ids in the path', () => {
    const href = buildPostCreateLeagueHomeHref({
      leagueId: 'league+id%test',
      leagueType: 'redraft',
    })
    expect(href).toContain(encodeURIComponent('league+id%test'))
  })
})
