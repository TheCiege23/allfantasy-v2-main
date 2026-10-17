'use client'

import { ScoringSettingsFullSection } from '@/app/league/[leagueId]/components/ScoringSettingsFullSection'
import { NflScoringSettingsPanel } from '@/components/league-settings/NflScoringSettingsPanel'
import { NbaScoringSettingsPanel } from '@/components/league-settings/NbaScoringSettingsPanel'
import { NcaabScoringSettingsPanel } from '@/components/league-settings/NcaabScoringSettingsPanel'
import { MlbScoringSettingsPanel } from '@/components/league-settings/MlbScoringSettingsPanel'
import { NhlScoringSettingsPanel } from '@/components/league-settings/NhlScoringSettingsPanel'
import { NcaafScoringSettingsPanel } from '@/components/league-settings/NcaafScoringSettingsPanel'
import { SoccerScoringSettingsPanel } from '@/components/league-settings/SoccerScoringSettingsPanel'
import type { LeagueSettingsTabProps } from '../league-settings-tabs-types'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'

/**
 * Exactly ONE sport's editor renders — the league's own sport. There is no football fallback:
 * an NBA league gets the NBA panel (no Passing/Rushing), and an unsupported sport gets a message.
 */
function SportScoringPanel({ sport, leagueId, isCommissioner }: { sport: string; leagueId: string; isCommissioner: boolean }) {
  const { t } = useLanguage()
  const props = { leagueId, isCommissioner }
  switch (String(sport ?? '').trim().toUpperCase()) {
    case 'NFL':
      return <NflScoringSettingsPanel {...props} />
    case 'NBA':
      return <NbaScoringSettingsPanel {...props} />
    case 'NCAAB':
      return <NcaabScoringSettingsPanel {...props} />
    case 'MLB':
      return <MlbScoringSettingsPanel {...props} />
    case 'NHL':
      return <NhlScoringSettingsPanel {...props} />
    case 'NCAAF':
      return <NcaafScoringSettingsPanel {...props} />
    case 'SOCCER':
      return <SoccerScoringSettingsPanel {...props} />
    default:
      return <p className="text-[13px] text-white/45">{t('lsHub.sc.unavailable')}</p>
  }
}

export function ScoringTab({ ctx }: LeagueSettingsTabProps) {
  const sleeperSettingsHref = ctx.sleeperLeagueId
    ? `https://sleeper.com/leagues/${ctx.sleeperLeagueId}/settings`
    : null

  return (
    <div className="min-w-0 space-y-6">
      <SportScoringPanel
        sport={ctx.league.sport}
        leagueId={ctx.league.id}
        isCommissioner={ctx.isCommissioner}
      />
      {/* The host's raw scoring_settings mirror only means something for a host-linked league;
          for a native league it was an empty "no rules" list beside the real editor. */}
      {sleeperSettingsHref ? (
        <ScoringSettingsFullSection
          league={ctx.league}
          sleeperSettingsHref={sleeperSettingsHref}
          showEditLink
        />
      ) : null}
    </div>
  )
}
