// @vitest-environment node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

/*
 * One Sleeper league is one `League` row PER IMPORTER. A viewer who plays a league somebody else
 * also imported sees both rows, and the list keeps one. Measured 2026-09-25 on KBFL: the kept row
 * alternated between two ids from one page load to the next, because the two rows tie on
 * [season, name] and the database decided. Every `?league=` link built from the other copy was then
 * dropped by /core as "not your league" and landed on All leagues.
 *
 * Two fixes, pinned here: the SAME row wins every time (the viewer's own import first), and a link
 * to the other copy lands on the viewer's copy instead of being dropped.
 */

const leagueRows = vi.hoisted(() => ({ current: [] as unknown[] }))
vi.mock('@/lib/prisma', () => {
  const model = (name: string) =>
    new Proxy(
      {},
      {
        get: (_t, op) => {
          if (typeof op !== 'string' || op === 'then') return undefined
          return async () => {
            if (name === 'league' && op === 'findMany') return leagueRows.current
            if (op === 'findUnique' || op === 'findFirst') return null
            return []
          }
        },
      },
    )
  return {
    prisma: new Proxy(
      {},
      { get: (_t, name) => (typeof name === 'string' && name !== 'then' ? model(name) : undefined) },
    ),
  }
})

import {
  collapseLeagueSeasons,
  defaultLeagueRowTieBreak,
  getDashboardLeagueListForUser,
} from '@/lib/dashboard/get-dashboard-league-list'
import { findPlayedAlias } from '@/lib/core-app/leagueRowAlias'

const row = (over: Record<string, unknown>): Record<string, unknown> => ({
  name: 'KBFL',
  platform: 'sleeper',
  platformLeagueId: 'SL-KBFL',
  season: 2026,
  ...over,
})

describe('collapseLeagueSeasons — a tie is never decided by arrival order', () => {
  it('🛑 two copies of one league and season: the same one wins whichever arrives first', () => {
    const older = row({ id: 'row-z', createdAt: new Date('2026-01-01T00:00:00Z') })
    const newer = row({ id: 'row-a', createdAt: new Date('2026-06-01T00:00:00Z') })
    expect(collapseLeagueSeasons([older, newer])[0]!.id).toBe('row-z')
    expect(collapseLeagueSeasons([newer, older])[0]!.id).toBe('row-z')
  })

  it('with no import date on either, the lower id wins — in both orders', () => {
    const a = row({ id: 'aaa' })
    const b = row({ id: 'bbb' })
    expect(collapseLeagueSeasons([b, a])[0]!.id).toBe('aaa')
    expect(collapseLeagueSeasons([a, b])[0]!.id).toBe('aaa')
  })

  it('a dated row beats an undated one', () => {
    expect(defaultLeagueRowTieBreak(row({ id: 'z', createdAt: '2026-01-01' }), row({ id: 'a' }))).toBeLessThan(0)
  })

  it('a caller’s preference decides a tie', () => {
    const mine = row({ id: 'mine', createdAt: new Date('2026-06-01') })
    const theirs = row({ id: 'theirs', createdAt: new Date('2026-01-01') })
    const prefer = (x: Record<string, unknown>, y: Record<string, unknown>) =>
      x.id === 'mine' ? -1 : y.id === 'mine' ? 1 : 0
    expect(collapseLeagueSeasons([theirs, mine], undefined, prefer)[0]!.id).toBe('mine')
    expect(collapseLeagueSeasons([mine, theirs], undefined, prefer)[0]!.id).toBe('mine')
  })

  it('a newer season still wins over any tie-break', () => {
    const prefer = () => -1
    const current = row({ id: 'current', season: 2026 })
    const last = row({ id: 'last', season: 2025 })
    expect(collapseLeagueSeasons([current, last], undefined, prefer)[0]!.id).toBe('current')
  })
})

describe('🛑 getDashboardLeagueListForUser — the viewer’s own copy of a shared league', () => {
  const base = {
    sport: 'NFL',
    leagueVariant: null,
    leagueSize: 32,
    status: 'in_season',
    settings: {},
    redraftMembers: [],
    teams: [],
    rosters: [],
    isCommissioner: false,
    lastSyncedAt: null,
  }
  // Somebody else imported it first; the viewer's own import came later.
  const theirs = row({ ...base, id: 'their-copy', userId: 'u-other', createdAt: new Date('2026-01-01') })
  const mine = row({ ...base, id: 'my-copy', userId: 'u-me', createdAt: new Date('2026-08-01') })

  const kept = async () =>
    (await getDashboardLeagueListForUser('u-me')).leagues
      .filter((l) => (l as { platformLeagueId?: string }).platformLeagueId === 'SL-KBFL')
      .map((l) => (l as { id: string }).id)

  it('keeps one row, and it is the viewer’s, whichever order the database returns them in', async () => {
    leagueRows.current = [theirs, mine]
    expect(await kept()).toEqual(['my-copy'])
    leagueRows.current = [mine, theirs]
    expect(await kept()).toEqual(['my-copy'])
  })

  it('with neither copy the viewer’s own, still the same one every time', async () => {
    const other = { ...mine, id: 'third-copy', userId: 'u-third' }
    leagueRows.current = [other, theirs]
    const first = await kept()
    leagueRows.current = [theirs, other]
    expect(await kept()).toEqual(first)
    expect(first).toEqual(['their-copy'])
  })
})

describe('findPlayedAlias — a link to the other copy lands on the viewer’s', () => {
  const played = [
    { id: 'my-copy', platform: 'sleeper', platformLeagueId: 'SL-KBFL' },
    { id: 'native', platform: 'allfantasy', platformLeagueId: null },
  ]

  it('resolves another importer’s row of a league the viewer plays to the viewer’s row', () => {
    expect(findPlayedAlias({ platform: 'Sleeper', platformLeagueId: 'SL-KBFL' }, played)).toBe('my-copy')
  })

  it('🛑 never resolves a league the viewer does not play', () => {
    expect(findPlayedAlias({ platform: 'sleeper', platformLeagueId: 'SL-STRANGER' }, played)).toBeNull()
  })

  it('the same id on another platform is another league', () => {
    expect(findPlayedAlias({ platform: 'espn', platformLeagueId: 'SL-KBFL' }, played)).toBeNull()
  })

  it('nothing to match on, nothing matched', () => {
    expect(findPlayedAlias(null, played)).toBeNull()
    expect(findPlayedAlias({ platform: 'allfantasy', platformLeagueId: null }, played)).toBeNull()
  })
})

describe('the /core page redirects a stale copy instead of dropping it', () => {
  const page = readFileSync(resolve(__dirname, '..', 'app/core/[[...screen]]/page.tsx'), 'utf8')
  const block = page.slice(
    page.indexOf('if (selectedLeagueId && !selectedLeagueRow) {'),
    page.indexOf('if (selectedLeagueId && !selectedLeagueRow) {') + 1400,
  )

  it('looks the requested row up, aliases it against the played list, and keeps the redirect', () => {
    expect(block).toContain('findPlayedAlias(requested, playedLeagues)')
    expect(block).toContain("safeParams.set('league', alias)")
    expect(block).toMatch(/redirect\(`\/core/)
    // The alias is set AFTER the loop that strips the stale id, or the loop would not matter.
    expect(block.indexOf("key !== 'league'")).toBeLessThan(block.indexOf("safeParams.set('league', alias)"))
  })
})
