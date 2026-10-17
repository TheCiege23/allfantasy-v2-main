import type { LandingCopy } from './copy'
import { GlassCard } from './shared/GlassCard'
import { SectionEyebrow } from './shared/SectionEyebrow'
import { GradientWord } from './shared/GradientWord'
import { ProgressBar } from './shared/ProgressBar'

export function WaiverWednesdaySection({ copy }: { copy: LandingCopy['journey']['waiverWednesday'] }) {
  return (
    <section className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-20" aria-labelledby="landing-waiver-heading">
      <div className="mb-10 text-center">
        <SectionEyebrow accent="var(--accent-cyan-strong)">{copy.eyebrow}</SectionEyebrow>
        <h2 id="landing-waiver-heading" className="mb-3 whitespace-pre-line text-[32px] font-black leading-[0.98] tracking-[0.02em] sm:text-[46px] md:text-[58px]" style={{ color: 'var(--text)' }}>
          <GradientWord>{copy.title}</GradientWord>
        </h2>
        <p className="mx-auto max-w-xl text-sm leading-7 sm:text-base sm:leading-8" style={{ color: 'var(--muted)' }}>
          {copy.subtitle}
        </p>
      </div>

      <div className="grid gap-6 sm:grid-cols-2">
        <GlassCard className="p-5" accentBorder="color-mix(in srgb, var(--accent-cyan) 20%, var(--border))">
          <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.12em]" style={{ color: 'var(--accent-cyan-strong)' }}>{copy.priorityLabel}</p>
          <div className="space-y-2">
            {copy.mockClaims.map((claim, i) => (
              <div key={claim.player} className="landing-fade-in-stagger flex items-center gap-2.5 rounded-lg border px-3 py-2" style={{ borderColor: 'var(--border)', background: 'color-mix(in srgb, var(--panel2) 60%, transparent)', animationDelay: `${i * 120}ms` }}>
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold" style={{ background: 'color-mix(in srgb, var(--accent-cyan) 16%, transparent)', color: 'var(--accent-cyan-strong)' }}>
                  {i + 1}
                </span>
                <span className="flex-1 truncate text-sm font-medium" style={{ color: 'var(--text)' }}>{claim.player}</span>
                <span className="text-xs font-semibold" style={{ color: 'var(--accent-emerald-strong)' }}>{claim.bid}</span>
              </div>
            ))}
          </div>
        </GlassCard>

        <GlassCard className="p-5" accentBorder="color-mix(in srgb, var(--accent-emerald) 20%, var(--border))">
          <ProgressBar targetPct={64} accent="linear-gradient(90deg, var(--accent-emerald), var(--accent-cyan))" label={copy.faabLabel} />
        </GlassCard>
      </div>
    </section>
  )
}
