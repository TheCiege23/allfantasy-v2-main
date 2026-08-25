import 'server-only'

import { unstable_cache } from 'next/cache'

import { prisma } from '@/lib/prisma'

/**
 * Own % and start %, computed from AllFantasy's OWN rosters.
 *
 * ⚠ THIS WAS PREVIOUSLY WRITTEN OFF AS UNAVAILABLE, AND THAT WAS WRONG. The
 * reasoning was that no vendor in our contracts supplies ownership percentages
 * — true, and beside the point. We do not need a vendor to tell us who is
 * rostered: every imported league's `Roster.playerData` says exactly that. The
 * number is ours to compute, and it gets better every time somebody imports a
 * league.
 *
 * ⚠ AND IT IS APP-WIDE, NOT PER-ROSTER. The old "share" column divided a
 * player's projection by his own team's total, which answered a different and
 * much smaller question. What a manager wants to know is what the field is
 * doing: is this guy universally started, or is he a bench stash everywhere?
 *
 *   own %   — of the leagues we hold, how many have him on a roster at all
 *   start % — of the leagues that roster him, how many have him in a STARTING
 *             slot this week
 *
 * Start % moves on its own with byes, injuries and role changes, because it is
 * read from lineups people actually set rather than from a static list.
 *
 * ⚠ THE SAMPLE IS SMALL AND THE NUMBER MUST CARRY IT. Early on this is computed
 * over a handful of leagues, where one manager's decision swings a percentage
 * by double digits. `leaguesCounted` travels with every row so a surface can
 * refuse to render a percentage drawn from four leagues — which is the
 * difference between a market signal and a rounding error.
 */

export type RosteredMarket = {
  /** 0–1. Share of counted leagues holding this player on any roster. */
  ownPct: number
  /**
   * 0–1. Share of the leagues that roster him where he is in a starting slot.
   *
   * Null when nobody rosters him — a start rate over zero leagues is not zero,
   * it is undefined, and rendering 0% would call a free agent a universal bench
   * player.
   */
  startPct: number | null
  /** Leagues holding him, and leagues starting him. The raw counts. */
  rosteredIn: number
  startedIn: number
}

export type RosteredMarketBoard = {
  byPlayerId: Map<string, RosteredMarket>
  /**
   * How many leagues the percentages were computed over.
   *
   * The denominator, and the honesty gate. A surface should decline to show a
   * percentage below a threshold rather than publish noise.
   */
  leaguesCounted: number
}

/** Sleeper writes an unfilled starting slot as "0" — a hole, not a player. */
const EMPTY_SLOT = '0'

/**
 * Below this many leagues, a percentage says more about who has signed up than
 * about the player. Callers should treat the board as unusable and say why.
 */
export const MIN_LEAGUES_FOR_MARKET = 8

function asIds(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => (x == null ? '' : String(x))).filter(Boolean) : []
}

/**
 * The whole board, cached.
 *
 * ⚠ USER-INDEPENDENT BY CONSTRUCTION, which is what makes caching it safe. Own
 * and start rates are a property of the app's rosters, not of who is asking, so
 * every concurrent viewer shares one computation. Scoped per sport and format
 * because a player started in every dynasty league can be a waiver add in
 * redraft, and averaging those together describes neither.
 */
const readMarketCached = unstable_cache(
  async (sport: string, dynastyOnly: boolean | null) => {
    const leagues = await prisma.league
      .findMany({
        where: {
          ...(sport ? { sport: sport as never } : {}),
          ...(dynastyOnly == null ? {} : { isDynasty: dynastyOnly }),
        },
        select: { id: true },
      })
      .catch(() => [])

    if (leagues.length === 0) return { rows: [] as Array<[string, RosteredMarket]>, leagues: 0 }

    const rosters = await prisma.roster
      .findMany({
        where: { leagueId: { in: leagues.map((l) => l.id) } },
        select: { leagueId: true, playerData: true },
      })
      .catch(() => [])

    /*
     * Counted per LEAGUE, not per roster. A player can only be on one roster in
     * a league, so this is the same thing today — but counting rosters would
     * silently double a player held in a league whose rows got duplicated, and
     * the denominator is leagues either way.
     */
    const rosteredLeagues = new Map<string, Set<string>>()
    const startedLeagues = new Map<string, Set<string>>()

    for (const r of rosters) {
      const pd = (r.playerData ?? {}) as Record<string, unknown>
      const all = asIds(pd.players).filter((id) => id !== EMPTY_SLOT)
      const starters = new Set(asIds(pd.starters).filter((id) => id !== EMPTY_SLOT))

      for (const id of new Set(all)) {
        let owned = rosteredLeagues.get(id)
        if (!owned) {
          owned = new Set()
          rosteredLeagues.set(id, owned)
        }
        owned.add(r.leagueId)

        if (starters.has(id)) {
          let started = startedLeagues.get(id)
          if (!started) {
            started = new Set()
            startedLeagues.set(id, started)
          }
          started.add(r.leagueId)
        }
      }
    }

    const total = leagues.length
    const rows: Array<[string, RosteredMarket]> = []
    for (const [id, owned] of rosteredLeagues) {
      const rosteredIn = owned.size
      const startedIn = startedLeagues.get(id)?.size ?? 0
      rows.push([
        id,
        {
          ownPct: rosteredIn / total,
          // Start rate is over the leagues that HOLD him, not over every
          // league — otherwise a player on 3 of 100 rosters and started in all
          // three reads as 3% started, when he is started everywhere he is
          // owned.
          startPct: rosteredIn > 0 ? startedIn / rosteredIn : null,
          rosteredIn,
          startedIn,
        },
      ])
    }

    return { rows, leagues: total }
  },
  ['rostered-market-v1'],
  // Rosters move on waivers and lineup locks, not by the second.
  { revalidate: 900 },
)

export async function getRosteredMarket(args: {
  sport?: string
  /** Null blends both; true/false scopes to dynasty or redraft. */
  dynastyOnly?: boolean | null
}): Promise<RosteredMarketBoard> {
  const { rows, leagues } = await readMarketCached(
    args.sport ?? 'NFL',
    args.dynastyOnly ?? null,
  ).catch(() => ({ rows: [] as Array<[string, RosteredMarket]>, leagues: 0 }))

  return { byPlayerId: new Map(rows), leaguesCounted: leagues }
}
