import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { updateDraft } from "@/lib/automated-blog"
import { requireAdminOrBearer } from "@/lib/adminAuth"

/** GET /api/blog/[articleId] — get one article by id. */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ articleId: string }> }
) {
  // Returns the working draft body — an editor view, not the public article.
  const gate = await requireAdminOrBearer(req)
  if (!gate.ok) return gate.res
  try {
    const { articleId } = await params
    const article = await prisma.blogArticle.findUnique({
      where: { articleId },
      include: { draft: true },
    })
    if (!article) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }
    const activeDraft = article.draft
    const tags =
      Array.isArray(activeDraft?.tags)
        ? activeDraft.tags
        : Array.isArray(article.tags)
          ? article.tags
          : []
    return NextResponse.json({
      article: {
        articleId: article.articleId,
        title: activeDraft?.title ?? article.title,
        slug: activeDraft?.slug ?? article.slug,
        sport: article.sport,
        category: article.category,
        excerpt: activeDraft?.excerpt ?? article.excerpt,
        body: activeDraft?.body ?? article.body,
        seoTitle: activeDraft?.seoTitle ?? article.seoTitle,
        seoDescription: activeDraft?.seoDescription ?? article.seoDescription,
        tags,
        publishStatus: article.publishStatus,
        publishedAt: article.publishedAt?.toISOString() ?? null,
        draftStatus: activeDraft?.draftStatus ?? null,
        createdAt: article.createdAt.toISOString(),
        updatedAt: article.updatedAt.toISOString(),
      },
    })
  } catch (e) {
    console.error("[blog GET article]", e)
    return NextResponse.json({ error: "Failed to load article" }, { status: 500 })
  }
}

/** PATCH /api/blog/[articleId] — update draft fields. */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ articleId: string }> }
) {
  const gate = await requireAdminOrBearer(req)
  if (!gate.ok) return gate.res
  try {
    const { articleId } = await params
    const body = await req.json()
    const ok = await updateDraft(articleId, {
      title: body.title,
      slug: body.slug,
      excerpt: body.excerpt,
      body: body.body,
      seoTitle: body.seoTitle,
      seoDescription: body.seoDescription,
      tags: body.tags,
    })
    if (!ok) {
      return NextResponse.json({ error: "Article not found or not a draft" }, { status: 400 })
    }
    const article = await prisma.blogArticle.findUnique({
      where: { articleId },
      include: { draft: true },
    })
    const activeDraft = article?.draft
    return NextResponse.json({
      ok: true,
      article: article
        ? {
            articleId: article.articleId,
            title: activeDraft?.title ?? article.title,
            slug: activeDraft?.slug ?? article.slug,
            sport: article.sport,
            category: article.category,
            excerpt: activeDraft?.excerpt ?? article.excerpt,
            body: activeDraft?.body ?? article.body,
            seoTitle: activeDraft?.seoTitle ?? article.seoTitle,
            seoDescription: activeDraft?.seoDescription ?? article.seoDescription,
            tags:
              Array.isArray(activeDraft?.tags)
                ? activeDraft.tags
                : Array.isArray(article.tags)
                  ? article.tags
                  : [],
            publishStatus: article.publishStatus,
            publishedAt: article.publishedAt?.toISOString() ?? null,
            draftStatus: activeDraft?.draftStatus ?? null,
            createdAt: article.createdAt.toISOString(),
            updatedAt: article.updatedAt.toISOString(),
          }
        : null,
    })
  } catch (e) {
    console.error("[blog PATCH]", e)
    return NextResponse.json({ error: "Failed to update" }, { status: 500 })
  }
}
