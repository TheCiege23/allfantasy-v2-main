import { NextRequest, NextResponse } from "next/server"
import {
  buildBlogSEO,
  generateBlogDraft,
  suggestInternalLinks,
  getBlogProviderStatus,
} from "@/lib/automated-blog"
import { normalizeToSupportedSport } from "@/lib/sport-scope"
import { BLOG_CATEGORIES } from "@/lib/automated-blog/types"
import { requireAdminOrBearer } from "@/lib/adminAuth"

/** POST /api/blog/generate — generate draft content (no save). Body: sport, category, topicHint?. */
export async function POST(req: NextRequest) {
  const gate = await requireAdminOrBearer(req)
  if (!gate.ok) return gate.res
  try {
    const body = await req.json()
    const sport = body?.sport ?? ""
    const category = body?.category ?? ""
    if (!sport || !category || !BLOG_CATEGORIES.includes(category as any)) {
      return NextResponse.json(
        { error: "Missing or invalid sport/category" },
        { status: 400 }
      )
    }
    const draft = await generateBlogDraft({
      sport: normalizeToSupportedSport(sport),
      category: category as any,
      topicHint: body.topicHint,
      contentType: category as any,
    })
    if (!draft) {
      return NextResponse.json({ error: "Generation failed" }, { status: 500 })
    }
    const seo = buildBlogSEO({
      title: draft.title,
      excerpt: draft.excerpt,
      body: draft.body,
      sport: normalizeToSupportedSport(sport),
      category,
      slug: draft.slug,
    })
    const internalLinks = suggestInternalLinks({
      sport: normalizeToSupportedSport(sport),
      category,
      body: draft.body,
      maxSuggestions: 10,
    })
    const providerStatus = getBlogProviderStatus()
    return NextResponse.json({
      draft,
      seo,
      internalLinks,
      providerStatus,
      degradedMode: !providerStatus.openai,
    })
  } catch (e) {
    console.error("[blog/generate]", e)
    return NextResponse.json({ error: "Generation failed" }, { status: 500 })
  }
}
