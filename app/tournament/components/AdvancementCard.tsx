'use client'

import Link from 'next/link'
import type { CSSProperties } from 'react'
import { useMemo } from 'react'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'

function ConfettiLayer() {
  const pieces = useMemo(
    () =>
      Array.from({ length: 28 }, (_, i) => ({
        id: i,
        left: `${(i * 3.7) % 100}%`,
        delay: `${(i % 8) * 0.08}s`,
        duration: `${2.4 + (i % 5) * 0.35}s`,
        hue: (i * 47) % 360,
        tx: `${(i % 2 === 0 ? 1 : -1) * (20 + (i % 6) * 8)}px`,
      })),
    [],
  )
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      {pieces.map((p) => (
        <span
          key={p.id}
          className="tournament-confetti-piece"
          style={
            {
              left: p.left,
              top: '-12px',
              animationDelay: p.delay,
              animationDuration: p.duration,
              backgroundColor: `hsl(${p.hue} 85% 55%)`,
              '--tx': p.tx,
            } as CSSProperties
          }
        />
      ))}
    </div>
  )
}

export function AdvancementOverlay({
  open,
  variant,
  fromRound,
  toRound,
  record,
  conferenceRank,
  conferenceName,
  newLeagueName,
  draftAt,
  basePath,
  onDismiss,
}: {
  open: boolean
  variant: 'qualified' | 'wildcard'
  fromRound: number
  toRound: number
  record: string
  conferenceRank: string
  conferenceName: string
  newLeagueName: string
  draftAt: string | null
  basePath: string
  onDismiss: () => void
}) {
  const { t, tInterpolate } = useLanguage()
  if (!open) return null

  const gold = variant === 'qualified'
  const confName = conferenceName.trim() || t('tournament.advancement.conferenceFallback')

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 p-4 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-labelledby="advancement-title"
    >
      {gold ? <ConfettiLayer /> : null}
      <div
        className={`tournament-scale-in relative w-full max-w-md overflow-hidden rounded-2xl border p-6 shadow-2xl ${
          gold
            ? 'border-[var(--tournament-gold)]/50 bg-[#0a0f16]'
            : 'border-[var(--tournament-accent)]/45 bg-[#0a1018]'
        }`}
        style={
          gold
            ? {
                boxShadow: '0 0 40px rgba(245, 184, 0, 0.18)',
              }
            : { boxShadow: '0 0 36px rgba(59, 130, 246, 0.2)' }
        }
      >
        <h2
          id="advancement-title"
          className={`text-center text-[22px] font-black tracking-tight md:text-[26px] ${
            gold
              ? 'bg-gradient-to-r from-yellow-200 via-amber-300 to-yellow-100 bg-clip-text text-transparent'
              : 'text-blue-200'
          }`}
        >
          {variant === 'wildcard'
            ? t('tournament.advancement.title.wildcard')
            : t('tournament.advancement.title.qualified')}
        </h2>
        <p className="mt-2 text-center text-[13px] text-[var(--tournament-text-mid)]">
          {tInterpolate('tournament.advancement.roundArrow', {
            from: String(fromRound),
            to: String(toRound),
          })}
        </p>
        <p className="mt-3 text-center text-[14px] text-white">
          {t('tournament.advancement.record')} <span className="font-mono font-bold">{record}</span>
        </p>
        <p className="text-center text-[12px] text-[var(--tournament-text-dim)]">
          {tInterpolate('tournament.advancement.rankInConference', { rank: conferenceRank, conference: confName })}
        </p>
        <div className="my-4 h-px bg-[var(--tournament-border)]" />
        <p className="text-center text-[11px] font-bold uppercase tracking-widest text-[var(--tournament-text-dim)]">
          {t('tournament.advancement.yourNewLeague')}
        </p>
        <p className="mt-1 text-center text-[18px] font-bold text-white">{newLeagueName}</p>
        <p className="mt-2 text-center text-[12px] text-[var(--tournament-text-mid)]">
          {draftAt
            ? tInterpolate('tournament.advancement.draftBegins', { when: draftAt })
            : t('tournament.advancement.draftTbd')}
        </p>
        <p className="mt-2 text-center text-[11px] text-[var(--tournament-text-dim)]">
          {t('tournament.advancement.alreadyInLeague')}
        </p>
        <Link
          href={`${basePath}/league`}
          className="mt-5 flex min-h-[56px] w-full items-center justify-center rounded-xl bg-yellow-500/90 text-[15px] font-bold text-black hover:bg-yellow-400"
          data-testid="advancement-view-league"
          onClick={onDismiss}
        >
          {t('tournament.advancement.ctaLeague')}
        </Link>
        <button
          type="button"
          onClick={onDismiss}
          className="mt-3 w-full text-center text-[13px] text-[var(--tournament-text-dim)] underline hover:text-white"
          data-testid="advancement-dismiss"
        >
          {t('tournament.advancement.dismiss')}
        </button>
      </div>
    </div>
  )
}

export function EliminationOverlay({
  open,
  round,
  record,
  pointsFor,
  basePath,
  onDismiss,
}: {
  open: boolean
  round: number
  record: string
  pointsFor: number
  basePath: string
  onDismiss: () => void
}) {
  const { t, tInterpolate } = useLanguage()
  if (!open) return null
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/85 p-4 backdrop-blur-md">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0c1014] p-6 text-center shadow-xl">
        <h2 className="text-[18px] font-bold text-white/90">{t('tournament.elimination.title')}</h2>
        <p className="mt-2 text-[13px] text-[var(--tournament-text-mid)]">
          {tInterpolate('tournament.elimination.throughRound', { round: String(round) })}
        </p>
        <p className="mt-3 font-mono text-[15px] text-white">
          {record} · {pointsFor.toFixed(1)} {t('tournament.elimination.pfSuffix')}
        </p>
        <div className="mt-5 flex flex-col gap-2">
          <Link
            href={`${basePath}/history`}
            className="flex min-h-[48px] items-center justify-center rounded-xl bg-white/10 text-[14px] font-semibold text-white hover:bg-white/15"
            onClick={onDismiss}
          >
            {t('tournament.elimination.history')}
          </Link>
          <Link
            href={`${basePath}/standings`}
            className="flex min-h-[48px] items-center justify-center rounded-xl border border-white/15 text-[14px] font-semibold text-white/90 hover:bg-white/5"
            onClick={onDismiss}
          >
            {t('tournament.elimination.standings')}
          </Link>
          <button type="button" onClick={onDismiss} className="text-[13px] text-white/40 underline">
            {t('tournament.elimination.dismiss')}
          </button>
        </div>
      </div>
    </div>
  )
}
