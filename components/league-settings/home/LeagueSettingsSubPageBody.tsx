'use client'

import '@/components/league/league-admin.css'

import type { ReactNode } from 'react'
import type { SubPanelContext } from '@/app/league/[leagueId]/components/LeagueSettingsSubPanels'
import type { SettingsSubPageId } from '@/lib/league-settings-home/buildLeagueSettingsHome'
import { GeneralTab } from '@/components/league-settings/tabs/GeneralTab'
import { ConceptRulesTab } from '@/components/league-settings/tabs/ConceptRulesTab'
import { RostersTab } from '@/components/league-settings/tabs/RostersTab'
import { ScoringTab } from '@/components/league-settings/tabs/ScoringTab'
import { DraftTab } from '@/components/league-settings/tabs/DraftTab'
import { WaiversTab } from '@/components/league-settings/tabs/WaiversTab'
import { TradesTab } from '@/components/league-settings/tabs/TradesTab'
import { PlayoffsTab } from '@/components/league-settings/tabs/PlayoffsTab'
import { MemberSettingsCommissionerPanel } from '@/components/league-settings/MemberSettingsCommissionerPanel'
import { CoOwnerSettingsPanel } from '@/components/league-settings/CoOwnerSettingsPanel'
import { DivisionSettingsCommissionerPanel } from '@/components/league-settings/DivisionSettingsCommissionerPanel'
import { CommissionerControlPanel } from '@/components/league-settings/CommissionerControlPanel'
import { LeagueDuesTrackerPanel } from '@/components/league-settings/LeagueDuesTrackerPanel'
import { LeagueHistoryPanel } from '@/components/league-settings/LeagueHistoryPanel'
import { DeleteLeagueFromAfPanel } from '@/app/league/[leagueId]/components/DeleteLeagueFromAfPanel'

/**
 * The EXISTING editor for each League Settings row, unchanged: every save still goes through the
 * route that editor already calls (PATCH /api/leagues/:id/settings for the autosaving tabs, the
 * roster / draft / scoring / member routes for the rest). This file only chooses which one to show.
 * The guillotine first-chop editor is rendered by the container, not here.
 */
export function LeagueSettingsSubPageBody({
  id,
  ctx,
  hasAfCommissionerSub,
}: {
  id: SettingsSubPageId
  ctx: SubPanelContext
  hasAfCommissionerSub: boolean
}) {
  const props = { ctx, canEdit: ctx.isCommissioner, hasAfCommissionerSub }
  const leagueId = ctx.league.id
  let body: ReactNode = null
  switch (id) {
    case 'general':
      body = <GeneralTab {...props} showWaivers={false} />
      break
    case 'format':
      body = <ConceptRulesTab {...props} />
      break
    case 'roster':
      body = <RostersTab {...props} />
      break
    case 'scoring':
      body = <ScoringTab {...props} />
      break
    case 'draft':
      body = <DraftTab {...props} />
      break
    case 'waivers':
      body = <WaiversTab {...props} />
      break
    case 'trades':
      body = <TradesTab {...props} />
      break
    case 'playoffs':
      body = <PlayoffsTab {...props} />
      break
    case 'members':
      body = <MemberSettingsCommissionerPanel leagueId={leagueId} />
      break
    case 'co-commissioners':
      body = <CoOwnerSettingsPanel leagueId={leagueId} />
      break
    case 'divisions':
      body = <DivisionSettingsCommissionerPanel leagueId={leagueId} />
      break
    case 'commissioner-tools':
      body = (
        <div className="space-y-10">
          <CommissionerControlPanel leagueId={leagueId} />
          <LeagueDuesTrackerPanel leagueId={leagueId} />
          <LeagueHistoryPanel leagueId={leagueId} />
          {ctx.isHeadCommissioner ? (
            <DeleteLeagueFromAfPanel leagueId={leagueId} currentUserId={ctx.userId} leagueOwnerUserId={ctx.league.userId} />
          ) : null}
        </div>
      )
      break
    default:
      body = null
  }
  return <div className="af-league-admin min-w-0">{body}</div>
}

export default LeagueSettingsSubPageBody
