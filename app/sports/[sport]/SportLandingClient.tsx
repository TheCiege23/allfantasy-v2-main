'use client'

import Link from 'next/link'
import HomeTopNav from '@/components/navigation/HomeTopNav'
import SeoLandingFooter from '@/components/landing/SeoLandingFooter'
import { LandingCTAStrip } from '@/components/landing/LandingCTAStrip'
import { RelatedToolsSection } from '@/components/landing/RelatedToolsSection'
import type { SportConfig } from '@/lib/seo-landing/config'
import { getSportCanonical } from '@/lib/seo-landing/config'
import { AppWindow, Trophy, Zap, ArrowRight } from 'lucide-react'
import { ShareButtons } from '@/components/seo/ShareButtons'

export default function SportLandingClient({ config }: { config: SportConfig }) {
  const relatedSlugs = ['trade-analyzer', 'mock-draft-simulator', 'waiver-wire-advisor', 'bracket-challenge', 'legacy-dynasty'] as const

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
          <p className="mt-4 text-base leading-relaxed" style={{ color: 'var(--muted)' }}>
            {config.body}
          </p>
          <div className="mt-4">
            <ShareButtons
              path={getSportCanonical(config.slug)}
              title={config.title}
              description={config.description}
              testIdPrefix={`sport-landing-share-${config.slug}`}
            />
          </div>
          <div className="mt-2">
            <Link
              href="/install"
              className="inline-flex items-center gap-2 text-xs font-medium hover:underline"
              style={{ color: 'var(--muted)' }}
              data-testid="sport-landing-install-link"
            >
              Install AllFantasy app
            </Link>
          </div>

          <section className="mt-8">
            <h2 className="text-lg font-semibold mb-3">Featured tools for {config.leagueSport}</h2>
            <ul className="space-y-2">
              {config.toolHrefs.map(({ label, href }) => (
                <li key={href}>
                  <Link
                    href={href}
                    data-testid={`sport-landing-feature-link-${href.replace(/\//g, '-').replace(/^-+/, '')}`}
                    className="inline-flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium hover:opacity-90"
                    style={{
                      borderColor: 'var(--border)',
                      background: 'color-mix(in srgb, var(--panel2) 70%, transparent)',
                      color: 'var(--text)',
                    }}
                  >
                    {label}
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>

          <section className="mt-8">
            <h2 className="text-lg font-semibold mb-3">AI capabilities</h2>
            <p className="text-sm leading-relaxed" style={{ color: 'var(--muted)' }}>
              AllFantasy uses AI for trade analysis, waiver recommendations, draft suggestions, and
              league insights. Get grades and explanations tuned to your league settings and sport.
            </p>
            <Link
              href="/chimmy"
              data-testid="sport-landing-chimmy-link"
              className="mt-3 inline-flex items-center gap-2 text-sm font-medium"
              style={{ color: 'var(--accent-cyan)' }}
            >
              Meet Chimmy AI
              <ArrowRight className="h-4 w-4" />
            </Link>
          </section>

          <section className="mt-8">
            <h2 className="text-lg font-semibold mb-3">Supported formats</h2>
            <p className="text-sm" style={{ color: 'var(--muted)' }}>
              Redraft and dynasty leagues. Snake and auction drafts. Multiple scoring systems.
              Connect your league from the Sports App or use tools standalone.
            </p>
          </section>

          <section className="mt-10 flex flex-col gap-4">
            <h2 className="text-lg font-semibold">Get started</h2>
            <LandingCTAStrip
              primaryHref="/app"
              primaryLabel="Open Sports App"
              showSignInSignUp
            />
            <div className="flex flex-wrap gap-3 text-sm">
              <Link
                href="/brackets"
                data-testid="sport-landing-bracket-link"
                className="inline-flex items-center gap-1 hover:underline"
                style={{ color: 'var(--muted)' }}
              >
                <Trophy className="h-4 w-4" />
                Bracket Challenge
              </Link>
              <Link
                href="/af-legacy"
                data-testid="sport-landing-legacy-link"
                className="inline-flex items-center gap-1 hover:underline"
                style={{ color: 'var(--muted)' }}
              >
                <Zap className="h-4 w-4" />
                AllFantasy Legacy
              </Link>
            </div>
          </section>

          <section className="mt-10">
            <RelatedToolsSection slugs={[...relatedSlugs]} title="Explore more tools" />
          </section>

          <section className="mt-10 rounded-2xl border p-5" style={{ borderColor: 'var(--border)', background: 'color-mix(in srgb, var(--panel) 50%, transparent)' }}>
            <h2 className="text-lg font-semibold mb-2">Also on AllFantasy</h2>
            <p className="text-sm mb-4" style={{ color: 'var(--muted)' }}>
              Main platform: leagues, bracket challenge, and legacy dynasty tools in one place.
            </p>
            <Link
              href="/"
              data-testid="sport-landing-home-link"
              className="inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium"
              style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
            >
              <AppWindow className="h-4 w-4" />
              Back to AllFantasy Home
            </Link>
          </section>
        </div>
      </article>

      <SeoLandingFooter />
    </main>
  )
}
