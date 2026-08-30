import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import {
  getPlatformLanding,
  platformLandingSlugs,
  PLATFORM_LANDINGS,
  WHAT_WE_READ,
  WHAT_WE_NEVER_DO,
} from '@/lib/league-import/platformLandingCopy'
import { isImportProviderAvailable } from '@/lib/league-import/provider-ui-config'
import '@/components/core-app/af-core.css'
import '@/components/core-app/af-landing-import.css'

/**
 * Public, indexable "import your <platform> league" pages.
 *
 * ⚠ THESE EXIST BECAUSE THE FLOW ITSELF CANNOT BE INDEXED. `/import` calls
 * `redirect('/login')` for anyone without a session, so a crawler has never seen
 * it and never will — putting metadata on that page only improves link previews
 * for people who already have the URL. Search traffic needs a page a logged-out
 * stranger can read, which is this one. It ends in a link into the gated flow.
 *
 * ⚠ ONE DYNAMIC ROUTE FOR SIX PLATFORMS, NOT SIX PAGES. This repo sits against
 * Vercel's hard 2048-route ceiling — the reason `/core` is a single optional
 * catch-all — so six sibling marketing pages would be exactly the wrong spend.
 * `generateStaticParams` still renders all six at build time, so each is a static,
 * fast, independently indexable document.
 *
 * ⚠ AND IT IS DELIBERATELY NOT AUTH-GATED. Its sibling `app/import/page.tsx`
 * redirects to /login; this one must not, or it becomes as invisible as the page
 * it exists to advertise.
 */

export const dynamicParams = false

export function generateStaticParams() {
  return platformLandingSlugs().map((platform) => ({ platform }))
}

const SITE = 'https://allfantasy.ai'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ platform: string }>
}): Promise<Metadata> {
  const { platform } = await params
  const landing = getPlatformLanding(platform)
  if (!landing) return {}

  const url = `${SITE}/import/${landing.slug}`
  /*
   * ⚠ NEVER ASK GOOGLE TO INDEX A PLATFORM THAT DOES NOT WORK. These pages exist to
   * rank for "import my <platform> league", and this one nearly shipped doing that
   * for Yahoo the same day a peer measured that Yahoo has NEVER imported a league —
   * `import_runs` where provider='yahoo' is 0, ever — and flipped it to
   * `available: false`.
   *
   * The visible CTA already followed provider-ui-config, but the title, description,
   * FAQ and HowTo did not: the page would have been an indexable advert for a dead
   * feature. Availability now gates indexing too, so switching a provider off in one
   * config file withdraws its marketing page in the same commit.
   */
  const indexable = isImportProviderAvailable(landing.provider)
  return {
    title: landing.title,
    description: landing.description,
    /* Self-referencing canonical: these pages are also reachable with tracking
       params from ads and shares, and every one of those must consolidate here. */
    alternates: { canonical: url },
    openGraph: {
      type: 'website',
      url,
      siteName: 'AllFantasy',
      title: landing.title,
      description: landing.description,
    },
    twitter: {
      card: 'summary_large_image',
      title: landing.title,
      description: landing.description,
    },
    robots: { index: indexable, follow: true },
  }
}

export default async function ImportPlatformLandingPage({
  params,
}: {
  params: Promise<{ platform: string }>
}) {
  const { platform } = await params
  const landing = getPlatformLanding(platform)
  if (!landing) notFound()

  const available = isImportProviderAvailable(landing.provider)
  const connectHref = `/import?provider=${landing.provider}`

  /*
   * ⚠ STRUCTURED DATA MIRRORS THE VISIBLE COPY, NEVER EXCEEDS IT. Google treats a
   * HowTo or FAQ whose answers do not appear on the page as a spam signal, and it
   * is dishonest regardless. Both blocks below are built from the SAME arrays the
   * page renders, so they cannot drift apart.
   */
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      /*
       * ⚠ THE HowTo IS DROPPED WHEN THE PLATFORM IS OFF. Publishing "here are the four
       * steps to import a Yahoo league" as structured data, for a path that returns you
       * still disconnected, is a rich-result claim we cannot honour — and Google treats
       * an unfollowable HowTo as a quality problem quite apart from it being untrue.
       * The FAQ and breadcrumb stay: both remain accurate either way.
       */
      ...(available
        ? [
            {
              '@type': 'HowTo',
              name: landing.heading,
              description: landing.description,
              totalTime: 'PT2M',
              step: landing.steps.map((text, i) => ({
                '@type': 'HowToStep',
                position: i + 1,
                text,
              })),
            },
          ]
        : []),
      {
        '@type': 'FAQPage',
        mainEntity: landing.faq.map((f) => ({
          '@type': 'Question',
          name: f.q,
          acceptedAnswer: { '@type': 'Answer', text: f.a },
        })),
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'AllFantasy', item: SITE },
          { '@type': 'ListItem', position: 2, name: 'Import a league', item: `${SITE}/import` },
          {
            '@type': 'ListItem',
            position: 3,
            name: landing.name,
            item: `${SITE}/import/${landing.slug}`,
          },
        ],
      },
    ],
  }

  return (
    <div className="af-core af-lp">
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger -- JSON-LD has no other injection point in Next metadata.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <header className="af-lp-top">
        <Link href="/" className="af-lp-brand" aria-label="AllFantasy — home">
          <Shield />
          <span className="af-lp-wordmark">AllFantasy</span>
        </Link>
        <span className="af-lp-readonly af-num">Read-only</span>
      </header>

      <main className="af-lp-main">
        <nav className="af-lp-crumbs" aria-label="Breadcrumb">
          <Link href="/">AllFantasy</Link>
          <span aria-hidden> › </span>
          <span>Import a league</span>
          <span aria-hidden> › </span>
          <span aria-current="page">{landing.name}</span>
        </nav>

        <span className="af-label af-lp-eyebrow">Connect {landing.name} to AllFantasy</span>
        {/* Exactly one h1, and it names the platform — that is the query. */}
        <h1 className="af-lp-h1">{landing.heading}</h1>
        <p className="af-lp-intro">{landing.intro}</p>

        {/*
          ⚠ THE PAGE LEADS WITH THE TRUTH, NOT JUST A DISABLED BUTTON. Swapping the CTA
          was not enough: everything above it — the headline, the intro, the four steps —
          still read as a working feature, so a visitor scanned a page that promised an
          import and only discovered otherwise at the button. Said once, at the top,
          before any of the copy that assumes it works.
        */}
        {available ? null : (
          <p className="af-lp-unavailable" role="status">
            <span className="af-label">Not connectable right now</span>
            <span>
              {landing.name} imports are switched off while we fix the connection. Everything
              below describes how it works when it is on &mdash; nothing here will import a
              league today.
            </span>
          </p>
        )}

        <p className="af-lp-needs">
          <span className="af-label">What you need</span>
          <span>{landing.needs}</span>
        </p>

        <div className="af-lp-cta-row">
          {available ? (
            <Link href={connectHref} className="af-btn af-lp-cta">
              Connect {landing.name} &rarr;
            </Link>
          ) : (
            <span className="af-lp-soon af-num">{landing.name} isn&rsquo;t available yet</span>
          )}
          <span className="af-lp-cta-note">Free. Read-only. No password, ever.</span>
        </div>

        <section className="af-lp-section" aria-labelledby="how-it-works">
          <h2 id="how-it-works" className="af-lp-h2">
            How importing {landing.article} {landing.name} league works
          </h2>
          <ol className="af-lp-steps">
            {landing.steps.map((step, i) => (
              <li key={i} className="af-lp-step">
                <span className="af-lp-step-n af-num">{i + 1}</span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        </section>

        <section className="af-lp-section" aria-labelledby="trust">
          <h2 id="trust" className="af-lp-h2">
            What AllFantasy reads &mdash; and what it never does
          </h2>
          <div className="af-lp-trust">
            <div className="af-lp-trust-col">
              <span className="af-label af-lp-read">What we read</span>
              <p>{WHAT_WE_READ}</p>
            </div>
            <div className="af-lp-trust-col">
              <span className="af-label af-lp-never">What we never do</span>
              <p>{WHAT_WE_NEVER_DO}</p>
            </div>
          </div>
        </section>

        <section className="af-lp-section" aria-labelledby="faq">
          <h2 id="faq" className="af-lp-h2">
            {landing.name} import questions
          </h2>
          <dl className="af-lp-faq">
            {landing.faq.map((f) => (
              <div key={f.q} className="af-lp-faq-item">
                <dt className="af-lp-faq-q">{f.q}</dt>
                <dd className="af-lp-faq-a">{f.a}</dd>
              </div>
            ))}
          </dl>
        </section>

        {/*
          Internal links to the sibling platforms. Not decoration: these are the
          crawl paths between six otherwise-orphaned pages, and the reason a
          visitor who landed on the wrong one does not bounce.
        */}
        <section className="af-lp-section" aria-labelledby="others">
          <h2 id="others" className="af-lp-h2">
            Import from another platform
          </h2>
          <ul className="af-lp-others">
            {PLATFORM_LANDINGS.filter((l) => l.slug !== landing.slug).map((l) => (
              <li key={l.slug}>
                <Link href={`/import/${l.slug}`} className="af-lp-other">
                  <span className="af-platform af-lp-mark" data-platform={l.provider} aria-hidden>
                    {l.provider === 'fleaflicker' ? 'FL' : l.name.charAt(0)}
                  </span>
                  {/* `l.article`, not a hardcoded "a" — same reason as the h2 above. */}
                  Import {l.article} {l.name} league
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <p className="af-lp-foot">
          Already have an account?{' '}
          <Link href={connectHref} className="af-lp-foot-link">
            Go straight to the importer
          </Link>
          .
        </p>
      </main>
    </div>
  )
}

/** Same lockup as every other AllFantasy screen. */
function Shield() {
  return (
    <svg width="26" height="28" viewBox="0 0 28 30" aria-hidden focusable="false">
      <path
        d="M14 1.5 26 6v10.5c0 6.4-5 10.6-12 12.5-7-1.9-12-6.1-12-12.5V6l12-4.5Z"
        fill="var(--accent-soft)"
        stroke="var(--accent)"
        strokeWidth="1.5"
      />
      <text
        x="14"
        y="19"
        textAnchor="middle"
        fill="var(--accent)"
        style={{ font: '900 10px Archivo, sans-serif', letterSpacing: '0.02em' }}
      >
        AF
      </text>
    </svg>
  )
}
