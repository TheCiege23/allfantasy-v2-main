'use client'

import Link from 'next/link'
import HomeTopNav from '@/components/navigation/HomeTopNav'
import SeoLandingFooter from '@/components/landing/SeoLandingFooter'
import { RelatedToolsSection } from '@/components/landing/RelatedToolsSection'
import type { SportConfig } from '@/lib/seo-landing/config'
import { getSportCanonical } from '@/lib/seo-landing/config'
import { ArrowRight, Trophy } from 'lucide-react'
import { ShareButtons } from '@/components/seo/ShareButtons'
import BlogGuideLinks from '@/components/seo/BlogGuideLinks'
import { SPORT_GUIDES } from '@/lib/seo-landing/blog-guides'

export type SportLeagueTypeLink = { slug: string; name: string; subtitle: string | null }

/**
 * One page per sport (/sports/<slug>).
 *
 * Simplicity-first: the headline says what you can do (play this sport, free), one primary action,
 * then the three facts a searcher compares sites on — scoring, which league types, and whether
 * they can bring the league they already have. Scoring is said once, here; the league types and
 * import platforms are computed on the server from the same config the create and import screens
 * read, so this page cannot offer what those screens refuse.
 */
export default function SportLandingClient({
  config,
  leagueTypes,
  importPlatforms,
}: {
  config: SportConfig
  leagueTypes: SportLeagueTypeLink[]
  importPlatforms: string[]
}) {
  const relatedSlugs = ['trade-analyzer', 'mock-draft-simulator', 'waiver-wire-advisor', 'bracket-challenge', 'legacy-dynasty'] as const
  const primary = config.primaryCta ?? { label: `Start a free ${config.noun} league`, href: '/create-league' }

  return (
    <main
      className="min-h-screen flex flex-col mode-readable"
      style={{ background: 'var(--bg)', color: 'var(--text)' }}
    >
      <HomeTopNav />

      <article className="flex-1 px-4 py-8 sm:px-6 sm:py-12">
        <div className="mx-auto max-w-3xl">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
            {config.headline}
          </h1>
          <p className="mt-4 text-base leading-relaxed">
            {config.body}
          </p>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Link
              href={primary.href}
              data-testid="sport-landing-primary-cta"
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-cyan-500 px-4 py-3 text-sm font-semibold text-black hover:bg-cyan-400 min-h-[44px]"
            >
              {primary.label}
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
            <Link
              href="/discover/leagues"
              data-testid="sport-landing-find-league"
              className="inline-flex items-center gap-2 rounded-xl border px-4 py-3 text-sm font-medium min-h-[44px]"
              style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
            >
              Find a league to join
            </Link>
          </div>

          <dl className="mt-8 grid gap-4 rounded-2xl border p-5 text-sm sm:grid-cols-[auto_1fr] sm:gap-x-6" style={{ borderColor: 'var(--border)', background: 'color-mix(in srgb, var(--panel) 50%, transparent)' }}>
            <dt className="font-semibold">Scoring</dt>
            <dd style={{ color: 'var(--muted)' }}>{config.scoring}</dd>
            {importPlatforms.length > 0 ? (
              <>
                <dt className="font-semibold">Bring your league</dt>
                <dd style={{ color: 'var(--muted)' }} data-testid="sport-landing-import-platforms">
                  Import it from {formatList(importPlatforms)}.
                </dd>
              </>
            ) : null}
          </dl>

          {leagueTypes.length > 0 ? (
            <section className="mt-10" aria-labelledby="league-types">
              <h2 id="league-types" className="text-lg font-semibold">
                League types you can play
              </h2>
              <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                {leagueTypes.map((t) => (
                  <li key={t.slug}>
                    <Link
                      href={`/league-types/${t.slug}`}
                      data-testid={`sport-landing-league-type-${t.slug}`}
                      className="flex min-h-[44px] items-center justify-between gap-3 rounded-xl border px-4 py-2.5 hover:opacity-90"
                      style={{ borderColor: 'var(--border)', background: 'color-mix(in srgb, var(--panel2) 70%, transparent)' }}
                    >
                      <span>
                        <span className="block text-sm font-medium">{t.name}</span>
                        {t.subtitle ? (
                          <span className="block text-xs" style={{ color: 'var(--muted)' }}>
                            {t.subtitle}
                          </span>
                        ) : null}
                      </span>
                      <ArrowRight className="h-4 w-4 shrink-0" aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <BlogGuideLinks guides={SPORT_GUIDES[config.slug]} testIdPrefix={`sport-landing-${config.slug}`} />

          <section className="mt-10" aria-labelledby="tools">
            <h2 id="tools" className="text-lg font-semibold">
              Tools for {config.noun}
            </h2>
            <ul className="mt-3 flex flex-wrap gap-2">
              {config.toolHrefs.map(({ label, href }) => (
                <li key={href}>
                  <Link
                    href={href}
                    data-testid={`sport-landing-feature-link-${href.replace(/\//g, '-').replace(/^-+/, '')}`}
                    className="inline-flex min-h-[40px] items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium hover:opacity-90"
                    style={{
                      borderColor: 'var(--border)',
                      background: 'color-mix(in srgb, var(--panel2) 70%, transparent)',
                      color: 'var(--text)',
                    }}
                  >
                    {label}
                    <ArrowRight className="h-4 w-4" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
            <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
              {primary.href !== '/brackets' ? (
                <Link
                  href="/brackets"
                  data-testid="sport-landing-bracket-link"
                  className="inline-flex items-center gap-1 hover:underline"
                  style={{ color: 'var(--muted)' }}
                >
                  <Trophy className="h-4 w-4" aria-hidden />
                  Bracket pools
                </Link>
              ) : null}
              <Link
                href="/install"
                className="inline-flex items-center gap-1 hover:underline"
                style={{ color: 'var(--muted)' }}
                data-testid="sport-landing-install-link"
              >
                Install the AllFantasy app
              </Link>
            </div>
            <div className="mt-4">
              <ShareButtons
                path={getSportCanonical(config.slug)}
                title={config.title}
                description={config.description}
                testIdPrefix={`sport-landing-share-${config.slug}`}
              />
            </div>
          </section>

          <section className="mt-10">
            <RelatedToolsSection slugs={[...relatedSlugs]} title="More free tools" />
          </section>
        </div>
      </article>

      <SeoLandingFooter />
    </main>
  )
}

/** "A", "A or B", "A, B or C". */
function formatList(items: string[]): string {
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join(', ')} or ${items[items.length - 1]}`
}
