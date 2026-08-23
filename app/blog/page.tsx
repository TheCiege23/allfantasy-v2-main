import type { Metadata } from "next"
import Link from "next/link"
import { prisma } from "@/lib/prisma"
import { formatInTimezone } from "@/lib/preferences/TimezoneFormattingResolver"
import { resolveServerRenderPreferences } from "@/lib/preferences/ServerRenderPreferenceResolver"
import { SUPPORTED_SPORTS } from "@/lib/sport-scope"
import { BLOG_CATEGORY_LABELS, BLOG_CATEGORIES } from "@/lib/automated-blog/types"
import { getPublicSiteOrigin } from "@/lib/site-public-origin"

const BASE = getPublicSiteOrigin()

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Fantasy Sports Blog – Strategy, Waiver Wire & Rankings | AllFantasy",
  description:
    "Fantasy sports blog: weekly strategy, waiver wire, trade value, draft prep, matchup previews, and ranking updates for NFL, NBA, MLB, NHL, NCAA, and Soccer.",
  alternates: { canonical: `${BASE}/blog` },
  openGraph: {
    title: "Fantasy Sports Blog | AllFantasy",
    description: "Strategy, waiver wire, draft prep, and rankings for fantasy football, basketball, baseball, hockey, and more.",
    url: `${BASE}/blog`,
    type: "website",
  },
  robots: { index: true, follow: true },
}

type BlogIndexProps = {
  searchParams?: Promise<{ sport?: string; category?: string }>
}

export default async function BlogIndexPage({ searchParams }: BlogIndexProps) {
  const { timezone, language } = await resolveServerRenderPreferences()
  const sp = await searchParams
  const sport = sp?.sport && SUPPORTED_SPORTS.includes(sp.sport as any) ? sp.sport : ""
  const category =
    sp?.category && BLOG_CATEGORIES.includes(sp.category as any) ? sp.category : ""
  const articles = await prisma.blogArticle.findMany({
    where: {
      publishStatus: "published",
      ...(sport ? { sport } : {}),
      ...(category ? { category } : {}),
    },
    orderBy: { publishedAt: "desc" },
    take: 50,
  })

  return (
    <main className="min-h-screen bg-gray-950 text-white">
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-12">
        <header className="mb-10">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Fantasy Sports Blog</h1>
          <p className="mt-2 text-gray-400">
            Strategy, waiver wire, draft prep, and rankings for NFL, NBA, MLB, NHL, NCAA, and Soccer.
          </p>
          <form className="mt-4 flex flex-wrap items-center gap-2" method="get" data-testid="blog-list-filter-form">
            <select
              name="sport"
              defaultValue={sport}
              className="rounded-lg border border-white/20 bg-black/30 px-3 py-1.5 text-xs text-white"
              data-testid="blog-list-sport-filter"
            >
              <option value="">All sports</option>
              {SUPPORTED_SPORTS.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
            <select
              name="category"
              defaultValue={category}
              className="rounded-lg border border-white/20 bg-black/30 px-3 py-1.5 text-xs text-white"
              data-testid="blog-list-category-filter"
            >
              <option value="">All categories</option>
              {BLOG_CATEGORIES.map((value) => (
                <option key={value} value={value}>
                  {BLOG_CATEGORY_LABELS[value]}
                </option>
              ))}
            </select>
            <button
              type="submit"
              className="rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-xs text-white hover:bg-white/20"
              data-testid="blog-list-apply-filter-button"
            >
              Apply filters
            </button>
          </form>
        </header>
        <ul className="space-y-6">
          {articles.length === 0 ? (
            <li className="rounded-xl border border-white/10 bg-white/5 p-6 text-center text-gray-400">
              No articles yet. Check back soon.
            </li>
          ) : (
            articles.map((a) => (
              <li key={a.articleId}>
                <Link
                  href={`/blog/${a.slug}`}
                  className="block rounded-xl border border-white/10 bg-white/5 p-5 transition hover:border-white/20 hover:bg-white/10"
                  data-testid={`blog-article-card-link-${a.articleId}`}
                >
                  <span className="text-xs uppercase text-gray-500">{a.sport} · {a.category.replace(/_/g, " ")}</span>
                  <h2 className="mt-1 text-lg font-semibold">{a.title}</h2>
                  {a.excerpt && <p className="mt-1 text-sm text-gray-400 line-clamp-2">{a.excerpt}</p>}
                  <time className="mt-2 block text-xs text-gray-500">
                    {a.publishedAt
                      ? formatInTimezone(
                          a.publishedAt,
                          timezone,
                          { dateStyle: "short" },
                          language
                        )
                      : ""}
                  </time>
                </Link>
              </li>
            ))
          )}
        </ul>
      </div>
    </main>
  )
}
