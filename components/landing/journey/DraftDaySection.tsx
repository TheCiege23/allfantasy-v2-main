import type { LandingCopy } from './copy'
import { GlassCard } from './shared/GlassCard'
import { SectionEyebrow } from './shared/SectionEyebrow'
import { GradientWord } from './shared/GradientWord'

const POSITION_COLORS: Record<string, string> = {
  RB: 'var(--accent-emerald-strong)',
  WR: 'var(--accent-cyan-strong)',
  QB: 'var(--accent-purple)',
  TE: 'var(--accent-amber-strong)',
}

export function DraftDaySection({ copy }: { copy: LandingCopy['journey']['draftDay'] }) {
  const onTheClockPick = copy.mockPicks[0]
  const nextUpPick = copy.mockPicks[1]
  const recentPicks = copy.mockPicks.slice(2)

  return (
    <section className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-20" aria-labelledby="landing-draft-day-heading">
      <div
        className="pointer-events-none absolute inset-x-0 -z-10 h-[420px]"
        style={{ background: 'radial-gradient(ellipse 55% 60% at 50% 20%, color-mix(in srgb, var(--accent-purple) 10%, transparent) 0%, transparent 70%)' }}
        aria-hidden="true"
      />
      <div className="mb-10 text-center">
        <SectionEyebrow accent="var(--accent-purple)">{copy.eyebrow}</SectionEyebrow>
        <h2 id="landing-draft-day-heading" className="mb-3 whitespace-pre-line text-[32px] font-black leading-[0.98] tracking-[0.02em] sm:text-[46px] md:text-[58px]" style={{ color: 'var(--text)' }}>
          <GradientWord from="var(--accent-purple)" to="color-mix(in srgb, var(--accent-cyan) 60%, var(--accent-purple))">{copy.title}</GradientWord>
        </h2>
        <p className="mx-auto max-w-xl text-sm leading-7 sm:text-base sm:leading-8" style={{ color: 'var(--muted)' }}>
          {copy.subtitle}
        </p>
      </div>

      <GlassCard className="p-4 sm:p-6" accentBorder="color-mix(in srgb, var(--accent-purple) 22%, var(--border))">
        <div className="grid gap-4 sm:grid-cols-3">
          {/* On the clock */}
          <div className="rounded-xl border p-4" style={{ borderColor: 'color-mix(in srgb, var(--accent-amber) 30%, var(--border))', background: 'color-mix(in srgb, var(--accent-amber) 6%, transparent)' }}>
            <div className="mb-3 flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-[0.12em]" style={{ color: 'var(--accent-amber-strong)' }}>{copy.onTheClock}</span>
              <span className="landing-clock-pulse rounded-full px-2 py-0.5 text-[11px] font-bold" style={{ background: 'color-mix(in srgb, var(--accent-amber) 18%, transparent)', color: 'var(--accent-amber-strong)' }}>
                {copy.clockLabel}
              </span>
            </div>
            {onTheClockPick ? (
              <div className="flex items-center gap-2.5">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold" style={{ background: 'color-mix(in srgb, var(--accent-amber) 20%, transparent)', color: 'var(--accent-amber-strong)' }}>
                  {onTheClockPick.position}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold" style={{ color: 'var(--text)' }}>{onTheClockPick.name}</p>
                  <p className="text-[11px]" style={{ color: 'var(--muted)' }}>{onTheClockPick.team}</p>
                </div>
              </div>
            ) : null}
          </div>

          {/* Next up */}
          <div className="rounded-xl border p-4" style={{ borderColor: 'var(--border)', background: 'color-mix(in srgb, var(--panel2) 70%, transparent)' }}>
            <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.12em]" style={{ color: 'var(--muted)' }}>{copy.nextUp}</p>
            {nextUpPick ? (
              <div className="flex items-center gap-2.5 opacity-80">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold" style={{ background: 'color-mix(in srgb, var(--border) 140%, transparent)', color: POSITION_COLORS[nextUpPick.position] ?? 'var(--muted)' }}>
                  {nextUpPick.position}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold" style={{ color: 'var(--text)' }}>{nextUpPick.name}</p>
                  <p className="text-[11px]" style={{ color: 'var(--muted)' }}>{nextUpPick.team}</p>
                </div>
              </div>
            ) : null}
          </div>

          {/* Recent picks */}
          <div className="rounded-xl border p-4" style={{ borderColor: 'var(--border)', background: 'color-mix(in srgb, var(--panel2) 70%, transparent)' }}>
            <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.12em]" style={{ color: 'var(--muted)' }}>{copy.recentPicks}</p>
            <div className="space-y-2">
              {recentPicks.map((pick, i) => (
                <div key={pick.name} className="landing-draft-slide-in flex items-center gap-2" style={{ animationDelay: `${i * 150}ms` }}>
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold" style={{ background: 'color-mix(in srgb, var(--border) 140%, transparent)', color: POSITION_COLORS[pick.position] ?? 'var(--muted)' }}>
                    {pick.position}
                  </span>
                  <span className="truncate text-xs font-medium" style={{ color: 'var(--text)' }}>{pick.name}</span>
                  <span className="text-[11px]" style={{ color: 'var(--muted2)' }}>{pick.team}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </GlassCard>
    </section>
  )
}
