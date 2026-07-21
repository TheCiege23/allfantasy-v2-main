'use client'

import { useCallback, useState } from 'react'
import type { AIContextSource } from '@/lib/chimmy-chat/types'
import type { AttentionSectionData } from '@/lib/league-command-center/sections/attention'
import type { LeagueHealthSectionData } from '@/lib/league-command-center/sections/leagueHealth'
import type { MatchupsSectionData } from '@/lib/league-command-center/sections/matchups'
import type { OverviewSectionData } from '@/lib/league-command-center/sections/overview'
import type { RosterSectionData } from '@/lib/league-command-center/sections/roster'
import type { StandingsSectionData } from '@/lib/league-command-center/sections/standings'
import {
  COMMAND_CENTER_NAV,
  type ActionCapability,
  type CommandCenterSectionId,
  type CommandCenterViewModel,
} from '@/lib/league-command-center/types'
import { NotBuiltState } from './primitives/Panel'
import type { ChimmyChip } from './primitives/DecisionOsFooter'
import { CommandCenterChimmy } from './shell/CommandCenterChimmy'
import { OverviewSection } from './sections/OverviewSection'
import { MatchupsSection } from './sections/MatchupsSection'
import { RosterSection } from './sections/RosterSection'
import { StandingsSection } from './sections/StandingsSection'
import { AttentionSection } from './sections/AttentionSection'
import { LeagueHealthSection } from './sections/LeagueHealthSection'

/**
 * The single client island on the Command Center.
 *
 * The hero and left rail stay server-rendered (they are pure display plus
 * `<Link>` navigation); only the section body and the Chimmy drawer need client
 * state, so only they ship as client code.
 *
 * Section data is loaded on the server and passed in already narrowed to the
 * active section — an unbuilt or unentitled section receives `null`, so its
 * data never reaches the browser.
 */
export interface CommandCenterSectionHostProps {
  viewModel: CommandCenterViewModel
  activeSection: CommandCenterSectionId
  overview: OverviewSectionData | null
  matchups: MatchupsSectionData | null
  standings: StandingsSectionData | null
  roster: RosterSectionData | null
  /**
   * Server-resolved lineup-write capability. Passed down rather than derived
   * here so the client cannot promote a read-only league into an editable one.
   */
  rosterCapability: ActionCapability | null
  /** Commissioner HQ home. Null unless the active section is `attention`. */
  attention: AttentionSectionData | null
  /** League Health Center. Null unless the active section is `health`. */
  leagueHealth: LeagueHealthSectionData | null
}

export function CommandCenterSectionHost({
  viewModel,
  activeSection,
  overview,
  matchups,
  standings,
  roster,
  rosterCapability,
  attention,
  leagueHealth,
}: CommandCenterSectionHostProps) {
  const [chimmy, setChimmy] = useState<{
    open: boolean
    prompt: string | null
    insightType: ChimmyChip['insightType']
    source: AIContextSource
  }>({ open: false, prompt: null, insightType: undefined, source: 'dashboard' })

  const handleAskChimmy = useCallback((chip: ChimmyChip, source: AIContextSource) => {
    setChimmy({ open: true, prompt: chip.prompt, insightType: chip.insightType, source })
  }, [])

  const closeChimmy = useCallback(() => {
    setChimmy((current) => ({ ...current, open: false }))
  }, [])

  const navEntry = COMMAND_CENTER_NAV.find((item) => item.id === activeSection)
  const classicHref = `/league/${viewModel.league.leagueId}`

  const body = (() => {
    switch (activeSection) {
      case 'overview':
        return overview && matchups && standings ? (
          <OverviewSection
            viewModel={viewModel}
            data={overview}
            matchups={matchups}
            standings={standings}
            onAskChimmy={handleAskChimmy}
          />
        ) : null

      case 'matchups':
        return matchups ? (
          <MatchupsSection viewModel={viewModel} data={matchups} onAskChimmy={handleAskChimmy} />
        ) : null

      case 'standings':
        return standings ? (
          <StandingsSection viewModel={viewModel} data={standings} onAskChimmy={handleAskChimmy} />
        ) : null

      case 'roster':
        return roster && rosterCapability ? (
          <RosterSection
            viewModel={viewModel}
            data={roster}
            capability={rosterCapability}
            onAskChimmy={handleAskChimmy}
          />
        ) : null

      case 'attention':
        return attention ? (
          <AttentionSection viewModel={viewModel} data={attention} onAskChimmy={handleAskChimmy} />
        ) : null

      case 'health':
        return leagueHealth ? (
          <LeagueHealthSection viewModel={viewModel} data={leagueHealth} onAskChimmy={handleAskChimmy} />
        ) : null

      default:
        return null
    }
  })()

  return (
    <>
      {body ?? (
        <NotBuiltState
          sectionLabel={navEntry?.label ?? 'This section'}
          fallbackHref={classicHref}
        />
      )}

      <CommandCenterChimmy
        open={chimmy.open}
        onClose={closeChimmy}
        viewModel={viewModel}
        prompt={chimmy.prompt}
        insightType={chimmy.insightType}
        source={chimmy.source}
      />
    </>
  )
}

export default CommandCenterSectionHost
