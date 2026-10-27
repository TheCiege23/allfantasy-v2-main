'use client'

import { useState } from 'react'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'
import { MAX_HOLD_HOURS, holdPositionOptions } from '@/lib/waiver-wire/hold-by-position'

/**
 * The hub's "Waiver period by position" (lib/waiver-wire/hold-by-position.ts): a list of positions
 * with their own after-drop waiver period. Unlisted positions use the league's waiver period. The
 * parent saves `value` as `waiverHoldHoursByPosition`.
 */
export function WaiverHoldByPosition({
  sport,
  value,
  onChange,
  disabled,
  fcfs,
  inputClassName,
  labelClassName,
}: {
  sport: string | null | undefined
  value: Record<string, number>
  onChange: (next: Record<string, number>) => void
  disabled: boolean
  fcfs: boolean
  inputClassName: string
  labelClassName: string
}) {
  const { t } = useLanguage()
  const sub = (key: string, pos: string) => t(key).replace('{{pos}}', pos)
  const listed = Object.keys(value)
  const addable = holdPositionOptions(sport).filter((p) => !listed.includes(p))
  const [pick, setPick] = useState('')
  const chosen = addable.includes(pick) ? pick : (addable[0] ?? '')

  return (
    <div className="space-y-2" data-testid="league-settings-waiver-hold-by-position">
      <p className={labelClassName}>{t('lsHub.wv.byPos')}</p>
      <p className="text-[11px] leading-snug text-white/40">{fcfs ? t('lsHub.wv.byPosFcfs') : t('lsHub.wv.byPosHint')}</p>
      {listed.length === 0 ? (
        <p className="text-[12px] text-white/55">{t('lsHub.wv.byPosNone')}</p>
      ) : (
        <ul className="divide-y divide-white/[0.05] overflow-hidden rounded-xl border border-white/[0.08] bg-black/20">
          {listed.map((pos) => (
            <li key={pos} className="flex items-center gap-3 px-3 py-2">
              <span className="w-12 shrink-0 text-[13px] font-semibold text-white/75">{pos}</span>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                max={MAX_HOLD_HOURS}
                value={value[pos]}
                disabled={disabled}
                aria-label={sub('lsHub.wv.byPosHours', pos)}
                onChange={(e) => {
                  const v = Math.min(MAX_HOLD_HOURS, Math.max(0, Math.round(Number(e.target.value) || 0)))
                  onChange({ ...value, [pos]: v })
                }}
                className={`${inputClassName} flex-1`}
                data-testid={`league-settings-waiver-hold-${pos}`}
              />
              <button
                type="button"
                disabled={disabled}
                aria-label={sub('lsHub.wv.byPosRemove', pos)}
                onClick={() => {
                  const next = { ...value }
                  delete next[pos]
                  onChange(next)
                }}
                className="shrink-0 rounded-lg border border-white/[0.12] px-2.5 py-1.5 text-[12px] text-white/70 hover:bg-white/5 disabled:opacity-50"
                data-testid={`league-settings-waiver-hold-remove-${pos}`}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      {addable.length > 0 ? (
        <div className="flex items-center gap-2">
          <select
            value={chosen}
            disabled={disabled}
            aria-label={t('lsHub.wv.byPosPick')}
            onChange={(e) => setPick(e.target.value)}
            className={`${inputClassName} flex-1`}
            data-testid="league-settings-waiver-hold-pick"
          >
            {addable.map((p) => (
              <option key={p} value={p} className="bg-[#0d1117]">
                {p}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={disabled || !chosen}
            onClick={() => onChange({ ...value, [chosen]: 0 })}
            className="shrink-0 rounded-lg border border-cyan-400/30 px-3 py-2 text-[12px] font-semibold text-cyan-100 hover:bg-cyan-500/10 disabled:opacity-50"
            data-testid="league-settings-waiver-hold-add"
          >
            {t('lsHub.wv.byPosAdd')}
          </button>
        </div>
      ) : null}
    </div>
  )
}
