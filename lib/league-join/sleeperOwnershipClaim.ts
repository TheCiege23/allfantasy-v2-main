import 'server-only'

import { randomInt } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import { assertPaidJoinAllowed, linkDuesToRoster } from '@/lib/league-finance/joinGate'
import { findExistingLeagueClaim } from '@/lib/identity/linkedAccounts'
import { fetchSleeperLeagueTeamNames } from '@/lib/league-join/sleeperOwnershipFetch'

/**
 * PROVE A SLEEPER TEAM IS YOURS, THEN CLAIM IT.
 *
 * A leaguemate who arrives from a shared recap joins an imported league as a member
 * (POST /api/leagues/join). Claiming their actual team needs proof they control that Sleeper account,
 * and until now there was none — a Sleeper "link" is a typed username, so first to type it won.
 *
 * The proof: we hand the member a short code, they put it in THEIR team name in THAT Sleeper league,
 * and we read Sleeper's public league users and check the team's manager now carries it. Only the
 * person signed in to that Sleeper account can change that team name, so the code appearing there is
 * the proof. They can change the name back the moment it is claimed.
 *
 *   start  → a code, 30 minutes, the same code again if they tap twice.
 *   verify → at most MAX_ATTEMPTS live reads per code; on success the team is claimed with the same
 *            writes the invite claim makes for an imported team, and the Sleeper account is linked to
 *            them (so `/join/<token>` and everything that reads PlatformIdentity knows it is theirs).
 *
 * Refuses, in plain words: not a Sleeper league; not a member; you already have a team; the team is
 * taken or has no Sleeper manager; that Sleeper account belongs to another AllFantasy login; dues
 * unpaid; another of your accounts already holds a team here.
 */

export const CLAIM_CODE_TTL_MS = 30 * 60 * 1000
/** Sleeper can show a renamed team a few minutes late (it does for league names), so impatient taps must not spend the code. */
export const MAX_ATTEMPTS = 12
const CACHE_PREFIX = 'sleeper-claim:v1:'
/** No 0/O/1/I/L, so a code read off a phone is typed right. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

export function newClaimCode(): string {
  let s = ''
  for (let i = 0; i < 4; i += 1) s += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]
  return `AF-${s}`
}

/** "Hammer Time af 7k2q" carries AF-7K2Q: case, spaces and dashes do not matter. */
export function teamNameCarriesCode(teamName: string | null | undefined, code: string): boolean {
  const squash = (v: string) => v.toUpperCase().replace(/[^A-Z0-9]/g, '')
  const want = squash(code)
  return want.length > 0 && squash(teamName ?? '').includes(want)
}

export function claimCacheKey(leagueId: string, teamExternalId: string, userId: string): string {
  return `${CACHE_PREFIX}${leagueId}:${teamExternalId}:${userId}`
}

type Challenge = { v: 1; code: string; sleeperUserId: string; attempts: number; createdAt: string }

export type ClaimRefusal =
  | 'not_sleeper'
  | 'not_member'
  | 'already_has_team'
  | 'team_not_found'
  | 'team_taken'
  | 'team_has_no_manager'
  | 'linked_elsewhere'
  | 'no_code'
  | 'too_many_attempts'
  | 'sleeper_unavailable'
  | 'code_not_found'
  | 'payment_required'
  | 'other_account'

export const CLAIM_REFUSAL_MESSAGE: Record<ClaimRefusal, string> = {
  not_sleeper: 'Team claiming by code works for leagues imported from Sleeper.',
  not_member: 'Join this league first.',
  already_has_team: 'You already have a team in this league.',
  team_not_found: 'That team is not in this league.',
  team_taken: 'Someone has already claimed that team.',
  team_has_no_manager: 'That team has no Sleeper manager to verify against.',
  linked_elsewhere: 'That Sleeper account is linked to another AllFantasy login. Sign in with that account to claim it.',
  no_code: 'That code expired. Get a new one.',
  too_many_attempts: 'Too many tries with this code. Get a new one.',
  sleeper_unavailable: 'Sleeper did not answer. Try again in a minute.',
  code_not_found: 'We could not find the code in your Sleeper team name yet.',
  payment_required: 'This league has dues to pay before you can take a team.',
  other_account: 'One of your other AllFantasy accounts already has a team in this league.',
}

async function loadContext(leagueId: string, teamExternalId: string, userId: string) {
  const [league, team, member, ownTeam, claims] = await Promise.all([
    prisma.league.findUnique({ where: { id: leagueId }, select: { id: true, platform: true, platformLeagueId: true, userId: true, name: true } }),
    prisma.leagueTeam.findFirst({
      where: { leagueId, externalId: teamExternalId },
      select: { id: true, teamName: true, platformUserId: true, claimedByUserId: true },
    }),
    prisma.redraftLeagueMember.findUnique({ where: { leagueId_userId: { leagueId, userId } }, select: { id: true } }),
    prisma.leagueTeam.findFirst({ where: { leagueId, claimedByUserId: userId }, select: { id: true } }),
    // LeagueManagerClaim is unique per (league, user) and per (league, team): a leftover row either
    // way would make the claim's insert throw, so it is refused up front in plain words.
    prisma.leagueManagerClaim.findMany({
      where: { leagueId, OR: [{ afUserId: userId }, { teamExternalId }] },
      select: { afUserId: true, teamExternalId: true },
    }),
  ])
  return {
    league,
    team,
    member,
    ownTeam: ownTeam ?? (claims.some((c) => c.afUserId === userId) ? { id: 'manager-claim' } : null),
    teamClaimedElsewhere: claims.some((c) => c.teamExternalId === teamExternalId && c.afUserId !== userId),
  }
}

/** The Sleeper account is someone else's on AllFantasy — in either store that records it. */
async function linkedToSomeoneElse(sleeperUserId: string, userId: string): Promise<boolean> {
  const [identity, profile] = await Promise.all([
    prisma.platformIdentity.findFirst({ where: { platform: 'sleeper', platformUserId: sleeperUserId }, select: { userId: true } }),
    prisma.userProfile.findFirst({ where: { sleeperUserId, userId: { not: userId } }, select: { userId: true } }),
  ])
  return Boolean((identity && identity.userId !== userId) || profile)
}

async function precheck(
  leagueId: string,
  teamExternalId: string,
  userId: string,
): Promise<{ ok: true; ctx: Awaited<ReturnType<typeof loadContext>>; sleeperUserId: string } | { ok: false; reason: ClaimRefusal }> {
  const ctx = await loadContext(leagueId, teamExternalId, userId)
  const { league, team, member, ownTeam } = ctx
  if (!league || String(league.platform).toLowerCase() !== 'sleeper' || !league.platformLeagueId) return { ok: false, reason: 'not_sleeper' }
  if (!member && league.userId !== userId) return { ok: false, reason: 'not_member' }
  if (ownTeam) return { ok: false, reason: 'already_has_team' }
  if (!team) return { ok: false, reason: 'team_not_found' }
  if (team.claimedByUserId || ctx.teamClaimedElsewhere) return { ok: false, reason: 'team_taken' }
  const sleeperUserId = team.platformUserId?.trim() ?? ''
  if (!sleeperUserId) return { ok: false, reason: 'team_has_no_manager' }
  if (await linkedToSomeoneElse(sleeperUserId, userId)) return { ok: false, reason: 'linked_elsewhere' }
  return { ok: true, ctx, sleeperUserId }
}

/** The unclaimed Sleeper teams a member can try to claim. */
export async function listClaimableSleeperTeams(leagueId: string) {
  return prisma.leagueTeam.findMany({
    where: { leagueId, claimedByUserId: null, platformUserId: { not: null } },
    select: { externalId: true, teamName: true, ownerName: true, avatarUrl: true },
    orderBy: { externalId: 'asc' },
  })
}

export async function startSleeperTeamClaim(input: {
  userId: string
  leagueId: string
  teamExternalId: string
  now?: Date
}): Promise<{ ok: true; code: string; expiresAt: string; teamName: string | null; leagueName: string | null } | { ok: false; reason: ClaimRefusal }> {
  const now = input.now ?? new Date()
  const pre = await precheck(input.leagueId, input.teamExternalId, input.userId)
  if (!pre.ok) return pre
  const key = claimCacheKey(input.leagueId, input.teamExternalId, input.userId)
  const existing = await prisma.sportsDataCache.findUnique({ where: { cacheKey: key } }).catch(() => null)
  const live = existing && existing.expiresAt > now ? (existing.data as unknown as Challenge) : null
  // Tapping "Get code" twice must not change the code under someone who is already typing it.
  if (live?.v === 1 && live.sleeperUserId === pre.sleeperUserId && live.attempts < MAX_ATTEMPTS) {
    return { ok: true, code: live.code, expiresAt: existing!.expiresAt.toISOString(), teamName: pre.ctx.team!.teamName, leagueName: pre.ctx.league!.name }
  }
  const challenge: Challenge = { v: 1, code: newClaimCode(), sleeperUserId: pre.sleeperUserId, attempts: 0, createdAt: now.toISOString() }
  const expiresAt = new Date(now.getTime() + CLAIM_CODE_TTL_MS)
  await prisma.sportsDataCache.upsert({
    where: { cacheKey: key },
    update: { data: challenge as unknown as object, expiresAt },
    create: { cacheKey: key, data: challenge as unknown as object, expiresAt },
  })
  return { ok: true, code: challenge.code, expiresAt: expiresAt.toISOString(), teamName: pre.ctx.team!.teamName, leagueName: pre.ctx.league!.name }
}

export async function verifySleeperTeamClaim(input: {
  userId: string
  leagueId: string
  teamExternalId: string
  now?: Date
  /** Test seam. */
  fetchTeamNames?: typeof fetchSleeperLeagueTeamNames
}): Promise<{ ok: true; leagueId: string } | { ok: false; reason: ClaimRefusal; seenTeamName?: string }> {
  const now = input.now ?? new Date()
  const key = claimCacheKey(input.leagueId, input.teamExternalId, input.userId)
  const row = await prisma.sportsDataCache.findUnique({ where: { cacheKey: key } }).catch(() => null)
  const challenge = row && row.expiresAt > now ? (row.data as unknown as Challenge) : null
  if (!challenge || challenge.v !== 1) return { ok: false, reason: 'no_code' }
  if (challenge.attempts >= MAX_ATTEMPTS) return { ok: false, reason: 'too_many_attempts' }
  // Counted BEFORE the live read, so a burst of taps cannot buy more reads than the cap.
  await prisma.sportsDataCache.update({
    where: { cacheKey: key },
    data: { data: { ...challenge, attempts: challenge.attempts + 1 } as unknown as object },
  })

  const pre = await precheck(input.leagueId, input.teamExternalId, input.userId)
  if (!pre.ok) return pre
  // The team's Sleeper manager must still be the one the code was issued for.
  if (pre.sleeperUserId !== challenge.sleeperUserId) return { ok: false, reason: 'no_code' }

  const names = await (input.fetchTeamNames ?? fetchSleeperLeagueTeamNames)(pre.ctx.league!.platformLeagueId)
  if (!names) return { ok: false, reason: 'sleeper_unavailable' }
  const seen = names.get(challenge.sleeperUserId) ?? ''
  if (!teamNameCarriesCode(seen, challenge.code)) return { ok: false, reason: 'code_not_found', seenTeamName: seen }

  // Proven. The same seat gates as every other way into a team.
  const prior = await findExistingLeagueClaim({ userId: input.userId, leagueId: input.leagueId })
  if (prior?.viaOtherAccount) return { ok: false, reason: 'other_account' }
  const paid = await assertPaidJoinAllowed({ leagueId: input.leagueId, userId: input.userId })
  if (!paid.ok) return { ok: false, reason: 'payment_required' }

  const team = pre.ctx.team!
  const rosters = await prisma.roster.findMany({
    where: { leagueId: input.leagueId },
    select: { id: true, playerData: true },
  })
  const roster = rosters.find((r) => {
    const imp = (r.playerData as Record<string, unknown> | null)?.import as Record<string, unknown> | undefined
    return typeof imp?.sourceTeamId === 'string' && imp.sourceTeamId.trim() === input.teamExternalId
  })

  const claimed = await prisma.$transaction(async (tx) => {
    // Never overwrite a claim that landed after the precheck.
    const taken = await tx.leagueTeam.updateMany({
      where: { id: team.id, claimedByUserId: null },
      data: { claimedByUserId: input.userId, isOrphan: false },
    })
    if (taken.count !== 1) return false
    if (roster) {
      const data = (roster.playerData as Record<string, unknown> | null) ?? {}
      const imp = (data.import as Record<string, unknown> | null) ?? {}
      await tx.roster.update({
        where: { id: roster.id },
        data: { platformUserId: input.userId, playerData: { ...data, import: { ...imp, afUserId: input.userId, claimedAt: now.toISOString() } } as object },
      })
    }
    await tx.leagueManagerClaim.create({
      data: { leagueId: input.leagueId, afUserId: input.userId, teamExternalId: input.teamExternalId, platformUserId: challenge.sleeperUserId, isConfirmed: true },
    })
    await tx.redraftLeagueMember.upsert({
      where: { leagueId_userId: { leagueId: input.leagueId, userId: input.userId } },
      create: { leagueId: input.leagueId, userId: input.userId, role: 'MEMBER' },
      update: {},
    })
    // The proven Sleeper account is now theirs on AllFantasy, so every other claim path knows it.
    const identity = await tx.platformIdentity.findFirst({ where: { platform: 'sleeper', platformUserId: challenge.sleeperUserId } })
    if (identity && identity.userId !== input.userId) throw new Error('LINKED_ELSEWHERE')
    if (identity) {
      await tx.platformIdentity.update({ where: { id: identity.id }, data: { lastSyncedAt: now } })
    } else {
      await tx.platformIdentity.create({
        data: {
          userId: input.userId,
          platform: 'sleeper',
          platformUserId: challenge.sleeperUserId,
          platformUsername: team.teamName ?? challenge.sleeperUserId,
          displayName: team.teamName ?? undefined,
          sport: 'nfl',
          firstImportAt: now,
          lastSyncedAt: now,
        },
      })
    }
    return true
  }).catch((err: unknown) => (err instanceof Error && err.message === 'LINKED_ELSEWHERE' ? ('linked' as const) : Promise.reject(err)))

  if (claimed === 'linked') return { ok: false, reason: 'linked_elsewhere' }
  if (!claimed) return { ok: false, reason: 'team_taken' }
  if (roster) await linkDuesToRoster({ leagueId: input.leagueId, userId: input.userId, rosterId: roster.id }).catch(() => undefined)
  await prisma.sportsDataCache.delete({ where: { cacheKey: key } }).catch(() => undefined)
  return { ok: true, leagueId: input.leagueId }
}
