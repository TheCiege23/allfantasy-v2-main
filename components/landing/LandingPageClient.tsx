'use client'

import type { Session } from 'next-auth'
import { useEffect, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { useOptionalSession } from '@/components/auth/useOptionalSession'
import { Shield } from 'lucide-react'
import LanguageToggle from '@/components/i18n/LanguageToggle'
import { ThemeModeSelect } from '@/components/theme/ThemeModeSelect'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { loginUrlWithIntent, signupUrlWithIntent } from '@/lib/auth/auth-intent-resolver'
import { trackLandingCtaClick } from '@/lib/landing-analytics'
import { LANDING_COPY } from './journey/copy'
import { GradientWord } from './journey/shared/GradientWord'
import { ArrivalSection } from './journey/ArrivalSection'
import { BuildLeagueSection } from './journey/BuildLeagueSection'
import { DraftDaySection } from './journey/DraftDaySection'
import { GameDaySection } from './journey/GameDaySection'
import { WaiverWednesdaySection } from './journey/WaiverWednesdaySection'
import { TradeDeadlineSection } from './journey/TradeDeadlineSection'
import { PlayoffPushSection } from './journey/PlayoffPushSection'
import { ChampionshipSection } from './journey/ChampionshipSection'
import { DecisionOSSection } from './journey/DecisionOSSection'
import { FinalCtaSection } from './journey/FinalCtaSection'

type LandingPageClientProps = {
  initialSession?: Session | null
}

export default function LandingPageClient({
  initialSession = null,
}: LandingPageClientProps) {
  const { language } = useOptionalLanguage()
  const { status } = useOptionalSession()
  const copy = LANDING_COPY[language as keyof typeof LANDING_COPY] ?? LANDING_COPY.en
  const isAuthenticated =
    status === 'unauthenticated'
      ? false
      : status === 'authenticated'
        ? true
        : Boolean(initialSession?.user)
  const [isAdmin, setIsAdmin] = useState(false)

  useEffect(() => {
    if (!isAuthenticated) {
      setIsAdmin(false)
      return
    }
    let cancelled = false
    fetch('/api/user/me', { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled && data?.isAdmin) setIsAdmin(true)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [isAuthenticated])

  const signupHref = signupUrlWithIntent('/dashboard')
  const loginHref = loginUrlWithIntent('/dashboard')
  const dashboardHref = '/dashboard'
  const commissionerSignupHref = `/signup?role=commissioner&next=${encodeURIComponent('/dashboard')}`
  const wcIntroHref = loginUrlWithIntent('/world-cup-intro?next=/brackets')

  return (
    <main className="mode-readable min-h-screen overflow-x-hidden" style={{ background: 'var(--bg)', color: 'var(--text)' }}>

      {/* ─── NAV ─── */}
      <header
        className="fixed inset-x-0 top-0 z-50 border-b"
        style={{
          borderColor: 'var(--border)',
          background: 'color-mix(in srgb, var(--bg) 86%, transparent)',
          backdropFilter: 'blur(18px)',
          WebkitBackdropFilter: 'blur(18px)',
        }}
      >
        <div className="mx-auto flex h-[56px] max-w-7xl items-center justify-between gap-3 px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2 px-1 py-1 transition-opacity hover:opacity-80" aria-label={copy.nav.ariaHome}>
            <Image
              src="/brand/allfantasy-wordmark-transparent.png"
              alt="AllFantasy wordmark"
              width={1198}
              height={306}
              priority
              className="nav-logo-img h-[34px] w-auto object-contain sm:h-[44px]"
            />
          </Link>

          <div className="flex items-center gap-2 sm:gap-3">
            <div className="hidden items-center gap-2 md:flex">
              <ThemeModeSelect size="sm" />
              <LanguageToggle />
            </div>
            <Link
              href="#landing-build-league"
              className="hidden text-sm font-medium transition hover:opacity-100 sm:inline-flex"
              style={{ color: '#f59e0b', opacity: 0.85 }}
            >
              {copy.nav.forCommissioners}
            </Link>
            {isAdmin && (
              <Link
                href="/admin"
                className="hidden rounded-lg border px-3 py-1.5 text-xs font-medium transition sm:inline-flex"
                style={{ borderColor: 'color-mix(in srgb, var(--border) 75%, transparent)', color: 'var(--muted)', background: 'transparent' }}
              >
                <Shield className="mr-1 h-3.5 w-3.5" />
                {copy.nav.admin}
              </Link>
            )}
            {!isAuthenticated ? (
              <>
                <Link
                  href={loginHref}
                  className="inline-flex rounded-lg border px-3 py-2 text-sm font-medium transition hover:opacity-90"
                  style={{ borderColor: 'color-mix(in srgb, var(--border) 100%, transparent)', color: 'var(--muted)', background: 'color-mix(in srgb, var(--panel2) 40%, transparent)' }}
                  data-testid="landing-nav-sign-in"
                  onClick={() => trackLandingCtaClick({ cta_label: copy.nav.signIn, cta_destination: loginHref, cta_type: 'secondary', source: 'nav' })}
                >
                  {copy.nav.signIn}
                </Link>
                <Link
                  href={signupHref}
                  className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold transition hover:opacity-90"
                  style={{ backgroundImage: 'linear-gradient(90deg, var(--accent-cyan), color-mix(in srgb, var(--accent-cyan-strong) 72%, #3b82f6))', color: 'var(--on-accent-bg)' }}
                  data-testid="landing-nav-sign-up"
                  onClick={() => trackLandingCtaClick({ cta_label: copy.nav.signUp, cta_destination: signupHref, cta_type: 'primary', source: 'nav' })}
                >
                  {copy.nav.signUp}
                </Link>
              </>
            ) : (
              <Link
                href={dashboardHref}
                className="inline-flex rounded-lg border px-3 py-2 text-sm font-medium transition hover:opacity-90"
                style={{ borderColor: 'color-mix(in srgb, var(--border) 100%, transparent)', color: 'var(--muted)', background: 'transparent' }}
                data-testid="landing-nav-dashboard"
                onClick={() => trackLandingCtaClick({ cta_label: copy.nav.dashboard, cta_destination: dashboardHref, cta_type: 'secondary', source: 'nav' })}
              >
                {copy.nav.dashboard}
              </Link>
            )}
          </div>
        </div>
      </header>

      {/* ─── SEASON JOURNEY ─── */}
      <ArrivalSection
        copy={copy}
        ariaSportsLabel={copy.nav.ariaSports}
        isAuthenticated={isAuthenticated}
        hrefs={{ signupHref, loginHref, dashboardHref, wcIntroHref }}
      />

      {/* stats + trust band */}
      <section className="border-t" style={{ borderColor: 'var(--border)' }}>
        <div className="mx-auto max-w-4xl px-4 sm:px-6">
          <div className="grid grid-cols-3 divide-x" style={{ borderColor: 'var(--border)' }}>
            {copy.stats.map((stat) => (
              <div key={stat.label} className="px-4 py-8 text-center sm:px-8">
                <div className="mb-1 text-3xl font-black leading-none sm:text-4xl">
                  <GradientWord>{stat.value}</GradientWord>
                </div>
                <div className="text-xs font-medium tracking-[0.03em] sm:text-sm" style={{ color: 'var(--muted)' }}>
                  {stat.label}
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="border-t" style={{ borderColor: 'var(--border)', background: 'var(--panel)' }}>
          <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-center gap-x-6 gap-y-3 px-4 py-5 sm:px-6">
            {copy.trust.map((t) => (
              <span key={t.text} className="flex items-center gap-2 text-[12px] font-medium sm:text-sm" style={{ color: 'var(--muted)' }}>
                <span>{t.icon}</span>
                {t.text}
              </span>
            ))}
          </div>
        </div>
      </section>

      <BuildLeagueSection copy={copy.journey.buildLeague} ctaHref={signupHref} commissionerCtaHref={commissionerSignupHref} />
      <DraftDaySection copy={copy.journey.draftDay} />
      <GameDaySection copy={copy.journey.gameDay} />
      <WaiverWednesdaySection copy={copy.journey.waiverWednesday} />
      <TradeDeadlineSection copy={copy.journey.tradeDeadline} />
      <PlayoffPushSection copy={copy.journey.playoffPush} />
      <ChampionshipSection copy={copy.journey.championship} ctaHref={signupHref} />
      <DecisionOSSection copy={copy.journey.decisionOS} />
      <FinalCtaSection
        copy={copy.cta}
        journeyNote={copy.journey.finalCtaNote}
        isAuthenticated={isAuthenticated}
        hrefs={{ signupHref, loginHref, dashboardHref, commissionerSignupHref }}
      />

      {/* ─── FOOTER ─── */}
      <footer className="border-t px-4 py-6 sm:px-6" style={{ borderColor: 'var(--border)' }}>
        <div className="mx-auto max-w-6xl">
          <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
            <Link href="/" className="flex items-center gap-3 opacity-80 transition-opacity hover:opacity-100" aria-label={copy.nav.ariaHome}>
              <Image
                src="/brand/allfantasy-wordmark-transparent.png"
                alt="AllFantasy wordmark"
                width={1198}
                height={306}
                className="nav-wordmark footer-logo h-[26px] w-auto object-contain"
              />
              <span className="text-sm" style={{ color: 'var(--muted2)' }}>
                © {new Date().getFullYear()} AllFantasy.ai
              </span>
            </Link>
            <nav className="flex flex-wrap items-center gap-x-5 gap-y-2" aria-label={copy.nav.ariaFooterNav}>
              <Link href="/privacy" className="text-sm transition-colors [color:var(--muted)] hover:[color:var(--text)]">{copy.footer.privacy}</Link>
              <Link href="/terms" className="text-sm transition-colors [color:var(--muted)] hover:[color:var(--text)]">{copy.footer.terms}</Link>
              <Link href="/data-deletion" className="text-sm transition-colors [color:var(--muted)] hover:[color:var(--text)]">{copy.footer.dataDeletion}</Link>
              <Link href={loginUrlWithIntent('/dashboard')} className="text-sm transition-colors [color:var(--muted)] hover:[color:var(--text)]">{copy.footer.signIn}</Link>
              <Link href="/admin" className="text-sm transition-colors [color:var(--muted)] hover:[color:var(--text)]">{copy.footer.admin}</Link>
            </nav>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2 md:hidden">
            <ThemeModeSelect size="sm" />
            <LanguageToggle />
          </div>
          <p className="mt-4 max-w-3xl text-[11px] leading-5" style={{ color: 'var(--muted2)' }}>
            {copy.footer.geoNote}
          </p>
        </div>
      </footer>

      <style jsx>{`
        .landing-grid {
          background-image:
            linear-gradient(color-mix(in srgb, var(--border) 40%, transparent) 1px, transparent 1px),
            linear-gradient(90deg, color-mix(in srgb, var(--border) 40%, transparent) 1px, transparent 1px);
          background-size: 48px 48px;
          mask-image: radial-gradient(ellipse 75% 75% at 50% 50%, black 20%, transparent 78%);
          -webkit-mask-image: radial-gradient(ellipse 75% 75% at 50% 50%, black 20%, transparent 78%);
        }

        .landing-crest-glow {
          background: radial-gradient(
            circle,
            color-mix(in srgb, var(--accent-cyan) 28%, transparent) 0%,
            rgba(59, 130, 246, 0.16) 35%,
            color-mix(in srgb, var(--accent-purple) 12%, transparent) 58%,
            transparent 74%
          );
          filter: blur(6px);
        }

        .landing-float {
          animation: landingFloat 5s ease-in-out infinite;
        }

        .hero-logo-wrap {
          background: transparent !important;
          isolation: auto;
        }

        :global(.landing-stagger-in),
        :global(.landing-fade-in),
        :global(.landing-fade-in-stagger) {
          animation: landingFadeIn 0.6s ease-out both;
        }

        :global(.landing-draft-slide-in) {
          animation: landingDraftSlideIn 0.5s ease-out both;
        }

        :global(.landing-clock-pulse) {
          animation: landingOpacityPulse 2s ease-in-out infinite;
        }

        :global(.landing-live-pulse) {
          animation: landingOpacityPulse 1.6s ease-in-out infinite;
        }

        :global(.landing-confetti-piece) {
          width: 6px;
          height: 10px;
          border-radius: 1px;
          animation: landingConfettiFall 3.2s linear infinite;
          opacity: 0.85;
        }

        @keyframes landingFloat {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-10px); }
        }

        @keyframes landingPulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.25; }
        }

        @keyframes landingFadeIn {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: translateY(0); }
        }

        @keyframes landingDraftSlideIn {
          from { opacity: 0; transform: translateX(-10px); }
          to { opacity: 1; transform: translateX(0); }
        }

        @keyframes landingOpacityPulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.55; }
        }

        @keyframes landingConfettiFall {
          0% { transform: translateY(0) rotate(0deg); opacity: 0.9; }
          100% { transform: translateY(420px) rotate(340deg); opacity: 0; }
        }

        @media (prefers-reduced-motion: reduce) {
          .landing-float { animation: none; }
          :global(.landing-stagger-in),
          :global(.landing-fade-in),
          :global(.landing-fade-in-stagger),
          :global(.landing-draft-slide-in) {
            animation: none;
            opacity: 1;
            transform: none;
          }
          :global(.landing-clock-pulse),
          :global(.landing-live-pulse) {
            animation: none;
            opacity: 1;
          }
          :global(.landing-confetti-piece) {
            display: none;
          }
        }
      `}</style>
    </main>
  )
}
