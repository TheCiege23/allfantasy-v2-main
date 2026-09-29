'use client'

import { useEffect, useState } from 'react'
import type { LandingCopy } from './copy'
import { GlassCard } from './shared/GlassCard'
import { SectionEyebrow } from './shared/SectionEyebrow'
import { GradientWord } from './shared/GradientWord'
import { ProgressBar } from './shared/ProgressBar'

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

const FEED_ICONS = ['📈', '⚠️', '🔄', '📣'] as const

function ActivityFeed({ items }: { items: readonly string[] }) {
  const [reduced, setReduced] = useState(false)

  useEffect(() => {
    setReduced(prefersReducedMotion())
  }, [])

  return (
    <div className="space-y-2">
      {items.map((item, i) => (
        <div
          key={item}
          className={reduced ? undefined : 'landing-fade-in-stagger'}
          style={{
            animationDelay: reduced ? undefined : `${i * 130}ms`,
            display: 'flex',
            alignItems: 'flex-start',
            gap: '8px',
            fontSize: '12px',
            fontWeight: 500,
            color: 'var(--muted)',
            padding: '7px 10px',
            borderRadius: '8px',
            background: 'color-mix(in srgb, var(--panel2) 60%, transparent)',
          }}
        >
          <span aria-hidden="true">{FEED_ICONS[i % FEED_ICONS.length]}</span>
          <span style={{ flex: 1 }}>{item}</span>
          {i === 0 && (
            <span
              className={reduced ? undefined : 'landing-live-pulse'}
              style={{ width: 6, height: 6, marginTop: 4, flexShrink: 0, borderRadius: '50%', background: 'var(--accent-red-strong)' }}
              aria-hidden="true"
            />
          )}
        </div>
      ))}
    </div>
  )
}

export function GameDaySection({ copy }: { copy: LandingCopy['journey']['gameDay'] }) {
  return (
    <section className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-20" aria-labelledby="landing-game-day-heading">
      <div className="mb-10 text-center">
        <SectionEyebrow accent="var(--accent-emerald-strong)">{copy.eyebrow}</SectionEyebrow>
        <h2 id="landing-game-day-heading" className="mb-3 whitespace-pre-line text-[32px] font-black leading-[0.98] tracking-[0.02em] sm:text-[46px] md:text-[58px]" style={{ color: 'var(--text)' }}>
          <GradientWord from="var(--accent-emerald-strong)" to="var(--accent-cyan)">{copy.title}</GradientWord>
        </h2>
        <p className="mx-auto max-w-xl text-sm leading-7 sm:text-base sm:leading-8" style={{ color: 'var(--muted)' }}>
          {copy.subtitle}
        </p>
      </div>

      <div className="grid gap-6 sm:grid-cols-2">
        <GlassCard className="p-5" accentBorder="color-mix(in srgb, var(--accent-emerald) 24%, var(--border))">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-[0.12em]" style={{ color: 'var(--accent-emerald-strong)' }}>{copy.matchupLabel}</span>
            <span className="landing-live-pulse rounded-full px-2 py-0.5 text-[11px] font-bold uppercase" style={{ background: 'color-mix(in srgb, var(--accent-red) 16%, transparent)', color: 'var(--accent-red-strong)' }}>
              {copy.liveLabel}
            </span>
          </div>
          <div className="mb-1 flex items-center justify-between text-sm font-semibold" style={{ color: 'var(--text)' }}>
            <span>Dynasty Dragons</span>
            <span className="text-lg font-black" style={{ color: 'var(--accent-cyan-strong)' }}>78.4</span>
          </div>
          <div className="mb-4 flex items-center justify-between text-sm font-semibold" style={{ color: 'var(--muted)' }}>
            <span>Gridiron Gang</span>
            <span className="text-lg font-black" style={{ color: 'var(--text)' }}>71.2</span>
          </div>
          <ProgressBar targetPct={72} accent="linear-gradient(90deg, var(--accent-emerald), var(--accent-cyan))" label={copy.winProbLabel} />
        </GlassCard>

        <GlassCard className="p-5" accentBorder="color-mix(in srgb, var(--border) 100%, transparent)">
          <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.12em]" style={{ color: 'var(--muted)' }}>{copy.liveActivityLabel}</p>
          <ActivityFeed items={copy.tickerItems} />
        </GlassCard>
      </div>
    </section>
  )
}
