'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { AccentTone } from '@/lib/create-league-v2/theme'
import type { CreateLeagueV2State } from '@/lib/create-league-v2/state'
import { getEffectiveLeagueType } from '@/lib/create-league-v2/state'
import {
  getDraftTypeOptions,
  getIdpDraftTypeOptions,
  isThirdRoundReversalAvailable,
} from '@/lib/create-league-v2/rules-engine'
import { GlassCard, SectionHeader, Segmented, Toggle } from '@/components/create-league-v2/primitives'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'
import type { DraftTypeId } from '@/lib/league-creation-wizard/types'
import { localizeDraftTypeOption } from '@/lib/i18n/createLeagueWire'
import { getDraftTypeMedia } from '@/lib/league-media/draftTypeMedia'

export function DraftTypeSelector({
  state,
  accent,
  onChange,
  onDraftSectionVisible,
  onDraftUserChange,
  draftError,
}: {
  state: CreateLeagueV2State
  accent: AccentTone
  onChange: (patch: Partial<CreateLeagueV2State>) => void
  onDraftSectionVisible?: (visible: boolean) => void
  /** Fires when the user changes draft format via the control (not auto-correction effects). */
  onDraftUserChange?: () => void
  draftError?: string
}) {
  const { t } = useLanguage()
  const effectiveType = getEffectiveLeagueType(state)
  const draftSectionRef = useRef<HTMLDivElement | null>(null)
  const [draftInView, setDraftInView] = useState(false)

  const draftOptions = useMemo(() => {
    if (!effectiveType) return []
    return state.idpSelected ? getIdpDraftTypeOptions() : getDraftTypeOptions(effectiveType, state.sport)
  }, [effectiveType, state.idpSelected, state.sport])
  const localizedDraftOptions = useMemo(
    () => draftOptions.map((opt) => localizeDraftTypeOption(t, opt)),
    [draftOptions, t],
  )
  const isSnake = state.draftType === 'snake'
  const unlocked = Boolean(effectiveType)
  const hasCurrentDraftType = draftOptions.some((option) => option.id === state.draftType)

  useEffect(() => {
    if (!effectiveType || draftOptions.length === 0 || hasCurrentDraftType) return
    const first = draftOptions[0]?.id
    if (first) onChange({ draftType: first })
  }, [effectiveType, draftOptions, hasCurrentDraftType, onChange, state.draftType])

  useEffect(() => {
    const el = draftSectionRef.current
    if (!el || !onDraftSectionVisible) return
    const io = new IntersectionObserver(
      ([e]) => {
        const v = (e?.intersectionRatio ?? 0) > 0.25
        setDraftInView(v)
        onDraftSectionVisible(v)
      },
      { threshold: [0, 0.15, 0.25, 0.5, 0.75] },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [onDraftSectionVisible])

  return (
    <div ref={draftSectionRef}>
      <GlassCard className={!unlocked ? 'pointer-events-none opacity-40' : ''}>
        <SectionHeader
          title={t('createLeague.section.draftTitle')}
          hint={t('createLeague.section.draftHint')}
        />
        <Segmented
          options={localizedDraftOptions.map((dt) => ({
            value: dt.id,
            label: dt.label,
            hint: dt.hint,
            thumbnailSrc: getDraftTypeMedia(dt.id as DraftTypeId).thumbnail,
          }))}
          value={
            effectiveType && hasCurrentDraftType ? state.draftType : draftOptions[0]?.id ?? 'snake'
          }
          onChange={(draftType) => {
            onDraftUserChange?.()
            onChange({ draftType })
          }}
          accent={accent}
          ariaLabel={t('createLeague.draft.ariaType')}
        />
        {draftError ? (
          <p className="mt-2 text-xs text-rose-300/90" role="alert">
            {draftError}
          </p>
        ) : null}
        {isThirdRoundReversalAvailable(state.draftType) ? (
          <div className="mt-4">
            <Toggle
              checked={state.thirdRoundReversal && isSnake}
              onChange={(v) => onChange({ thirdRoundReversal: v })}
              label={t('createLeague.draft.thirdRoundReversal')}
              description={t('createLeague.draft.thirdRoundReversalDesc')}
              accent={accent}
            />
          </div>
        ) : null}
        {draftInView ? (
          <p className="mt-3 text-[11px] text-white/30" aria-hidden>
            {t('createLeague.draft.previewNote')}
          </p>
        ) : null}
      </GlassCard>
    </div>
  )
}
