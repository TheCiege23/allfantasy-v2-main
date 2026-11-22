/**
 * One definition of "in this league" for reads (lib/league/leagueMemberWhere.ts): a co-owner, a viewer
 * and a co-commissioner who does not play are members too, and the league page lets them in.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { leagueMemberWhere } from '@/lib/league/leagueMemberWhere'

describe('leagueMemberWhere', () => {
  it('covers the owner, a claimed team, an accepted co-owner, a viewer and both kinds of co-commissioner', () => {
    expect(leagueMemberWhere('u1')).toEqual([
      { userId: 'u1' },
      { teams: { some: { claimedByUserId: 'u1' } } },
      { teamCoOwners: { some: { userId: 'u1', acceptedAt: { not: null } } } },
      { settings: { path: ['importViewerIds'], array_contains: ['u1'] } },
      { settings: { path: ['importCoCommissionerIds'], array_contains: ['u1'] } },
      { settings: { path: ['tournamentCoCommissionerIds'], array_contains: ['u1'] } },
    ])
  })
})

describe('the screens a league mate without a team opens', () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
  it('the league page admits a co-owner, a viewer and a co-commissioner who does not play', () => {
    const page = read('app/league/[leagueId]/page.tsx')
    expect(page).toMatch(/^\s*const teamlessMember = Boolean\(coOwnerRosterId\) \|\| isImportViewer\(league\.settings, userId\) \|\| isTournamentCoCommissioner\(league\.settings, userId\)$/m)
    expect(page).toMatch(/^\s*if \(!isOwner && !userTeam && !teamlessMember\) \{$/m)
    expect(page).not.toMatch(/^\s*if \(!isOwner && !userTeam\) \{$/m)
  })
  it('the league read routes use the shared rule, not owner-or-claimed-team', () => {
    const routes = ['context', 'this-week', 'matchup-center', 'h2h', 'history', 'projected-standings', 'trend-board', 'draft-report', 'trade-grades', 'live-roster'].map((r) => `app/api/league/${r}/route.ts`)
    for (const p of [...routes, 'app/api/dashboard/live-scores/route.ts', 'app/core/(shell)/[[...screen]]/page.tsx']) {
      const src = read(p)
      expect(src, p).toContain('OR: leagueMemberWhere(userId)')
      expect(src, p).not.toMatch(/OR: \[\{ userId(: userId)? \}, \{ teams: \{ some: \{ claimedByUserId: userId \} \} \}\]/)
    }
  })
})
