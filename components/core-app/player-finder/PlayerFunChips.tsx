'use client'

import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { sparkPath, type Exposure, type Form } from '@/lib/core-app/playerFun'
import { playerFunCopy } from '@/lib/core-app/playerFunCopy'

/**
 * Two chips beside the player's name (2026-10-08, item #5):
 *   - exposure: "6% exposure · Sprinkle" — how much of your fantasy life rides on him;
 *   - form: a six-game sparkline with 🔥 Hot / 🧊 Cold when his last three games run 20% off his season.
 * Pure display over playerFun.ts; each renders nothing when its number is not there.
 */

export function ExposureChip({ exposure }: { exposure: Exposure | null }) {
  const { language } = useOptionalLanguage()
  if (!exposure) return null
  const t = playerFunCopy(language)
  return (
    <span className="af-chip af-num af-pf-exposure" data-tier={exposure.tier} title={t.exposureTitle(exposure.leagues, exposure.of, exposure.pct)}>
      {t.exposure(exposure.pct, exposure.tier)}
    </span>
  )
}

const W = 56
const H = 18

export function FormSpark({ form }: { form: Form | null }) {
  const { language } = useOptionalLanguage()
  if (!form) return null
  const t = playerFunCopy(language)
  const label = t.form(form.call)
  const title = t.formTitle(form.recent, form.season)
  return (
    <span className="af-chip af-num af-pf-form" data-call={form.call} title={title} aria-label={label ? `${label}. ${title}` : title}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden className="af-pf-form-spark">
        <polyline points={sparkPath(form.points, W, H)} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
      {label ? <span>{label}</span> : null}
    </span>
  )
}
