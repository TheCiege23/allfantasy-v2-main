import { notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { isArticleLive } from '@/lib/automated-blog/liveArticles'
import { blogShareCardLabel } from '@/lib/automated-blog/blogShareCard'
import { renderBlogShareCard } from '@/lib/automated-blog/blogShareCardImage'

/**
 * The share card for a blog post (og:image and, through ./twitter-image, twitter:image).
 *
 * Posts had no image at all, so a link pasted into a group chat or a feed showed bare text. This
 * reads the database only for the title and labels, and a post that is not live gets no card, the
 * same rule as the page itself. The drawing is lib/automated-blog/blogShareCardImage.tsx.
 *
 * Served from the page path rather than `/api/*`: middleware refuses API calls from data-centre
 * addresses but lets link-preview crawlers through on pages (see the Survivor moment card).
 */
export const runtime = 'nodejs'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'
export const alt = 'AllFantasy blog'

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const article = await prisma.blogArticle.findUnique({
    where: { slug },
    select: { title: true, sport: true, category: true, publishStatus: true, publishedAt: true },
  })
  if (!article || !isArticleLive(article)) notFound()
  return renderBlogShareCard(article.title, blogShareCardLabel(article.sport, article.category))
}
