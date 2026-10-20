'use client'

import Link from 'next/link'
import HomeTopNav from '@/components/navigation/HomeTopNav'
import SeoLandingFooter from '@/components/landing/SeoLandingFooter'
import { LandingCTAStrip } from '@/components/landing/LandingCTAStrip'
import { LandingToolVisitTracker } from '@/components/landing/LandingToolVisitTracker'
import { RelatedToolsSection } from '@/components/landing/RelatedToolsSection'
import type { ToolConfig } from '@/lib/seo-landing/config'
import { SPORT_SLUGS } from '@/lib/seo-landing/config'
import { ROUTES } from '@/lib/tool-hub'
import { AppWindow, ArrowRight } from 'lucide-react'
import { ShareButtons } from '@/components/seo/ShareButtons'
import { getToolCanonical } from '@/lib/seo-landing/config'

export default function ToolLandingClient({ config }: { config: ToolConfig }) {
  const relatedSlugs = config.relatedToolSlugs

  return (
    <main
      className="min-h-screen flex flex-col mode-readable"
      style={{ background: 'var(--bg)', color: 'var(--text)' }}
    >
      <LandingToolVisitTracker path={`/tools/${config.slug}`} toolName={config.headline} />
      <HomeTopNav />

      <article className="flex-1 px-4 py-8 sm:px-6 sm:py-12">
        <div className="mx-auto max-w-3xl">
          <div className="mb-4">
            <Link
              href={ROUTES.toolsHub()}
              className="inline-flex items-center gap-2 text-sm font-medium hover:underline"
              style={{ color: 'var(--muted)' }}
              data-testid="tool-landing-back-to-hub"
            >
              <ArrowRight className="h-4 w-4 rotate-180" />
              Back to Tools Hub
            </Link>
          </div>
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
            {config.headline}
          </h1>
          <p className="mt-4 text-lg leading-relaxed" style={{ color: 'var(--muted)' }}>
            {config.benefitSummary}
          </p>

          <section className="mt-8">
            <LandingCTAStrip
              primaryHref={config.openToolHref}
              primaryLabel={`Open ${config.headline}`}
              showSignInSignUp
            />
            <div className="mt-4">
              <ShareButtons
                path={getToolCanonical(config.slug)}
                title={config.title}
                description={config.description}
                testIdPrefix={`tool-landing-share-${config.slug}`}
              />
              <div className="mt-3">
                <Link
                  href="/install"
                  className="inline-flex items-center gap-2 text-xs font-medium hover:underline"
                  style={{ color: 'var(--muted)' }}
                  data-testid="tool-landing-install-link"
                >
                  Install AllFantasy app
                </Link>
              </div>
            </div>
          </section>

          <section className="mt-10">
            <h2 className="text-lg font-semibold mb-3">What this tool does</h2>
            <ul className="list-disc list-inside space-y-2 text-sm" style={{ color: 'var(--muted)' }}>
              {config.examples.map((ex, i) => (
                <li key={i}>{ex}</li>
              ))}
            </ul>
          </section>

          <section className="mt-10">
            <h2 className="text-lg font-semibold mb-3">Who it&apos;s for</h2>
            <p className="text-sm leading-relaxed" style={{ color: 'var(--muted)' }}>
              Fantasy players in redraft or dynasty leagues who want AI-backed analysis, faster
              decisions, and league-context aware recommendations. Works across NFL, NBA, MLB, NHL,
              NCAA, and soccer.
            </p>
          </section>

          <section className="mt-10">
            <h2 className="text-lg font-semibold mb-3">Supported sports</h2>
            <p className="text-sm mb-3" style={{ color: 'var(--muted)' }}>
              AllFantasy supports NFL, NHL, NBA, MLB, NCAA Basketball, NCAA Football, and Soccer.
            </p>
            <ul className="flex flex-wrap gap-2">
              {SPORT_SLUGS.map((slug) => (
                <li key={slug}>
                  <Link
                    href={`/sports/${slug}`}
                    className="rounded-lg border px-3 py-1.5 text-xs font-medium hover:opacity-90"
                    style={{
                      borderColor: 'var(--border)',
                      background: 'color-mix(in srgb, var(--panel2) 70%, transparent)',
                      color: 'var(--text)',
                    }}
                    data-testid={`tool-landing-sport-link-${slug}`}
                  >
                    {slug.replace(/-/g, ' ')}
                  </Link>
                </li>
              ))}
            </ul>
          </section>

          {config.faqs && config.faqs.length > 0 && (
            <section className="mt-10">
              <h2 className="text-lg font-semibold mb-3">FAQ</h2>
              <ul className="space-y-4">
                {config.faqs.map((faq, i) => (
                  <li key={i} className="rounded-xl border p-4" style={{ borderColor: 'var(--border)' }}>
                    <h3 className="font-medium text-sm mb-1">{faq.q}</h3>
                    <p className="text-sm" style={{ color: 'var(--muted)' }}>{faq.a}</p>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="mt-10">
            <RelatedToolsSection slugs={relatedSlugs} title="Explore related tools" />
          </section>

          <section className="mt-10 rounded-2xl border p-5" style={{ borderColor: 'var(--border)', background: 'color-mix(in srgb, var(--panel) 50%, transparent)' }}>
            <h2 className="text-lg font-semibold mb-2">More from AllFantasy</h2>
            <p className="text-sm mb-4" style={{ color: 'var(--muted)' }}>
              Sports App, Bracket Challenge, and Legacy dynasty tools in one platform.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link
                href="/"
                className="inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium"
                style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
              >
                <AppWindow className="h-4 w-4" />
                Home
              </Link>
              <Link
                href={ROUTES.toolsHub()}
                className="inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium"
                style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
                data-testid="tool-landing-all-tools-link"
              >
                All tools
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </section>

          <section className="mt-10">
            <LandingCTAStrip
              primaryHref={config.openToolHref}
              primaryLabel={`Open ${config.headline}`}
              showSignInSignUp
            />
          </section>
        </div>
      </article>

      <SeoLandingFooter />
    </main>
  )
}
