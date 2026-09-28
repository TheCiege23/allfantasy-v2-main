'use client'

import dynamic from 'next/dynamic'

// Keep the lazy boundary on the client so Next splits the screen bundles.
// Default SSR stays enabled: the selected screen still arrives as rendered HTML.
export const MyTeam = dynamic(() => import('./MyTeam'))
export const Matchup = dynamic(() => import('./Matchup'))
export const Trades = dynamic(() => import('./Trades'))
export const Waivers = dynamic(() => import('./Waivers'))
export const DraftHq = dynamic(() => import('./DraftHq'))
export const DraftBoard = dynamic(() => import('./DraftBoard'))
export const PlayerFinder = dynamic(() => import('./PlayerFinder'))
export const LeagueHome = dynamic(() => import('./LeagueHome'))
export const DevyCore = dynamic(() => import('./DevyCore'))
export const DevyLeagueTab = dynamic(() => import('./DevyLeagueTab'))
