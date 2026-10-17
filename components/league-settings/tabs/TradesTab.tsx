'use client'

import { useEffect, useState } from 'react'
import { useLeagueSettingsSectionAutosave } from '@/hooks/useLeagueSettingsSectionAutosave'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'
import type { LeagueSettingsTabProps } from '../league-settings-tabs-types'

export function TradesTab({ ctx, canEdit }: LeagueSettingsTabProps) {
  const { t } = useLanguage()
  const leagueId = ctx.league.id
  const { queuePatch, saving } = useLeagueSettingsSectionAutosave(leagueId, 'trades', { enabled: canEdit })

  const [tradeReviewHours, setTradeReviewHours] = useState(ctx.league.tradeReviewHours ?? 48)
  const [tradeDeadlineWeek, setTradeDeadlineWeek] = useState(ctx.league.tradeDeadlineWeek ?? 14)
  const [draftPickTrading, setDraftPickTrading] = useState(ctx.league.draftPickTrading ?? true)

  useEffect(() => {
    setTradeReviewHours(ctx.league.tradeReviewHours ?? 48)
    setTradeDeadlineWeek(ctx.league.tradeDeadlineWeek ?? 14)
    setDraftPickTrading(ctx.league.draftPickTrading ?? true)
  }, [ctx.league.tradeReviewHours, ctx.league.tradeDeadlineWeek, ctx.league.draftPickTrading])

  return (
    <div className="space-y-5">
      {saving ? <p className="text-[11px] font-semibold text-cyan-300/80">{t('lsHub.saving')}</p> : null}

      <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-white/[0.08] bg-black/20 px-3 py-3">
        <span className="text-[13px] text-white/85">{t('lsHub.tr.pickTrading')}</span>
        <input
          type="checkbox"
          className="h-4 w-4 accent-cyan-400"
          checked={draftPickTrading}
          disabled={!canEdit}
          onChange={(e) => {
            const v = e.target.checked
            setDraftPickTrading(v)
            queuePatch({ draftPickTrading: v })
          }}
        />
      </label>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-white/40">
            {t('lsHub.tr.review')}
          </span>
          <input
            type="number"
            min={0}
            max={168}
            value={tradeReviewHours}
            disabled={!canEdit}
            onChange={(e) => {
              const v = Number(e.target.value)
              setTradeReviewHours(v)
              queuePatch({ tradeReviewHours: v })
            }}
            className="w-full rounded-xl border border-white/[0.10] bg-black/25 px-3 py-2 text-sm text-white disabled:opacity-50"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-white/40">
            {t('lsHub.tr.deadline')}
          </span>
          <input
            type="number"
            min={1}
            max={18}
            value={tradeDeadlineWeek}
            disabled={!canEdit}
            onChange={(e) => {
              const v = Number(e.target.value)
              setTradeDeadlineWeek(v)
              queuePatch({ tradeDeadlineWeek: v })
            }}
            className="w-full rounded-xl border border-white/[0.10] bg-black/25 px-3 py-2 text-sm text-white disabled:opacity-50"
          />
        </label>
      </div>
    </div>
  )
}
