'use client'

import type { ComponentType } from 'react'
import { SurvivorAppShell } from '@/app/survivor/[leagueId]/SurvivorAppShell'
import SurvivorIslandHomePage from '@/app/survivor/[leagueId]/page'
import SurvivorTribePage from '@/app/survivor/[leagueId]/tribe/page'
import SurvivorTribalPage from '@/app/survivor/[leagueId]/tribal/page'
import SurvivorChallengesPage from '@/app/survivor/[leagueId]/challenges/page'
import SurvivorExilePage from '@/app/survivor/[leagueId]/exile/page'
import SurvivorJuryPage from '@/app/survivor/[leagueId]/jury/page'
import SurvivorMergePage from '@/app/survivor/[leagueId]/merge/page'
import SurvivorFinalePage from '@/app/survivor/[leagueId]/finale/page'
import SurvivorEpisodesPage from '@/app/survivor/[leagueId]/episodes/page'
import SurvivorIntelPage from '@/app/survivor/[leagueId]/intel/page'
import SurvivorSeasonStoryPage from '@/app/survivor/[leagueId]/story/page'
import SurvivorRulesPage from '@/app/survivor/[leagueId]/rules/page'
import SurvivorSwapPage from '@/app/survivor/[leagueId]/swap/page'

import type { SurvivorHarnessScreen as Screen } from './screens'

const PAGES: Record<Screen, ComponentType> = {
  home: SurvivorIslandHomePage,
  tribe: SurvivorTribePage,
  tribal: SurvivorTribalPage,
  challenges: SurvivorChallengesPage,
  exile: SurvivorExilePage,
  jury: SurvivorJuryPage,
  merge: SurvivorMergePage,
  finale: SurvivorFinalePage,
  episodes: SurvivorEpisodesPage,
  intel: SurvivorIntelPage,
  story: SurvivorSeasonStoryPage,
  rules: SurvivorRulesPage,
  swap: SurvivorSwapPage,
}

/**
 * Harness only (app/e2e is 404 in production). The pages read `useParams().leagueId`, which this route
 * provides as its own `[leagueId]` segment, so each one runs exactly as it does under /survivor/[leagueId].
 */
export default function SurvivorHarnessClient({ leagueId, screen }: { leagueId: string; screen: Screen }) {
  const Page = PAGES[screen]
  return (
    <div data-testid="survivor-harness" data-screen={screen}>
      <SurvivorAppShell leagueId={leagueId}>
        <Page />
      </SurvivorAppShell>
    </div>
  )
}
