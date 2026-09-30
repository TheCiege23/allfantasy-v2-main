import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { suggestInternalLinks } from "@/lib/automated-blog"
import { requireAdminOrBearer } from "@/lib/adminAuth"

/** GET /api/blog/[articleId]/internal-links — suggest internal links for this article. */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ articleId: string }> }
) {
  const gate = await requireAdminOrBearer(req)
  if (!gate.ok) return gate.res
  try {
    const { articleId } = await params
    const article = await prisma.blogArticle.findUnique({
      where: { articleId },
    })
    if (!article) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }
    const suggestions = suggestInternalLinks({
      sport: article.sport,
      category: article.category,
      body: article.body,
      maxSuggestions: 10,
    })
    return NextResponse.json({ suggestions })
  } catch (e) {
    console.error("[blog internal-links]", e)
    return NextResponse.json({ error: "Failed to get suggestions" }, { status: 500 })
  }
}
