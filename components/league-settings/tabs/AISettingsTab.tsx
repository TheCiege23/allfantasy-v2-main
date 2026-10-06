'use client'

import { useEffect, useState } from 'react'
import { Lock } from 'lucide-react'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'
import { useLeagueSettingsSectionAutosave } from '@/hooks/useLeagueSettingsSectionAutosave'
import type { LeagueSettingsTabProps } from '../league-settings-tabs-types'

function Row({
  label,
  hint,
  checked,
  disabled,
  locked,
  onChange,
}: {
  label: string
  hint: string
  checked: boolean
  disabled: boolean
  locked?: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label
      className={`flex items-start justify-between gap-3 rounded-xl border border-white/[0.08] px-3 py-3 ${
        locked ? 'bg-white/[0.02] opacity-70' : 'bg-black/20'
      }`}
    >
      <div>
        <div className="flex items-center gap-2 text-[13px] font-medium text-white/90">
          {label}
          {locked ? <Lock className="h-3.5 w-3.5 text-amber-300/90" aria-hidden /> : null}
        </div>
        <p className="mt-0.5 text-[11px] text-white/45">{hint}</p>
      </div>
      <input
        type="checkbox"
        className="mt-1 h-4 w-4 accent-cyan-400"
        checked={checked}
        disabled={disabled || locked}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  )
}

export function AISettingsTab({ ctx, canEdit, hasAfCommissionerSub }: LeagueSettingsTabProps) {
  const { t } = useLanguage()
  const leagueId = ctx.league.id
  const { queuePatch, saving } = useLeagueSettingsSectionAutosave(leagueId, 'ai', { enabled: canEdit })

  const [chimmy, setChimmy] = useState(ctx.league.aiChimmyEnabled ?? true)
  const [waiver, setWaiver] = useState(ctx.league.aiWaiverSuggestions ?? true)
  const [trade, setTrade] = useState(ctx.league.aiTradeAnalysis ?? true)
  const [lineup, setLineup] = useState(ctx.league.aiLineupHelp ?? true)
  const [draftRecs, setDraftRecs] = useState(ctx.league.aiDraftRecs ?? true)

  useEffect(() => {
    setChimmy(ctx.league.aiChimmyEnabled ?? true)
    setWaiver(ctx.league.aiWaiverSuggestions ?? true)
    setTrade(ctx.league.aiTradeAnalysis ?? true)
    setLineup(ctx.league.aiLineupHelp ?? true)
    setDraftRecs(ctx.league.aiDraftRecs ?? true)
  }, [
    ctx.league.aiChimmyEnabled,
    ctx.league.aiWaiverSuggestions,
    ctx.league.aiTradeAnalysis,
    ctx.league.aiLineupHelp,
    ctx.league.aiDraftRecs,
  ])

  const premiumLocked = !hasAfCommissionerSub

  return (
    <div className="space-y-4">
      {saving ? <p className="text-[11px] font-semibold text-cyan-300/80">{t('lsHub.saving')}</p> : null}
      <p className="text-[12px] text-white/45">
        {t('lsHub.ai.intro')}
      </p>

      <Row
        label={t('lsHub.ai.helper')}
        hint={t('lsHub.ai.helperHint')}
        checked={chimmy}
        disabled={!canEdit}
        onChange={(v) => {
          setChimmy(v)
          queuePatch({ aiChimmyEnabled: v })
        }}
      />
      <Row
        label={t('lsHub.ai.waiver')}
        hint={t('lsHub.ai.waiverHint')}
        checked={waiver}
        disabled={!canEdit}
        locked={premiumLocked}
        onChange={(v) => {
          setWaiver(v)
          queuePatch({ aiWaiverSuggestions: v })
        }}
      />
      <Row
        label={t('lsHub.ai.trade')}
        hint={t('lsHub.ai.tradeHint')}
        checked={trade}
        disabled={!canEdit}
        locked={premiumLocked}
        onChange={(v) => {
          setTrade(v)
          queuePatch({ aiTradeAnalysis: v })
        }}
      />
      <Row
        label={t('lsHub.ai.engagement')}
        hint={t('lsHub.ai.engagementHint')}
        checked={lineup}
        disabled={!canEdit}
        locked={premiumLocked}
        onChange={(v) => {
          setLineup(v)
          queuePatch({ aiLineupHelp: v })
        }}
      />
      <Row
        label={t('lsHub.ai.draft')}
        hint={t('lsHub.ai.draftHint')}
        checked={draftRecs}
        disabled={!canEdit}
        locked={premiumLocked}
        onChange={(v) => {
          setDraftRecs(v)
          queuePatch({ aiDraftRecs: v })
        }}
      />
    </div>
  )
}
