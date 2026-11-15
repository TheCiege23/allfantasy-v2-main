import Image from 'next/image'
import Link from 'next/link'
import { ArrowRight, Check, ChevronDown, Eye } from 'lucide-react'
import HomeTopNav from '@/components/navigation/HomeTopNav'
import SeoLandingFooter from '@/components/landing/SeoLandingFooter'
import {
  SPORT_DISPLAY,
  getLeagueTypeDemoMeta,
  getLeagueTypePage,
  getLeagueTypeSports,
  type LeagueTypePage,
} from '@/lib/seo-landing/league-type-pages'

/**
 * One lander per league format (/league-types/<slug>). Server-rendered on purpose: the whole
 * point is text a crawler can read without running JavaScript.
 *
 * Layout follows simplicity-first: one headline, one primary action, the rules once, then the
 * questions folded away. Nothing here restates a number the rules list already gives.
 */
export default function LeagueTypeLanding({ page }: { page: LeagueTypePage }) {
  const meta = getLeagueTypeDemoMeta(page)
  const sports = getLeagueTypeSports(page)
  const related = page.related.map((s) => getLeagueTypePage(s)).filter((p): p is LeagueTypePage => Boolean(p))
  const createHref = `/create-league?type=${page.wizardType}`
  const demoHref = `/demo/formats/${page.demoId}`
  const landscape = meta?.poster.includes('pirate-hero') ?? false

  const faqs = [
    ...page.faqs,
    {
      q: `Is a ${page.name} league free?`,
      a: 'Yes. Every league on AllFantasy is free to create and play.',
    },
    {
      q: 'Can I see one before I start?',
      a: 'Yes. The sample league shows a full example season with made-up teams, so you can see how it plays before you invite anyone.',
    },
  ]

  return (
    <main className="min-h-screen flex flex-col mode-readable" style={{ background: 'var(--bg)', color: 'var(--text)' }}>
      <HomeTopNav />

      <article className="flex-1 px-4 py-8 sm:px-6 sm:py-12" data-testid={`league-type-landing-${page.slug}`}>
        <div className="mx-auto max-w-4xl">
          <nav aria-label="Breadcrumb" className="mb-5 text-xs" style={{ color: 'var(--muted)' }}>
            <Link href="/league-types" className="hover:underline">
              League types
            </Link>
            <span aria-hidden> / </span>
            <span>{page.name}</span>
          </nav>

          <header className={`grid gap-6 ${landscape ? '' : 'sm:grid-cols-[1fr_200px]'} sm:items-start`}>
            <div className="min-w-0">
              <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{page.h1}</h1>
              <p className="mt-4 text-base leading-relaxed">{page.intro}</p>
              <p className="mt-2 text-sm leading-relaxed" style={{ color: 'var(--muted)' }}>
                {page.forWho}
              </p>
              <div className="mt-6 flex flex-wrap items-center gap-3">
                <Link
                  href={createHref}
                  data-testid="league-type-create"
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-cyan-500 px-4 py-3 text-sm font-semibold text-black hover:bg-cyan-400 min-h-[44px]"
                >
                  Start a free {page.name} league
                  <ArrowRight className="h-4 w-4" aria-hidden />
                </Link>
                <Link
                  href={demoHref}
                  data-testid="league-type-demo"
                  className="inline-flex items-center gap-2 rounded-xl border px-4 py-3 text-sm font-medium min-h-[44px]"
                  style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
                >
                  <Eye className="h-4 w-4" aria-hidden />
                  See a sample league
                </Link>
              </div>
            </div>
            {meta ? (
              <div
                className={`relative overflow-hidden rounded-2xl border ${
                  landscape ? 'aspect-[16/9] w-full' : 'aspect-[16/9] w-full sm:aspect-[2/3] sm:w-[200px]'
                }`}
                style={{ borderColor: 'var(--border)' }}
              >
                <Image
                  src={meta.poster}
                  alt={`${page.name} league`}
                  fill
                  priority
                  sizes={landscape ? '(min-width: 896px) 896px, 100vw' : '(min-width: 640px) 200px, 100vw'}
                  className="object-cover object-top"
                />
              </div>
            ) : null}
          </header>

          {meta && meta.rules.length > 0 ? (
            <section className="mt-10" aria-labelledby="how-it-works">
              <h2 id="how-it-works" className="text-lg font-semibold">
                How a {page.name} league works
              </h2>
              <ul className="mt-3 space-y-2.5">
                {meta.rules.map((rule) => (
                  <li key={rule} className="flex gap-3 text-sm leading-relaxed">
                    <Check className="mt-0.5 h-4 w-4 shrink-0" style={{ color: 'var(--accent-cyan)' }} aria-hidden />
                    <span>{rule}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {sports.length > 0 ? (
            <section className="mt-10" aria-labelledby="sports">
              <h2 id="sports" className="text-lg font-semibold">
                Sports you can play it in
              </h2>
              <ul className="mt-3 flex flex-wrap gap-2">
                {sports.map((s) => (
                  <li key={s}>
                    <Link
                      href={`/sports/${SPORT_DISPLAY[s].lander}`}
                      className="inline-flex min-h-[36px] items-center rounded-full border px-3 text-sm hover:opacity-90"
                      style={{ borderColor: 'var(--border)', background: 'color-mix(in srgb, var(--panel2) 70%, transparent)' }}
                    >
                      {SPORT_DISPLAY[s].label}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="mt-10" aria-labelledby="faq">
            <h2 id="faq" className="text-lg font-semibold">
              Questions
            </h2>
            <div className="mt-3 divide-y rounded-2xl border" style={{ borderColor: 'var(--border)' }}>
              {faqs.map((f) => (
                <details key={f.q} className="group px-4 py-3" style={{ borderColor: 'var(--border)' }}>
                  <summary className="flex min-h-[32px] cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium">
                    {f.q}
                    <ChevronDown className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180" aria-hidden />
                  </summary>
                  <p className="mt-2 text-sm leading-relaxed" style={{ color: 'var(--muted)' }}>
                    {f.a}
                  </p>
                </details>
              ))}
            </div>
          </section>

          {related.length > 0 ? (
            <section className="mt-10" aria-labelledby="related">
              <h2 id="related" className="text-lg font-semibold">
                Other league types
              </h2>
              <ul className="mt-3 grid gap-3 sm:grid-cols-3">
                {related.map((r) => {
                  const rm = getLeagueTypeDemoMeta(r)
                  return (
                    <li key={r.slug}>
                      <Link
                        href={`/league-types/${r.slug}`}
                        className="flex h-full flex-col rounded-2xl border p-4 hover:opacity-90"
                        style={{ borderColor: 'var(--border)', background: 'color-mix(in srgb, var(--panel) 50%, transparent)' }}
                      >
                        <span className="text-sm font-semibold">{r.name}</span>
                        {rm ? (
                          <span className="mt-1 text-xs" style={{ color: 'var(--muted)' }}>
                            {rm.subtitle}
                          </span>
                        ) : null}
                      </Link>
                    </li>
                  )
                })}
              </ul>
              <Link
                href="/league-types"
                className="mt-4 inline-flex items-center gap-1 text-sm font-medium hover:underline"
                style={{ color: 'var(--accent-cyan)' }}
              >
                See every league type
                <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
            </section>
          ) : null}
        </div>
      </article>

      <SeoLandingFooter />
    </main>
  )
}
