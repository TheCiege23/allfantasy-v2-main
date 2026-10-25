'use client'

import { useEffect, useState } from 'react'
import { AutosaveStatus } from '@/components/league-settings/AutosaveStatus'
import { useLeagueSettingsSectionAutosave } from '@/hooks/useLeagueSettingsSectionAutosave'
import { PlayoffSettingsEditor } from '@/components/league-settings/PlayoffSettingsEditor'
import { PlayoffBracketFormatCard } from '@/components/league-settings/PlayoffBracketFormatCard'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'
import { resolvePlayoffStartWeek } from '@/lib/playoff-settings/resolvePlayoffStartWeek'
import { tryGetSportConfig } from '@/lib/sportConfig'
import { isNativePlatform } from '@/lib/league/isNativeLeague'
import { MAX_PLAYOFF_TEAMS, maxPlayoffTeamsThatFit } from '@/lib/playoff-runtime/playoffFit'
import { readChampionshipLength } from '@/lib/playoff-runtime/playoffRoundWeeks'
import { readMedianGameInPlayoffs } from '@/lib/redraft/medianGame'
import { savedOr } from '@/lib/league-settings/savedLeagueOverrides'
import type { LeagueSettingsTabProps } from '../league-settings-tabs-types'
import { TournamentPlayoffsNote, tournamentRunsPlayoffs } from '../TournamentLeagueNotes'
import { TiebreakerOrderEditor } from '../TiebreakerOrderEditor'

export function PlayoffsTab({ ctx, canEdit, hasAfCommissionerSub }: LeagueSettingsTabProps) {
  const { t } = useLanguage()
  const leagueId = ctx.league.id
  const { queuePatch, saving, savedAt, lastError } = useLeagueSettingsSectionAutosave(leagueId, 'playoffs', { enabled: canEdit })

  const [playoffTeams, setPlayoffTeams] = useState(ctx.league.playoffTeams ?? 6)
  // Native leagues: the quick field is the source of truth for the start week (column, then its JSON
  // copies, then the sport default) and the stage editor below shows it read-only. Imported leagues
  // keep the original seed.
  const native = isNativePlatform(ctx.league.platform)
  const chosenStartWeek = native ? resolvePlayoffStartWeek(ctx.league).week : (ctx.league.playoffStartWeek ?? 14)
  const [playoffStartWeek, setPlayoffStartWeek] = useState(chosenStartWeek)

  // The league median game itself. Its own save, so a refusal (the server locks it once the season's
  // first week is final, lib/redraft/medianGameSwitch.ts) puts back only this switch.
  const medianSave = useLeagueSettingsSectionAutosave(leagueId, 'playoffs', { enabled: canEdit })
  const storedMedianGame = savedOr(leagueId, 'medianGame', ctx.league.medianGame === true) === true
  const [medianGame, setMedianGame] = useState(storedMedianGame)
  useEffect(() => setMedianGame(storedMedianGame), [storedMedianGame])
  useEffect(() => {
    if (medianSave.lastError && !medianSave.manual) setMedianGame(storedMedianGame)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [medianSave.lastError])
  // A median of category results means nothing, so it is offered to points leagues (and to any league
  // that already has it on, so it can be turned off).
  const settingsObj = (ctx.league.settings ?? {}) as Record<string, unknown>
  const pointsLeague = String(settingsObj.scoring_mode ?? settingsObj.scoringMode ?? 'points').toLowerCase() === 'points'
  const offerMedianGame = pointsLeague || storedMedianGame

  // Off unless the commissioner turned it on (lib/redraft/medianGame.ts); only offered with the median game on.
  const storedMedianInPlayoffs = readMedianGameInPlayoffs(ctx.league.settings)
  const [medianInPlayoffs, setMedianInPlayoffs] = useState(storedMedianInPlayoffs)

  useEffect(() => {
    setPlayoffTeams(ctx.league.playoffTeams ?? 6)
    setPlayoffStartWeek(chosenStartWeek)
  }, [ctx.league.playoffTeams, chosenStartWeek])
  useEffect(() => setMedianInPlayoffs(storedMedianInPlayoffs), [storedMedianInPlayoffs])

  const seasonWeeks = tryGetSportConfig(String(ctx.league.sport ?? 'NFL'))?.defaultSeasonWeeks ?? 52
  const startWeekMax = Math.max(18, seasonWeeks, chosenStartWeek)
  const leagueCap = Math.min(ctx.league.leagueSize ?? ctx.league.teams?.length ?? 12, MAX_PLAYOFF_TEAMS)
  // A field whose final would land after the season's last week never completes, and the server refuses
  // it (lib/playoff-runtime/championshipLengthFit.ts) — so it is not offered. A dynasty season is sized
  // to its bracket instead, so only the league and the engine's 16 bound it.
  const fitCap = ctx.league.isDynasty
    ? leagueCap
    : maxPlayoffTeamsThatFit({
        seasonWeeks,
        playoffStartWeek,
        weeksPerRound: ctx.league.playoffWeeksPerRound,
        championshipLength: readChampionshipLength(ctx.league.settings),
        leagueSize: leagueCap,
      })
  const teamCap = Math.max(2, Math.min(leagueCap, fitCap))

  // A tournament conference league has no league playoffs; its fields would do nothing.
  if (tournamentRunsPlayoffs(ctx.league.settings)) return <TournamentPlayoffsNote settings={ctx.league.settings} />

  return (
    <div className="space-y-8">
      <div className="rounded-2xl border border-white/[0.08] bg-[#0a1228]/90 p-4">
        <h4 className="mb-3 text-[12px] font-bold uppercase tracking-wide text-white/55">{t('lsHub.po.quick')}</h4>
        <p className="mb-2"><AutosaveStatus saving={saving} savedAt={savedAt} error={lastError} /></p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
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
                if (e.target.value !== '' && e.target.validity.valid && Number.isInteger(v)) queuePatch({ playoffTeams: v })
              }}
              className="w-full rounded-xl border border-white/[0.10] bg-black/25 px-3 py-2 text-sm text-white disabled:opacity-50"
            />
          </label>
          {fitCap < leagueCap ? (
            <p className="mt-1 text-[11px] text-white/45" data-testid="playoff-teams-fit-note">
              {fitCap >= 2
                ? `At most ${fitCap} fit with playoffs starting in week ${playoffStartWeek}.`
                : `No bracket fits with playoffs starting in week ${playoffStartWeek}.`}
            </p>
          ) : null}
          </div>
          <label className="block">
            <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-white/40">
              {t('lsHub.po.start')}
            </span>
            <input
              type="number"
              min={1}
              max={startWeekMax}
              value={playoffStartWeek}
              disabled={!canEdit}
              onChange={(e) => {
                const v = Number(e.target.value)
                setPlayoffStartWeek(v)
                if (e.target.value !== '' && e.target.validity.valid && Number.isInteger(v)) queuePatch({ playoffStartWeek: v })
              }}
              className="w-full rounded-xl border border-white/[0.10] bg-black/25 px-3 py-2 text-sm text-white disabled:opacity-50"
            />
          </label>
        </div>
        {offerMedianGame ? (
          <label
            className="mt-4 flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-white/[0.08] bg-black/20 px-3 py-3"
            data-testid="median-game-toggle"
          >
            <span className="min-w-0">
              <span className="block text-[13px] text-white/85">{t('lsHub.po.medianGame')}</span>
              <span className="mt-0.5 block text-[11px] text-white/45">{t('lsHub.po.medianGameHelp')}</span>
              {medianSave.lastError ? (
                <span role="alert" className="mt-1 block text-[11px] text-red-300">{medianSave.lastError}</span>
              ) : null}
            </span>
            <input
              type="checkbox"
              className="h-4 w-4 accent-cyan-400"
              checked={medianGame}
              disabled={!canEdit}
              onChange={(e) => {
                const v = e.target.checked
                setMedianGame(v)
                medianSave.queuePatch({ medianGame: v })
              }}
            />
          </label>
        ) : null}
        {medianGame ? (
          <label
            className="mt-4 flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-white/[0.08] bg-black/20 px-3 py-3"
            data-testid="median-in-playoffs-toggle"
          >
            <span className="min-w-0">
              <span className="block text-[13px] text-white/85">{t('lsHub.po.medianPlayoffs')}</span>
              <span className="mt-0.5 block text-[11px] text-white/45">{t('lsHub.po.medianPlayoffsHelp')}</span>
            </span>
            <input
              type="checkbox"
              className="h-4 w-4 accent-cyan-400"
              checked={medianInPlayoffs}
              disabled={!canEdit}
              onChange={(e) => {
                const v = e.target.checked
                setMedianInPlayoffs(v)
                queuePatch({ medianGameInPlayoffs: v })
              }}
            />
          </label>
        ) : null}
      </div>

      {native ? <PlayoffBracketFormatCard leagueId={leagueId} playoffTeams={playoffTeams} canEdit={canEdit} /> : null}
      {native ? (
        <TiebreakerOrderEditor
          leagueId={leagueId}
          settings={ctx.league.settings}
          canEdit={canEdit}
          hasPlan={hasAfCommissionerSub || Boolean(ctx.hasAfCommissionerSub)}
          queuePatch={queuePatch}
        />
      ) : null}

      <div>
        <h4 className="mb-2 text-[12px] font-bold uppercase tracking-wide text-white/55">{t('lsHub.po.stages')}</h4>
        <PlayoffSettingsEditor leagueId={leagueId} playoffStartWeek={native ? playoffStartWeek : undefined} />
      </div>
    </div>
  )
}
