'use client'

import { useState } from 'react'
import type { UserLeague } from '@/app/dashboard/types'
import { NativeLeagueWorkspace } from '@/components/league/native/NativeLeagueWorkspace'
import { normalizeToSupportedSport } from '@/lib/sport-scope'
// LeagueShell loads /core's palette itself (the workspace does not), so the harness must too — without
// it --surface/--line2 resolve empty and every frame shows transparent chrome.
import '@/components/core-app/af-core.css'

/** The native redraft tab set LeagueShell builds for a commissioner (its `nflRedraftCore` branch). */
const TABS = [
  { id: 'native_home', label: 'League home' }, { id: 'home', label: 'Home' }, { id: 'decide', label: 'Decide' },
  { id: 'ai_coaching', label: 'Chimmy Coaching' }, { id: 'draft', label: 'Draft' }, { id: 'draft_intel', label: 'Live Intel' },
  { id: 'roster', label: 'My Team' }, { id: 'matchups', label: 'Matchups' }, { id: 'schedule', label: 'Schedule' },
  { id: 'players', label: 'Players' }, { id: 'waivers', label: 'Waivers' }, { id: 'trades', label: 'Trades' },
  { id: 'standings', label: 'Standings' }, { id: 'legacy', label: 'Legacy' }, { id: 'war_room', label: 'War Room' },
  { id: 'league_chat', label: 'League Chat' }, { id: 'commissioner', label: 'Commissioner' }, { id: 'settings', label: '⚙ Settings' },
]

type Props = {
  sport: string
  lifecycleState: string
  currentWeek: number | null
  totalWeeks: number | null
  playoffStartWeek: number | null
  tradeDeadlineWeek: number | null
  platform: string
  leagueType: string
  tab: string
}

/**
 * Harness only (app/e2e is 404 in production). The workspace chrome — root tokens, header, season
 * track, sidebar, phone bars — is the real component; the tab body below is a labelled FIXTURE of
 * card / page-ground text so the tokens can be judged on both grounds. It is not the League Home tab.
 */
export default function RedraftIdentityHarnessClient(props: Props) {
  const [activeTab, setActiveTab] = useState(props.tab)
  const league: UserLeague = {
    id: 'e2e-redraft-identity',
    name: 'Sunday Night Redraft',
    platform: props.platform,
    sport: normalizeToSupportedSport(props.sport),
    format: 'redraft',
    scoring: 'Half PPR',
    teamCount: 12,
    season: 2026,
    lifecycleState: props.lifecycleState,
    currentWeek: props.currentWeek,
    leagueType: props.leagueType,
    tradeDeadlineWeek: props.tradeDeadlineWeek,
    isCommissioner: true,
  }
  return (
    <NativeLeagueWorkspace
      native
      league={league}
      leagues={[league]}
      tabs={TABS}
      activeTab={activeTab}
      isCommissioner
      onSelectTab={setActiveTab}
      onOpenSettings={() => setActiveTab('settings')}
      seasonFacts={{
        totalWeeks: props.totalWeeks,
        playoffStartWeek: props.playoffStartWeek,
        ...(['in_season', 'playoffs', 'completed'].includes(props.lifecycleState) ? { draftComplete: true } : {}),
      }}
      leftPanel={null}
      rightPanel={null}
    >
      <div className="nl-home" data-testid="redraft-identity-fixture">
        <div className="nl-home-primary">
          <section className="nl-card nl-next">
            <div className="nl-card-label"><span>Harness fixture · card ground</span><span>Week {props.currentWeek ?? '—'}</span></div>
            <h2>Card heading on --surface</h2>
            <p>Secondary text on a card. The accent link below and the primary button use the sport tokens.</p>
            <div className="nl-actions"><button type="button" className="nl-button nl-primary">Primary action</button><button type="button" className="nl-button">Secondary</button><a className="nl-text-link" href="#fixture">Accent link →</a></div>
          </section>
        </div>
        <div className="nl-home-secondary">
          <p className="nl-eyebrow">Page-ground label (--faint over the art)</p>
          <p>Page-ground body text (--text2 over the art and glow).</p>
        </div>
      </div>
    </NativeLeagueWorkspace>
  )
}
