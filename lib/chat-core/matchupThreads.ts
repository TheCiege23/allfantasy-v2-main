import 'server-only'
import { prisma } from '@/lib/prisma'
import { createPlatformThread } from '@/lib/platform/chat-service'

/**
 * A PRIVATE ROOM FOR THE TWO PEOPLE PLAYING EACH OTHER THIS WEEK.
 *
 * The highest-intent trash talk in fantasy: you know exactly who you are talking
 * to and exactly why. Every competitor with well-liked chat ships some version
 * of this, and it needs no new table — a huddle IS a thread with two members,
 * and the pairings are already in `MatchupFact`.
 *
 * ⚠ ONLY WHERE BOTH MANAGERS ARE REAL ALLFANTASY USERS, WHICH IS RARER THAN IT
 * LOOKS. `LeagueTeam` has two columns that look like an owner and only one is:
 * `claimedByUserId` is an `AppUser.id`, while `platformUserId` holds the
 * PROVIDER's user id. Measured on production: 1,044 teams carry a
 * `platformUserId` and exactly 13 of those values are real app users, against 94
 * genuine `claimedByUserId` links. Pairing on the wrong column would put two
 * strangers — or two Sleeper ids belonging to nobody here — into a private room.
 *
 * ⚠ SO THE REACH IS SMALL TODAY, AND THAT IS A CLAIMING PROBLEM, NOT A CHAT ONE.
 * Of 275 week-one matchups in the 2026 season, 2 have both sides claimed. This
 * grows on its own as people claim their teams; nothing here needs to change.
 *
 * ⚠ IDEMPOTENT THROUGH AN EXTERNAL INDEX. `PlatformChatThread` has no natural
 * key for "this league, this season, this week, these two rosters", and adding
 * one would be a migration for a lookup. The mapping lives in the same keyed
 * store presence and trade watermarks use.
 */

const INDEX_PREFIX = 'matchup-thread:'

export type MatchupThreadResult = {
  /** Threads that already existed and were reused. */
  existing: number
  /** Threads created on this pass. */
  created: number
  /** Pairings skipped because one or both sides is not an AllFantasy user. */
  unclaimed: number
}

const EMPTY: MatchupThreadResult = { existing: 0, created: 0, unclaimed: 0 }

function indexKey(leagueId: string, season: number, week: number, a: string, b: string): string {
  /* Sorted, so the same pairing keys identically whichever side is "home". */
  const [x, y] = [a, b].sort()
  return `${INDEX_PREFIX}${leagueId}:${season}:${week}:${x}-${y}`
}

async function readIndex(key: string): Promise<string | null> {
  const row = await prisma.sportsDataCache.findUnique({ where: { cacheKey: key } }).catch(() => null)
  const data = row?.data as { threadId?: string } | null
  return data?.threadId ?? null
}

async function writeIndex(key: string, threadId: string): Promise<void> {
  const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
  await prisma.sportsDataCache
    .upsert({
      where: { cacheKey: key },
      update: { data: { threadId } as never, expiresAt },
      create: { cacheKey: key, data: { threadId } as never, expiresAt },
    })
    .catch(() => undefined)
}

/**
 * Make sure this person has a room for each of their matchups in the given week.
 *
 * Returns counts rather than threads: the caller lists threads through the
 * normal endpoint afterwards, and this exists to guarantee the rooms are there.
 * Never throws — a thread list that failed because a room could not be created
 * would be worse than a missing room.
 */
export async function ensureMatchupThreadsForUser(
  userId: string | null | undefined,
  opts: { season: number; week: number },
): Promise<MatchupThreadResult> {
  if (!userId || !Number.isFinite(opts.season) || !Number.isFinite(opts.week)) return EMPTY

  try {
    /* The teams this person actually owns — the real link, never platformUserId. */
    const myTeams = await prisma.leagueTeam.findMany({
      where: { claimedByUserId: userId },
      select: { leagueId: true, externalId: true },
      take: 50,
    })
    if (myTeams.length === 0) return EMPTY

    const byLeague = new Map<string, Set<string>>()
    for (const t of myTeams) {
      if (!byLeague.has(t.leagueId)) byLeague.set(t.leagueId, new Set())
      byLeague.get(t.leagueId)!.add(t.externalId)
    }

    const facts = await prisma.matchupFact.findMany({
      where: {
        leagueId: { in: [...byLeague.keys()] },
        season: opts.season,
        weekOrPeriod: opts.week,
      },
      select: { leagueId: true, teamA: true, teamB: true },
      take: 200,
    })

    let existing = 0
    let created = 0
    let unclaimed = 0

    for (const fact of facts) {
      const mine = byLeague.get(fact.leagueId)
      if (!mine) continue

      const iAmA = mine.has(fact.teamA)
      const iAmB = mine.has(fact.teamB)
      if (!iAmA && !iAmB) continue

      const opponentSlot = iAmA ? fact.teamB : fact.teamA

      const key = indexKey(fact.leagueId, opts.season, opts.week, fact.teamA, fact.teamB)
      if (await readIndex(key)) {
        existing += 1
        continue
      }

      const opponent = await prisma.leagueTeam.findFirst({
        where: { leagueId: fact.leagueId, externalId: opponentSlot },
        select: { claimedByUserId: true, ownerName: true, teamName: true },
      })

      /*
       * No claimed opponent means there is nobody on the other side of the room.
       * Counted rather than silently dropped, because "why do I have no matchup
       * chat" has a real answer and it is this.
       */
      if (!opponent?.claimedByUserId || opponent.claimedByUserId === userId) {
        unclaimed += 1
        continue
      }

      const thread = await createPlatformThread({
        creatorUserId: userId,
        threadType: 'group',
        title: `Week ${opts.week} · ${opponent.teamName || opponent.ownerName || 'your opponent'}`,
        memberUserIds: [opponent.claimedByUserId],
      })

      if (!thread?.id) continue

      await writeIndex(key, thread.id)
      created += 1
    }

    return { existing, created, unclaimed }
  } catch {
    return EMPTY
  }
}
