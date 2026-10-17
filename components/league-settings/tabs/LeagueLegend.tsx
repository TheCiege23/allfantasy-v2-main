'use client'

import { TrendingDown, TrendingUp } from 'lucide-react'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'

/** Player-status colors match the injury badges used across the app (green → amber → red). */
const STATUSES = [
  { code: 'lsHub.lg.probable', body: 'lsHub.lg.probableBody', tone: 'text-emerald-400' },
  { code: 'lsHub.lg.questionable', body: 'lsHub.lg.questionableBody', tone: 'text-amber-400' },
  { code: 'lsHub.lg.doubtful', body: 'lsHub.lg.doubtfulBody', tone: 'text-red-400' },
  { code: 'lsHub.lg.out', body: 'lsHub.lg.outBody', tone: 'text-red-400' },
  { code: 'lsHub.lg.suspended', body: 'lsHub.lg.suspendedBody', tone: 'text-red-400' },
  { code: 'lsHub.lg.ir', body: 'lsHub.lg.irBody', tone: 'text-red-400' },
] as const

/**
 * League Legend: what the player-status tags and trend arrows mean. (Only what the app actually
 * shows — there is no defense-matchup color coding yet, so the legend does not describe one.)
 */
export function LeagueLegend() {
  const { t } = useLanguage()
  return (
    <div className="space-y-6" data-testid="league-settings-legend">
      <section>
        <h4 className="mb-2 text-[11px] font-bold uppercase tracking-wide text-white/40">{t('lsHub.lg.status')}</h4>
        <ul className="divide-y divide-white/[0.06] rounded-2xl border border-white/[0.08] bg-black/20">
          {STATUSES.map((s) => (
            <li key={s.code} className="px-4 py-3">
              <p className={`text-[11px] font-bold uppercase tracking-wide ${s.tone}`}>{t(s.code)}</p>
              <p className="mt-0.5 text-[13px] text-white/80">{t(s.body)}</p>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h4 className="mb-2 text-[11px] font-bold uppercase tracking-wide text-white/40">{t('lsHub.lg.trending')}</h4>
        <ul className="divide-y divide-white/[0.06] rounded-2xl border border-white/[0.08] bg-black/20">
          <li className="flex gap-3 px-4 py-3">
            <TrendingUp className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" aria-hidden />
            <p className="text-[13px] text-white/80">
              <span className="font-semibold text-white">{t('lsHub.lg.up')}</span> {t('lsHub.lg.upBody')}
            </p>
          </li>
          <li className="flex gap-3 px-4 py-3">
            <TrendingDown className="mt-0.5 h-4 w-4 shrink-0 text-red-400" aria-hidden />
            <p className="text-[13px] text-white/80">
              <span className="font-semibold text-white">{t('lsHub.lg.down')}</span> {t('lsHub.lg.downBody')}
            </p>
          </li>
        </ul>
      </section>
    </div>
  )
}
