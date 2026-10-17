'use client'

import Link from 'next/link'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'
import type { LanguageCode } from '@/lib/i18n/constants'

function pickOrdinalLabel(n: number, lang: LanguageCode): string {
  if (lang === 'es') return `${n}.º`
  return `${n}${nth(n)}`
}

export function DraftTransitionCard({
  leagueName,
  conferenceName,
  draftTypeLabel,
  clockLabel,
  draftSlot,
  scheduledLabel,
  status,
  countdownLabel,
  leagueRoomHref,
  readOnly,
}: {
  leagueName: string
  conferenceName: string | null
  draftTypeLabel: string
  clockLabel: string
  draftSlot: number | null
  scheduledLabel: string
  status: 'SCHEDULED' | 'LIVE' | 'COMPLETE' | string
  countdownLabel: string | null
  leagueRoomHref: string | null
  readOnly?: boolean
}) {
  const { t, tInterpolate, language } = useLanguage()
  const live = status === 'LIVE' || status === 'drafting'
  return (
    <div
      className={`rounded-xl border p-4 ${
        live ? 'border-[var(--tournament-active)]/50 bg-cyan-500/10' : 'border-[var(--tournament-border)] bg-[var(--tournament-panel)]'
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-[15px] font-bold text-white">{leagueName}</p>
          {conferenceName ? (
            <p className="text-[11px] text-[var(--tournament-text-dim)]">{conferenceName}</p>
          ) : null}
        </div>
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] font-bold uppercase ${
            live ? 'bg-red-500/25 text-red-200' : 'bg-white/10 text-white/70'
          }`}
        >
          {status}
        </span>
      </div>
      <p className="mt-2 text-[12px] text-[var(--tournament-text-mid)]">
        {draftTypeLabel} · {clockLabel}
      </p>
      <p className="text-[12px] text-white/90">
        {tInterpolate('tournament.draft.youPick', {
          ordinal:
            draftSlot != null ? pickOrdinalLabel(draftSlot, language) : t('tournament.draft.pickDash'),
        })}
      </p>
      <p className="mt-1 text-[12px] text-[var(--tournament-text-dim)]">{scheduledLabel}</p>
      {countdownLabel ? (
        <p className="mt-2 font-mono text-[20px] font-bold tracking-tight text-[var(--tournament-gold)]">
          {countdownLabel}
        </p>
      ) : null}
      {leagueRoomHref && !readOnly ? (
        <Link
          href={leagueRoomHref}
          className={`mt-4 flex min-h-[48px] w-full items-center justify-center rounded-xl text-[14px] font-bold ${
            live ? 'bg-cyan-500 text-black hover:bg-cyan-400' : 'bg-white/10 text-white hover:bg-white/15'
          }`}
          data-testid="draft-enter-room"
        >
          {live ? t('tournament.draft.enterRoom') : t('tournament.draft.openWorkspace')}
        </Link>
      ) : null}
    </div>
  )
}

function nth(n: number): string {
  const m = n % 10
  const m100 = n % 100
  if (m100 >= 11 && m100 <= 13) return 'th'
  if (m === 1) return 'st'
  if (m === 2) return 'nd'
  if (m === 3) return 'rd'
  return 'th'
}

export function RoundResetExplainer({
  roundNumber,
  rosterBefore,
  rosterAfter,
  faabReset,
}: {
  roundNumber: number
  rosterBefore: number
  rosterAfter: number
  faabReset: boolean
}) {
  const { t, tInterpolate } = useLanguage()
  return (
    <div className="tournament-panel p-4">
      <p className="text-[12px] font-bold uppercase tracking-wide text-[var(--tournament-text-dim)]">
        {tInterpolate('tournament.roundExplainer.title', { n: String(roundNumber) })}
      </p>
      <ul className="mt-3 space-y-2 text-[13px] text-[var(--tournament-text-mid)]">
        <li className="flex gap-2">
          <span>🔄</span>
          <span>
            <strong className="text-white">{t('tournament.roundExplainer.newDraft')}</strong> —{' '}
            {t('tournament.roundExplainer.newDraftDesc')}
          </span>
        </li>
        <li className="flex gap-2">
          <span>📋</span>
          <span>
            <strong className="text-white">{t('tournament.roundExplainer.rosterSize')}</strong> —{' '}
            {tInterpolate('tournament.roundExplainer.rosterSizeDesc', {
              after: String(rosterAfter),
              before: String(rosterBefore),
            })}
          </span>
        </li>
        <li className="flex gap-2">
          <span>💰</span>
          <span>
            <strong className="text-white">{t('tournament.roundExplainer.faab')}</strong> —{' '}
            {faabReset ? t('tournament.roundExplainer.faabReset') : t('tournament.roundExplainer.faabCarryover')}
          </span>
        </li>
        <li className="flex gap-2">
          <span>⚡</span>
          <span>
            <strong className="text-white">{t('tournament.roundExplainer.draftOrder')}</strong> —{' '}
            {t('tournament.roundExplainer.draftOrderDesc')}
          </span>
        </li>
      </ul>
    </div>
  )
}
