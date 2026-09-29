// @vitest-environment node
/**
 * 🛑 The injury feed reads the viewer's rosters in EVERY league, and their ids are not all Sleeper's.
 *
 * The injury context and names are keyed on NFL Sleeper ids. Passed through raw, a Fleaflicker id
 * that equals a Sleeper id (44 of the 248 on the production Fleaflicker league do) or a native NHL
 * roster's Rolling Insights id (13 of 18 on the reachable production NHL roster do — 1332 is Sleeper's
 * Ifeanyi Momah) announced a stranger as injured "on 1 of your rosters". ESPN ids are the other half:
 * translatable, so the viewer's own injured ESPN player should appear — once, merged with the same
 * player on a Sleeper roster.
 *
 * The real `computeUserPlayerExposure` runs; the mock database honours the query's `where`.
 */
import { describe, expect, it, vi } from 'vitest'

type Where = Record<string, unknown>
type Row = Record<string, unknown>

const ROSTERS: Row[] = [
  { id: 'r-slp', leagueId: 'L-slp', platformUserId: 'u1', playerData: { players: ['9228', '4046'] }, league: { platform: 'sleeper', sport: 'NFL' } },
  { id: 'r-flea', leagueId: 'L-flea', platformUserId: 'u1', playerData: { players: ['6038'] }, league: { platform: 'fleaflicker', sport: 'NFL' } },
  { id: 'r-nhl', leagueId: 'L-nhl', platformUserId: 'u1', playerData: { players: ['1332'] }, league: { platform: 'manual', sport: 'NHL' } },
  { id: 'r-espn', leagueId: 'L-espn', platformUserId: 'u1', playerData: { players: ['4040404', '5050505'] }, league: { platform: 'espn', sport: 'NFL' } },
  { id: 'r-other-user', leagueId: 'L-x', platformUserId: 'u2', playerData: { players: ['4046'] }, league: { platform: 'sleeper', sport: 'NFL' } },
]
const IDENTITY_MAP: Row[] = [{ espnId: '4040404', sleeperId: '4046' }]
/** The Sleeper-keyed injury table: 6038 and 1332 ARE Sleeper ids — for strangers. */
const SLEEPER_INJURED: Record<string, string> = { '6038': 'O', '1332': 'O', '4046': 'Q' }
const SLEEPER_NAMES: Record<string, string> = { '4046': 'Mapped Guy', '6038': 'Sleeper Stranger', '1332': 'Ifeanyi Momah', '9228': 'Bryce Young' }

function matches(row: Row, where: Where): boolean {
  for (const [key, cond] of Object.entries(where)) {
    if (cond && typeof cond === 'object') {
      const c = cond as { in?: unknown[]; not?: unknown }
      if (c.in && !c.in.includes(row[key])) return false
      if ('not' in c && row[key] === c.not) return false
    } else if (row[key] !== cond) return false
  }
  return true
}

const h = vi.hoisted(() => ({ injuryAsked: [] as string[] }))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    userProfile: { findUnique: vi.fn(async () => null) },
    roster: { findMany: vi.fn(async ({ where }: { where: Where }) => ROSTERS.filter((r) => matches(r, where))) },
    playerIdentityMap: { findMany: vi.fn(async ({ where }: { where: Where }) => IDENTITY_MAP.filter((r) => matches(r, where))) },
  },
}))
vi.mock('@/lib/decision-os/world/injuryEnrichedWorld', () => ({
  resolveInjuryContext: vi.fn(async (_sport: string, ids: string[]) => {
    h.injuryAsked.push(...ids)
    return {
      byId: new Map(
        ids
          .filter((id) => SLEEPER_INJURED[id])
          .map((id) => [id, { status: SLEEPER_INJURED[id], availabilityCategory: 'unavailable', freshness: null }]),
      ),
    }
  }),
}))
vi.mock('@/lib/roster/resolvePlayerNames', () => ({
  resolvePlayerNamesForSport: vi.fn(async (ids: string[]) => new Map(ids.map((id) => [id, SLEEPER_NAMES[id] ?? `Player ${id}`]))),
}))

import { collectRosterInjuryActivity } from '@/lib/activity/sources/rosterInjuryActivity'

describe('collectRosterInjuryActivity — ids from other platforms and sports', () => {
  it('never announces the Sleeper player who shares a Fleaflicker or native NHL id', async () => {
    const items = await collectRosterInjuryActivity({ userId: 'u1', leagues: [], limit: 50 })
    const text = items.map((i) => i.description).join(' | ')
    expect(text).not.toContain('Sleeper Stranger')
    expect(text).not.toContain('Ifeanyi Momah')
    // Neither foreign id was ever asked of the Sleeper-keyed injury table.
    expect(h.injuryAsked).not.toContain('6038')
    expect(h.injuryAsked).not.toContain('1332')
  })

  it('translates an ESPN id and merges it with the same player on a Sleeper roster; drops the unmapped one', async () => {
    const items = await collectRosterInjuryActivity({ userId: 'u1', leagues: [], limit: 50 })
    expect(items.map((i) => i.description)).toEqual(['Mapped Guy → Questionable — on 2 of your rosters'])
    expect(h.injuryAsked).not.toContain('5050505')
    expect(h.injuryAsked).not.toContain('4040404')
  })
})
