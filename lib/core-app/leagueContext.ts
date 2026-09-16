import 'server-only'

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

/**
 * One league, read once per render: the row, and which team in it is the viewer's.
 *
 * Item 3 of the `/core?league=` brief — "load one shared league context". #910 made the shell read
 * the `League` row once; every screen loader then read it AGAIN, each with its own column list,
 * and most re-read the viewer's claimed `LeagueTeam` as well. Measured on 2026-09-16:
 *
 * - `/core/draft-hq?league=` read the same row up to five times and the claimed team up to three:
 *   the shell, `getDraftHqData` (up to three row reads between its helpers), and `getDraftBoardData`.
 * - every other league tab: the shell's read plus the loader's own — a SERIAL cross-coast round
 *   trip, because the loaders run after the shell's parallel wave has been awaited.
 *
 * ⚠ REQUEST-SCOPED BY CONSTRUCTION, NOT BY A CACHE. The page creates one context per render and
 * hands it to the loader it runs; the memo lives on that object and dies with it. React's
 * `cache()` would dedupe the same reads with no signature changes, but only inside Next's server
 * render — the React this repo's tests run has no `cache` at all — so the saving could never be
 * shown by a test here. An explicit object can.
 *
 * ⚠ NOT A CROSS-REQUEST CACHE, deliberately. The row carries `syncStatus` and `lastSyncedAt`,
 * which the "what's on file" panel shows right after a manual sync; a TTL would show a finished
 * sync as still running. Moving between tabs is item 9's job (prewarm), not this one's.
 *
 * 🛑 A CONTEXT FOR ANOTHER LEAGUE OR VIEWER IS IGNORED, NOT TRUSTED. `leagueContextFor` hands a
 * loader the passed context only when both ids match its own arguments, so a mis-threaded
 * context falls back to a fresh read rather than serving one league's row — or one viewer's team —
 * on another's screen (item 6, cross-league leakage).
 */

/**
 * Every column any `/core` league loader reads off `League`, as one select. A scalar column
 * costs next to nothing beside `settings`, which half of them need anyway.
 */
export const LEAGUE_CONTEXT_SELECT = {
  id: true,
  name: true,
  platform: true,
  platformLeagueId: true,
  sport: true,
  season: true,
  leagueType: true,
  isDynasty: true,
  starters: true,
  settings: true,
  status: true,
  lifecycleState: true,
  guillotineMode: true,
  logoUrl: true,
  avatarUrl: true,
  syncStatus: true,
  lastSyncedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.LeagueSelect

export type LeagueContextRow = Prisma.LeagueGetPayload<{ select: typeof LEAGUE_CONTEXT_SELECT }>

/** Every column any `/core` league loader reads off the viewer's own claimed team. */
export const CLAIMED_TEAM_SELECT = {
  id: true,
  externalId: true,
  platformUserId: true,
  teamName: true,
  ownerName: true,
  avatarUrl: true,
  wins: true,
  losses: true,
  ties: true,
  pointsFor: true,
  pointsAgainst: true,
  currentRank: true,
} satisfies Prisma.LeagueTeamSelect

export type ClaimedTeamRow = Prisma.LeagueTeamGetPayload<{ select: typeof CLAIMED_TEAM_SELECT }>

export type LeagueContext = {
  readonly leagueId: string
  readonly userId: string
  /** The `League` row, or null when there is none. Rejects when the read fails, like the read it replaces. */
  league(): Promise<LeagueContextRow | null>
  /**
   * The viewer's claimed team in this league — the same unordered `findFirst` every loader ran,
   * now run once, so two sections of one screen cannot land on different teams.
   */
  claimedTeam(): Promise<ClaimedTeamRow | null>
  /** Every team in this league the viewer has claimed. */
  claimedTeams(): Promise<ClaimedTeamRow[]>
}

export function createLeagueContext(leagueId: string, userId: string): LeagueContext {
  let league: Promise<LeagueContextRow | null> | undefined
  let claimedTeam: Promise<ClaimedTeamRow | null> | undefined
  let claimedTeams: Promise<ClaimedTeamRow[]> | undefined
  return {
    leagueId,
    userId,
    league: () =>
      (league ??= prisma.league.findUnique({ where: { id: leagueId }, select: LEAGUE_CONTEXT_SELECT })),
    claimedTeam: () =>
      (claimedTeam ??= prisma.leagueTeam.findFirst({
        where: { leagueId, claimedByUserId: userId },
        select: CLAIMED_TEAM_SELECT,
      })),
    claimedTeams: () =>
      (claimedTeams ??= prisma.leagueTeam.findMany({
        where: { leagueId, claimedByUserId: userId },
        select: CLAIMED_TEAM_SELECT,
      })),
  }
}

/** The passed context when it is for this league and viewer; otherwise a fresh one. */
export function leagueContextFor(
  leagueId: string,
  userId: string,
  ctx?: LeagueContext | null,
): LeagueContext {
  return ctx && ctx.leagueId === leagueId && ctx.userId === userId ? ctx : createLeagueContext(leagueId, userId)
}
