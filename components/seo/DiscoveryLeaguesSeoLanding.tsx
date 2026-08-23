import Link from 'next/link'
import HomeTopNav from '@/components/navigation/HomeTopNav'
import { Users, ArrowRight } from 'lucide-react'
import {
  DISCOVERY_LEAGUES_PAGE_CONFIG,
  DISCOVERY_LEAGUES_SLUGS,
  getDiscoveryLeaguesCanonical,
  type DiscoveryLeaguesPageConfig,
} from '@/lib/seo-landing/discovery-leagues-pages'
import { getPublicSiteOrigin } from '@/lib/site-public-origin'

interface DiscoveryLeaguesSeoLandingProps {
  config: DiscoveryLeaguesPageConfig
}

export default function DiscoveryLeaguesSeoLanding({ config }: DiscoveryLeaguesSeoLandingProps) {
  const canonicalUrl = getDiscoveryLeaguesCanonical(config.slug)
  /*
   * ⚠ THE SITE ROOT USED TO BE THE HARDCODED APEX IN TWO PLACES BELOW, AND THAT
   * LEFT THIS PAGE'S OWN JSON-LD DISAGREEING WITH ITSELF. `canonicalUrl` resolves
   * through getPublicSiteOrigin() and returns www; `isPartOf.url` and the
   * breadcrumb's Home item said https://allfantasy.ai. Measured on all three
   * rendered pages: BOTH hosts appeared inside the same structured-data block,
   * so the page declared two different site roots and named a Home URL that
   * 307s.
   *
   * That is worse than being uniformly wrong, and it got worse when d662343a
   * fixed the canonical helper without touching these two literals — a partial
   * fix turned a consistent error into an inconsistent one. This is the last
   * SEO-visible instance of the hardcoded apex; the ~30 that remain are
   * NEXTAUTH_URL fallbacks for invite and share links, which are a different
   * concern and deliberately untouched.
   */
  const siteOrigin = getPublicSiteOrigin()
  const relatedPages = DISCOVERY_LEAGUES_SLUGS.filter((slug) => slug !== config.slug).map(
    (slug) => DISCOVERY_LEAGUES_PAGE_CONFIG[slug]
  )
  const faqSchema = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: config.faq.map((item) => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: item.answer,
      },
    })),
  }
  const webPageSchema = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: config.title,
    description: config.description,
    url: canonicalUrl,
    inLanguage: 'en-US',
    isPartOf: {
      '@type': 'WebSite',
      name: 'AllFantasy',
      url: siteOrigin,
    },
    breadcrumb: {
      '@type': 'BreadcrumbList',
      itemListElement: [
        {
          '@type': 'ListItem',
          position: 1,
          name: 'Home',
          item: siteOrigin,
        },
        {
          '@type': 'ListItem',
          position: 2,
          name: config.sportLabel,
          item: canonicalUrl,
        },
      ],
    },
  }

  return (
    <main
      className="min-h-screen flex flex-col mode-readable"
      style={{ background: 'var(--bg)', color: 'var(--text)' }}
    >
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(webPageSchema) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
      />
      <HomeTopNav />

      <article className="flex-1 px-4 py-8 sm:px-6 sm:py-12">
        <div className="mx-auto max-w-3xl">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
            {config.headline}
          </h1>
          <p className="mt-4 text-base leading-relaxed" style={{ color: 'var(--muted)' }}>
            {config.body}
          </p>

          <section className="mt-10 rounded-2xl border p-6" style={{ borderColor: 'var(--border)', background: 'var(--panel)' }}>
            <h2 className="text-lg font-semibold mb-2">Browse & join leagues</h2>
            <p className="text-sm mb-4" style={{ color: 'var(--muted)' }}>
              See open public and creator leagues. Filter by format and join before they fill.
            </p>
            <Link
              href={config.discoverHref}
              className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-emerald-500 px-5 py-3 text-sm font-semibold text-black shadow-lg hover:bg-emerald-400 transition-colors"
            >
              <Users className="h-5 w-5 shrink-0" />
              Browse leagues
              <ArrowRight className="h-4 w-4 shrink-0" />
            </Link>
          </section>

          <section className="mt-8">
            <h2 className="text-lg font-semibold mb-4">Frequently asked questions</h2>
            <div className="space-y-3">
              {config.faq.map((item) => (
                <div
                  key={`${config.slug}-${item.question}`}
                  className="rounded-xl border p-4"
                  style={{ borderColor: 'var(--border)', background: 'var(--panel)' }}
                >
                  <h3 className="text-sm font-semibold">{item.question}</h3>
                  <p className="mt-1.5 text-sm" style={{ color: 'var(--muted)' }}>
                    {item.answer}
                  </p>
                </div>
              ))}
            </div>
          </section>

          <section className="mt-8">
            <h2 className="text-lg font-semibold mb-4">Related fantasy league pages</h2>
            <ul className="space-y-2">
              {relatedPages.map((page) => (
                <li key={`related-${page.slug}`}>
                  <Link
                    href={`/${page.slug}/leagues`}
                    className="inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium transition-colors hover:opacity-90"
                    style={{
                      borderColor: 'var(--border)',
                      background: 'var(--panel)',
                      color: 'var(--text)',
                    }}
                  >
                    {page.headline}
                    <ArrowRight className="h-4 w-4 shrink-0" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>

          <section className="mt-8">
            <h2 className="text-lg font-semibold mb-4">More ways to play</h2>
            <ul className="space-y-2">
              <li>
                <Link
                  href="/discover/leagues"
                  className="inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium transition-colors hover:opacity-90"
                  style={{
                    borderColor: 'var(--border)',
                    background: 'var(--panel)',
                    color: 'var(--text)',
                  }}
                >
                  All sports – discover leagues
                  <ArrowRight className="h-4 w-4 shrink-0" />
                </Link>
              </li>
              <li>
                <Link
                  href="/find-league"
                  className="inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium transition-colors hover:opacity-90"
                  style={{
                    borderColor: 'var(--border)',
                    background: 'var(--panel)',
                    color: 'var(--text)',
                  }}
                >
                  Find a league by invite
                  <ArrowRight className="h-4 w-4 shrink-0" />
                </Link>
              </li>
              <li>
                <Link
                  href="/app"
                  className="inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium transition-colors hover:opacity-90"
                  style={{
                    borderColor: 'var(--border)',
                    background: 'var(--panel)',
                    color: 'var(--text)',
                  }}
                >
                  Open AllFantasy App
                  <ArrowRight className="h-4 w-4 shrink-0" />
                </Link>
              </li>
            </ul>
          </section>
        </div>
      </article>

      <footer className="border-t py-6 text-center text-xs" style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}>
        <div className="mx-auto flex flex-wrap items-center justify-center gap-3 px-4">
          <Link href="/" className="hover:underline">Home</Link>
          <span style={{ color: 'var(--muted2)' }}>·</span>
          <Link href="/discover/leagues" className="hover:underline">Discover Leagues</Link>
          <span style={{ color: 'var(--muted2)' }}>·</span>
          <Link href="/app" className="hover:underline">App</Link>
        </div>
      </footer>
    </main>
  )
}
