'use client'

/**
 * Shared scoring-preset picker for every sport's commissioner scoring panel.
 *
 * A single native <select> instead of a row of 5–9 chips: it fits a 360px screen, lists only the
 * presets THIS sport's panel passes in (so an NBA league can never be offered an NFL preset), and
 * puts the Sleeper-style preset first, marked as the default.
 */
import { Lock } from 'lucide-react'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'

export interface ScoringPresetSelectProps<K extends string> {
  /** This sport's preset keys, in the panel's own order. */
  presetKeys: readonly K[]
  value: K
  onChange: (key: K) => void
  /** Dictionary-resolved label for a key. */
  labelFor: (key: K) => string
  /** The Sleeper-style preset key for this sport — listed first and marked "(Default)". */
  defaultKey?: K
  isCommissioner: boolean
  isPremium: boolean
  /** Shown under the select (e.g. "Sleeper is the default — save to apply it"). */
  hint?: string | null
  id?: string
}

/** Sleeper-style preset first, everything else in the panel's order. */
export function orderPresetKeys<K extends string>(keys: readonly K[], defaultKey?: K): K[] {
  if (!defaultKey || !keys.includes(defaultKey)) return [...keys]
  return [defaultKey, ...keys.filter((k) => k !== defaultKey)]
}

/**
 * The preset a panel should open on. A league whose scoring was never saved (`lastUpdatedAt`
 * null — the service is serving its built-in fallback) opens on the Sleeper-style default, with
 * that preset's rules staged so Save applies it. A saved choice is always respected.
 */
export function pickInitialPreset<K extends string>(
  config: { presetKey?: string | null; lastUpdatedAt?: string | null } | null | undefined,
  presets: Array<{ key: string; rules?: Record<string, number> }> | null | undefined,
  defaultKey: K,
  fallbackKey: K,
  /** Only a commissioner can stage the default; a viewer must see what is actually live. */
  canStage = true,
): { key: K; stagedRules: Record<string, number> | null } {
  const saved = (config?.presetKey ?? null) as K | null
  const neverSaved = !config || config.lastUpdatedAt == null
  const sleeper = (presets ?? []).find((p) => p.key === defaultKey)
  if (canStage && neverSaved && sleeper && (saved == null || saved === fallbackKey)) {
    return { key: defaultKey, stagedRules: sleeper.rules ?? {} }
  }
  return { key: saved ?? fallbackKey, stagedRules: null }
}

export function ScoringPresetSelect<K extends string>({
  presetKeys,
  value,
  onChange,
  labelFor,
  defaultKey,
  isCommissioner,
  isPremium,
  hint,
  id = 'scoring-preset-select',
}: ScoringPresetSelectProps<K>) {
  const { t } = useOptionalLanguage()
  const keys = orderPresetKeys(presetKeys, defaultKey)
  const customLocked = !isPremium && isCommissioner
  return (
    <div className="af-ls-card space-y-2">
      <label htmlFor={id} className="af-ls-eyebrow block">{t('lsScore.presetHeading')}</label>
      <div className="relative flex min-w-0 items-center">
        <select
          id={id}
          value={value}
          disabled={!isCommissioner}
          onChange={(e) => onChange(e.target.value as K)}
          aria-label={t('lsScore2.presetAria')}
          data-testid="scoring-preset-select"
          className="w-full min-w-0 truncate rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-[13px] font-medium text-white outline-none focus:border-cyan-500/50 disabled:cursor-default disabled:opacity-70"
        >
          {keys.map((key) => {
            const base = labelFor(key)
            const label = key === defaultKey ? t('lsScore2.defaultSuffix').replace('{{label}}', base) : base
            return (
              <option key={key} value={key}>
                {key === 'custom' && customLocked ? `${label} 🔒` : label}
              </option>
            )
          })}
        </select>
        {value === 'custom' && customLocked ? (
          <Lock className="pointer-events-none absolute right-8 h-3.5 w-3.5 text-white/40" aria-hidden />
        ) : null}
      </div>
      {hint ? <p className="text-[12px] leading-snug text-white/60">{hint}</p> : null}
    </div>
  )
}
