import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { resolveDashboardAvatarUrl } from '@/lib/dashboard/resolve-dashboard-avatar'

/**
 * TWO AVATARS, ONE APP, AND THEY ARE NOT THE SAME PICTURE.
 *
 * Product rule (user, 2026-09-01): changing your AllFantasy avatar changes it everywhere on
 * AllFantasy EXCEPT on league surfaces, which keep showing the image imported from that
 * league (Sleeper/ESPN/etc). So:
 *
 *   platform identity  →  AppUser.avatarUrl     →  account chrome, profile, top nav
 *   league identity    →  LeagueTeam.avatarUrl  →  rosters, standings, matchups, activity
 *
 * The league half already holds: every core-app league module selects `avatarUrl` off the
 * TEAM row, and none of them falls back to the AppUser value. This file guards the platform
 * half, which did not hold.
 */

const REPO = process.cwd()
const read = (p: string) => readFileSync(join(REPO, p), 'utf8')

describe('platform avatar resolution is always fresh', () => {
  it('passes a full URL through and expands a bare Sleeper hash', () => {
    expect(resolveDashboardAvatarUrl('https://cdn.example/a.png')).toBe('https://cdn.example/a.png')
    expect(resolveDashboardAvatarUrl('abc123')).toBe('https://sleepercdn.com/avatars/abc123')
  })

  it('treats absent and blank as no image rather than inventing one', () => {
    expect(resolveDashboardAvatarUrl(null)).toBeUndefined()
    expect(resolveDashboardAvatarUrl(undefined)).toBeUndefined()
    expect(resolveDashboardAvatarUrl('   ')).toBeUndefined()
  })

  /*
   * ⚠ THE ARITY IS THE POINT, NOT A DETAIL. The resolver used to take `sessionImage` first
   * and prefer it. `lib/auth.ts` sets `token.picture` once at sign-in, so that value is
   * frozen into the JWT and never reflects a later avatar change — a caller passing it got
   * the OLD picture forever. Dropping the parameter is what makes the stale value
   * unpassable; if someone re-adds it, this fails before the staleness ships again.
   */
  it('accepts exactly one argument, so a stale session image cannot be passed', () => {
    expect(resolveDashboardAvatarUrl.length).toBe(1)
  })
})

describe('no page hands the frozen JWT image to the resolver', () => {
  /*
   * A source assertion on purpose. The defect was never inside the resolver — it was one
   * call site passing `session.user.image` while the other passed null, so the SAME account
   * rendered two different pictures depending on which page you were on. A unit test of the
   * resolver cannot see that; only the call sites can.
   */
  it.each([
    'app/league/[leagueId]/page.tsx',
    'app/core/[[...screen]]/page.tsx',
  ])('%s resolves from the database, not the session', (file) => {
    const src = read(file)
    expect(src).toContain('resolveDashboardAvatarUrl(')
    expect(src).not.toMatch(/resolveDashboardAvatarUrl\(\s*session\.user\.image/)
    expect(src).not.toMatch(/resolveDashboardAvatarUrl\(\s*null\s*,/)
  })
})

describe('league surfaces keep the imported image', () => {
  /*
   * The other half of the rule, guarded where it is cheapest to guard: the core-app league
   * data modules must read the avatar off the league TEAM row. If one of them ever starts
   * joining AppUser to fill a missing team avatar, a manager's AllFantasy picture would
   * start appearing on a league page — the exact thing the rule forbids.
   */
  it.each([
    'lib/core-app/leagueScoreboard.ts',
    'lib/core-app/leagueActivity.ts',
    'lib/core-app/allPlay.ts',
  ])('%s does not read an AppUser avatar', (file) => {
    const src = read(file)
    expect(src).toContain('avatarUrl')
    expect(src.toLowerCase()).not.toContain('appuser')
  })
})
