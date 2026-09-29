import Link from 'next/link'
import { ArrowRight, Trophy } from 'lucide-react'
import type { LandingCopy } from './copy'
import { GlassCard } from './shared/GlassCard'
import { SectionEyebrow } from './shared/SectionEyebrow'
import { GradientWord } from './shared/GradientWord'
import { trackLandingCtaClick } from '@/lib/landing-analytics'

const CONFETTI_COUNT = 10

export function ChampionshipSection({ copy, ctaHref }: { copy: LandingCopy['journey']['championship']; ctaHref: string }) {
  return (
    <section className="relative overflow-hidden px-4 py-16 text-center sm:px-6 sm:py-24" aria-labelledby="landing-championship-heading">
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: `
            radial-gradient(ellipse 65% 60% at 50% 30%, color-mix(in srgb, var(--accent-amber) 20%, transparent) 0%, transparent 68%),
            radial-gradient(ellipse 55% 50% at 50% 60%, color-mix(in srgb, var(--accent-cyan) 14%, transparent) 0%, transparent 70%)
          `,
        }}
        aria-hidden="true"
      />
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        {Array.from({ length: CONFETTI_COUNT }).map((_, i) => (
          <span
            key={i}
            className={`landing-confetti-piece absolute ${i >= 5 ? 'hidden sm:block' : ''}`}
            style={{
              left: `${(i * 97) % 100}%`,
              top: '-5%',
              animationDelay: `${i * 0.6}s`,
              background: i % 2 === 0 ? 'var(--accent-amber-strong)' : 'var(--accent-cyan-strong)',
            }}
          />
        ))}
      </div>

      <div className="relative z-10 mx-auto max-w-2xl">
        <SectionEyebrow accent="var(--accent-amber-strong)">🏆 {copy.eyebrow}</SectionEyebrow>
        <h2 id="landing-championship-heading" className="mb-4 whitespace-pre-line text-[40px] font-black leading-[0.95] tracking-[0.02em] sm:text-[58px] md:text-[76px]" style={{ color: 'var(--text)' }}>
          <GradientWord from="var(--accent-amber-strong)" to="var(--accent-cyan-strong)">{copy.title}</GradientWord>
        </h2>
        <p className="mx-auto mb-8 max-w-lg text-sm leading-7 sm:text-base sm:leading-8" style={{ color: 'var(--muted)' }}>
          {copy.subtitle}
        </p>

        <GlassCard className="landing-float mx-auto mb-8 max-w-xs p-6" accentBorder="color-mix(in srgb, var(--accent-amber) 30%, var(--border))">
          <Trophy className="mx-auto mb-3 h-10 w-10" style={{ color: 'var(--accent-amber-strong)' }} aria-hidden="true" />
          <p className="mb-1 text-[11px] font-bold uppercase tracking-[0.12em]" style={{ color: 'var(--accent-amber-strong)' }}>{copy.trophyCardTitle}</p>
          <p className="mb-3 text-lg font-black" style={{ color: 'var(--text)' }}>Dynasty Dragons</p>
          <p className="text-xs font-medium" style={{ color: 'var(--muted)' }}>{copy.recordLabel}: 13-1</p>
        </GlassCard>

        <Link
          href={ctaHref}
          className="inline-flex items-center gap-2 rounded-xl px-6 py-3 text-sm font-semibold text-black transition hover:-translate-y-0.5 hover:opacity-90"
          style={{ backgroundImage: 'linear-gradient(90deg, #f59e0b, #d97706)' }}
          onClick={() => trackLandingCtaClick({ cta_label: copy.cta, cta_destination: ctaHref, cta_type: 'primary', source: 'championship-section' })}
        >
          {copy.cta}
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    </section>
  )
}
