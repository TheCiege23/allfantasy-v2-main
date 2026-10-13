'use client'

import { useEffect, useState } from 'react'
import { useLeagueSettingsSectionAutosave } from '@/hooks/useLeagueSettingsSectionAutosave'
import { PlayoffSettingsEditor } from '@/components/league-settings/PlayoffSettingsEditor'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'
import type { LeagueSettingsTabProps } from '../league-settings-tabs-types'
import { HubCard, HubChoices, HubSavingNote, rangeChoices } from './hubFields'

export function PlayoffsTab({ ctx, canEdit }: LeagueSettingsTabProps) {
  const { t } = useLanguage()
  const leagueId = ctx.league.id
  const { queuePatch, saving } = useLeagueSettingsSectionAutosave(leagueId, 'playoffs', { enabled: canEdit })

  const [playoffTeams, setPlayoffTeams] = useState(ctx.league.playoffTeams ?? 6)
  const [playoffStartWeek, setPlayoffStartWeek] = useState(ctx.league.playoffStartWeek ?? 14)
  const [weeksPerRound, setWeeksPerRound] = useState<number>(ctx.league.playoffWeeksPerRound ?? 1)
  const [seeding, setSeeding] = useState<string>(ctx.league.playoffSeedingRule ?? 'default')
  const [lower, setLower] = useState<string>(ctx.league.playoffLowerBracket ?? 'consolation')

  useEffect(() => {
    setPlayoffTeams(ctx.league.playoffTeams ?? 6)
    setPlayoffStartWeek(ctx.league.playoffStartWeek ?? 14)
    setWeeksPerRound(ctx.league.playoffWeeksPerRound ?? 1)
    setSeeding(ctx.league.playoffSeedingRule ?? 'default')
    setLower(ctx.league.playoffLowerBracket ?? 'consolation')
  }, [
    ctx.league.playoffTeams,
    ctx.league.playoffStartWeek,
    ctx.league.playoffWeeksPerRound,
    ctx.league.playoffSeedingRule,
    ctx.league.playoffLowerBracket,
  ])

  const teamCap = ctx.league.leagueSize ?? ctx.league.teams?.length ?? 12
  const teamOptions = rangeChoices(2, Math.max(2, Math.min(teamCap, 16)))
  const weekOptions = rangeChoices(10, 18, (n) => t('lsHub.ro.weekN').replace('{{n}}', String(n)))

  return (
    <div className="space-y-8">
      <HubCard title={t('lsHub.po.quick')} testId="league-settings-playoff-schedule">
        <HubSavingNote saving={saving} text={t('lsHub.saving')} />
        <HubChoices
          label={t('lsHub.po.start')}
          value={playoffStartWeek}
          disabled={!canEdit}
          options={weekOptions}
          onChange={(n) => {
            setPlayoffStartWeek(n)
            queuePatch({ playoffStartWeek: n })
          }}
        />
        <p className="text-[11px] leading-relaxed text-white/45">{t('lsHub.po.week18Hint')}</p>
        <HubChoices
          label={t('lsHub.po.teams')}
          value={playoffTeams}
          disabled={!canEdit}
          options={teamOptions}
          onChange={(n) => {
            setPlayoffTeams(n)
            queuePatch({ playoffTeams: n })
          }}
        />
        <HubChoices
          label={t('lsHub.po.weeksPerRound')}
          value={weeksPerRound}
          disabled={!canEdit}
          options={[
            { value: 1, label: t('lsHub.po.oneWeek'), hint: t('lsHub.po.oneWeekHint') },
            { value: 2, label: t('lsHub.po.twoWeeks'), hint: t('lsHub.po.twoWeeksHint') },
          ]}
          onChange={(n) => {
            setWeeksPerRound(n)
            queuePatch({ playoffWeeksPerRound: n })
          }}
        />
        <HubChoices
          label={t('lsHub.po.seeding')}
          value={seeding}
          disabled={!canEdit}
          options={[
            { value: 'default', label: t('lsHub.po.seedDefault'), hint: t('lsHub.po.seedDefaultHint') },
            { value: 'reseed', label: t('lsHub.po.reseed'), hint: t('lsHub.po.reseedHint') },
          ]}
          onChange={(v) => {
            setSeeding(v)
            queuePatch({ playoffSeedingRule: v })
          }}
        />
        <HubChoices
          label={t('lsHub.po.lower')}
          value={lower}
          disabled={!canEdit}
          options={[
            { value: 'toilet', label: t('lsHub.po.toilet'), hint: t('lsHub.po.toiletHint') },
            { value: 'consolation', label: t('lsHub.po.consolation'), hint: t('lsHub.po.consolationHint') },
            { value: 'none', label: t('lsHub.none') },
          ]}
          onChange={(v) => {
            setLower(v)
            queuePatch({ playoffLowerBracket: v })
          }}
        />
      </HubCard>

      <div>
        <h4 className="mb-2 text-[12px] font-bold uppercase tracking-wide text-white/55">{t('lsHub.po.stages')}</h4>
        <PlayoffSettingsEditor leagueId={leagueId} />
      </div>
    </div>
  )
}
