'use client'

import { useState } from 'react'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'
import { DYNASTY_FORMAT_UI_COPY, dynastyFormatLang, dynastySportPresetCopy } from '@/lib/i18n/dynasty-format-copy'
import type { DynastySettingsSnapshot } from './useDynastySettingsSnapshot'
import { SettingsHelper, SettingsSectionLabel, controlClassSm } from './settings-ui'

/**
 * Pre-draft switch between the NBA / NHL / MLB dynasty format presets. Renders nothing for a sport
 * without presets. Applying goes through PUT /api/leagues/[id]/dynasty-settings `{ sportPresetId }`,
 * which refuses once the draft has started; the control is disabled then too.
 */
export function DynastyFormatPresetSection({
  canEdit,
  dynasty,
  saveDynasty,
  onApplied,
}: {
  canEdit: boolean
  dynasty: DynastySettingsSnapshot | null
  saveDynasty: (body: Record<string, unknown>) => Promise<{ ok: boolean; error?: string }>
  onApplied?: () => void
}) {
  const { language } = useLanguage()
  const lang = dynastyFormatLang(language)
  const copy = DYNASTY_FORMAT_UI_COPY[lang]
  const presets = dynasty?.presets?.sportFormats ?? []
  const current = dynasty?.sportFormatPreset?.current ?? null
  const editable = Boolean(dynasty?.sportFormatPreset?.editable) && canEdit
  const firstId = presets[0]?.id ?? ''
  const [selection, setSelection] = useState<{ current: string | null; firstId: string; choice: string } | null>(null)
  // Derive the initial choice during render so a late initialization effect cannot
  // overwrite a manager's selection immediately after settings finish loading.
  const choice = selection?.current === current && selection.firstId === firstId
    ? selection.choice
    : current ?? firstId
  const [state, setState] = useState<'idle' | 'applying' | 'applied' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)

  if (presets.length === 0) return null

  const apply = async () => {
    if (!editable || !choice) return
    setState('applying')
    setError(null)
    const result = await saveDynasty({ sportPresetId: choice })
    if (result.ok) {
      setState('applied')
      onApplied?.()
    } else {
      setState('error')
      setError(result.error ?? copy.failed)
    }
  }

  return (
    <section
      className="space-y-3 rounded-2xl border border-white/10 bg-white/[0.025] p-4"
      data-testid="dynasty-format-preset-section"
    >
      <SettingsSectionLabel>{copy.editTitle}</SettingsSectionLabel>
      <div className="flex flex-wrap items-center gap-2">
        <select
          className={controlClassSm}
          disabled={!editable || state === 'applying'}
          value={choice}
          onChange={(e) => { setSelection({ current, firstId, choice: e.target.value }); setState('idle') }}
          data-testid="dynasty-format-preset-select"
        >
          {presets.map((p) => (
            <option key={p.id} value={p.id}>
              {dynastySportPresetCopy(p.id, lang).label}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={!editable || state === 'applying'}
          onClick={() => void apply()}
          className="rounded-full border border-white/15 bg-white/10 px-3 py-2 text-[12px] font-semibold text-white transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-40"
          data-testid="dynasty-format-preset-apply"
        >
          {state === 'applying' ? copy.applying : copy.apply}
        </button>
        {state === 'applied' ? <span className="text-[12px] text-teal-300">{copy.applied}</span> : null}
      </div>
      {choice ? <SettingsHelper>{dynastySportPresetCopy(choice, lang).hint}</SettingsHelper> : null}
      <SettingsHelper>{editable ? copy.editHelp : copy.locked}</SettingsHelper>
      {error ? <p role="alert" className="text-[12px] text-rose-300">{error}</p> : null}
    </section>
  )
}
