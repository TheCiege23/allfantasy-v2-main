'use client'

import { useState } from 'react'
import { useSearchParams } from 'next/navigation'
import type { UserLeague } from '@/app/dashboard/types'
import type { TabDef } from '@/app/league/[leagueId]/LeagueTabs'
import { LeagueHeader } from '@/app/league/[leagueId]/LeagueShell'
import { ImportedLeagueQuickActions } from '@/components/league/ImportedLeagueQuickActions'
import { LeagueTypeHero } from '@/components/league/LeagueTypeHero'
import { LeagueWorkspaceNavigation } from '@/components/league/LeagueWorkspaceNavigation'
import '@/components/core-app/af-core.css'
import '@/components/league/league-workspace.css'
import '@/components/league/league-type-skin.css'
import { LEAGUE_SKINS, redraftSkinSport, resolveLeagueSkin, type LeagueSkin } from '@/lib/league/leagueTypeSkin'

/** Sample leagues, one per skin — SAMPLE DATA, used only by this harness. */
const SAMPLES: Record<LeagueSkin, { name: string; leagueType: string; leagueVariant?: string; isDynasty?: boolean; sport: string; teams: number; week: number | null }> = {
  dynasty: { name: 'Defense IDP For Life', leagueType: 'dynasty', isDynasty: true, sport: 'NFL', teams: 16, week: 11 },
  redraft: { name: 'Not 4 the Weak!', leagueType: 'redraft', sport: 'NFL', teams: 12, week: 11 },
  keeper: { name: 'Jeepers Keepers!', leagueType: 'keeper', sport: 'NFL', teams: 12, week: 11 },
  best_ball: { name: 'Best Ball Bash', leagueType: 'best_ball', sport: 'NFL', teams: 12, week: 11 },
  guillotine: { name: 'Off With Their Heads', leagueType: 'guillotine', sport: 'NFL', teams: 16, week: 11 },
  survivor: { name: 'Island League', leagueType: 'redraft', leagueVariant: 'survivor', sport: 'NFL', teams: 12, week: 11 },
  devy: { name: 'The Last IDP Dynasty!!', leagueType: 'devy', isDynasty: true, sport: 'NFL', teams: 14, week: 11 },
  zombie: { name: 'Undead Sundays', leagueType: 'zombie', sport: 'NFL', teams: 12, week: 11 },
  salary_cap: { name: 'Cap Space Kings', leagueType: 'salary_cap', sport: 'NFL', teams: 12, week: 11 },
  pirate: { name: 'Pirate League!', leagueType: 'pirate', isDynasty: true, sport: 'NFL', teams: 14, week: 11 },
  big_brother: { name: 'The House', leagueType: 'redraft', leagueVariant: 'big_brother', sport: 'NFL', teams: 12, week: 11 },
}

const TABS: TabDef[] = [
  { id: 'decide', label: 'Decide' },
  { id: 'ai_coaching', label: 'Chimmy Coaching' },
  { id: 'draft', label: 'Draft' },
  { id: 'roster', label: 'My Team' },
  { id: 'matchups', label: 'Matchups' },
  { id: 'waivers', label: 'Waivers' },
  { id: 'trades', label: 'Trades' },
  { id: 'standings', label: 'Standings' },
  { id: 'legacy', label: 'Legacy' },
  { id: 'commissioner', label: 'Commissioner' },
]

const noop = () => {}

export function LeagueTypeSkinsHarnessClient() {
  const params = useSearchParams()
  const requested = String(params?.get('skin') ?? 'dynasty')
  const sportParam = params?.get('sport')
  const skinKey: LeagueSkin = (LEAGUE_SKINS as readonly string[]).includes(requested) ? (requested as LeagueSkin) : 'dynasty'
  const sample = SAMPLES[skinKey]
  const sport = sportParam ? sportParam.toUpperCase() : sample.sport
  const [activeTab, setActiveTab] = useState('decide')

  // Resolve through the same function the page uses, so the harness proves the mapping too.
  const skin = resolveLeagueSkin({ leagueType: sample.leagueType, leagueVariant: sample.leagueVariant, isDynasty: sample.isDynasty })
  const league = {
    id: 'harness-league',
    name: sample.name,
    sport,
    season: 2026,
    teamCount: sample.teams,
    leagueType: sample.leagueType,
    leagueVariant: sample.leagueVariant,
    isDynasty: sample.isDynasty ?? false,
    platform: 'sleeper',
    status: 'in_season',
    settings: {},
  } as unknown as UserLeague

  return (
    // Same nesting as the page: the skin is stamped on a wrapper ABOVE the af-core workspace root.
    <div
      data-league-skin={skin}
      data-league-sport={skin === 'redraft' ? redraftSkinSport(sport) : undefined}
      data-testid="league-type-skins-harness"
    >
     <div className="af-core af-league-workspace min-h-[100dvh]">
      <main className="af-lsk-main min-h-[100dvh]" data-testid="league-command-center-surface">
        <LeagueWorkspaceNavigation
          variant="strip"
          leagueId="harness-league"
          leagueName={sample.name}
          platform="sleeper"
          sourceLeagueId="1180000000000000000"
          season={2026}
          trailing={<ImportedLeagueQuickActions compact leagueId="harness-league" leagueName={sample.name} platform="sleeper" canRemove />}
        />
        <LeagueHeader
          league={league}
          leagueId="harness-league"
          tabs={TABS}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          onOpenLeagueSettingsModal={noop}
          memberGearMenu={null}
          onGoHome={noop}
          isCommissioner
        />
        <LeagueTypeHero skin={skin} sportLabel={sport} season={2026} week={sample.week} teamCount={sample.teams} />
        <p className="px-5 py-6 text-sm" style={{ color: 'var(--lsk-muted)' }}>
          Sample data. The tab content below the hero (What&apos;s next, this week, needs your call) is unchanged.
        </p>
      </main>
     </div>
    </div>
  )
}
