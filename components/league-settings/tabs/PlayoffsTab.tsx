'use client'

import { useEffect, useState } from 'react'
import { useLeagueSettingsSectionAutosave } from '@/hooks/useLeagueSettingsSectionAutosave'
import { PlayoffSettingsEditor } from '@/components/league-settings/PlayoffSettingsEditor'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'
import { resolvePlayoffStartWeek } from '@/lib/playoff-settings/resolvePlayoffStartWeek'
import { isNativePlatform } from '@/lib/league/isNativeLeague'
import type { LeagueSettingsTabProps } from '../league-settings-tabs-types'
import { TournamentPlayoffsNote, tournamentRunsPlayoffs } from '../TournamentLeagueNotes'

export function PlayoffsTab({ ctx, canEdit }: LeagueSettingsTabProps) {
  const { t } = useLanguage()
  const leagueId = ctx.league.id
  const { queuePatch, saving } = useLeagueSettingsSectionAutosave(leagueId, 'playoffs', { enabled: canEdit })

  const [playoffTeams, setPlayoffTeams] = useState(ctx.league.playoffTeams ?? 6)
  // Native leagues: the quick field is the source of truth for the start week (column, then its JSON
  // copies, then the sport default) and the stage editor below shows it read-only. Imported leagues
  // keep the original seed.
  const native = isNativePlatform(ctx.league.platform)
  const chosenStartWeek = native ? resolvePlayoffStartWeek(ctx.league).week : (ctx.league.playoffStartWeek ?? 14)
  const [playoffStartWeek, setPlayoffStartWeek] = useState(chosenStartWeek)

  useEffect(() => {
    setPlayoffTeams(ctx.league.playoffTeams ?? 6)
    setPlayoffStartWeek(chosenStartWeek)
  }, [ctx.league.playoffTeams, chosenStartWeek])

  const teamCap = ctx.league.leagueSize ?? ctx.league.teams?.length ?? 12

  // A tournament conference league has no league playoffs; its fields would do nothing.
  if (tournamentRunsPlayoffs(ctx.league.settings)) return <TournamentPlayoffsNote settings={ctx.league.settings} />

  return (
    <div className="space-y-8">
      <div className="rounded-2xl border border-white/[0.08] bg-[#0a1228]/90 p-4">
        <h4 className="mb-3 text-[12px] font-bold uppercase tracking-wide text-white/55">{t('lsHub.po.quick')}</h4>
        {saving ? <p className="mb-2 text-[11px] text-cyan-300/80">{t('lsHub.saving')}</p> : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-white/40">
              {t('lsHub.po.teams')}
            </span>
            <input
              type="number"
              min={2}
              max={teamCap}
              value={playoffTeams}
              disabled={!canEdit}
              onChange={(e) => {
                const v = Number(e.target.value)
                setPlayoffTeams(v)
                queuePatch({ playoffTeams: v })
              }}
              className="w-full rounded-xl border border-white/[0.10] bg-black/25 px-3 py-2 text-sm text-white disabled:opacity-50"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-white/40">
              {t('lsHub.po.start')}
            </span>
            <input
              type="number"
              min={10}
              max={18}
              value={playoffStartWeek}
              disabled={!canEdit}
              onChange={(e) => {
                const v = Number(e.target.value)
                setPlayoffStartWeek(v)
                queuePatch({ playoffStartWeek: v })
              }}
              className="w-full rounded-xl border border-white/[0.10] bg-black/25 px-3 py-2 text-sm text-white disabled:opacity-50"
            />
          </label>
        </div>
      </div>

      <div>
        <h4 className="mb-2 text-[12px] font-bold uppercase tracking-wide text-white/55">{t('lsHub.po.stages')}</h4>
        <PlayoffSettingsEditor leagueId={leagueId} playoffStartWeek={native ? playoffStartWeek : undefined} />
      </div>
    </div>
  )
}
