import { prisma } from '@/lib/prisma'
import {
  SKILL_CLASS_MIN_GAMES,
  classBlockedMessage,
  classRangeFor,
  clampLevel,
  hasClassException,
  medianClass,
  resolveLeagueClassRange,
  skillClassFor,
  type ClassBasis,
} from '@/lib/league-join/managerClass'
import { readSkillBoard, type SkillBoard } from '@/lib/rank/skillRating/skillRatingStore'

/**
 * The manager-class gate every league join path runs (`lib/league-join/managerClass.ts`).
 *
 * Callers: `POST /api/leagues/join` (invite code), `POST /api/league/invite/claim`
 * (the `/join/<token>` link a new league hands out), and `acceptInvite` in
 * `lib/invite-engine/InviteEngine.ts` (tracked invite links). Before 2026-10-01
 * only the first of those checked anything, and the second is the link the
 * league-creation flow gives a commissioner to share.
 *
 * ── WHICH CLASS ──────────────────────────────────────────────────────────────
 * SKILL when it can be: the joiner and the league both have a skill class in the
 * league's sport. The league's class is the MEDIAN skill class of its members
 * who are rated (10+ games in that sport), the commissioner included — so it is
 * the level the league actually plays at, not the level one person had on the
 * day they created it.
 *
 * LEVEL otherwise: a manager with no rated games yet, or a league whose members
 * have none, falls back to the ladder-level band stored on the league's listing.
 * A newcomer is never locked out for lacking history, and the band tightens to
 * skill as games are played.
 *
 * ⚠ THE SHARED-CODE BYPASS IS NOT HONOURED. `LeagueInvite.bypassRankGate`
 * attached to the league's one shared invite code, so turning it on let anyone
 * holding the code in. The only way outside the band is a commissioner exception
 * for one named manager, stored on the league.
 *
 * A league with no class (no listing row carrying a level — imported leagues,
 * whose members are claiming the team they already run on the source platform)
 * is not gated.
 */

type PrismaLike = Pick<typeof prisma, 'findLeagueListing' | 'userProfile' | 'league' | 'redraftLeagueMember'>

export type ResolveJoinRankGateInput = {
  leagueId: string
  userId: string
  /** Accepted for call-site compatibility; invite tokens no longer open the gate. */
  inviteTokenOrCode?: string | null
  prismaLike?: PrismaLike
  /** The stored skill board; read when omitted. Injected by tests. */
  skillBoard?: SkillBoard | null
}

export type ResolveJoinRankGateResult = {
  allowed: boolean
  /** True when the manager is outside the band and got in on a commissioner exception. */
  bypassed: boolean
  /** Which class the band was measured on. */
  basis: ClassBasis
  /** The league's sport — the sport a skill class is measured in. */
  sport: string | null
  /** The joiner's ladder level, whichever basis applied. */
  userRankLevel: number
  /** The joiner's class on `basis` (a level, or a skill class). */
  userClass: number
  /** The band, on `basis`. Null when the league has no class. */
  minRankLevel: number | null
  maxRankLevel: number | null
  reason?: 'LISTING_MISSING' | 'RANGE_NOT_CONFIGURED' | 'RANGE_OK' | 'COMMISSIONER_EXCEPTION' | 'OUTSIDE_RANK_RANGE'
}

export function resolveUserRankLevel(input: { xpLevel?: number | null; legacyCareerLevel?: number | null } | null): number {
  return clampLevel(input?.xpLevel ?? input?.legacyCareerLevel ?? 1, 1)
}

/** A manager's skill class in `sport`, or null while they have fewer than the minimum rated games. */
export function skillClassOf(board: SkillBoard | null | undefined, sport: string | null, userId: string): number | null {
  if (!board || !sport) return null
  const row = board.sports[sport.toUpperCase()]?.rows.find((r) => r.u === userId)
  if (!row || row.g < SKILL_CLASS_MIN_GAMES) return null
  return skillClassFor(row.r)
}

export async function resolveJoinRankGate(input: ResolveJoinRankGateInput): Promise<ResolveJoinRankGateResult> {
  const prismaClient = input.prismaLike ?? prisma

  const [listing, profile, league, members, board] = await Promise.all([
    /*
     * ⚠ A LEAGUE CAN HAVE TWO LISTING ROWS. Creation writes one carrying the
     * creator's level; the League finder adds a recruitment row. Only rows that
     * carry a level, oldest first — an unordered `findFirst` could pick one that
     * reads as "no range", an open door.
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
    prismaClient.league.findUnique({
      where: { id: input.leagueId },
      select: { userId: true, sport: true, settings: true },
    }),
    prismaClient.redraftLeagueMember
      .findMany({ where: { leagueId: input.leagueId }, select: { userId: true } })
      .catch(() => [] as Array<{ userId: string }>),
    input.skillBoard !== undefined ? Promise.resolve(input.skillBoard) : readSkillBoard().catch(() => null),
  ])

  const userRankLevel = resolveUserRankLevel(profile)
  const sport = league?.sport ? String(league.sport).toUpperCase() : null
  const none = {
    bypassed: false,
    basis: 'level' as const,
    sport,
    userRankLevel,
    userClass: userRankLevel,
    minRankLevel: null,
    maxRankLevel: null,
  }

  if (!listing) return { allowed: true, ...none, reason: 'LISTING_MISSING' }
  const levelRange = resolveLeagueClassRange(listing)
  if (!levelRange) return { allowed: true, ...none, reason: 'RANGE_NOT_CONFIGURED' }

  // Skill, when both sides have it.
  const memberIds = new Set<string>(members.map((m) => m.userId))
  if (league?.userId) memberIds.add(league.userId)
  memberIds.delete(input.userId)
  const leagueSkill = medianClass(
    [...memberIds].map((id) => skillClassOf(board, sport, id)).filter((c): c is number => c != null),
  )
  const joinerSkill = skillClassOf(board, sport, input.userId)
  const useSkill = leagueSkill != null && joinerSkill != null
  const basis: ClassBasis = useSkill ? 'skill' : 'level'
  const range = useSkill ? classRangeFor(leagueSkill) : levelRange
  const userClass = useSkill ? joinerSkill : userRankLevel

  const base = { basis, sport, userRankLevel, userClass, minRankLevel: range.min, maxRankLevel: range.max }

  if (userClass >= range.min && userClass <= range.max) {
    return { allowed: true, bypassed: false, ...base, reason: 'RANGE_OK' }
  }
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
    message: classBlockedMessage({ min, max }, gate.userClass, gate.basis, gate.sport),
    leagueId,
    basis: gate.basis,
    sport: gate.sport,
    minRankLevel: min,
    maxRankLevel: max,
    userRankLevel: gate.userClass,
    canRequestException: true,
  }
}

export type LeagueClass = {
  basis: ClassBasis
  sport: string | null
  /** The band on `basis`; null when the league has no class at all. */
  range: { center: number; min: number; max: number } | null
  /** How many members' skill set the class, when the basis is skill. */
  ratedMembers: number
}

/**
 * The league's class as the gate would measure it for a joiner who HAS a skill
 * class: skill when any member is rated in the league's sport, else the stored
 * level band. For the commissioner's panel — the gate itself also needs the
 * joiner's side, so it does not call this.
 */
export async function resolveLeagueClass(leagueId: string, board?: SkillBoard | null): Promise<LeagueClass> {
  const [listing, league, members, skillBoard] = await Promise.all([
    prisma.findLeagueListing.findFirst({
      where: { leagueId, OR: [{ creatorRankLevel: { not: null } }, { minRankLevel: { not: null } }] },
      orderBy: { createdAt: 'asc' },
      select: { creatorRankLevel: true, minRankLevel: true, maxRankLevel: true },
    }),
    prisma.league.findUnique({ where: { id: leagueId }, select: { userId: true, sport: true } }),
    prisma.redraftLeagueMember.findMany({ where: { leagueId }, select: { userId: true } }).catch(() => [] as Array<{ userId: string }>),
    board !== undefined ? Promise.resolve(board) : readSkillBoard().catch(() => null),
  ])
  const sport = league?.sport ? String(league.sport).toUpperCase() : null
  const levelRange = resolveLeagueClassRange(listing)
  if (!levelRange) return { basis: 'level', sport, range: null, ratedMembers: 0 }
  const ids = new Set(members.map((m) => m.userId))
  if (league?.userId) ids.add(league.userId)
  const classes = [...ids].map((id) => skillClassOf(skillBoard, sport, id)).filter((c): c is number => c != null)
  const center = medianClass(classes)
  return center != null
    ? { basis: 'skill', sport, range: classRangeFor(center), ratedMembers: classes.length }
    : { basis: 'level', sport, range: levelRange, ratedMembers: 0 }
}

/**
 * Skill class for many leagues at once — for discovery, which lists hundreds of
 * leagues per read and cannot run `resolveLeagueClass` once each. Two queries
 * (leagues, members) whatever the count. A league with no rated member in its
 * sport is absent from the result, and discovery falls back to its level tier,
 * exactly as the join gate does.
 */
export async function leagueSkillClasses(
  leagueIds: string[],
  board: SkillBoard | null,
): Promise<Map<string, { sport: string; skillClass: number; ratedMembers: number }>> {
  const out = new Map<string, { sport: string; skillClass: number; ratedMembers: number }>()
  if (!board || leagueIds.length === 0) return out
  const ids = [...new Set(leagueIds)]
  const [leagues, members] = await Promise.all([
    prisma.league.findMany({ where: { id: { in: ids } }, select: { id: true, userId: true, sport: true } }),
    prisma.redraftLeagueMember.findMany({ where: { leagueId: { in: ids } }, select: { leagueId: true, userId: true } }),
  ])
  const byLeague = new Map<string, Set<string>>()
  for (const m of members) {
    const set = byLeague.get(m.leagueId) ?? new Set<string>()
    set.add(m.userId)
    byLeague.set(m.leagueId, set)
  }
  for (const l of leagues) {
    const sport = String(l.sport).toUpperCase()
    const people = byLeague.get(l.id) ?? new Set<string>()
    if (l.userId) people.add(l.userId)
    const classes = [...people].map((u) => skillClassOf(board, sport, u)).filter((c): c is number => c != null)
    const center = medianClass(classes)
    if (center != null) out.set(l.id, { sport, skillClass: center, ratedMembers: classes.length })
  }
  return out
}
