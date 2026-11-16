import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import HomeTopNav from '@/components/navigation/HomeTopNav'
import SeoLandingFooter from '@/components/landing/SeoLandingFooter'
import { buildSeoMeta } from '@/lib/seo'
import {
  LEAGUE_TYPES_HUB,
  LEAGUE_TYPE_PAGES,
  getLeagueTypeCanonical,
  getLeagueTypeDemoMeta,
} from '@/lib/seo-landing/league-type-pages'

export const metadata: Metadata = buildSeoMeta({
  title: LEAGUE_TYPES_HUB.title,
  description: LEAGUE_TYPES_HUB.description,
  canonical: getLeagueTypeCanonical(),
})

export default function LeagueTypesHubPage() {
  return (
    <main className="min-h-screen flex flex-col mode-readable" style={{ background: 'var(--bg)', color: 'var(--text)' }}>
      <HomeTopNav />

      <article className="flex-1 px-4 py-8 sm:px-6 sm:py-12" data-testid="league-types-hub">
        <div className="mx-auto max-w-5xl">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{LEAGUE_TYPES_HUB.h1}</h1>
          <p className="mt-4 max-w-2xl text-base leading-relaxed" style={{ color: 'var(--muted)' }}>
            {LEAGUE_TYPES_HUB.intro}
          </p>

          <ul className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {LEAGUE_TYPE_PAGES.map((page) => {
              const meta = getLeagueTypeDemoMeta(page)
              return (
                <li key={page.slug}>
                  <Link
                    href={`/league-types/${page.slug}`}
                    data-testid={`league-types-hub-${page.slug}`}
                    className="group flex h-full flex-col overflow-hidden rounded-2xl border hover:opacity-95"
                    style={{ borderColor: 'var(--border)', background: 'color-mix(in srgb, var(--panel) 50%, transparent)' }}
                  >
                    {meta ? (
                      <div className="relative aspect-[4/3] w-full">
                        <Image
                          src={meta.poster}
                          alt=""
                          fill
                          sizes="(min-width: 1024px) 240px, (min-width: 640px) 33vw, 50vw"
                          className="object-cover object-top"
                        />
                      </div>
                    ) : null}
                    <div className="flex flex-1 flex-col p-3">
                      {/* The search name (Guillotine), not the product nickname (Guilly). */}
                      <h2 className="text-sm font-semibold leading-snug">{page.name}</h2>
                      {meta ? (
                        <p className="mt-1 text-xs leading-snug" style={{ color: 'var(--muted)' }}>
                          {meta.subtitle}
                        </p>
                      ) : null}
                    </div>
                  </Link>
                </li>
              )
            })}
          </ul>
        </div>
      </article>

      <SeoLandingFooter />
    </main>
  )
}
