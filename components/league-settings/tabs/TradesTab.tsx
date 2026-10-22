'use client'

import { useEffect, useState } from 'react'
import { AutosaveStatus } from '@/components/league-settings/AutosaveStatus'
import { useLeagueSettingsSectionAutosave } from '@/hooks/useLeagueSettingsSectionAutosave'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'
import { readSavedLeagueOverrides } from '@/lib/league-settings/savedLeagueOverrides'
import { DEFAULT_LEAGUE_TIMEZONE, timeZoneShortName } from '@/lib/timezone'
import { fromLocalInput, readDeadlineAt, toLocalInput, TRADE_DEADLINE_AT_KEY } from '@/lib/trade-deadline/tradeDeadlineTime'
import { tryGetSportConfig } from '@/lib/sportConfig'
import type { LeagueSettingsTabProps } from '../league-settings-tabs-types'

export function TradesTab({ ctx, canEdit }: LeagueSettingsTabProps) {
  const { t } = useLanguage()
  const leagueId = ctx.league.id
  const { queuePatch, saving, savedAt, lastError } = useLeagueSettingsSectionAutosave(leagueId, 'trades', { enabled: canEdit })

  const [tradeReviewHours, setTradeReviewHours] = useState(ctx.league.tradeReviewHours ?? 48)
  const [tradeDeadlineWeek, setTradeDeadlineWeek] = useState(ctx.league.tradeDeadlineWeek?.toString() ?? '')
  const [draftPickTrading, setDraftPickTrading] = useState(ctx.league.draftPickTrading ?? true)

  // The close time is an instant; the field shows and takes it as wall-clock time in the LEAGUE's
  // timezone, whatever the viewer's browser zone is (lib/trade-deadline/tradeDeadlineTime.ts).
  const timezone = ctx.league.timezone || DEFAULT_LEAGUE_TIMEZONE
  const seedCloseAt = () => {
    const saved = readSavedLeagueOverrides(leagueId).settingsMerge as Record<string, unknown> | undefined
    const settings = saved && TRADE_DEADLINE_AT_KEY in saved ? saved : ctx.league.settings
    return toLocalInput(readDeadlineAt(settings), timezone)
  }
  const [closeAt, setCloseAt] = useState(seedCloseAt)
  const [savedCloseAt, setSavedCloseAt] = useState(seedCloseAt)

  useEffect(() => {
    setTradeReviewHours(ctx.league.tradeReviewHours ?? 48)
    setTradeDeadlineWeek(ctx.league.tradeDeadlineWeek?.toString() ?? '')
    setDraftPickTrading(ctx.league.draftPickTrading ?? true)
    setCloseAt(seedCloseAt())
    setSavedCloseAt(seedCloseAt())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.league.tradeReviewHours, ctx.league.tradeDeadlineWeek, ctx.league.draftPickTrading, ctx.league.settings, timezone])

  const saveCloseAt = (local: string) => {
    setCloseAt(local)
    if (local === savedCloseAt) return
    const iso = local ? fromLocalInput(local, timezone) : null
    if (local && !iso) return
    setSavedCloseAt(local)
    queuePatch({ settingsMerge: { [TRADE_DEADLINE_AT_KEY]: iso } })
  }

  const seasonWeeks = tryGetSportConfig(String(ctx.league.sport ?? 'NFL'))?.defaultSeasonWeeks ?? 52
  const deadlineMax = Math.max(18, seasonWeeks, ctx.league.tradeDeadlineWeek ?? 0)

  return (
    <div className="space-y-5">
      <p><AutosaveStatus saving={saving} savedAt={savedAt} error={lastError} /></p>

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
              if (e.target.value !== '' && e.target.validity.valid && Number.isInteger(v)) queuePatch({ tradeReviewHours: v })
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
            max={deadlineMax}
            placeholder={t('lsHub.tr.noDeadline')}
            value={tradeDeadlineWeek}
            disabled={!canEdit}
            onChange={(e) => {
              const v = e.target.value
              setTradeDeadlineWeek(v)
              if (v === '' || (e.target.validity.valid && Number.isInteger(Number(v)))) {
                queuePatch({ tradeDeadlineWeek: v === '' ? null : Number(v) })
              }
            }}
            className="w-full rounded-xl border border-white/[0.10] bg-black/25 px-3 py-2 text-sm text-white disabled:opacity-50"
          />
        </label>
      </div>

      <div className="block">
        <label htmlFor="trade-close-at" className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-white/40">
          {t('lsHub.tr.closeAt')}
        </label>
        <div className="flex gap-2">
          <input
            id="trade-close-at"
            type="datetime-local"
            value={closeAt}
            disabled={!canEdit}
            // Saved on blur: a half-typed datetime-local reads as '', which would clear a real close time.
            onChange={(e) => setCloseAt(e.target.value)}
            onBlur={(e) => saveCloseAt(e.target.value)}
            data-testid="trade-close-at"
            className="min-w-0 flex-1 rounded-xl border border-white/[0.10] bg-black/25 px-3 py-2 text-sm text-white disabled:opacity-50"
          />
          {closeAt && canEdit ? (
            <button
              type="button"
              onClick={() => saveCloseAt('')}
              className="rounded-xl border border-white/[0.10] px-3 py-2 text-[12px] font-semibold text-white/70 hover:text-white"
            >
              {t('lsHub.tr.closeAtClear')}
            </button>
          ) : null}
        </div>
        <p className="mt-1 text-[11px] text-white/45">
          {t('lsHub.tr.closeAtHint')} {timeZoneShortName(timezone)}
        </p>
      </div>
    </div>
  )
}
