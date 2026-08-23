import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { buildBlogSEO } from "@/lib/automated-blog"
import { formatInTimezone } from "@/lib/preferences/TimezoneFormattingResolver"
import { resolveServerRenderPreferences } from "@/lib/preferences/ServerRenderPreferenceResolver"
import { getPublicSiteOrigin } from "@/lib/site-public-origin"

const BASE = getPublicSiteOrigin()

type Props = { params: Promise<{ slug: string }>; searchParams?: Promise<{ preview?: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const article = await prisma.blogArticle.findUnique({
    where: { slug },
  })
  if (!article) return { title: "Blog | AllFantasy" }
  const seo = buildBlogSEO({
    title: article.title,
    excerpt: article.excerpt,
    body: article.body,
    sport: article.sport,
    category: article.category,
    slug: article.slug,
  })
  return {
    title: seo.title,
    description: seo.description,
    keywords: seo.keywords,
    alternates: { canonical: seo.canonical },
    openGraph: {
      title: seo.ogTitle,
      description: seo.ogDescription,
      url: seo.canonical,
      siteName: "AllFantasy",
      type: "article",
    },
    twitter: {
      card: "summary_large_image",
      title: seo.ogTitle,
      description: seo.ogDescription,
    },
    robots: { index: true, follow: true },
  }
}

export default async function BlogArticlePage({ params, searchParams }: Props) {
  const { timezone, language } = await resolveServerRenderPreferences()
  const { slug } = await params
  const sp = await searchParams
  const isPreview = sp?.preview === "1"
  const article = await prisma.blogArticle.findUnique({
    where: { slug },
  })
  if (!article) notFound()
  if (article.publishStatus !== "published" && !isPreview) notFound()

  const bodyHtml = article.body
    .split("\n")
    .map((line) => {
      if (/^###\s/.test(line)) return `<h3 class="text-lg font-semibold mt-6 mb-2">${line.slice(4)}</h3>`
      if (/^##\s/.test(line)) return `<h2 class="text-xl font-semibold mt-8 mb-2">${line.slice(3)}</h2>`
      if (/^#\s/.test(line)) return `<h1 class="text-2xl font-bold mt-6 mb-2">${line.slice(2)}</h1>`
      if (line.trim()) return `<p class="mb-3">${line.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")}</p>`
      return ""
    })
    .filter(Boolean)
    .join("\n")

  return (
    <main className="min-h-screen bg-gray-950 text-white">
      <article className="mx-auto max-w-2xl px-4 py-10 sm:px-6 sm:py-12">
        <Link href="/blog" className="text-sm text-gray-400 hover:text-white" data-testid="blog-article-back-button">
          ← Back to Blog
        </Link>
        <header className="mt-6">
          <span className="text-xs uppercase text-gray-500">{article.sport} · {article.category.replace(/_/g, " ")}</span>
          <h1 className="mt-1 text-3xl font-bold tracking-tight">{article.title}</h1>
          {article.publishedAt && (
            <time className="mt-2 block text-sm text-gray-500">
              {formatInTimezone(article.publishedAt, timezone, { dateStyle: "short" }, language)}
            </time>
          )}
        </header>
        {article.excerpt && (
          <p className="mt-4 text-gray-400">{article.excerpt}</p>
        )}
        <div
          className="blog-body mt-8 prose prose-invert max-w-none"
          dangerouslySetInnerHTML={{ __html: bodyHtml }}
          data-testid="blog-article-body"
        />
      </article>
    </main>
  )
}
