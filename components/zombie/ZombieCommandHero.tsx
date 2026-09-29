'use client'

import clsx from 'clsx'
import { Biohazard, Radio } from 'lucide-react'
import { type ReactNode } from 'react'
import {
  formatZombieTierLabel,
  getZombieSportHeroPreset,
  resolveZombieUniverseTier,
  zombieTierBadgeClasses,
} from '@/lib/zombie/zombie-visual-system'
import { ZombieDangerMeter, type ZombieDangerLevel } from '@/components/zombie/ZombieDangerMeter'

function StatTile({
  label,
  value,
  hint,
  tone,
}: {
  label: string
  value: string
  hint: string
  tone: 'survivor' | 'horde' | 'whisperer' | 'pot'
}) {
  const tones: Record<'survivor' | 'horde' | 'whisperer' | 'pot', string> = {
    survivor:
      'border-emerald-500/22 bg-emerald-500/[0.07] shadow-[inset_0_1px_0_rgba(52,211,153,0.12)]',
    horde: 'border-red-500/25 bg-red-500/[0.08] shadow-[0_0_20px_rgba(239,68,68,0.06)]',
    whisperer: 'border-fuchsia-500/25 bg-fuchsia-950/25 shadow-[inset_0_0_0_1px_rgba(217,70,239,0.12)]',
    pot: 'border-amber-500/28 bg-amber-500/[0.09] shadow-[0_0_18px_rgba(245,158,11,0.08)]',
  }
  return (
    <div className={clsx('rounded-2xl border p-3', tones[tone])}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/45">{label}</p>
      <p className="mt-2 text-xl font-black tabular-nums text-white">{value}</p>
      <p className="mt-0.5 text-[11px] text-white/55">{hint}</p>
    </div>
  )
}

export function ZombieCommandHero({
  leagueName,
  logoUrl,
  sport,
  week,
  level,
  survivorCount,
  hordeCount,
  whispererCount,
  potTotal,
  isPaid,
  chompinNames,
  riskScore,
  dangerLevel,
  whispererPanel,
  quickActions,
}: {
  leagueName: string | null
  logoUrl?: string | null
  sport: string | null | undefined
  week: number
  level: { tierLabel?: string | null; name?: string | null; tierTheme?: string | null } | null | undefined
  survivorCount: number
  hordeCount: number
  whispererCount: number
  potTotal: number
  isPaid: boolean
  chompinNames: string[]
  riskScore?: number | null
  dangerLevel?: ZombieDangerLevel
  whispererPanel: ReactNode
  quickActions: ReactNode
}) {
  const preset = getZombieSportHeroPreset(sport)
  const tier = resolveZombieUniverseTier(level ?? null)
  const tierLabel = formatZombieTierLabel(tier, level?.tierLabel ?? level?.name)

  return (
    <section className="zombie-hero-shell border border-white/10 shadow-[0_24px_80px_rgba(0,0,0,0.45)]">
      <div className="zombie-hero-fog" aria-hidden />
      <div className={clsx('pointer-events-none absolute inset-0', preset.overlayClass)} aria-hidden />
      <div className="zombie-drift-particles opacity-[0.35]" aria-hidden />

      <div className="relative z-[1] p-5 sm:p-6">
        <div className="flex flex-col gap-8 lg:flex-row lg:items-stretch lg:justify-between lg:gap-10">
          <div className="min-w-0 flex-1 space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--zombie-toxic)]/35 bg-black/30 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.24em] text-[var(--zombie-toxic)] shadow-[var(--zombie-glow-toxic)]">
                <Radio className="h-3.5 w-3.5" aria-hidden />
                Outbreak command
              </span>
              <span
                className={clsx(
                  'rounded-full border px-3 py-1 text-[11px] font-bold uppercase tracking-[0.2em]',
                  zombieTierBadgeClasses(tier),
                )}
              >
                {tierLabel}
              </span>
              <span className="rounded-full border border-white/10 bg-black/25 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-white/70">
                Week {week}
              </span>
              <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/60">
                {preset.sport} · {preset.label}
              </span>
            </div>

            <div className="flex flex-wrap items-start gap-4">
              <div className="zombie-toxic-ring flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-[var(--zombie-toxic)]/40 bg-black/50 sm:h-[72px] sm:w-[72px]">
                {logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- league logos may be arbitrary commissioner URLs
                  <img src={logoUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <Biohazard className="h-9 w-9 text-[var(--zombie-toxic)] sm:h-10 sm:w-10" aria-hidden />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <h1 className="text-3xl font-black tracking-tight text-white sm:text-4xl">{leagueName ?? 'Zombie League'}</h1>
                <p className="mt-2 max-w-2xl text-sm leading-relaxed text-white/70">{preset.tagline}</p>
              </div>
            </div>

            <div
              className={clsx(
                'rounded-2xl border border-red-500/30 px-4 py-3',
                chompinNames.length > 0 ? 'zombie-chompin-alert' : 'border-dashed border-white/15 bg-black/25',
              )}
              data-testid="zombie-chompin-block-banner"
            >
              <p className="text-[11px] font-bold uppercase tracking-[0.28em] text-red-200">On the Chompin&apos; Block</p>
              {chompinNames.length > 0 ? (
                <p className="mt-2 text-sm font-semibold text-amber-50">{chompinNames.slice(0, 3).join(' · ')}</p>
              ) : (
                <p className="mt-2 text-sm text-white/55">No one flagged on the block right now — stay sharp.</p>
              )}
            </div>

            <ZombieDangerMeter riskScore={riskScore} level={dangerLevel} />
          </div>

          <div className="flex w-full flex-col gap-4 lg:max-w-[380px]">
            <div className="w-full">{whispererPanel}</div>
            <div className="grid grid-cols-2 gap-3">
              <StatTile label="Survivors" value={String(survivorCount)} hint="Still in the fight" tone="survivor" />
              <StatTile label="Horde" value={String(hordeCount)} hint="Infected + Whisperer" tone="horde" />
              <StatTile label="Whisperer" value={String(whispererCount)} hint="Shadow asset" tone="whisperer" />
              <StatTile
                label={isPaid ? 'Pot' : 'Economy'}
                value={isPaid ? `$${potTotal.toFixed(0)}` : `${potTotal.toFixed(0)} pts`}
                hint={isPaid ? 'League pot tracker' : 'In-play resources'}
                tone="pot"
              />
            </div>
          </div>
        </div>

        <div className="mt-8 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{quickActions}</div>
      </div>
    </section>
  )
}
