'use client'

import { useEffect, useState } from 'react'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'
import { readSavedLeagueOverrides } from '@/lib/league-settings/savedLeagueOverrides'
import {
  DEFAULT_TIEBREAKER_ORDER,
  moveTiebreaker,
  parseTiebreakerOrder,
  readTiebreakerOrder,
  TIEBREAKER_LABELS,
  type TiebreakerKey,
} from '@/lib/standings/tiebreakerOrder'

/**
 * The commissioner's tiebreaker order (lib/standings/tiebreakerOrder.ts): what separates teams level
 * on record, for the standings and the playoff seeds. AllFantasy-run leagues only — an imported
 * league follows its platform's rule. A Commissioner-plan setting; going back to the default is free.
 */
export function TiebreakerOrderEditor({
  leagueId,
  settings,
  canEdit,
  hasPlan,
  queuePatch,
}: {
  leagueId: string
  settings: unknown
  canEdit: boolean
  hasPlan: boolean
  queuePatch: (updates: Record<string, unknown>) => void
}) {
  const { t, language } = useLanguage()
  const lang = language === 'es' ? 'es' : 'en'

  const seed = (): TiebreakerKey[] | null => {
    const saved = readSavedLeagueOverrides(leagueId)
    if ('tiebreakerOrder' in saved) {
      const parsed = parseTiebreakerOrder(saved.tiebreakerOrder)
      return parsed.ok ? parsed.value : null
    }
    return readTiebreakerOrder(settings)
  }
  const [custom, setCustom] = useState<TiebreakerKey[] | null>(seed)
  useEffect(() => {
    setCustom(seed())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueId, settings])

  const order = custom ?? [...DEFAULT_TIEBREAKER_ORDER]
  const editable = canEdit && hasPlan
  const save = (next: TiebreakerKey[] | null) => {
    setCustom(next)
    queuePatch({ tiebreakerOrder: next })
  }

  return (
    <div className="rounded-2xl border border-white/[0.08] bg-[#0a1228]/90 p-4" data-testid="tiebreaker-order">
      <h4 className="mb-1 text-[12px] font-bold uppercase tracking-wide text-white/55">{t('lsHub.po.tiebreakers')}</h4>
      <p className="mb-3 text-[11px] text-white/45">{t('lsHub.po.tiebreakersHint')}</p>
      <ol className="space-y-1.5">
        <li className="flex items-center gap-2 rounded-xl border border-white/[0.06] bg-black/20 px-3 py-2 text-[13px] text-white/60">
          <span className="w-5 text-right text-[11px] text-white/35">1</span>
          <span className="flex-1">{t('lsHub.po.tiebreakersRecord')}</span>
        </li>
        {order.map((key, i) => (
          <li key={key} className="flex items-center gap-2 rounded-xl border border-white/[0.08] bg-black/20 px-3 py-2 text-[13px] text-white/85" data-testid="tiebreaker-row">
            <span className="w-5 text-right text-[11px] text-white/35">{i + 2}</span>
            <span className="flex-1">{TIEBREAKER_LABELS[key][lang]}</span>
            {editable ? (
              <>
                <button
                  type="button"
                  aria-label={`${t('lsHub.po.tiebreakersUp')}: ${TIEBREAKER_LABELS[key][lang]}`}
                  disabled={i === 0}
                  onClick={() => save(moveTiebreaker(order, key, -1))}
                  className="rounded-lg border border-white/[0.10] px-2 py-0.5 text-white/70 disabled:opacity-30"
                >
                  ↑
                </button>
                <button
                  type="button"
                  aria-label={`${t('lsHub.po.tiebreakersDown')}: ${TIEBREAKER_LABELS[key][lang]}`}
                  disabled={i === order.length - 1}
                  onClick={() => save(moveTiebreaker(order, key, 1))}
                  className="rounded-lg border border-white/[0.10] px-2 py-0.5 text-white/70 disabled:opacity-30"
                >
                  ↓
                </button>
              </>
            ) : null}
          </li>
        ))}
      </ol>
      {custom && canEdit ? (
        <button type="button" onClick={() => save(null)} className="mt-3 text-[12px] font-semibold text-cyan-300 underline">
          {t('lsHub.po.tiebreakersReset')}
        </button>
      ) : null}
      {canEdit && !hasPlan ? (
        <p className="mt-3 text-[11px] text-white/55">
          {t('lsHub.po.tiebreakersPlan')}{' '}
          <a href="/upgrade?plan=commissioner" className="font-semibold text-violet-300 underline">
            {t('lsHub.po.tiebreakersUpgrade')}
          </a>
        </p>
      ) : null}
    </div>
  )
}
