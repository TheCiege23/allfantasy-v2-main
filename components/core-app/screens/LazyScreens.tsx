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

// Every other client screen /core renders. Each is mounted by exactly one segment, so
// a static import put all of them (and their stylesheets) into every /core screen's graph.
export const LeagueSchedule = dynamic(() => import('./LeagueSchedule'))
export const ConnectedFranchiseWarRoom = dynamic(() => import('./ConnectedFranchiseWarRoom'))
export const TradeCenter = dynamic(() => import('./TradeCenter').then((m) => m.TradeCenter))
export const FormatHub = dynamic(() => import('./FormatHub'))
export const DraftArchive = dynamic(() => import('./DraftArchive').then((m) => m.DraftArchive))
export const Scout = dynamic(() => import('./Scout'))
export const GamePlan = dynamic(() => import('./GamePlan'))
export const WarRoomWeek = dynamic(() => import('./WarRoomWeek'))
export const Partners = dynamic(() => import('./Partners'))
export const BusinessRetention = dynamic(() => import('./BusinessRetention').then((m) => m.BusinessRetention))
export const DiscordBridge = dynamic(() => import('./DiscordBridge').then((m) => m.DiscordBridge))
export const BracketChallenge = dynamic(() => import('./BracketChallenge').then((m) => m.BracketChallenge))
export const Portfolio = dynamic(() => import('./Portfolio').then((m) => m.Portfolio))
export const Tools = dynamic(() => import('./Tools').then((m) => m.Tools))
export const Career = dynamic(() => import('./Career').then((m) => m.Career))
export const YourWeek = dynamic(() => import('./YourWeek'))
export const RivalryRadar = dynamic(() => import('./RivalryRadar'))
export const YourWeekLeague = dynamic(() => import('./YourWeekLeague'))
export const SeasonOutlook = dynamic(() => import('./SeasonOutlook'))
export const SeasonOutlookLeague = dynamic(() => import('./SeasonOutlookLeague'))
export const LiveScores = dynamic(() => import('./LiveScores'))
export const LiveGameView = dynamic(() => import('./LiveGameView').then((m) => m.LiveGameView))
export const Standings = dynamic(() => import('./Standings'))
export const NotificationsCenter = dynamic(() => import('./NotificationsCenter'))
export const CareerShare = dynamic(() => import('./CareerShare'))
