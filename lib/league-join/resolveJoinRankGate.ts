import { prisma } from '@/lib/prisma'
import {
  classBlockedMessage,
  clampLevel,
  hasClassException,
  resolveLeagueClassRange,
} from '@/lib/league-join/managerClass'

/**
 * The manager-class gate every league join path runs (`lib/league-join/managerClass.ts`).
 *
 * Callers: `POST /api/leagues/join` (invite code), `POST /api/league/invite/claim`
 * (the `/join/<token>` link a new league hands out), and `acceptInvite` in
 * `lib/invite-engine/InviteEngine.ts` (tracked invite links). Before 2026-10-01
 * only the first of those checked anything, and the second is the link the
 * league-creation flow gives a commissioner to share.
 *
 * ⚠ THE SHARED-CODE BYPASS IS NO LONGER HONOURED. `LeagueInvite.bypassRankGate`
 * attached to the league's one shared invite code, so turning it on let anyone
 * holding the code in. The only way outside the band is now a commissioner
 * exception for one named manager, stored on the league.
 *
 * A league with no class (no listing row carrying a level — imported leagues,
 * whose members are claiming the team they already run on the source platform)
 * is not gated.
 */

type PrismaLike = Pick<typeof prisma, 'findLeagueListing' | 'userProfile' | 'league'>

export type ResolveJoinRankGateInput = {
  leagueId: string
  userId: string
  /** Accepted for call-site compatibility; invite tokens no longer open the gate. */
  inviteTokenOrCode?: string | null
  prismaLike?: PrismaLike
}

export type ResolveJoinRankGateResult = {
  allowed: boolean
  /** True when the manager is outside the band and got in on a commissioner exception. */
  bypassed: boolean
  userRankLevel: number
  minRankLevel: number | null
  maxRankLevel: number | null
  reason?: 'LISTING_MISSING' | 'RANGE_NOT_CONFIGURED' | 'RANGE_OK' | 'COMMISSIONER_EXCEPTION' | 'OUTSIDE_RANK_RANGE'
}

export function resolveUserRankLevel(input: { xpLevel?: number | null; legacyCareerLevel?: number | null } | null): number {
  return clampLevel(input?.xpLevel ?? input?.legacyCareerLevel ?? 1, 1)
}

export async function resolveJoinRankGate(input: ResolveJoinRankGateInput): Promise<ResolveJoinRankGateResult> {
  const prismaClient = input.prismaLike ?? prisma

  const [listing, profile] = await Promise.all([
    /*
     * ⚠ A LEAGUE CAN HAVE TWO LISTING ROWS. Creation writes one carrying the
     * creator's level; the League finder adds a recruitment row that carries
     * none. An unordered `findFirst` could pick the recruitment row and read
     * "no range" — an open door. So: only rows that carry a level, oldest first.
     */
    prismaClient.findLeagueListing.findFirst({
      where: {
        leagueId: input.leagueId,
        OR: [{ creatorRankLevel: { not: null } }, { minRankLevel: { not: null } }],
      },
      orderBy: { createdAt: 'asc' },
      select: { creatorRankLevel: true, minRankLevel: true, maxRankLevel: true },
    }),
    prismaClient.userProfile.findUnique({
      where: { userId: input.userId },
      select: { xpLevel: true, legacyCareerLevel: true },
    }),
  ])

  const userRankLevel = resolveUserRankLevel(profile)

  if (!listing) {
    return { allowed: true, bypassed: false, userRankLevel, minRankLevel: null, maxRankLevel: null, reason: 'LISTING_MISSING' }
  }

  const range = resolveLeagueClassRange(listing)
  if (!range) {
    return { allowed: true, bypassed: false, userRankLevel, minRankLevel: null, maxRankLevel: null, reason: 'RANGE_NOT_CONFIGURED' }
  }

  const base = { userRankLevel, minRankLevel: range.min, maxRankLevel: range.max }

  if (userRankLevel >= range.min && userRankLevel <= range.max) {
    return { allowed: true, bypassed: false, ...base, reason: 'RANGE_OK' }
  }

  const league = await prismaClient.league.findUnique({
    where: { id: input.leagueId },
    select: { settings: true },
  })
  if (league && hasClassException(league.settings, input.userId)) {
    return { allowed: true, bypassed: true, ...base, reason: 'COMMISSIONER_EXCEPTION' }
  }

  return { allowed: false, bypassed: false, ...base, reason: 'OUTSIDE_RANK_RANGE' }
}

/** The JSON body every join path returns for a blocked manager, so the client handles one shape. */
export function rankGateBlockedBody(gate: ResolveJoinRankGateResult, leagueId: string) {
  const min = gate.minRankLevel ?? 1
  const max = gate.maxRankLevel ?? 1
  return {
    error: 'RANK_GATE_BLOCKED' as const,
    code: 'RANK_GATE_BLOCKED' as const,
    message: classBlockedMessage({ min, max }, gate.userRankLevel),
    leagueId,
    minRankLevel: min,
    maxRankLevel: max,
    userRankLevel: gate.userRankLevel,
    canRequestException: true,
  }
}
