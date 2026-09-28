import 'server-only'

import { prisma } from '@/lib/prisma'
import { CHIMMY_AUTHOR_FLAG_KEYS } from '@/lib/league-chat/chimmyIdentity'
import { getLeagueChatReadMarks } from './leagueChatRead'
import { getChatUnread } from './unreadCounts'

/**
 * THE CHAT BUBBLE'S NUMBER — everything waiting for you, not only DMs (owner's call 2026-09-25,
 * "fix the chat bubble count issues"). The launcher counted DMs and huddles; a busy league chat and
 * Chimmy's weekly lineup and waiver checks never moved it.
 *
 *   dm      unread DMs and huddles (getChatUnread — muted threads excluded, never your own)
 *   league  league chat messages since you last opened that league's chat (leagueChatRead.ts); a
 *           league you have never opened counts only its last LEAGUE_WINDOW_MS, so a first visit
 *           does not greet you with a season of backlog. Chimmy's posts count for EVERYONE,
 *           the commissioner included — see `notMineOrChimmy`
 *   chimmy  Chimmy's weekly lineup / waiver checks you haven't opened (unread bell rows, 7 days)
 *   mentions  messages that name you, DMs and league chat — a subset of total, badged differently
 *
 * Each part fails to zero on its own: a badge is decoration on a working page.
 */

export type ChatBadge = { total: number; mentions: number; dm: number; league: number; chimmy: number }

export const CHIMMY_PROACTIVE_TYPES = ['chimmy_lineup_check', 'chimmy_waiver_check'] as const
const LEAGUE_WINDOW_MS = 3 * 24 * 60 * 60 * 1000
const CHIMMY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000
const MAX_LEAGUES = 60
const MAX_LEAGUE_ROWS = 500

const ZERO: ChatBadge = { total: 0, mentions: 0, dm: 0, league: 0, chimmy: 0 }

/**
 * "Not your own message" — EXCEPT that a Chimmy post is never your own.
 *
 * 🛑 A CHIMMY ROW IS STORED UNDER THE LEAGUE OWNER. `LeagueChatMessage.userId` is a required FK and
 * there is no bot user, so every Chimmy post (weekly awards, trade takes, close finishes, starter
 * injuries, commissioner notices) carries the commissioner as its technical author
 * (lib/league-chat/chimmyIdentity.ts). A bare `userId: { not: me }` therefore dropped every one of
 * them from the COMMISSIONER's count only — the one person who most needs to see a governance notice
 * went unbadged. The marker is server-owned (a member cannot set it through the client allowlist), so
 * letting it through here cannot make a member's own message count as unread for them.
 *
 * Set-based on purpose: one `OR` over the JSON flags inside the same `findMany`, no per-row read.
 */
function notMineOrChimmy(userId: string) {
  return {
    OR: [
      { userId: { not: userId } },
      ...CHIMMY_AUTHOR_FLAG_KEYS.map((key) => ({ metadata: { path: [key], equals: true } })),
    ],
  }
}

export async function getChatBadge(userId: string | null | undefined, now: Date = new Date()): Promise<ChatBadge> {
  if (!userId) return ZERO
  const [dm, league, chimmy] = await Promise.all([
    getChatUnread(userId).catch(() => ({ total: 0, mentions: 0, mutedUnread: 0 })),
    leagueUnread(userId, now).catch(() => ({ count: 0, mentions: 0 })),
    chimmyUnread(userId, now).catch(() => 0),
  ])
  return {
    total: dm.total + league.count + chimmy,
    mentions: dm.mentions + league.mentions,
    dm: dm.total,
    league: league.count,
    chimmy,
  }
}

/** The leagues whose chat is yours: a team you claimed, or a league you run. */
async function myLeagueIds(userId: string): Promise<string[]> {
  const [teams, owned] = await Promise.all([
    prisma.leagueTeam.findMany({
      where: { claimedByUserId: userId },
      select: { leagueId: true },
      distinct: ['leagueId'],
      take: MAX_LEAGUES,
    }),
    prisma.league.findMany({ where: { userId }, select: { id: true }, take: MAX_LEAGUES }),
  ])
  return Array.from(new Set([...teams.map((t) => t.leagueId), ...owned.map((l) => l.id)])).slice(0, MAX_LEAGUES)
}

async function leagueUnread(userId: string, now: Date): Promise<{ count: number; mentions: number }> {
  const leagueIds = await myLeagueIds(userId)
  if (leagueIds.length === 0) return { count: 0, mentions: 0 }
  const floor = new Date(now.getTime() - LEAGUE_WINDOW_MS)
  const [marks, rows] = await Promise.all([
    getLeagueChatReadMarks(userId, leagueIds),
    prisma.leagueChatMessage.findMany({
      where: {
        leagueId: { in: leagueIds },
        createdAt: { gt: floor },
        // League chat only (draft-only rows are the draft room's).
        source: null,
        AND: [
          // Never your own — but a Chimmy post is nobody's own, the commissioner's included.
          notMineOrChimmy(userId),
          // Never a private @chimmy row addressed to somebody else.
          { OR: [{ isPrivate: false }, { visibleToUserId: userId }] },
        ],
      },
      select: { leagueId: true, createdAt: true, mentionedUserIds: true },
      orderBy: { createdAt: 'desc' },
      take: MAX_LEAGUE_ROWS,
    }),
  ])
  let count = 0
  let mentions = 0
  for (const r of rows) {
    const readAt = marks.get(r.leagueId)
    if (readAt && r.createdAt.getTime() <= readAt.getTime()) continue
    count += 1
    if (r.mentionedUserIds.includes(userId)) mentions += 1
  }
  return { count, mentions }
}

async function chimmyUnread(userId: string, now: Date): Promise<number> {
  return prisma.platformNotification.count({
    where: {
      userId,
      type: { in: [...CHIMMY_PROACTIVE_TYPES] },
      readAt: null,
      createdAt: { gte: new Date(now.getTime() - CHIMMY_WINDOW_MS) },
    },
  })
}

/** Opening Chimmy clears its weekly checks from the bubble (and the bell). Never throws. */
export async function markChimmyProactiveSeen(userId: string, now: Date = new Date()): Promise<void> {
  if (!userId) return
  await prisma.platformNotification
    .updateMany({ where: { userId, type: { in: [...CHIMMY_PROACTIVE_TYPES] }, readAt: null }, data: { readAt: now } })
    .catch(() => {})
}
