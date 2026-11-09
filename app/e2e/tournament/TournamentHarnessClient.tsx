'use client'

import type { ComponentType } from 'react'
import { TournamentUiProvider } from '@/app/tournament/[tournamentId]/TournamentUiContext'
import { TournamentChrome } from '@/app/tournament/[tournamentId]/TournamentChrome'
import TournamentHomePage from '@/app/tournament/[tournamentId]/page'
import TournamentStandingsHubPage from '@/app/tournament/[tournamentId]/standings/page'
import TournamentMyLeaguePage from '@/app/tournament/[tournamentId]/league/page'
import TournamentProgressPage from '@/app/tournament/[tournamentId]/progress/page'
import TournamentDraftsPage from '@/app/tournament/[tournamentId]/drafts/page'
import TournamentForumPage from '@/app/tournament/[tournamentId]/forum/page'
import TournamentHistoryPage from '@/app/tournament/[tournamentId]/history/page'
import { HARNESS_USER_ID, layout } from './fixtures'
import type { TournamentHarnessScreen } from './screens'

const PAGES: Record<TournamentHarnessScreen, ComponentType> = {
  home: TournamentHomePage,
  standings: TournamentStandingsHubPage,
  league: TournamentMyLeaguePage,
  progress: TournamentProgressPage,
  drafts: TournamentDraftsPage,
  forum: TournamentForumPage,
  history: TournamentHistoryPage,
}

/**
 * Harness only (app/e2e is 404 in production). Mirrors app/tournament/[tournamentId]/layout.tsx — the same
 * provider, wrapper classes and chrome — around the REAL page, with the layout payload from fixtures.ts in place
 * of `loadTournamentLayoutPayload`. The pages read `useParams().tournamentId`, which this route provides.
 */
export default function TournamentHarnessClient({ screen }: { screen: TournamentHarnessScreen }) {
  const Page = PAGES[screen]
  return (
    <TournamentUiProvider value={{ ...layout, viewerUserId: HARNESS_USER_ID }}>
      <div className="af-draft-dark tournament-theme af-tournament-immersive relative min-h-dvh">
        <TournamentChrome>
          <Page />
        </TournamentChrome>
      </div>
    </TournamentUiProvider>
  )
}
