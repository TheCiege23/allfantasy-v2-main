'use client'

import Image from 'next/image'
import Link from 'next/link'
import type { LandingCopy } from './copy'
import { GradientWord } from './shared/GradientWord'
import { trackLandingCtaClick } from '@/lib/landing-analytics'
import { PlatformImportPicker } from './PlatformImportPicker'
import { B2BDemoBand } from './B2BDemoBand'

type Hrefs = {
  signupHref: string
  loginHref: string
  dashboardHref: string
  wcIntroHref: string
}

export function ArrivalSection({
  copy,
  ariaSportsLabel,
  isAuthenticated,
  hrefs,
}: {
  copy: Pick<LandingCopy, 'badge' | 'hero' | 'sports'>
  ariaSportsLabel: string
  isAuthenticated: boolean
  hrefs: Hrefs
}) {
  const { signupHref, loginHref, dashboardHref, wcIntroHref } = hrefs

  return (
    <section className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-4 pb-16 pt-24 text-center sm:px-6 sm:pb-20 sm:pt-28">
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: `
            radial-gradient(ellipse 55% 50% at 50% 38%, color-mix(in srgb, var(--accent-cyan) 18%, transparent) 0%, transparent 65%),
            radial-gradient(ellipse 40% 35% at 60% 30%, rgba(59,130,246,0.08) 0%, transparent 65%),
            radial-gradient(ellipse 65% 55% at 50% 48%, color-mix(in srgb, var(--accent-purple) 10%, transparent) 0%, transparent 70%),
            radial-gradient(ellipse 50% 40% at 40% 70%, color-mix(in srgb, var(--accent-emerald) 7%, transparent) 0%, transparent 65%)
          `,
        }}
        aria-hidden="true"
      />
      <div className="landing-grid pointer-events-none absolute inset-0" aria-hidden="true" />

      <div className="relative z-10 mb-6 sm:mb-8">
        <div className="landing-crest-glow absolute left-1/2 top-1/2 h-[300px] w-[300px] -translate-x-1/2 -translate-y-1/2 rounded-full sm:h-[440px] sm:w-[440px]" aria-hidden="true" />
        <div className="landing-float hero-logo-wrap relative flex flex-col items-center justify-center" style={{ filter: 'drop-shadow(0 24px 72px rgba(4,9,21,0.38))' }}>
          <div
            className="pointer-events-none absolute left-1/2 top-1/2 h-[220px] w-[220px] -translate-x-1/2 -translate-y-1/2 rounded-full sm:h-[300px] sm:w-[300px]"
            aria-hidden="true"
            style={{
              background:
                'radial-gradient(circle at 50% 40%, color-mix(in srgb, var(--accent-cyan) 22%, transparent) 0%, transparent 62%), radial-gradient(circle at 50% 68%, color-mix(in srgb, var(--accent-purple) 12%, transparent) 0%, transparent 74%)',
            }}
          />
          <Image
            src="/brand/af-shield-transparent.png"
            alt="AllFantasy AF shield logo"
            className="hero-shield relative h-[130px] w-auto object-contain sm:h-[170px] lg:h-[210px]"
            priority
            width={584}
            height={625}
          />
        </div>
      </div>

      <div
        className="relative z-10 mb-5 inline-flex max-w-[min(94vw,36rem)] items-center justify-center gap-2 rounded-2xl border px-3 py-1.5 text-center text-[10px] font-semibold tracking-[0.06em] sm:px-4 sm:py-2 sm:text-xs"
        style={{
          background: 'color-mix(in srgb, var(--accent-amber) 10%, transparent)',
          borderColor: 'color-mix(in srgb, var(--accent-amber) 28%, transparent)',
          color: 'var(--accent-amber-strong)',
        }}
      >
        <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: 'var(--accent-amber-strong)', animation: 'landingPulse 2s ease-in-out infinite' }} />
        {copy.badge}
      </div>

      <h1
        className="relative z-10 mb-4 max-w-4xl text-[38px] font-black leading-[0.93] tracking-[0.02em] sm:text-[62px] md:text-[80px]"
        style={{ color: 'var(--text)' }}
        data-testid="landing-hero-headline"
      >
        <span className="block">{copy.hero.titleTop}</span>
        <span className="block"><GradientWord>{copy.hero.titleBottom}</GradientWord></span>
      </h1>

      <p className="relative z-10 mb-8 max-w-xl text-sm leading-6 sm:text-base sm:leading-7" style={{ color: 'var(--muted)' }}>
        {copy.hero.subtitle}
      </p>

      <div className="relative z-10 mb-8 w-full max-w-xs sm:max-w-none">
        {isAuthenticated ? (
          <Link
            href={dashboardHref}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl px-7 py-3.5 text-sm font-semibold transition hover:-translate-y-0.5 hover:opacity-90 sm:w-auto"
            style={{ backgroundImage: 'linear-gradient(90deg, var(--accent-cyan), color-mix(in srgb, var(--accent-cyan-strong) 72%, #3b82f6))', color: 'var(--on-accent-bg)' }}
            data-testid="landing-hero-dashboard"
            onClick={() => trackLandingCtaClick({ cta_label: copy.hero.primaryAuthed, cta_destination: dashboardHref, cta_type: 'primary', source: 'hero' })}
          >
            {copy.hero.primaryAuthed}
          </Link>
        ) : (
          <div className="flex w-full flex-col items-center gap-3">
            <PlatformImportPicker />

            <div className="mt-1 flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5">
              <Link
                href={signupHref}
                className="text-xs font-semibold underline underline-offset-4 transition hover:opacity-90"
                style={{ color: 'var(--muted)' }}
                data-testid="landing-hero-sign-up"
                onClick={() => trackLandingCtaClick({ cta_label: copy.hero.primary, cta_destination: signupHref, cta_type: 'secondary', source: 'hero' })}
              >
                {copy.hero.primary} — free, no card needed
              </Link>
              <Link
                href={loginHref}
                className="text-xs font-medium underline underline-offset-4 transition hover:opacity-90"
                style={{ color: 'var(--accent-cyan)' }}
                data-testid="landing-hero-sign-in"
                onClick={() => trackLandingCtaClick({ cta_label: copy.hero.alreadyHaveAccount, cta_destination: loginHref, cta_type: 'secondary', source: 'hero' })}
              >
                {copy.hero.alreadyHaveAccount}
              </Link>
              <Link
                href={wcIntroHref}
                className="text-xs font-medium underline underline-offset-4 transition hover:opacity-90"
                style={{ color: '#6ee7b7' }}
                data-testid="landing-hero-wc-pools"
                onClick={() => trackLandingCtaClick({ cta_label: 'AF World Cup Pools', cta_destination: wcIntroHref, cta_type: 'secondary', source: 'hero' })}
              >
                ⚽ AF World Cup Pools — free
              </Link>
            </div>
          </div>
        )}
      </div>

      <div className="relative z-10 mb-6 flex flex-wrap items-center justify-center gap-2 px-2" aria-label={ariaSportsLabel}>
        {copy.sports.map((sport) => (
          <span
            key={sport}
            className="rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.08em]"
            style={{ background: 'color-mix(in srgb, var(--panel2) 78%, transparent)', borderColor: 'color-mix(in srgb, var(--border) 100%, transparent)', color: 'var(--muted)' }}
          >
            {sport}
          </span>
        ))}
      </div>

      {!isAuthenticated && <B2BDemoBand />}
    </section>
  )
}
