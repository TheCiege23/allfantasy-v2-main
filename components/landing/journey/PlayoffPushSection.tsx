import type { LandingCopy } from './copy'
import { GlassCard } from './shared/GlassCard'
import { SectionEyebrow } from './shared/SectionEyebrow'
import { GradientWord } from './shared/GradientWord'

function statusToneStyle(status: string, clinchLabel: string, isBubble: boolean): { color: string; background: string } {
  if (status === clinchLabel) return { color: 'var(--accent-emerald-strong)', background: 'color-mix(in srgb, var(--accent-emerald) 14%, transparent)' }
  if (isBubble) return { color: 'var(--accent-amber-strong)', background: 'color-mix(in srgb, var(--accent-amber) 16%, transparent)' }
  return { color: 'var(--muted)', background: 'color-mix(in srgb, var(--panel2) 70%, transparent)' }
}

export function PlayoffPushSection({ copy }: { copy: LandingCopy['journey']['playoffPush'] }) {
  return (
    <section className="relative mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-20" aria-labelledby="landing-playoff-heading">
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: 'radial-gradient(ellipse 55% 45% at 50% 30%, color-mix(in srgb, var(--accent-amber) 10%, transparent) 0%, transparent 70%)' }}
        aria-hidden="true"
      />
      <div className="relative mb-10 text-center">
        <SectionEyebrow accent="var(--accent-purple)">{copy.eyebrow}</SectionEyebrow>
        <h2 id="landing-playoff-heading" className="mb-3 whitespace-pre-line text-[32px] font-black leading-[0.98] tracking-[0.02em] sm:text-[46px] md:text-[58px]" style={{ color: 'var(--text)' }}>
          <GradientWord from="var(--accent-purple)" to="var(--accent-amber-strong)">{copy.title}</GradientWord>
        </h2>
        <p className="mx-auto max-w-xl text-sm leading-7 sm:text-base sm:leading-8" style={{ color: 'var(--muted)' }}>
          {copy.subtitle}
        </p>
      </div>

      <GlassCard className="relative p-5 sm:p-6" accentBorder="color-mix(in srgb, var(--accent-amber) 28%, var(--accent-purple) 12%)">
        <div className="mb-4 flex items-center justify-between">
          <p className="text-[11px] font-bold uppercase tracking-[0.12em]" style={{ color: 'var(--accent-purple)' }}>{copy.standingsLabel}</p>
          <span
            className="rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.08em]"
            style={{ color: 'var(--accent-amber-strong)', background: 'color-mix(in srgb, var(--accent-amber) 16%, transparent)' }}
          >
            🔥 {copy.tensionTag}
          </span>
        </div>
        <div className="space-y-2">
          {copy.mockStandings.map((row, i) => {
            const isGlow = row.status === copy.clinchLabel
            const isBubble = !isGlow && i === copy.mockStandings.length - 1
            const tone = statusToneStyle(row.status, copy.clinchLabel, isBubble)
            return (
              <div
                key={row.team}
                className={`landing-fade-in-stagger flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 ${isGlow ? 'animate-glow-pulse' : ''}`}
                style={{
                  borderColor: isGlow
                    ? 'color-mix(in srgb, var(--accent-emerald) 30%, var(--border))'
                    : isBubble
                      ? 'color-mix(in srgb, var(--accent-amber) 35%, var(--border))'
                      : 'var(--border)',
                  animationDelay: `${i * 100}ms`,
                }}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span className="text-sm font-semibold" style={{ color: 'var(--muted2)' }}>{i + 1}</span>
                  <span className="truncate text-sm font-semibold" style={{ color: 'var(--text)' }}>{row.team}</span>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="text-xs font-medium" style={{ color: 'var(--muted)' }}>{row.record}</span>
                  <span className="rounded-full px-2 py-0.5 text-[11px] font-bold" style={tone}>{row.status}</span>
                </div>
              </div>
            )
          })}
        </div>
      </GlassCard>
    </section>
  )
}
