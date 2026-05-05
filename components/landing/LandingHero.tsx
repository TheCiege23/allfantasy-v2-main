'use client'

import Link from 'next/link'
import Image from 'next/image'
import { ArrowRight, UserPlus } from 'lucide-react'
import { trackLandingCtaClick } from '@/lib/landing-analytics'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'
import { SUPPORTED_SPORTS } from '@/lib/sport-scope'

const SPORT_LABELS: Record<string, string> = {
  NFL: 'NFL',
  NHL: 'NHL',
  NBA: 'NBA',
  MLB: 'MLB',
  NCAAB: 'NCAA Basketball',
  NCAAF: 'NCAA Football',
  SOCCER: 'Soccer',
}

export function HeroLogo() {
  return (
    <Link
      href="/"
      aria-label="AllFantasy home"
      className="focus:outline-none"
      data-testid="landing-logo-link"
    >
      <Image
        src="/branding/allfantasy-crest-chatgpt.png"
        alt="AllFantasy logo"
        width={1024}
        height={1024}
        priority
        sizes="(max-width: 640px) 320px, (max-width: 1024px) 540px, 700px"
        className="mode-logo-safe h-auto w-[320px] max-w-[92vw] object-contain drop-shadow-[0_0_38px_rgba(14,165,233,0.38)] sm:w-[540px] lg:w-[700px]"
      />
    </Link>
  )
}

export function HeroHeadline() {
  const { t } = useLanguage()
  return (
    <h1
      className="max-w-4xl text-balance text-center text-3xl font-extrabold leading-tight sm:text-4xl md:text-5xl"
      data-testid="landing-hero-headline"
    >
      {t('landing.hero.headline')}
    </h1>
  )
}

export function HeroSubheadline() {
  const { t } = useLanguage()
  return (
    <p
      className="mx-auto max-w-3xl text-balance text-center text-base sm:text-lg"
      style={{ color: 'var(--muted)' }}
      data-testid="landing-hero-subheadline"
    >
      {t('landing.hero.subline')}
    </p>
  )
}

export function PrimaryCTA() {
  const { t } = useLanguage()
  const ctaLabel = t('landing.cta.openApp')
  return (
    <Link
      href="/dashboard"
      prefetch={false}
      className="inline-flex min-h-[52px] items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-500 px-7 py-3 text-base font-semibold text-black shadow-lg hover:from-cyan-400 hover:to-blue-400 active:scale-[0.98] transition-all focus:outline-none focus:ring-2 focus:ring-cyan-400 focus:ring-offset-2 focus:ring-offset-[var(--bg)]"
      onClick={() =>
        trackLandingCtaClick({
          cta_label: ctaLabel,
          cta_destination: '/dashboard',
          cta_type: 'primary',
          source: 'hero',
        })
      }
      data-testid="landing-open-app-button"
    >
      {ctaLabel}
      <ArrowRight className="h-4 w-4 shrink-0" />
    </Link>
  )
}

export function SecondaryCTA() {
  const { t } = useLanguage()
  const ctaLabel = t('landing.cta.createAccount')
  return (
    <Link
      href="/signup"
      prefetch={false}
      className="inline-flex min-h-[52px] items-center justify-center gap-2 rounded-xl border border-white/20 bg-white/5 px-7 py-3 text-base font-semibold text-white/90 hover:bg-white/10 active:scale-[0.98] transition-all focus:outline-none focus:ring-2 focus:ring-white/30 focus:ring-offset-2 focus:ring-offset-[var(--bg)]"
      onClick={() =>
        trackLandingCtaClick({
          cta_label: ctaLabel,
          cta_destination: '/signup',
          cta_type: 'secondary',
          source: 'hero',
        })
      }
      data-testid="landing-sign-up-button"
    >
      <UserPlus className="h-4 w-4 shrink-0" />
      {ctaLabel}
    </Link>
  )
}

export default function LandingHero() {
  return (
    <section
      className="relative flex flex-col items-center gap-5 overflow-hidden px-4 pb-14 pt-10 sm:gap-6 sm:px-6 sm:pb-16 sm:pt-14"
      aria-label="Hero"
    >
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute left-1/2 top-12 h-56 w-[360px] -translate-x-1/2 rounded-full bg-cyan-500/10 blur-3xl" />
      </div>

      <HeroLogo />
      <HeroTextBlock />
      <HeroCTAGroup />

      <div className="flex flex-wrap justify-center gap-2">
        {SUPPORTED_SPORTS.map((sport) => (
          <span
            key={sport}
            className="rounded-full border px-3 py-0.5 text-xs font-medium"
            style={{
              borderColor: 'color-mix(in srgb, var(--border) 100%, transparent)',
              background: 'color-mix(in srgb, var(--panel2) 78%, transparent)',
              color: 'var(--muted)',
            }}
          >
            {SPORT_LABELS[sport] ?? sport}
          </span>
        ))}
      </div>

    </section>
  )
}

/** Legacy named exports kept for backward compat */
export const AFLogoLarge = HeroLogo
export function HeroTextBlock() {
  return (
    <div className="space-y-2 text-center sm:space-y-3" data-testid="landing-hero-text-block">
      <HeroHeadline />
      <HeroSubheadline />
    </div>
  )
}
export function HeroCTAGroup() {
  return (
    <div
      className="flex w-full max-w-xs flex-col gap-3 sm:max-w-none sm:flex-row sm:justify-center"
      data-testid="landing-hero-cta-group"
    >
      <PrimaryCTA />
      <SecondaryCTA />
    </div>
  )
}
