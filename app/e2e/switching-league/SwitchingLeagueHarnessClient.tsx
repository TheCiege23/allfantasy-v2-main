'use client'

import type { ReactNode } from 'react'
import '@/components/core-app/af-core.css'
import '@/components/league/league-admin.css'

import {
  SwitchingLeagueCommissionerView,
  SwitchingLeagueTeamView,
  type SwitchingState,
} from '@/components/league-home/SwitchingLeagueCard'

const base: SwitchingState = {
  applies: true,
  official: false,
  seasonInProgress: true,
  platformLabel: 'Sleeper',
  isHeadCommissioner: true,
  myTeam: { name: 'Hail Shiva', switched: false },
  teams: [],
  invitePath: null,
}

const official: SwitchingState = {
  ...base,
  official: true,
  invitePath: '/join/3f7c2a90-sample',
  myTeam: { name: 'Hail Shiva', switched: true },
  teams: [
    { name: 'Hail Shiva', manager: 'guap', switched: true },
    { name: 'Gridiron Ghosts', manager: 'tkells', switched: true },
    { name: 'Owl Street', manager: 'mbrooks', switched: false },
    { name: 'Tank Command', manager: 'deshawn22', switched: false },
  ],
}

const noop = () => {}

function Frame({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <p className="text-[11px] font-bold uppercase tracking-wide text-white/40">{title}</p>
      {children}
    </div>
  )
}

export function SwitchingLeagueHarnessClient() {
  return (
    <main className="af-core min-h-screen p-6" style={{ background: "var(--bg)" }}>
      <div className="mx-auto grid max-w-3xl gap-6">
        {/* The Commissioner tab's own wrapper, which themes the card (components/league/league-admin.css). */}
        <div className="af-core af-league-admin grid gap-6">
          <Frame title="Commissioner tab — in season, not official">
            <SwitchingLeagueCommissionerView leagueId="sample" state={base} onChanged={noop} />
          </Frame>
          <Frame title="Commissioner tab — official">
            <SwitchingLeagueCommissionerView leagueId="sample" state={official} onChanged={noop} />
          </Frame>
        </div>
        <Frame title="Team tab — manager, before official">
          <SwitchingLeagueTeamView leagueId="sample" state={{ ...base, isHeadCommissioner: false, myTeam: { name: 'Owl Street', switched: false } }} onChanged={noop} />
        </Frame>
        <Frame title="Team tab — manager, league official">
          <SwitchingLeagueTeamView leagueId="sample" state={{ ...official, isHeadCommissioner: false, myTeam: { name: 'Owl Street', switched: false } }} onChanged={noop} />
        </Frame>
        <Frame title="Team tab — switched early (practice)">
          <SwitchingLeagueTeamView leagueId="sample" state={{ ...base, isHeadCommissioner: false, myTeam: { name: 'Gridiron Ghosts', switched: true } }} onChanged={noop} />
        </Frame>
      </div>
    </main>
  )
}
