'use client'

import { useCallback, useEffect, useState, type ComponentType } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { Coins, Lock, Sparkles } from 'lucide-react'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'
import { BestBallSettingsCommissionerPanel } from '@/components/league-settings/BestBallSettingsCommissionerPanel'
import type { LeagueSettingsTabProps } from '../../league-settings-tabs-types'
import type { FormatSectionProps } from './SpecialtyFormatSections'
import { GuillotineSettingsForm, type GuillotineSettingsValue } from './GuillotineSettingsForm'

type GatedFormat = 'guillotine' | 'survivor' | 'zombie' | 'big_brother' | 'salary_cap' | 'devy' | 'c2c' | 'tournament'

type SpecialtyState = {
  formats: GatedFormat[]
  canEdit: boolean
  coveredBySubscription: boolean
  unlock: { season: number; unlockedAt: string } | null
  season: number
  tokenCost: number | null
  paywallLive: boolean
  paywallStartsAt: string
  upgradePath: string
  guillotine: GuillotineSettingsValue | null
}

const TOKEN_RULE = 'commissioner_specialty_settings_league_unlock'

/** Format editors load only when this tab is open, and only the module once. */
const load = (pick: (m: typeof import('./SpecialtyFormatSections')) => ComponentType<FormatSectionProps>) =>
  dynamic(() => import('./SpecialtyFormatSections').then(pick), { ssr: false })
const SECTIONS: Record<Exclude<GatedFormat, 'guillotine'>, ComponentType<FormatSectionProps>> = {
  survivor: load((m) => m.SurvivorSection),
  zombie: load((m) => m.ZombieSection),
  big_brother: load((m) => m.BigBrotherSection),
  salary_cap: load((m) => m.SalaryCapSection),
  devy: load((m) => m.DevySection),
  c2c: load((m) => m.C2CSection),
  tournament: load((m) => m.TournamentSection),
}

/**
 * Specialty tab: the rules of AllFantasy's specialty formats, for the commish and co-commishes.
 *
 * Editing is AF Commish (or AF Supreme), or a one-time AF Token unlock for this league and season.
 * The server refuses every specialty write without one of those; this tab only explains the lock
 * and offers both doors. Best Ball is a standard format and stays free here.
 */
export function SpecialtyTab({ ctx, canEdit: isCommish }: LeagueSettingsTabProps) {
  const { t } = useLanguage()
  const leagueId = ctx.league.id
  const [state, setState] = useState<SpecialtyState | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [confirming, setConfirming] = useState(false)
  const [unlocking, setUnlocking] = useState(false)
  const [unlockError, setUnlockError] = useState<{ message: string; needTokens: boolean } | null>(null)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/specialty-settings`, { credentials: 'include' })
      if (!res.ok) throw new Error(String(res.status))
      setState((await res.json()) as SpecialtyState)
      setStatus('ready')
    } catch {
      setStatus('error')
    }
  }, [leagueId])

  useEffect(() => {
    if (!isCommish) return
    void refresh()
  }, [isCommish, refresh])

  const unlock = async () => {
    setUnlocking(true)
    setUnlockError(null)
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/specialty-settings`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmTokenSpend: true }),
      })
      const data = (await res.json().catch(() => ({}))) as { code?: string; message?: string; error?: string }
      if (!res.ok) {
        const needTokens = data.code === 'insufficient_token_balance'
        setUnlockError({ message: needTokens ? t('lsHub.sp.needTokens') : data.message ?? data.error ?? t('lsHub.sp.unlockFailed'), needTokens })
        return
      }
      setConfirming(false)
      await refresh()
    } catch {
      setUnlockError({ message: t('lsHub.sp.unlockFailed'), needTokens: false })
    } finally {
      setUnlocking(false)
    }
  }

  const bestBall = ctx.league.bestBallMode === true

  if (!isCommish) {
    return <p className="text-[13px] text-white/55">{t('lsHub.sp.commishOnly')}</p>
  }

  return (
    <div className="space-y-6" data-testid="league-settings-specialty-tab">
      <header>
        <h3 className="text-[15px] font-bold text-white">{t('lsHub.sp.title')}</h3>
        <p className="mt-1 text-[12px] leading-relaxed text-white/50">{t('lsHub.sp.intro')}</p>
      </header>

      {status === 'loading' ? (
        <div className="space-y-2" aria-busy="true">
          <div className="h-16 animate-pulse rounded-2xl bg-white/[0.05]" />
          <div className="h-10 animate-pulse rounded-2xl bg-white/[0.05]" />
        </div>
      ) : status === 'error' || !state ? (
        <div className="rounded-2xl border border-red-400/20 bg-red-950/20 p-4 text-[13px] text-red-200/85">
          {t('lsHub.sp.loadFailed')}{' '}
          <button type="button" onClick={() => void refresh()} className="font-semibold underline">
            {t('lsHub.sp.retry')}
          </button>
        </div>
      ) : state.formats.length === 0 ? (
        <p className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4 text-[13px] text-white/60">
          {t('lsHub.sp.none')}
        </p>
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5" data-testid="specialty-format-chips">
            {state.formats.map((f) => (
              <span key={f} className="rounded-full border border-fuchsia-400/30 bg-fuchsia-500/10 px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-fuchsia-100">
                {t(`lsHub.sp.fmt.${f}`)}
              </span>
            ))}
          </div>

          <AccessBanner
            state={state}
            confirming={confirming}
            unlocking={unlocking}
            unlockError={unlockError}
            onStartUnlock={() => {
              setUnlockError(null)
              setConfirming(true)
            }}
            onCancel={() => setConfirming(false)}
            onConfirm={() => void unlock()}
          />

          {state.canEdit
            ? state.formats.map((format) => {
                const Section = format === 'guillotine' ? null : SECTIONS[format]
                return (
                  <section key={format} className="space-y-3" data-testid={`specialty-section-${format}`}>
                    <h4 className="text-[12px] font-bold uppercase tracking-wide text-white/55">{t(`lsHub.sp.fmt.${format}`)}</h4>
                    {format === 'guillotine' ? (
                      state.guillotine ? (
                        <GuillotineSettingsForm leagueId={leagueId} initial={state.guillotine} canEdit />
                      ) : (
                        <p className="text-[12px] text-white/50">{t('lsHub.sp.g.noConfig')}</p>
                      )
                    ) : Section ? (
                      <Section ctx={ctx} canEdit coveredBySubscription={state.coveredBySubscription} />
                    ) : null}
                  </section>
                )
              })
            : (
              <ul className="space-y-1.5 text-[12px] text-white/55" data-testid="specialty-locked-preview">
                {state.formats.map((f) => (
                  <li key={f} className="flex items-start gap-2">
                    <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-white/35" aria-hidden />
                    <span>{t(`lsHub.sp.what.${f}`)}</span>
                  </li>
                ))}
              </ul>
            )}
        </>
      )}

      {bestBall ? (
        <section className="space-y-3">
          <h4 className="text-[12px] font-bold uppercase tracking-wide text-white/55">{t('lsHub.cr.bestBallSettings')}</h4>
          <p className="text-[11px] text-white/45">{t('lsHub.sp.bestBallFree')}</p>
          <BestBallSettingsCommissionerPanel leagueId={leagueId} sport={String(ctx.league.sport ?? 'NFL')} canEdit={isCommish} />
        </section>
      ) : null}
    </div>
  )
}

function AccessBanner({
  state,
  confirming,
  unlocking,
  unlockError,
  onStartUnlock,
  onCancel,
  onConfirm,
}: {
  state: SpecialtyState
  confirming: boolean
  unlocking: boolean
  unlockError: { message: string; needTokens: boolean } | null
  onStartUnlock: () => void
  onCancel: () => void
  onConfirm: () => void
}) {
  const { t, language } = useLanguage()

  if (state.coveredBySubscription) {
    return (
      <p className="flex items-center gap-2 rounded-xl border border-emerald-400/20 bg-emerald-950/25 px-3 py-2 text-[12px] text-emerald-100/85" data-testid="specialty-access-plan">
        <Sparkles className="h-3.5 w-3.5" aria-hidden />
        {t('lsHub.sp.coveredByPlan')}
      </p>
    )
  }
  if (!state.paywallLive) {
    const date = new Date(state.paywallStartsAt).toLocaleDateString(language === 'es' ? 'es' : 'en-US', {
      month: 'long',
      day: 'numeric',
      timeZone: 'America/New_York',
    })
    return (
      <p className="flex items-center gap-2 rounded-xl border border-amber-300/20 bg-amber-950/25 px-3 py-2 text-[12px] text-amber-100/85" data-testid="specialty-access-prelaunch">
        <Sparkles className="h-3.5 w-3.5 shrink-0" aria-hidden />
        {t('lsHub.sp.prelaunch').replace('{{date}}', date)}
      </p>
    )
  }
  if (state.unlock) {
    return (
      <p className="flex items-center gap-2 rounded-xl border border-cyan-400/20 bg-cyan-950/25 px-3 py-2 text-[12px] text-cyan-100/85" data-testid="specialty-access-unlocked">
        <Coins className="h-3.5 w-3.5" aria-hidden />
        {t('lsHub.sp.unlockedFor').replace('{{season}}', String(state.unlock.season))}
      </p>
    )
  }

  const cost = state.tokenCost ?? 0
  return (
    <div className="rounded-2xl border border-fuchsia-400/25 bg-gradient-to-br from-fuchsia-950/40 via-[#12163e] to-violet-950/40 p-4" data-testid="specialty-paywall">
      <div className="flex items-center gap-2">
        <Lock className="h-4 w-4 text-fuchsia-200" aria-hidden />
        <p className="text-[14px] font-bold text-white">{t('lsHub.sp.lockedTitle')}</p>
      </div>
      <p className="mt-1.5 text-[12px] leading-relaxed text-white/65">{t('lsHub.sp.lockedBody')}</p>

      {confirming ? (
        <div className="mt-3 rounded-xl border border-white/[0.10] bg-black/30 p-3" data-testid="specialty-unlock-confirm">
          <p className="text-[12px] text-white/80">
            {t('lsHub.sp.confirm').replace('{{n}}', String(cost)).replace('{{season}}', String(state.season))}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onConfirm}
              disabled={unlocking}
              className="rounded-lg bg-cyan-500/90 px-3.5 py-2 text-[12px] font-extrabold text-[#04131a] disabled:opacity-60"
              data-testid="specialty-unlock-confirm-button"
            >
              {unlocking ? t('lsHub.sp.unlocking') : t('lsHub.sp.confirmButton').replace('{{n}}', String(cost))}
            </button>
            <button type="button" onClick={onCancel} disabled={unlocking} className="rounded-lg px-3.5 py-2 text-[12px] font-semibold text-white/60 hover:text-white">
              {t('lsHub.sp.cancel')}
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          <Link
            href={state.upgradePath}
            className="inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-[12px] font-extrabold text-white"
            style={{ background: 'linear-gradient(90deg,#ff3d81,#ff8a3d)' }}
            data-testid="specialty-upgrade-link"
          >
            {t('lsHub.sp.getPlan')}
          </Link>
          {cost > 0 ? (
            <button
              type="button"
              onClick={onStartUnlock}
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/[0.06] px-3.5 py-2 text-[12px] font-bold text-white/90 hover:bg-white/[0.1]"
              data-testid="specialty-unlock-button"
            >
              <Coins className="h-3.5 w-3.5" aria-hidden />
              {t('lsHub.sp.unlockWithTokens').replace('{{n}}', String(cost))}
            </button>
          ) : null}
        </div>
      )}

      {unlockError ? (
        <p className="mt-2 text-[12px] text-amber-200/85" role="alert">
          {unlockError.message}{' '}
          {unlockError.needTokens ? (
            <Link href={`/tokens?ruleCode=${TOKEN_RULE}`} className="font-semibold underline">
              {t('lsHub.sp.buyTokens')}
            </Link>
          ) : null}
        </p>
      ) : null}
    </div>
  )
}
