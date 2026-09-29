import { ArrowRight, ArrowDown } from 'lucide-react'
import type { LandingCopy } from './copy'
import { GlassCard } from './shared/GlassCard'
import { SectionEyebrow } from './shared/SectionEyebrow'
import { GradientWord } from './shared/GradientWord'
import { ProgressBar } from './shared/ProgressBar'

export function TradeDeadlineSection({ copy }: { copy: LandingCopy['journey']['tradeDeadline'] }) {
  return (
    <section className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-20" aria-labelledby="landing-trade-heading">
      <div className="mb-10 text-center">
        <SectionEyebrow accent="var(--accent-amber-strong)">{copy.eyebrow}</SectionEyebrow>
        <h2 id="landing-trade-heading" className="mb-3 whitespace-pre-line text-[32px] font-black leading-[0.98] tracking-[0.02em] sm:text-[46px] md:text-[58px]" style={{ color: 'var(--text)' }}>
          <GradientWord from="var(--accent-amber-strong)" to="#d97706">{copy.title}</GradientWord>
        </h2>
        <p className="mx-auto max-w-xl text-sm leading-7 sm:text-base sm:leading-8" style={{ color: 'var(--muted)' }}>
          {copy.subtitle}
        </p>
      </div>

      <GlassCard className="p-5 sm:p-6" accentBorder="color-mix(in srgb, var(--accent-amber) 24%, var(--border))">
        <p className="mb-4 text-[11px] font-bold uppercase tracking-[0.12em]" style={{ color: 'var(--accent-amber-strong)' }}>{copy.proposalLabel}</p>
        <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center sm:gap-5">
          <div className="w-full rounded-xl border p-4 text-center sm:w-64" style={{ borderColor: 'var(--border)', background: 'color-mix(in srgb, var(--panel2) 60%, transparent)' }}>
            <p className="mb-1 text-[11px] font-bold uppercase tracking-[0.1em]" style={{ color: 'var(--muted)' }}>{copy.giveLabel}</p>
            <p className="text-sm font-semibold" style={{ color: 'var(--text)' }}>{copy.mockTrade.give}</p>
          </div>
          <span className="shrink-0" aria-hidden="true">
            <ArrowRight className="hidden h-5 w-5 sm:block" style={{ color: 'var(--accent-amber-strong)' }} />
            <ArrowDown className="block h-5 w-5 sm:hidden" style={{ color: 'var(--accent-amber-strong)' }} />
          </span>
          <div className="w-full rounded-xl border p-4 text-center sm:w-64" style={{ borderColor: 'color-mix(in srgb, var(--accent-emerald) 30%, var(--border))', background: 'color-mix(in srgb, var(--accent-emerald) 8%, transparent)' }}>
            <p className="mb-1 text-[11px] font-bold uppercase tracking-[0.1em]" style={{ color: 'var(--accent-emerald-strong)' }}>{copy.getLabel}</p>
            <p className="text-sm font-semibold" style={{ color: 'var(--text)' }}>{copy.mockTrade.get}</p>
          </div>
        </div>
        <div className="mx-auto mt-6 max-w-sm">
          <ProgressBar targetPct={96} accent="linear-gradient(90deg, var(--accent-amber), var(--accent-emerald))" label={copy.fairnessLabel} />
        </div>
      </GlassCard>
    </section>
  )
}
