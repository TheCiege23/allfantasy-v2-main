import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { hydrateRedraftLineupLocks } from '@/lib/redraft/lineupLock'

/**
 * The redraft lineup lock is DERIVED, not stored — so there is no lock state for a trade reversal to
 * preserve or restore.
 *
 * 🛑 WHY THIS FILE EXISTS. Trade reversal shipped with a caveat telling commissioners that "players who
 * were locked before this trade come back unlocked", and a task to "preserve lock state" followed from
 * it. Both rested on reading `RedraftRosterPlayer.isLocked` as stored state. It is not:
 *   - `hydrateRedraftLineupLocks` computes the lock from `SportsGame` kickoffs at request time and stamps
 *     it onto players IN MEMORY
 *   - no code writes `isLocked: true` to the column; the only writes are `false`, from settlement
 *   - measured 2026-09-12: 62,934 `redraft_roster_players` rows in production, 0 with `isLocked = true`
 *
 * These tests make that fact fail loudly if it ever stops being true, so nobody builds "preservation"
 * of a column that means nothing — or restores a recorded lock into a scoring period that has ended.
 */

const NOW = new Date('2026-09-13T18:00:00.000Z')
const PAST = new Date(NOW.getTime() - 60 * 60 * 1000)
const FUTURE = new Date(NOW.getTime() + 60 * 60 * 1000)

/**
 * A client that answers exactly one read and throws on EVERYTHING else — any write, any other model.
 * A mock that returned data for every call could not tell "derives in memory" from "writes the column".
 */
function readOnlySchedule(games: { homeTeam: string; awayTeam: string; startTime: Date }[]) {
  const sportsGame = new Proxy(
    { findMany: async () => games },
    {
      get(target, prop) {
        if (prop === 'findMany') return target.findMany
        if (prop === 'then') return undefined
        throw new Error(`lineup lock touched sportsGame.${String(prop)} — it must only read the schedule`)
      },
    },
  )
  return new Proxy({} as Record<string, unknown>, {
    get(_t, prop) {
      if (prop === 'sportsGame') return sportsGame
      if (prop === 'then') return undefined
      throw new Error(`lineup lock touched prisma.${String(prop)} — it must not read or write roster state`)
    },
  })
}

describe('redraft lineup lock is derived at read time', () => {
  it('locks by kickoff and ignores whatever the stored column says', async () => {
    const prisma = readOnlySchedule([
      { homeTeam: 'KC', awayTeam: 'LV', startTime: PAST },
      { homeTeam: 'BUF', awayTeam: 'MIA', startTime: FUTURE },
    ])

    const { players } = await hydrateRedraftLineupLocks(prisma as never, {
      sport: 'NFL',
      season: 2026,
      week: 2,
      rosterId: 'r-1',
      leagueSettings: {},
      now: NOW,
      players: [
        // Stored FALSE, but the game has kicked off: derived lock is TRUE.
        { playerId: 'p-kc', team: 'KC', isLocked: false },
        // Stored TRUE, but the game has not started: derived lock is FALSE.
        { playerId: 'p-buf', team: 'BUF', isLocked: true },
      ],
    })

    expect(players.find((p) => p.playerId === 'p-kc')?.isLocked).toBe(true)
    expect(players.find((p) => p.playerId === 'p-buf')?.isLocked).toBe(false)
  })

  it('never writes: the only thing it may touch is the schedule read', async () => {
    // The proxy throws on any other access, so reaching this assertion is the proof.
    const prisma = readOnlySchedule([{ homeTeam: 'KC', awayTeam: 'LV', startTime: PAST }])
    await expect(
      hydrateRedraftLineupLocks(prisma as never, {
        sport: 'NFL',
        season: 2026,
        week: 2,
        rosterId: 'r-1',
        leagueSettings: {},
        now: NOW,
        players: [{ playerId: 'p-kc', team: 'KC', isLocked: false }],
      }),
    ).resolves.toBeDefined()
  })

  it('trade reversal does not write isLocked — there is nothing to restore', () => {
    const src = readFileSync(resolve(process.cwd(), 'lib/redraft/tradeReversal.ts'), 'utf8')
    // Strip comments: the module EXPLAINS isLocked in prose; it must not SET it in any data object.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    expect(code).not.toMatch(/isLocked\s*:/)
  })
})
