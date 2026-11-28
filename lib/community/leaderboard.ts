import { Prisma } from '@prisma/client'

/**
 * Clubhouse contributor points. Pure, so the weights are tested and the page can show them.
 *
 * A post counts more than a reply, an upvote someone else gave your idea counts more than
 * either, and a shipped idea counts most: the point of the board is to reward the people whose
 * ideas move AllFantasy, not whoever posts most. Automatic threads never count, and nobody can
 * upvote their own idea, so none of these can be farmed alone.
 */
export const POINTS = { post: 3, reply: 1, upvoteReceived: 2, ideaShipped: 25 } as const

export type ContributionCounts = { posts: number; replies: number; upvotesReceived: number; ideasShipped: number }

export function contributionScore(c: ContributionCounts): number {
  return c.posts * POINTS.post + c.replies * POINTS.reply + c.upvotesReceived * POINTS.upvoteReceived + c.ideasShipped * POINTS.ideaShipped
}

export type LeaderboardWindow = '30d' | 'all'

export function parseLeaderboardWindow(v: unknown): LeaderboardWindow {
  return v === 'all' ? 'all' : '30d'
}

/** The 30-day top three get the "Top contributor" badge. */
export const TOP_CONTRIBUTOR_COUNT = 3

/**
 * One row per member with their counts in the window. `since` null = all time. Upvotes are
 * counted when they were GIVEN, so an old idea that is still collecting votes keeps scoring.
 */
export function contributionCountsSql(since: Date | null): Prisma.Sql {
  const postSince = since ? Prisma.sql`and p."createdAt" >= ${since}` : Prisma.empty
  const replySince = since ? Prisma.sql`and r."createdAt" >= ${since}` : Prisma.empty
  const voteSince = since ? Prisma.sql`and v."createdAt" >= ${since}` : Prisma.empty
  const shipSince = since ? Prisma.sql`and p."ideaStatusAt" >= ${since}` : Prisma.empty
  return Prisma.sql`
    select u, sum(posts)::int posts, sum(replies)::int replies, sum(upvotes)::int upvotes, sum(shipped)::int shipped from (
      select p."authorUserId" u, count(*) posts, 0 replies, 0 upvotes, 0 shipped
        from community_posts p where p."removedAt" is null and p."systemKey" is null ${postSince} group by 1
      union all
      select r."authorUserId", 0, count(*), 0, 0
        from community_replies r where r."removedAt" is null ${replySince} group by 1
      union all
      select p."authorUserId", 0, 0, count(*), 0
        from community_idea_votes v join community_posts p on p.id = v."postId"
        where p."removedAt" is null and v."userId" <> p."authorUserId" ${voteSince} group by 1
      union all
      select p."authorUserId", 0, 0, 0, count(*)
        from community_posts p where p."removedAt" is null and p.kind = 'idea' and p."ideaStatus" = 'shipped' ${shipSince} group by 1
    ) t group by u`
}

export type LeaderboardRowCounts = { userId: string } & ContributionCounts & { score: number }

export function rankContributions(
  rows: Array<{ u: string; posts: number; replies: number; upvotes: number; shipped: number }>,
  exclude: Set<string> = new Set(),
): LeaderboardRowCounts[] {
  return rows
    .filter((r) => !exclude.has(r.u))
    .map((r) => {
      const c = { posts: r.posts, replies: r.replies, upvotesReceived: r.upvotes, ideasShipped: r.shipped }
      return { userId: r.u, ...c, score: contributionScore(c) }
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || b.ideasShipped - a.ideasShipped || b.upvotesReceived - a.upvotesReceived || a.userId.localeCompare(b.userId))
}
