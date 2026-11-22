/**
 * Which blog articles are LIVE — readable by the public, listed on /blog, in the sitemap and the feed.
 *
 * 🛑 "PUBLISHED" ALONE WAS THE BUG. `scheduleArticle` stores `publishStatus: "scheduled"` with a
 * future `publishedAt`, and nothing anywhere ever flipped it to "published": no cron, no job, no
 * read-time check. Every reader filtered on `publishStatus === "published"`, so a scheduled post
 * stayed invisible forever, past its date, with no error.
 *
 * Fixed on the READ side rather than with a cron on purpose: a scheduled post goes live the moment
 * its time passes, on every surface at once, and it cannot be stranded by a job that did not run.
 * The stored status stays "scheduled" — the admin draft page still shows it as such — and that is
 * fine, because every public reader asks this module, not the column.
 *
 * Every public read of BlogArticle must use one of these two. A new `publishStatus: "published"`
 * filter re-creates the bug for whatever surface it is on.
 */

export type LiveCheckable = { publishStatus: string; publishedAt: Date | null }

/** Prisma `where` fragment: published, or scheduled and its time has come. */
export function liveArticleWhere(now: Date = new Date()) {
  return {
    OR: [
      { publishStatus: 'published' },
      { publishStatus: 'scheduled', publishedAt: { lte: now } },
    ],
  }
}

/** The same rule for one article already in hand. */
export function isArticleLive(article: LiveCheckable, now: Date = new Date()): boolean {
  if (article.publishStatus === 'published') return true
  return (
    article.publishStatus === 'scheduled' &&
    article.publishedAt !== null &&
    article.publishedAt.getTime() <= now.getTime()
  )
}
