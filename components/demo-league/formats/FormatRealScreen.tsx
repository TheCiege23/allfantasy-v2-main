'use client'

import { DevyLeagueHomeHero } from '@/components/devy/DevyLeagueHomeHero'
import { ZombieCommandHero } from '@/components/zombie/ZombieCommandHero'
import { CapDashboard } from '@/components/salary-cap/CapDashboard'
import { ContractsPage } from '@/components/salary-cap/ContractsPage'
import { BigBrotherCeremonyCenter } from '@/components/big-brother/BigBrotherCeremonyCenter'
import { SGVisualSet } from '@/components/survivor-guillotine/SGVisualSet'
import type { FormatRealScreen as Screen } from '@/lib/demo-league/formats/realScreens'

const noop = () => {}

/**
 * A league-type example's own screen — the component a member of that kind of league sees, fed the
 * example's sample data (lib/demo-league/formats/realScreens.ts). Chosen per type because each is a
 * different component; every one here is pure (no fetch, no session, no signed-in link).
 *
 * Buttons that open member-only views (Devy's settings and chat, Salary Cap's "Back") are inert here;
 * demo-core.css hides the ones that would read as broken.
 */
export function FormatRealScreen({ screen }: { screen: Screen }) {
  return <div className="af-demo-real-screen" data-testid={`format-real-screen-${screen.kind}`}>{render(screen)}</div>
}

function render(screen: Screen) {
  switch (screen.kind) {
    case 'devy':
      return (
        <DevyLeagueHomeHero
          leagueName={screen.leagueName}
          sport="NFL"
          season={screen.season}
          dynastyYear={screen.dynastyYear}
          isCommissioner={false}
          onOpenSettings={noop}
          onOpenChat={noop}
        />
      )
    case 'zombie':
      return (
        <ZombieCommandHero
          leagueName={screen.leagueName}
          sport="NFL"
          week={screen.week}
          level={null}
          survivorCount={screen.survivorCount}
          hordeCount={screen.hordeCount}
          whispererCount={screen.whispererCount}
          // AllFantasy never holds league money (dues are tracking only), and an example has no dues.
          potTotal={0}
          isPaid={false}
          chompinNames={screen.chompinNames}
          whispererPanel={null}
          quickActions={null}
          sceneThemeId="abandoned-hospital"
        />
      )
    case 'salary-cap':
      return (
        <div className="space-y-5">
          <CapDashboard summary={screen.summary} leagueId="demo-salary-cap" onBack={noop} />
          <ContractsPage summary={screen.summary} leagueId="demo-salary-cap" onBack={noop} />
        </div>
      )
    case 'big-brother':
      return <BigBrotherCeremonyCenter leagueId="demo-big-brother" summary={screen.summary} />
    case 'survivor-guilly':
      return <SGVisualSet input={screen.input} leagueId="demo-survivor-guilly" isCommissioner={false} />
  }
}
