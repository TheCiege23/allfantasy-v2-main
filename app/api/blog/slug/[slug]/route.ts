import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { isBlogAdminRequest } from "@/lib/automated-blog/blogAdminGate"

/** GET /api/blog/slug/[slug] — get article by slug (for public page). Optional ?preview=1 to include drafts. */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params
    const u = new URL(req.url)
    const preview = u.searchParams?.get("preview") === "1"
    const article = await prisma.blogArticle.findUnique({
      where: { slug },
    })
    if (!article) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }
    // A draft preview is an admin view; to anyone else an unpublished slug does not exist.
    if (article.publishStatus !== "published" && !(preview && (await isBlogAdminRequest(req)))) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }
    const tags = Array.isArray(article.tags) ? article.tags : []
    return NextResponse.json({
      article: {
        articleId: article.articleId,
        title: article.title,
        slug: article.slug,
        sport: article.sport,
        category: article.category,
        excerpt: article.excerpt,
        body: article.body,
        seoTitle: article.seoTitle,
        seoDescription: article.seoDescription,
        tags,
        publishStatus: article.publishStatus,
        publishedAt: article.publishedAt?.toISOString() ?? null,
        createdAt: article.createdAt.toISOString(),
        updatedAt: article.updatedAt.toISOString(),
      },
    })
  } catch (e) {
    console.error("[blog slug GET]", e)
    return NextResponse.json({ error: "Failed to load article" }, { status: 500 })
  }
}
