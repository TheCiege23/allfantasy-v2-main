import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { cookies, headers } from 'next/headers'
import { getServerSession } from 'next-auth'

import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { recordDashboardActivation } from '@/lib/analytics/recordDashboardActivation'
import { getDashboardLeagueListForUser } from '@/lib/dashboard/get-dashboard-league-list'
import { toPlayedLeagues } from '@/lib/core-app/playedLeagues'
import { findPlayedAlias } from '@/lib/core-app/leagueRowAlias'
import { selectResyncCandidates } from '@/lib/core-app/resyncableLeagues'
import { getLeagueDataSignals } from '@/lib/core-app/leagueDataSignals'
import { getLeagueTypeMedia, resolveLeagueCardTypeKey } from '@/lib/league-media/leagueTypeMedia'
import { deriveOutstandingIssues, lastSyncByLeagueFrom } from '@/lib/core-app/outstandingIssues'
import { mergeDash34Issues } from '@/lib/core-app/mergeDash34Issues'
import { buildHomeSignals, serializeHomeSignals } from '@/lib/core-app/homeSignals'
import { describeAge } from '@/lib/sports-data/freshnessPolicy'
import { resolveDashboardAvatarUrl } from '@/lib/dashboard/resolve-dashboard-avatar'
import { aiAccessResolver } from '@/lib/ai-access/AIAccessResolver'
import { attachLeagueHubs } from '@/lib/core-app/attachLeagueHubs'
import { ConnectedLeagueContext } from '@/components/core-app/ConnectedLeagueNavigation'
import ConnectedFranchiseWarRoom from '@/components/core-app/screens/ConnectedFranchiseWarRoom'
import ConnectedDecisionScopeBar from '@/components/core-app/ConnectedDecisionScopeBar'
import { resolvePairedHalf } from '@/lib/core-app/leaguePairing'
import AfCoreShell, { type CoreNavKey, type RailLeague } from '@/components/core-app/AfCoreShell'
import type { UserLeague } from '@/app/dashboard/types'
import { DefenseHubClient } from '@/app/idp/defense-hub/[leagueId]/DefenseHubClient'
import { resolveLeagueValueSurfaces } from '@/lib/values/valueSurfaceEligibility'
import { createLeagueContext, type LeagueContext } from '@/lib/core-app/leagueContext'
import {
  resolveImportCoverageSummary,
  UNKNOWN_IMPORT_COVERAGE,
} from '@/lib/league-import/importCoverageSummary'
import DevyCore from '@/components/core-app/screens/DevyCore'
import DevyLeagueTab from '@/components/core-app/screens/DevyLeagueTab'
import { getDevyCoreData, leagueDevyNav, looksLikeDevyFormat, NO_DEVY_NAV } from '@/lib/core-app/devy'
import type { TriageBookRow } from '@/components/core-app/screens/Dash3ATriage'
import { resolveUserOsSnapshot } from '@/lib/decision-os/userOs'
import { getCrossLeagueExposure, getRivalRecords } from '@/lib/core-app/dash3aPanels'
import { getFollowingCard } from '@/lib/core-app/followingCard'
import { getDecisionReceipts } from '@/lib/core-app/decisionReceipts'
import { getDash34Data, imageOf, type Dash34LeagueRow } from '@/lib/core-app/dash34'
import {
  readHomeExposure,
  readHomePortfolio,
  readHomeRivals,
  type PortfolioSummaryMeta,
} from '@/lib/core-app/homePortfolioSummary'
import { getChatBadge } from '@/lib/chat-core/chatBadge'
import LeagueHome from '@/components/core-app/screens/LeagueHome'
import { getLeagueHomeData } from '@/lib/core-app/leagueHome'
import {
  LeagueDataCoverage,
  LeagueDataCoverageSkeleton,
  LEAGUE_DATA_COVERAGE_ANCHOR,
} from '@/components/core-app/LeagueDataCoverage'
import { getLeagueDataCoverage, type LeagueDataCoverageRecord } from '@/lib/core-app/leagueDataCoverage'
import { isImportedPlatform } from '@/lib/league/isNativeLeague'
import PlayerFinder from '@/components/core-app/screens/PlayerFinder'
import { searchPlayers, getPlayerDetail } from '@/lib/core-app/playerFinder'
import { getPlayerLeagueView } from '@/lib/core-app/playerLeagueView'
import { getPlayerTradeVisual } from '@/lib/core-app/playerTradeVisual'
import { getManagerPresence } from '@/lib/core-app/managerPresence'
import { loadGameDayTriage } from '@/lib/core-app/gameDayTriageLoader'
import { listRecentPlayerSearches, recordRecentPlayerSearch } from '@/lib/core-app/recentPlayerSearches'
import ScreenLoadError from '@/components/core-app/ScreenLoadError'
import MyTeam from '@/components/core-app/screens/MyTeam'
import { getMyTeamData } from '@/lib/core-app/myTeam'
import MyTeamBoard from '@/components/core-app/MyTeamBoard'
import { getMyTeamPulse } from '@/lib/core-app/myTeamPulse'
import Matchup from '@/components/core-app/screens/Matchup'
import { getMatchupData } from '@/lib/core-app/matchup'
import MatchupPulseBoard from '@/components/core-app/MatchupPulseBoard'
import { getMatchupPulse } from '@/lib/core-app/matchupPulse'
import Trades from '@/components/core-app/screens/Trades'
import { TradeCenter } from '@/components/core-app/screens/TradeCenter'
import { getTradesData } from '@/lib/core-app/trades'
import { getTradesBoard, pointBoardAtReachableLeagues } from '@/lib/core-app/tradesBoard'
import { readTradesBoardSummary } from '@/lib/core-app/tradesBoardSummary'
import TradesBoard from '@/components/core-app/boards/TradesBoard'
import { resolveCurrentWeek } from '@/lib/core-app/currentWeek'
import FormatHub from '@/components/core-app/screens/FormatHub'
import { getFormatHub, parseHubFormat } from '@/lib/core-app/formatHubs'
import Waivers from '@/components/core-app/screens/Waivers'
import { getWaiversData } from '@/lib/core-app/waivers'
import { loadWaiverEdgeForScreen } from '@/lib/competitive-edge/waiverEdgeLoader'
import { getWaiversBoard } from '@/lib/core-app/waiversBoard'
import { readWaiversBoardSummary } from '@/lib/core-app/waiversBoardSummary'
import { readPortfolioSummary } from '@/lib/core-app/portfolioSummary'
import WaiversBoard from '@/components/core-app/boards/WaiversBoard'
import DraftHq from '@/components/core-app/screens/DraftHq'
import DraftHqBoard from '@/components/core-app/boards/DraftHqBoard'
import { getLiveDraftPicks } from '@/lib/core-app/warRoomBoard'
import { getDraftHqData } from '@/lib/core-app/draftHq'
import { loadDraftEdgeForScreen } from '@/lib/competitive-edge/draftEdgeLoader'
import DraftBoard from '@/components/core-app/screens/DraftBoard'
import { getDraftBoardData } from '@/lib/core-app/draftBoard'
import Scout from '@/components/core-app/screens/Scout'
import { getScoutData } from '@/lib/core-app/scout'
import GamePlan from '@/components/core-app/screens/GamePlan'
import LandingV4 from '@/components/core-app/screens/LandingV4'
import DashboardV2 from '@/components/core-app/screens/DashboardV2'
import Partners from '@/components/core-app/screens/Partners'
import { BusinessRetention } from '@/components/core-app/screens/BusinessRetention'
import { DiscordBridge } from '@/components/core-app/screens/DiscordBridge'
import { loadDiscordBridgeScreen } from '@/lib/core-app/discordBridgeScreen'
import { DiscordBridgeNotice } from '@/components/core-app/screens/DiscordBridgeNotice'
import { BracketChallenge } from '@/components/core-app/screens/BracketChallenge'
import { getBracketChallenge } from '@/lib/core-app/bracketChallenge'
import { resolveSport } from '@/lib/brackets/sportShell'
import AuthV4 from '@/components/core-app/screens/AuthV4'
import ImportV4, { type ImportPreviewState } from '@/components/core-app/screens/ImportV4'
import { Portfolio } from '@/components/core-app/screens/Portfolio'
import { Tools } from '@/components/core-app/screens/Tools'
import { Career } from '@/components/core-app/screens/Career'
import { getCareerData } from '@/lib/core-app/career'
import { leagueArtUrl } from '@/lib/core-app/leagueArt'
import { getRailMatchups } from '@/lib/core-app/railMatchups'
import {
  LEAGUE_FIRST_ALL_VIEW,
  LEAGUE_FIRST_COOKIE,
  isLeagueFirstEnabled,
  resolveLeagueFirstLanding,
} from '@/lib/core-app/leagueFirst'
import { readLastLeague, rememberLastLeague } from '@/lib/core-app/leagueFirstStore'
import { readLeagueChatPreview } from '@/lib/core-app/leagueChatPreview'
import { composeChimmyMoves, type ChimmyMoves } from '@/lib/core-app/chimmyMoves'
import { ChimmyMovesCard } from '@/components/core-app/ChimmyMovesCard'
import LeagueCareer from '@/components/core-app/screens/LeagueCareer'
import { getLeagueCareer } from '@/lib/core-app/leagueCareer'
import { toShareCard } from '@/lib/core-app/shareCard'
import { Rankings } from '@/components/core-app/screens/Rankings'
import { RankingsFaq } from '@/components/core-app/screens/RankingsFaq'
import { RankingsCompare } from '@/components/core-app/screens/RankingsCompare'
import {
  getRankingsData,
  getCompareData,
  getLeagueCompareData,
  getTeamCompareData,
  getPlayerPickData,
  parseCompareKind,
  type CompareResult,
} from '@/lib/core-app/rankings'
import { filterParams, parseRankingFilters } from '@/lib/core-app/rankingsEngine'
import { getPortfolio } from '@/lib/core-app/portfolio'
import { readPortfolioInsights, readRecordedValueDays } from '@/lib/core-app/portfolioInsightsSummary'
import { parseFilter, parseView, type LineupSignal } from '@/lib/core-app/portfolioView'
import { getTodayStrip } from '@/lib/core-app/todayStrip'
import { getPlayFeed } from '@/lib/live/playFeedPresentation'
import { getRecentTrades } from '@/lib/core-app/recentTrades'
import { getCrossLeagueValueActions } from '@/lib/core-app/crossLeagueValueActions'
import { getSinceLastVisit } from '@/lib/core-app/sinceLastVisit'
import { getUrgencyBadges, recordPendingOffers } from '@/lib/core-app/urgencyBadges'
import { isSpeculativeRequestHeaders } from '@/lib/http/speculativeRequest'
import { hasRegularSeasonStarted } from '@/lib/core-app/seasonPhase'
import { readPlayByPlayFeed } from '@/lib/live/playByPlayFeed'
import { getDraftHqAll } from '@/lib/core-app/draftHqAll'
import { getWeekAll, scoredMatchupLeagueIds } from '@/lib/core-app/weekAll'
import { buildWeeklyRoutine, getRoutineFacts } from '@/lib/core-app/weeklyRoutine'
import YourWeek from '@/components/core-app/screens/YourWeek'
import WeekBoard from '@/components/core-app/boards/WeekBoard'
import RivalryRadar from '@/components/core-app/screens/RivalryRadar'
import { getWeekBoard, getRivalryRadar } from '@/lib/core-app/weekBoard'
import YourWeekLeague from '@/components/core-app/screens/YourWeekLeague'
import SeasonOutlook from '@/components/core-app/screens/SeasonOutlook'
import { getSeasonOutlook } from '@/lib/core-app/seasonOutlook'
import SeasonOutlookLeague from '@/components/core-app/screens/SeasonOutlookLeague'
import { slimOutlookForBoard } from '@/lib/core-app/outlookCopy'
import LiveScores from '@/components/core-app/screens/LiveScores'
import { LiveGameView } from '@/components/core-app/screens/LiveGameView'
/*
 * Model Admin's two panels, reused verbatim from the page this replaced. They
 * are client components that fetch their own data, so moving them onto the core
 * shell needs no new loader — only the admin gate below.
 */
import { V3WeightsPanel } from '@/components/admin/V3WeightsPanel'
import { UsageAnalyticsPanel } from '@/components/admin/UsageAnalyticsPanel'
import { getAdminAccessState } from '@/lib/adminAuth'
import { getLivePageData } from '@/lib/live/liveScoresPage'
import { getEspnGameSummary } from '@/lib/sports-live-scores-service'
import CommissionerHub from '@/components/core-app/screens/CommissionerHub'
import { getCommissionerHub } from '@/lib/core-app/commissionerHub'
import { resolveCorePaywall } from '@/lib/core-app/corePaywall'
import type { LaunchOfferView } from '@/lib/monetization/foundingMember'
import { homeLaunchOfferFor } from '@/components/launch/homeLaunchOffer'
import { LaunchOfferStrip } from '@/components/launch/LaunchOfferStrip'
import CommissionerOverview from '@/components/core-app/screens/CommissionerOverview'
import { getCommissionerOverview } from '@/lib/core-app/commissionerOverview'
import Standings from '@/components/core-app/screens/Standings'
import StandingsBoard from '@/components/core-app/boards/StandingsBoard'
import { parseStandingsView } from '@/lib/core-app/standingsView'
import PickALeague from '@/components/core-app/PickALeague'
import LeagueTabs from '@/components/core-app/LeagueTabs'
import { platformLabel } from '@/lib/core-app/platformLinks'
import { getLeagueStandings } from '@/lib/core-app/leagueStandings'
import { readLeagueStandingsSummary } from '@/lib/core-app/leagueStandingsSummary'
import { readWeekAllSummary } from '@/lib/core-app/weekAllSummary'
import { readSeasonOutlookSummary, seasonOutlookFingerprint } from '@/lib/core-app/seasonOutlookSummary'
import { getCareerScreen, parseCareerView } from '@/lib/core-app/careerScreen'
import { parseCareerFilter } from '@/lib/core-app/careerModel'
import { isEnabled, DEFAULT_ROLLOUTS } from '@/lib/sports-os/rollout'
import { freshnessLabel, freshnessMeta, shouldWarnAboutFreshness } from '@/lib/sports-os/freshness'
import { recordBudgetSince } from '@/lib/sports-os/budgetTelemetry'
import { classifyDevice } from '@/lib/observability/requestContext'
import LeagueSync from '@/components/core-app/screens/LeagueSync'
import { getLeagueSync } from '@/lib/core-app/leagueSync'
import NotificationsCenter from '@/components/core-app/screens/NotificationsCenter'
import { getNotificationsCenter } from '@/lib/core-app/notificationsCenter'
import CareerShare from '@/components/core-app/screens/CareerShare'
import { buildToolsHub } from '@/lib/core-app/toolsHub'
import { getTokenSpendRuleMatrixEntry } from '@/lib/tokens/pricing-matrix'
import { planAllowanceMeta, readChimmyPlanAllowance } from '@/lib/chimmy/planAllowance'
import { getCoreActivitySnapshot } from '@/lib/core-app/coreActivity'
import { isCoreSurfaceKey, type CoreSurfaceKey } from '@/lib/core-app/coreSurface'
import CoreLeagueContextBar, {
  CoreLeagueDecisionChip,
  CoreLeagueRecommendation,
} from '@/components/core-app/CoreLeagueContextBar'
import { touchLeagueViewed } from '@/lib/leagues/touchLeagueViewed'
import CoreScreenSkeleton from '@/components/core-app/CoreScreenSkeleton'
import { CoreScreenArea } from '@/components/core-app/coreNavPending'
import CoreScreenErrorBoundary from '@/components/core-app/CoreScreenErrorBoundary'
import { PublishShellSignals, type ShellUrgencyBadges } from '@/components/core-app/shellSignals'
import { recordCompletedSpan, recordRootDuration } from '@/lib/observability/rootTiming'
import { CoreHomeCards, emptyHomeLoads, type HomeLoads } from '@/components/core-app/home/HomeCards'
import { ConnectLeagueCard } from '@/components/core-app/home/ConnectLeagueCard'
import { traceCard } from '@/lib/observability/cardTelemetry'
import {
  applyHomeScope,
  FAVORITES_COOKIE,
  HOME_SCOPE_PARAM,
  isScoped,
  parseFavoriteIds,
  parseHomeScope,
  platformOf,
  SCOPE_COOKIE,
  scopeLabel,
  serializeHomeScope,
  sportOf,
  type HomeScope,
} from '@/lib/core-app/homeScope'
import { leagueDataFreshness } from '@/lib/core-app/cardFreshness'
import { CARD_USE_COOKIE, orderHomeCards, parseCardUsage, timeSensitiveCards } from '@/lib/core-app/homeCardOrder'

export const dynamic = 'force-dynamic'

/**
 * How many recent trades the home loads. Shared by the trade band's loader and the
 * since-last-visit brief, which must know the list is capped to say "3+" honestly.
 */
const HOME_RECENT_TRADES_LIMIT = 3

/**
 * AF Core — every screen from the design handoff, behind ONE route.
 *
 * An optional catch-all rather than nine sibling routes on purpose: this repo
 * sits against Vercel's hard 2048-route ceiling (see
 * scripts/vercel-next-build.cjs), and nine page routes for one product surface
 * is exactly the kind of spend that pushed it there. `/core`, `/core/players`,
 * `/core/my-team` and the rest all resolve here and cost one route between them.
 *
 * Screens land incrementally. Anything not yet built renders an explicit
 * "not built yet" panel instead of a blank page or a redirect, so the nav is
 * honest about what exists.
 */

const SCREEN_KEYS: Record<string, CoreNavKey> = {
  '': 'home',
  players: 'players',
  'my-team': 'my-team',
  'landing-preview': 'landing-preview',
  matchup: 'matchup',
  trades: 'trades',
  waivers: 'waivers',
  'war-room': 'war-room',
  'draft-hq': 'draft-hq',
  'defense-hub': 'defense-hub',
  /* Two segments because the handoff is two screens: a cross-league hub and a
     per-league tab. See the CoreNavKey note in AfCoreShell. */
  devy: 'devy',
  'devy-league': 'devy-league',
  portfolio: 'portfolio',
  career: 'career',
  rankings: 'rankings',
  commissioner: 'commissioner',
  tools: 'tools',
  /*
   * The five handoff screens added in this change. Segments on the same
   * catch-all as everything else — five sibling routes for five screens is
   * exactly the spend that pushed this repo against Vercel's 2048-route
   * ceiling, and the shell is identical on all of them.
   *
   * `week` carries Rivalry Radar behind ?view=rivalries rather than taking its
   * own key: same data layer, same header, same empty state.
   */
  week: 'week',
  'season-outlook': 'season-outlook',
  share: 'share',
  notifications: 'notifications',
  /*
   * 32a lands on the EXISTING commissioner nav key rather than taking one of its
   * own. It is a commissioner surface — configuring where a league's chat goes
   * is not a manager action — so the rail should highlight Commissioner while
   * you are on it, and the shell needs no new entry.
   */
  discord: 'commissioner',
  /*
   * Model Admin rides the commissioner nav key for the same reason `discord`
   * does — it is an admin surface, not a manager one, and it must not add a
   * rail entry that 403s almost everyone who clicks it. Moved here from
   * /leagues/[leagueId]/admin/model, which now redirects.
   */
  'model-admin': 'commissioner',
  /*
   * 28a. ONE segment for every sport — the sport is a query parameter
   * (?sport=mlb), not a route. That is the "one shell, every sport" constraint
   * expressed in the routing layer too, and it keeps six sports at zero
   * additional routes against Vercel's 2048 ceiling.
   */
  bracket: 'tools',
  /*
   * 38a — the live slate inside the shell. Another segment on the same
   * catch-all, so it costs zero routes; the public `/live` page is untouched
   * and stays the signed-out, indexable one.
   */
  live: 'live',
  /* 38a·7 — league points-for board. Separate key from `rankings`, which is the
     cross-app XP ladder and measures something else entirely. */
  standings: 'standings',
  /* 38a·10 — per-league sync detail. */
  sync: 'sync',
  /*
   * Multi-league format hubs (2026-09-13). One segment for all six — the format is
   * the second path segment (/core/hubs/guillotine), so six hubs cost zero routes.
   * Rides the commissioner nav key for the same reason `discord` does: no new rail
   * entry, and the branch below is matched on `segment`, above every activeKey branch.
   */
  hubs: 'commissioner',
  /*
   * The dashboard-v2 home: the home data without the shell (see the early return below
   * the shell). It is listed so it is a KNOWN segment — it used to work only because an
   * unknown segment fell back to home, and an unknown segment now redirects to /core.
   */
  'dashboard-v2': 'home',
}

/**
 * Per-tab titles and descriptions.
 *
 * ⚠ THE ROOT LAYOUT DECLARES `robots: { index: true, follow: true }` AND EVERY
 * SCREEN HERE INHERITED IT. Nothing was ever actually indexed — /core redirects
 * an anonymous request to /login, so a crawler never sees a page — but the
 * markup was telling search engines to index a signed-in dashboard, which is
 * the wrong instruction to be shipping either way. `generateMetadata` below
 * overrides it for the whole catch-all.
 *
 * The titles are not an SEO play; they are what a browser tab, a bookmark and a
 * pasted link say. Nineteen screens that all read "AllFantasy" is unusable once
 * more than two tabs are open, which is the normal state for this product.
 */
const TAB_META: Record<string, { title: string; description: string }> = {
  '': { title: 'Your leagues', description: 'Every league you play, ordered by what needs you first.' },
  players: { title: 'Player Finder', description: 'Search any player and see what they are worth in your leagues.' },
  /*
   * Covers both states this segment renders: the cross-league lineup check when
   * no league is selected, and one league's roster when one is. A description
   * naming only the second was wrong for the screen most visits land on.
   */
  'my-team': {
    title: 'My team',
    description: 'Which of your lineups still need setting, and every slot, projection and lock time inside one league.',
  },
  matchup: { title: 'Matchup', description: 'This week head to head, scored against your league rules.' },
  trades: { title: 'Trades', description: 'Trade offers and grades, priced against one league.' },
  waivers: { title: 'Waivers', description: 'Targets, bids and claim order for this league.' },
  'war-room': {
    title: 'War Room',
    description:
      'Scout the managers you play, and the moves you owe before kickoff. ?view=plan for the game plan.',
  },
  'draft-hq': { title: 'Draft HQ', description: 'Draft order, pick slots and board settings.' },
  'defense-hub': {
    title: 'Defense Hub',
    description: 'Your defenders and kickers, priced by this league’s own scoring and starting slots.',
  },
  devy: {
    title: 'Devy',
    description: 'College prospects tracked across every league you are in — rankings, exposure and news.',
  },
  'devy-league': {
    title: 'Devy',
    description: 'This league’s devy slots, free agents, draft board and prospect values.',
  },
  portfolio: { title: 'Portfolio', description: 'Every league you hold, in one table.' },
  career: { title: 'Your career', description: 'Seasons, titles and records across every league you have played.' },
  // (league-scoped career shares this key; the title is accurate either way)
  rankings: { title: 'Rankings', description: 'Community, portfolio and league rankings — normalised, filterable and explained.' },
  commissioner: { title: 'Commissioner', description: 'League health, disputes and settings.' },
  tools: { title: 'Tools', description: 'Everything you can decide or understand about a league.' },
  week: { title: 'Your week', description: 'Every matchup this week, ordered by what needs a decision.' },
  'season-outlook': { title: 'Season Outlook', description: 'Playoff odds, title odds and what decides your season.' },
  share: { title: 'Career Share', description: 'A shareable card of your fantasy career.' },
  notifications: { title: 'Notifications', description: 'Trades, waivers, lineups and commissioner alerts.' },
  discord: { title: 'Discord bridge', description: 'Connect a league to a Discord channel.' },
  'model-admin': { title: 'Model Admin', description: 'V3 scoring weights, drift monitoring and API usage.' },
  bracket: { title: 'Bracket Challenge', description: 'Fill a bracket and track it against the field.' },
  live: { title: 'Live Scores', description: 'Live scores across every sport, scored against your rosters.' },
  standings: { title: 'Standings', description: 'This league ranked by points scored, not by record.' },
  sync: { title: 'Sync', description: 'What AllFantasy reads for this league, and when it last read it.' },
  hubs: {
    title: 'Format hubs',
    description: 'Every Zombie, Tournament, Survivor, C2C, Guillotine and EFL league you play in, one hub per format.',
  },
}

/**
 * The league in the URL, named — but only if it is the reader's.
 *
 * ⚠ THE MEMBERSHIP CLAUSE IS THE WHOLE POINT AND MUST NOT BE DROPPED FOR SPEED.
 * A title is rendered from a query parameter the caller supplies, so an
 * unscoped `findUnique` would hand anybody who guesses a uuid the name of a
 * private league in the `<title>` tag — a leak the page body itself does not
 * have, because every screen resolves through a claimed team.
 *
 * Both arms are single-key lookups: `League.userId` is the importer's own row,
 * and the second covers a league someone else imported where this user has
 * claimed a team. Returns null on anything unexpected so a failed lookup costs
 * a plainer tab title and never a 500 on the page it titles.
 */
async function leagueNameForTitle(leagueId: string, userId: string): Promise<string | null> {
  return prisma.league
    .findFirst({
      where: {
        id: leagueId,
        OR: [{ userId }, { teams: { some: { claimedByUserId: userId } } }],
      },
      select: { name: true },
    })
    .then((l) => l?.name?.trim() || null)
    .catch(() => null)
}

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ screen?: string[] }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { screen } = await params
  const sp = await searchParams
  const segment = (screen?.[0] ?? '').toLowerCase()
  const meta = TAB_META[segment]

  /*
   * ⚠ NINETEEN SCREENS SHARED ONE TITLE PER SEGMENT AND SIXTY-FIVE LEAGUES
   * SHARED THAT. TAB_META exists because "AllFantasy" nineteen times over is
   * unusable once more than two tabs are open — and the league-scoped screens
   * have exactly the same problem one level down: three tabs open on three
   * different rosters all read "My team · AllFantasy". The league is the thing
   * that tells them apart, and it is already in the URL.
   */
  const leagueId = typeof sp.league === 'string' ? sp.league : null
  let leagueName: string | null = null
  if (leagueId) {
    const session = await getServerSession(authOptions).catch(() => null)
    const userId = (session?.user as { id?: string } | undefined)?.id
    if (userId) leagueName = await leagueNameForTitle(leagueId, userId)
  }

  const base = meta ? `${meta.title} · AllFantasy` : 'AllFantasy'

  return {
    title: leagueName && meta ? `${meta.title} · ${leagueName} · AllFantasy` : base,
    description: meta?.description,
    /*
     * Signed-in surface. `noindex` is the honest instruction and `nofollow`
     * stops a crawler that somehow reaches one of these from walking the whole
     * league graph. The public player pages every player name here links to are
     * the surfaces that are meant to rank — this one never is.
     */
    robots: { index: false, follow: false, nocache: true },
  }
}

function titleCase(slug: string): string {
  return slug
    .split('_')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

const PLATFORM_MARK: Record<string, string> = {
  sleeper: 'S',
  espn: 'E',
  yahoo: 'Y',
  cbs: 'C',
  mfl: 'M',
  fantrax: 'F',
}

export default async function AfCorePage({
  params,
  searchParams,
}: {
  params: Promise<{ screen?: string[] }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { screen } = await params
  const sp = await searchParams
  const selectedLeagueId = typeof sp.league === 'string' ? sp.league : null
  const playerQuery = typeof sp.q === 'string' ? sp.q : ''
  const selectedPlayerId = typeof sp.player === 'string' ? sp.player : null
  const segment = (screen?.[0] ?? '').toLowerCase()
  const navKey = SCREEN_KEYS[segment]

  /*
   * The landing preview is served BEFORE the session gate and OUTSIDE AfCoreShell.
   *
   * Both matter and both were wrong first time round. A marketing page rendered
   * inside the signed-in chrome came out wrapped in the league rail, the app nav
   * and the topbar — it has its own nav and belongs to no league. And gating it
   * behind auth is backwards: a landing page exists for people who are NOT
   * signed in, so the redirect to /login made it unreachable by its only real
   * audience.
   */
  if (segment === 'landing-preview') {
    return <LandingV4 />
  }

  /*
   * AllFantasy for Business, at /core/partners.
   *
   * Served here rather than as its own /partners route because the repo sits at
   * Vercel's hard 2048-route ceiling — this catch-all is the whole point: every
   * handoff screen behind ONE route. Same placement rules as the landing above:
   * before the session gate and outside AfCoreShell, because it is a marketing
   * page for people who are NOT signed in and carries its own nav.
   */
  if (segment === 'partners') {
    return <Partners />
  }

  /*
   * 30b — the B2B retention case, at /core/business.
   *
   * Ungated and outside AfCoreShell for the same reason `partners` is: it is a
   * partner-facing page for people who are NOT signed in. It sits beside
   * `partners` rather than replacing it — `partners` is the offer ("here is
   * what we run over your data"), this is the argument for it ("here is why
   * offseason retention is the thing to buy"). Its demo CTA deep-links into the
   * one working demo form at /core/partners#demo rather than growing a second.
   */
  if (segment === 'business') {
    return <BusinessRetention />
  }

  // Auth previews are ungated for the same reason the landing is: sign-in and
  // sign-up exist for people who are NOT signed in.
  if (segment === 'signin-preview') {
    return <AuthV4 mode="signin" />
  }
  if (segment === 'signup-preview') {
    return <AuthV4 mode="signup" />
  }
  /*
   * ⚠ /core/import RESOLVED TO THE DASHBOARD, SILENTLY. `import` is not in
   * SCREEN_KEYS, and an unknown segment used to fall back to `activeKey = 'home'` — so
   * anyone who typed, bookmarked or linked /core/import landed on the home screen
   * with no indication they had asked for something else. LeaguePanel.tsx even
   * carries a comment warning contributors to link /import instead, which is a
   * workaround for this rather than a fix.
   *
   * It redirects rather than rendering ImportV4 here on purpose: /import is not
   * only a screen, it is the auth boundary and the param contract (`provider`,
   * `username`, `leagueId`/`sourceId`, `returnTo`, the Yahoo callback fields) for
   * every inbound import link in the product. Re-rendering the screen on this
   * route would mean maintaining that contract in two places; forwarding keeps
   * one. The query string is carried over so a deep link still arrives intact.
   */
  if (segment === 'import') {
    const qs = new URLSearchParams()
    for (const [key, value] of Object.entries(sp)) {
      if (typeof value === 'string') qs.set(key, value)
      else if (Array.isArray(value) && typeof value[0] === 'string') qs.set(key, value[0])
    }
    const query = qs.toString()
    redirect(query ? `/import?${query}` : '/import')
  }

  if (segment === 'import-preview') {
    // ?state= previews the connecting and result layouts. They are reachable
    // only deliberately, and the result panel says it carries no league data.
    const raw = typeof sp.state === 'string' ? sp.state : 'pick'
    const previewState: ImportPreviewState =
      raw === 'connecting' || raw === 'result' ? raw : 'pick'
    return <ImportV4 state={previewState} />
  }

  /*
   * ⚠ AN UNKNOWN SEGMENT REDIRECTS TO /core. IT NO LONGER RENDERS THE HOME IN PLACE.
   *
   * The old fallback kept a mistyped or stale link from 404ing, and the redirect keeps that:
   * the user still lands on the home screen. What it removes is rendering the WHOLE home under
   * the wrong URL. Measured in production 2026-09-16: `/core/contact_support` ran every home
   * card for 11.9s. Scanner paths (`/core/.env`, `/core/phpinfo.php`) reached the same
   * fallback. And telemetry tagged those renders `af.screen: other`, so they were missing
   * from every home measurement.
   *
   * Placed after the ungated segments above, which return or redirect first, and BEFORE the
   * session read, so an unknown path costs nothing. The query is carried: `?league=` is what
   * selects a league, and dropping it would downgrade the landing to the cross-league home.
   * The league gate below still checks it, exactly as for a typed `/core?league=`.
   */
  if (!navKey) {
    const kept = new URLSearchParams()
    for (const [key, value] of Object.entries(sp)) {
      if (typeof value === 'string') kept.set(key, value)
    }
    const query = kept.toString()
    redirect(query ? `/core?${query}` : '/core')
  }

  // `af.shell_ms` on the request's root span measures from here to "the shell has everything".
  const shellStartedAt = Date.now()
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string; email?: string | null } } | null
  const userId = session?.user?.id
  if (!userId) {
    /*
     * ⚠ CARRY THE QUERY, NOT JUST THE PATH. `?league=` is the ONLY thing that
     * decides whether /core renders the cross-league dashboard or one league's
     * home — see `selectedLeagueId` above: there is no cookie, no stored
     * default and no first-league fallback. Redirecting to a bare
     * `/core/<segment>` therefore silently downgrades every signed-out deep
     * link INTO a league: the user follows a link to their league, signs in,
     * and lands on the cross-league dashboard with nothing saying a selection
     * was dropped.
     *
     * Rebuilt from `sp` rather than from a request URL because a server
     * component has none. Array-valued params are skipped for the same reason
     * `selectedLeagueId` ignores them: `?league=a&league=b` already resolves to
     * null, so carrying it forward would preserve nothing.
     */
    const carried = new URLSearchParams()
    for (const [key, value] of Object.entries(sp)) {
      if (typeof value === 'string') carried.set(key, value)
    }
    const carriedQuery = carried.toString()
    const callbackTarget = `/core${segment ? `/${segment}` : ''}${carriedQuery ? `?${carriedQuery}` : ''}`
    redirect(`/login?callbackUrl=${encodeURIComponent(callbackTarget)}`)
  }

  /*
   * /core/commissioner without a league no longer redirects (five-doors restyle,
   * 2026-09-17). It renders the all-leagues Commissioner Hub itself, and
   * /commissioner-hub — the page it used to bounce to — is now the redirect, the
   * other way round. See `getCommissionerOverview`.
   */

  // An unknown segment has already redirected above; the fallback only satisfies the index type.
  const activeKey: CoreNavKey = navKey ?? 'home'

  // getDashboardLeagueListForUser returns { leagues, sleeperUserId } — NOT an
  // array — and types its leagues as `unknown[]`, so nothing stops a caller from
  // mapping the payload itself. The dashboard page casts the same way.
  /*
   * ⚠ STARTED HERE, AWAITED WHERE IT IS USED. It needs only the session, and it was awaited ALONE
   * after the whole shell wave — a third serial stage on every /core render for a value the wave
   * never needed. Same inputs, same fallback, same place it is read.
   */
  const chimmyPlanRead = readChimmyPlanAllowance({
    userId,
    email: (session?.user as { email?: string | null } | undefined)?.email ?? null,
  }).catch(() => null)

  const leagueListPayload = await getDashboardLeagueListForUser(userId).catch(() => null)
  const leagues = (leagueListPayload?.leagues ?? []) as unknown as UserLeague[]

  /*
   * How many leagues "Sync now" can actually re-read. Computed from the payload
   * ALREADY fetched above rather than by a second read, and by the same
   * `selectResyncCandidates` the sync endpoint uses to build its work list —
   * a count and a work-list from different code are not the same answer, and
   * the disagreement would show up as a button that is enabled and syncs
   * nothing, or greyed out over leagues the endpoint would have refreshed.
   *
   * ⚠ NULL, NOT 0, WHEN THE LEAGUE READ ITSELF FAILED. Zero greys the button
   * out, which would tell the user they have no leagues when we only failed to
   * look at them.
   */
  const syncEligibleCount = leagueListPayload
    ? selectResyncCandidates(leagueListPayload.leagues).length
    : null

  /*
   * ⚠ THE RAIL IS LEAGUES YOU PLAY, NOT YOUR IMPORT HISTORY. `hasUnifiedRecord:
   * false` marks an AF Legacy board row — a past-season snapshot from the career
   * import with no row in `leagues`. One production account carries 543 of them
   * against 60 real teams, and letting them into this list is what produced a
   * 604-tile rail and a 604-row home. Same filter the home loader applies, for
   * the same reason.
   */
  /*
   * The rule moved to `lib/core-app/playedLeagues.ts` when `weekAllSummary` became a second caller.
   * Copying the two lines would have put two implementations of one rule in the tree.
   */
  const playedLeagues = toPlayedLeagues(leagues)
  const selectedLeagueRow = selectedLeagueId
    ? (playedLeagues.find((league) => league.id === selectedLeagueId) ?? null)
    : null

  // A league query is also an authorization boundary. Do not let a stale,
  // deleted, or hand-written id reach any provider-backed loader below.
  if (selectedLeagueId && !selectedLeagueRow) {
    const safeParams = new URLSearchParams()
    for (const [key, value] of Object.entries(sp)) {
      if (key !== 'league' && typeof value === 'string') safeParams.set(key, value)
    }
    /*
     * Another importer's copy of a league the viewer plays: land on THEIR copy instead of
     * dropping the league. The target comes from `playedLeagues`, so this never widens what the
     * viewer can reach (lib/core-app/leagueRowAlias.ts).
     */
    const requested = await prisma.league
      .findUnique({ where: { id: selectedLeagueId }, select: { platform: true, platformLeagueId: true } })
      .catch(() => null)
    const alias = findPlayedAlias(requested, playedLeagues)
    if (alias) safeParams.set('league', alias)
    const query = safeParams.toString()
    redirect(`/core${segment ? `/${segment}` : ''}${query ? `?${query}` : ''}`)
  }

  // This demand signal moves the league into the five-minute active import
  // lane. The helper ignores prefetches and swallows write failures.
  if (selectedLeagueRow) void touchLeagueViewed(selectedLeagueRow.id)

  /*
   * League-first (lib/core-app/leagueFirst.ts). Opening a league remembers it; bare /core then
   * reopens it below, once the rail matchups say whether it has a head-to-head this week.
   * Started here so the read runs beside the shell reads rather than after them.
   */
  const leagueFirst = isLeagueFirstEnabled({
    userId,
    cookieValue: cookies().get(LEAGUE_FIRST_COOKIE)?.value,
    rolloutEnv: process.env.AF_LEAGUE_FIRST_ROLLOUT,
  })
  if (leagueFirst && selectedLeagueRow) void rememberLastLeague(userId, selectedLeagueRow.id)
  const leagueFirstLanding =
    leagueFirst && segment === '' && !selectedLeagueId && sp.view !== LEAGUE_FIRST_ALL_VIEW
  const lastLeagueRead = leagueFirstLanding ? readLastLeague(userId) : Promise.resolve(null)
  // The chat bar's newest line (phase 2). Started here, awaited just before the shell renders.
  const leagueChatPreviewRead =
    leagueFirst && selectedLeagueRow ? readLeagueChatPreview(selectedLeagueRow.id, userId) : Promise.resolve(null)
  // Chimmy's one-tap moves (phase 2): this league's flagged starters, from the same DB-only triage
  // the game-plan screen uses. Only where the card renders — the matchup and the league home.
  const chimmyMovesRead =
    leagueFirst && selectedLeagueRow && (activeKey === 'matchup' || activeKey === 'home')
      ? loadGameDayTriage(userId, [selectedLeagueRow.id])
          .then((triage) =>
            triage.available
              ? composeChimmyMoves({
                  triage: triage.data,
                  leagueId: selectedLeagueRow.id,
                  leagueName: selectedLeagueRow.name,
                  nowIso: new Date().toISOString(),
                })
              : null,
          )
          .catch(() => null)
      : Promise.resolve(null)

  const rail: RailLeague[] = playedLeagues.map((l) => ({
    id: l.id,
    name: l.name,
    platform: String(l.platform ?? 'manual').toLowerCase(),
    mark: PLATFORM_MARK[String(l.platform ?? '').toLowerCase()] ?? l.name.charAt(0).toUpperCase(),
    /*
     * ⚠ THE LOADER ALREADY SELECTS avatarUrl AND logoUrl — this mapping used to
     * drop them, which is why every Sleeper chip rendered 'S' while the My
     * Leagues rows below showed real images from the SAME rows. imageOf is the
     * dash34 resolver those rows go through: logoUrl as-is, Sleeper avatar hash
     * → sleepercdn thumbs URL, anything unresolvable → null so the letter mark
     * is the genuine fallback rather than a broken <img>.
     */
    /*
     * ⚠ AND WHEN THERE IS NO CUSTOM IMAGE, THE LEAGUE TYPE'S OWN ARTWORK —
     * dynasty gets the dynasty cover, keeper the keeper cover, and so on.
     * `getLeagueTypeMedia().defaultLeagueImageUrl` is documented as exactly this
     * ("card / My Leagues fallback when the league has no custom logo") and is
     * already what app/dashboard/components/LeagueTypeIcon.tsx renders, so the
     * rail now matches the tiles elsewhere in the app instead of inventing a
     * second mapping that would drift from it.
     *
     * ⚠ RESOLVED, NOT READ OFF `leagueType`. resolveLeagueCardTypeKey is the
     * canonical resolver: it reads the column, then the variant, then the
     * guillotine/best-ball flags in settings, and only then falls back to
     * dynasty-vs-redraft. A league whose type lives in `settings` rather than
     * the column — which is most of the older ones — would otherwise silently
     * take the redraft cover.
     *
     * The letter mark stays as the last resort: `RailMark` falls back to it if
     * the artwork itself 404s, so a missing file degrades to a letter and never
     * to a broken-image glyph.
     */
    imageUrl:
      imageOf(l as unknown as Dash34LeagueRow) ??
      getLeagueTypeMedia(
        resolveLeagueCardTypeKey({
          leagueType: l.leagueType,
          leagueVariant: l.leagueVariant,
          settings: l.settings ?? undefined,
          isDynasty: l.isDynasty,
        }),
      ).defaultLeagueImageUrl,
  }))

  /*
   * What the Trade Center needs beyond the league it is scoped to: the
   * league's resolved type and variant (they scope the asset legend — a
   * redraft league must not advertise future picks) and every played league
   * for the cross-league offers strip. Resolved through the same
   * resolveLeagueCardTypeKey the rail uses, so the two never disagree.
   */
  /*
   * ⚠ STARTED HERE, AWAITED AFTER THE SHELL WAVE. It was awaited on its own before the wave began —
   * a serial stage in front of every other shell read — though `hub` is only read when the shell's
   * props are built, well after the wave. It writes `hub` onto these same rail objects, so nothing
   * that already holds one (`selectedRailLeague` below) misses it.
   *
   * The no-op `.catch` only marks the promise handled, so a redirect that throws before the await
   * cannot leave an unhandled rejection; the await below still rethrows exactly as before.
   */
  const railHubsRead = attachLeagueHubs(userId, rail)
  railHubsRead.catch(() => {})

  const tradeLeagueRow = selectedLeagueRow
  const tradeLeagueTypeKey = tradeLeagueRow
    ? resolveLeagueCardTypeKey({
        leagueType: tradeLeagueRow.leagueType,
        leagueVariant: tradeLeagueRow.leagueVariant,
        settings: tradeLeagueRow.settings ?? undefined,
        isDynasty: tradeLeagueRow.isDynasty,
      })
    : null
  const tradeStripLeagues = playedLeagues.map((l) => ({
    id: l.id,
    name: l.name,
    platform: String(l.platform ?? 'manual').toLowerCase(),
    mark: PLATFORM_MARK[String(l.platform ?? '').toLowerCase()] ?? l.name.charAt(0).toUpperCase(),
    meta: [l.sport, l.teamCount ? `${l.teamCount} teams` : null].filter(Boolean).join(' · ') || null,
  }))

  /*
   * The selected league's display name, for the in-league tab bar.
   *
   * ⚠ RESOLVED FROM THE RAIL, NOT QUERIED. The rail is the list the user picked
   * from, so an id that is absent from it is stale, foreign, or hand-typed —
   * and null is the honest answer for all three. Fetching a name for an id the
   * rail does not contain would put a league heading above a screen the user
   * has no membership in.
   */
  /*
   * ⚠ THE WHOLE RAIL ENTRY, NOT JUST ITS NAME. The header below needs the
   * league's artwork and letter mark too, and the rail has already resolved
   * both through `imageOf` → `resolveLeagueCardTypeKey` → `getLeagueTypeMedia`.
   * Re-deriving them beside the header is how the rail chip and the header
   * crest end up showing different artwork for one league.
   */
  const selectedRailLeague = selectedLeagueId
    ? (rail.find((l) => l.id === selectedLeagueId) ?? null)
    : null
  const selectedLeagueName = selectedRailLeague?.name ?? null

  const selectedSyncAge = describeAge(
    'roster',
    selectedLeagueRow?.lastSyncedAt ? new Date(selectedLeagueRow.lastSyncedAt) : null,
    new Date(),
  )
  /*
   * 🛑 EVERY LEAGUE, NOT THE FIRST TWELVE. This was capped at 12 of a name-sorted list, so from the
   * cross-league home a league past the twelfth could not be picked in Chimmy's scope selector at
   * all (user report, 2026-09-16). The picker has its own search box; the selected league stays first.
   */
  const commsLeagueRows = selectedLeagueRow
    ? [selectedLeagueRow, ...playedLeagues.filter((league) => league.id !== selectedLeagueRow.id)]
    : playedLeagues

  /*
   * ⚠ `playedLeagues`, AND THE REAL SYNC TIMESTAMPS.
   *
   * This passed `leagues` — all 606 rows on a production account, 543 of which
   * are AF Legacy board snapshots with no row in `leagues` and nothing to sync.
   * The rail two lines above already filters them out for exactly this reason.
   *
   * It also omitted `lastSyncByLeague`, which defaults every league to "never
   * read" and made the stale detector fire on all of them unconditionally.
   */
  const { issues: derivedIssues } = deriveOutstandingIssues({
    leagues: playedLeagues,
    lastSyncByLeague: lastSyncByLeagueFrom(
      playedLeagues as unknown as Array<{ id: string; lastSyncedAt?: Date | string | null }>,
    ),
  })

  const now = new Date()

  /*
   * ── THE SELECTED LEAGUE, READ ONCE ────────────────────────────────────────
   *
   * 🛑 TWO OF THE SHELL READS BELOW WERE EACH FETCHING THIS SAME ROW, AND A THIRD
   * FACT ABOUT IT CAME FROM A DIFFERENT SOURCE ENTIRELY. `resolveLeagueValueSurfaces`
   * read `{id, settings}` and the import-coverage summary read `{settings, platform}` —
   * the same row, twice, in the same render.
   *
   * ⚠ REORDERING COULD NOT FIX IT, WHICH IS WHY THE ROW IS RESOLVED AS A PROMISE AND
   * NOT AWAITED HERE. Both are entries in the `Promise.all` below, so they already run
   * concurrently; awaiting a league read before that block would add a serial
   * cross-coast round-trip in front of every league-scoped render and make the page
   * slower to save a query. Creating the promise here and letting both entries `.then()`
   * off it keeps everything in one parallel wave and issues one query instead of two.
   *
   * 🛑 AND THE CONSISTENCY HALF IS THE PART THAT WAS ACTUALLY WRONG. `platform` for one
   * league was read from TWO sources in one render: the header chip and the absent-tab
   * notes took `selectedLeagueRow.platform` — from the dashboard LIST payload, which
   * SYNTHESISES that field for some rows (`normalizedSleeper` hardcodes `'sleeper'`,
   * tournaments hardcode `'allfantasy'`) — while the coverage sentence took
   * `prisma.league.platform`. Two answers to "which platform is this league on", inside
   * one page, free to disagree. They now come from this row.
   *
   * 🛑 AND THE SCREEN LOADERS NOW SHARE IT TOO. They used to read the row again — each with
   * its own column list, most with a second read of the viewer's claimed team, and the
   * draft screen up to five times — AFTER this wave had been awaited, so every league tab
   * paid one more serial cross-coast round trip for a row already in hand. `leagueCtx` is
   * created once per render and passed to whichever loader runs; see
   * `lib/core-app/leagueContext.ts` for why it is an explicit object and not `cache()`.
   *
   * The select is `LEAGUE_CONTEXT_SELECT`: every column any league loader reads, including
   * the Overview's `platformLeagueId`, `syncStatus` and `lastSyncedAt` for its "what's on
   * file" panel.
   */
  const leagueCtx = selectedLeagueId ? createLeagueContext(selectedLeagueId, userId) : null
  const selectedLeagueRead = leagueCtx ? leagueCtx.league().catch(() => null) : Promise.resolve(null)
  /* Rejection is impossible (`.catch` above), but an unawaited promise that somehow
     rejected before its `await` would surface as unhandled. Same guard as `shellReads`. */
  selectedLeagueRead.catch(() => undefined)

  /*
   * ── THE SHELL'S READS, TOGETHER ───────────────────────────────────────────
   *
   * Everything the chrome needs and nothing a screen needs. These used to run one after
   * another, scattered through the screen loaders, so nothing painted until the slowest SCREEN
   * read had finished and the whole page arrived at once. None depends on another — each needs
   * only the league list above — so they run together, the shell renders as soon as they land,
   * and the screen streams in behind it (`CoreScreenBody`, below).
   *
   * Each read keeps the fallback it had; one failure never blocks the others.
   */
  const shellReads = Promise.all([
    getCoreActivitySnapshot(
      playedLeagues.map((league) => league.id),
      playedLeagues.map((league) => String(league.sport ?? 'NFL')),
      now,
    ).catch(() => ({ gameDayActive: false, liveGameCount: 0, draftLive: false, liveDraftLeagueIds: [] as string[] })),
    /*
     * Whether the selected league has any scored week, for the nav gate.
     *
     * 🛑 FOUR TABS READ SCORED WEEKS AND NOTHING ELSE. On a league with none —
     * an imported college league before week 1, measured with 60 fixtures and 0
     * scores — Matchup, Your week, Standings and Season outlook each land on a
     * variation of "we cannot tell which week this league is in yet". Offering
     * them makes an early league look like a broken one.
     *
     * ⚠ NULL WHEN THERE IS NO LEAGUE IN CONTEXT, which the shell reads as unknown
     * and shows everything. The cross-league screens are not gated by one league's
     * emptiness.
     */
    selectedLeagueId
      ? getLeagueDataSignals({
          leagueId: selectedLeagueId,
          platformLeagueId:
            (playedLeagues.find((l) => l.id === selectedLeagueId) as { platformLeagueId?: string | null } | undefined)
              ?.platformLeagueId ?? null,
        })
          .then((signals) => signals.hasScoredWeek)
          .catch(() => null)
      : Promise.resolve(null),
    /*
     * Does this league score IDP? Gates the Defense Hub rail entry.
     *
     * ⚠ RUN ON EVERY LEAGUE-SCOPED RENDER, NOT ONLY ON ITS OWN SCREEN, WHICH IS THE OPPOSITE OF
     * the per-screen loaders below — a nav item has to be decidable before you are on the screen
     * it links to. It is one indexed read of the league's own settings, no provider call, and it
     * degrades to false so an error hides the entry rather than surfacing a dead one.
     */
    selectedLeagueId
      ? /* ⚠ THE PROMISE, NOT `.then(row => …)`. Chaining would delay the CALL until the
           shared read landed, which serialises a shell read the block exists to
           parallelise — `core-page-shell-first` asserts every one of these has started
           before any resolves, and it caught exactly that. The resolver awaits it. */
        resolveLeagueValueSurfaces(prisma, selectedLeagueId, selectedLeagueRead)
          .then((surfaces) => surfaces?.hasIdp ?? false)
          .catch(() => false)
      : Promise.resolve(false),
    /*
     * The selected league's devy facts — slot count (the per-league Devy tab) and whether it is a
     * devy or C2C league at all (the Devy hub entry). Computed for EVERY render, not just the devy
     * screens, for the same reason `hasIdpDefense` is: they gate nav items, and a nav item has to be
     * decidable before you are on the screen it links to. Two indexed config reads plus the shared
     * row, no provider call, degrading to "no devy" so an error hides the entries rather than
     * showing dead ones.
     */
    selectedLeagueId
      ? leagueDevyNav(selectedLeagueId, selectedLeagueRead).catch(() => NO_DEVY_NAV)
      : Promise.resolve(NO_DEVY_NAV),
    /*
     * What the selected league's import could actually deliver — same reasoning as
     * `hasIdpDefense`: it gates nav items, so it has to be decidable before you are
     * on the screen it links to. One read of the league's own settings, no provider call.
     *
     * ⚠ DEGRADES TO "SHOW EVERYTHING", NOT TO "HIDE EVERYTHING". The neighbouring gates
     * degrade to hidden because a dead Defense Hub entry is worse than a missing one. This
     * one is the opposite: a failed read here would strip Trades off a league that has
     * trades, so `UNKNOWN_IMPORT_COVERAGE` (all flags true) is the safe fallback and
     * `resolveImportCoverageSummary` already returns it for anything it cannot read.
     */
    selectedLeagueId
      ? selectedLeagueRead
          .then((row) =>
            resolveImportCoverageSummary({ settings: row?.settings, platform: row?.platform }),
          )
          .catch(() => UNKNOWN_IMPORT_COVERAGE)
      : Promise.resolve(UNKNOWN_IMPORT_COVERAGE),
    /*
     * ⚠ THE NAV BADGE IS ITS OWN READ, AND IT HAS TO BE. The first version drove it
     * off `notifications?.unread`, which is only loaded when the notifications
     * screen is the one being rendered — so the badge appeared exactly on the page
     * where it was least useful and was absent everywhere else. This is an indexed
     * count on (userId, readAt), which is cheap enough to pay on every screen.
     *
     * It counts STORED notifications only. The derived "act today" rows are part
     * of the same unread number on the screen itself, but they are recomputed per
     * request and are not worth a second pass here just to bump a badge.
     */
    Promise.all([
      prisma.platformNotification.count({ where: { userId, readAt: null } }).catch(() => 0),
      /*
       * The rail's profile chip. Read fresh from app_users rather than
       * session.user.image, which is frozen into the JWT at sign-in and goes
       * stale. avatarUrl is a full sleepercdn URL for Sleeper sign-ins and can be
       * a bare avatar hash on older rows — resolveDashboardAvatarUrl handles
       * both. Null is a real state (account has no image) and renders the
       * display-name initial, not an invented picture.
       */
      prisma.appUser
        .findUnique({
          where: { id: userId },
          select: { username: true, displayName: true, avatarUrl: true },
        })
        .catch(() => null),
    ]),
    /*
     * The launcher badge, on EVERY /core screen rather than only home — the dock
     * is mounted in the shell, so a count that only existed on the dashboard would
     * blink out the moment somebody navigated. Degrades to zeroes on failure
     * rather than failing the page. DMs, league chat and Chimmy's weekly checks (chatBadge.ts).
     */
    getChatBadge(userId),
    /*
     * This week's head-to-head per league, for the expanded league rail.
     *
     * ⚠ THE SHELL IS ON EVERY /core PAGE, SO THIS IS BUDGETED, NOT FREE. Three
     * set-based reads regardless of league count — the same shape and cost as
     * `getWeekAll`, which already runs on the home. It is loaded unconditionally
     * because the rail is chrome: the user can expand it on any screen, and a
     * rail that only carries scores on some pages is worse than one that never
     * does. A failure is null and the rail simply renders names and crests.
     */
    getRailMatchups(
      userId,
      playedLeagues.map((l) => ({
        id: l.id,
        platformLeagueId: (l as { platformLeagueId?: string | null }).platformLeagueId ?? null,
        /* The rail must know this before it pairs a schedule. Some providers
           publish matchup ids even for a guillotine field; those ids do not turn
           an elimination race into head-to-head. */
        elimination:
          resolveLeagueCardTypeKey({
            leagueType: l.leagueType,
            leagueVariant: l.leagueVariant,
            settings: l.settings ?? undefined,
            isDynasty: l.isDynasty,
          }) === 'guillotine',
      })),
    ).catch(() => null),
    /*
     * The plan chip and token meter. The handoff is explicit that the meter must be
     * visible BEFORE anything spends, and Chimmy is the only thing that spends — so
     * the number belongs in the chrome, not on the screen that happens to open the
     * chat. `null` on a read failure omits the chip rather than showing a made-up
     * tier or a zero balance the user does not actually have.
     */
    aiAccessResolver.resolveForUser({ userId, now }).catch(() => null),
  ])
  // Awaited below the admin gate. Every read above degrades rather than throws, but should one
  // ever reject while the gate is still being read, this keeps it from surfacing as unhandled;
  // the `await` still throws it.
  shellReads.catch(() => undefined)

  /*
   * Admin nav gate — computed every render for the same reason `hasIdpDefense` and
   * `devySlotCount` are: it gates a nav item, and a nav item has to be
   * decidable before you are on the screen it links to.
   *
   * ⚠ `modelAdminAllowed` NO LONGER ISSUES ITS OWN AUTH READ, AND THE ORIGINAL REASON IS WHY.
   * That gate used to read the admin state lazily on its own segment, because running it on
   * every /core render would put an extra auth read in front of every screen to decorate one
   * admin page. That reasoning still holds — but the rail's Admin entry needs the same answer
   * on EVERY render and cannot be resolved lazily, so this is the SINGLE such read in the file
   * and `modelAdminAllowed` reuses it. One read per render, not two: strictly cheaper than
   * the segment-scoped version was on the model-admin segment itself.
   *
   * ⚠ IT IS `getAdminAccessState`, THE PREDICATE /admin ITSELF ENFORCES, not a second
   * email check written here. The two would drift, and the failure is silent in the
   * worse direction: a rail offering a door the page then refuses to open. This is the
   * AllFantasy admin allowlist, not league commissionership.
   *
   * Degrades to false: an errored gate hides the entry rather than surfacing a dead
   * one, and denies rather than admits.
   *
   * ⚠ ITS OWN BINDING, OUTSIDE THE Promise.all, SO THE GATE STAYS ONE READABLE CHAIN —
   * `modelAdminAllowed` → `isAdmin` → the admin state → status → catch — which
   * model-admin-authorization-policy.test.ts follows. It costs no time: the reads above
   * have already started, so this waits beside them rather than in front of them.
   */
  const isAdmin = await getAdminAccessState()
    .then((state) => state.status === 'admin')
    .catch(() => false)
  const modelAdminAllowed = segment === 'model-admin' && isAdmin

  const [
    coreActivity,
    leagueHasScoredWeek,
    hasIdpDefense,
    devyNav,
    importCoverageSummary,
    [unreadNotifications, shellUser],
    chatUnread,
    railMatchups,
    access,
  ] = await shellReads
  await railHubsRead

  /*
   * The league-first landing. A redirect, so it must stay in AfCorePage ahead of the shell render
   * (see "NOTHING HERE MAY REDIRECT" on CoreScreenBody). Only a league still in `playedLeagues` can
   * be the target — the same list the `?league=` authorisation check above uses.
   */
  if (leagueFirstLanding) {
    const landing = resolveLeagueFirstLanding({
      lastLeagueId: await lastLeagueRead,
      playedLeagueIds: playedLeagues.map((l) => l.id),
      headToHeadLeagueIds: new Set(
        Object.values(railMatchups?.byLeague ?? {})
          .filter((m) => !m.unpaired)
          .map((m) => m.leagueId),
      ),
    })
    if (landing) redirect(landing)
  }
  const devySlotCount = devyNav.devySlotCount
  /*
   * 🛑 THE DEVY HUB ENTRY SHOWED FOR EVERY LEAGUE. In a league it now shows only for a devy or C2C
   * league; with no league held, only when the user plays in at least one — decided from the list
   * rows already in hand, no query.
   */
  const devyInScope = selectedLeagueId ? devyNav.devyFormat : playedLeagues.some(looksLikeDevyFormat)

  /*
   * Free by this point: the read was started before `shellReads` and has been in flight
   * alongside every entry in it, so this `await` adds no round-trip.
   *
   * ⚠ FALLS BACK TO THE LIST ROW RATHER THAN TO A LITERAL. A failed read here must not
   * turn an imported league into "AllFantasy" in the header — that is the one wrong
   * answer worse than the stale one, because `platformLabel` maps an empty platform to
   * the native league name and the chip would then confidently misattribute the league.
   */
  const selectedLeagueRecord = await selectedLeagueRead
  const selectedLeaguePlatform = selectedLeagueRecord?.platform ?? selectedLeagueRow?.platform ?? null

  const shellProfile = {
    name: shellUser?.displayName?.trim() || shellUser?.username?.trim() || null,
    imageUrl: resolveDashboardAvatarUrl(shellUser?.avatarUrl) ?? null,
  }

  /*
   * ⚠ SYNC AGE IS NOW READ, NOT ASSUMED. This was hardcoded to `null` — "never
   * synced" — with a comment saying a per-league timestamp was not wired through.
   * It is: the league list already selects `League.lastSyncedAt`. Measured on
   * production it is null for all 98 leagues, so the label does not change today,
   * but it will the moment a sync runs, and the shell no longer lies about
   * whether it is looking.
   */
  const lastSynced = playedLeagues.reduce<Date | null>((latest, l) => {
    const raw = (l as { lastSyncedAt?: Date | string | null }).lastSyncedAt
    if (!raw) return latest
    const d = raw instanceof Date ? raw : new Date(raw)
    if (Number.isNaN(d.getTime())) return latest
    return latest == null || d > latest ? d : latest
  }, null)
  const syncAge = describeAge('roster', lastSynced, now)

  const plan = access
    ? {
        // Plan ids are slugs — 'war_room', 'supreme'. Rendering one raw puts an
        // internal identifier in the chrome of the signed-in home.
        /*
         * ⚠ NO TRIAL CHIP, BECAUSE THERE IS NO TRIAL TO CHIP.
         *
         * This read `access.trial.inTrial ? \`Trial · ${d}d left\` : 'Free'`. The trial
         * confers NOTHING: the Chimmy route never consults AIAccessResolver, and the
         * token floor that used to back it (TRIAL_DAILY_FREE_TOKENS, 5 answers a day)
         * was deleted from lib/tokens/dailyFreeTokens.ts on 2026-08-28. A trialling
         * account gets the same two free questions as everyone else.
         *
         * So the chip counted down days against an allowance that does not exist —
         * which is the exact bug "The trial badge now stands for something"
         * (129441a13) was written to fix, reintroduced when that work was overwritten.
         * Showing 'Free' is true today. Restoring the chip is a SPEND decision: put the
         * trial floor back first, then this line.
         */
        name: access.hasSubscription
          ? titleCase(access.subscription.plans[0] ?? 'premium')
          : 'Free',
        tokensLeft: access.tokenBalance,
      }
    : null

  /*
   * The launch countdown on the home (components/launch) — "Everything's free until Oct 15".
   * Same rule as the depth locks' "Free until" chip (`preLaunchFree` in coreDepthAccess): only
   * before the paywall, only for a viewer WITHOUT a plan — plan holders never see it. A failed plan
   * read (`access` null) shows nothing rather than risk counting down at a paying customer. No read
   * of its own: the plan answer is the one the chip above already awaited.
   */
  const homeLaunchOffer: LaunchOfferView | null = homeLaunchOfferFor({
    hasPlan: access ? access.hasSubscription : null,
    now,
  })

  const commissionerCount = playedLeagues.filter((l) => Boolean(l.isCommissioner)).length

  /*
   * The Chimmy price the drawer shows BEFORE the user sends anything, read from
   * the real catalog rather than typed in. `ai_chimmy_chat_message` is the rule
   * /api/chat/chimmy actually spends against.
   */
  const chimmyTokenCost = getTokenSpendRuleMatrixEntry('ai_chimmy_chat_message')?.tokenCost ?? null
  /*
   * AF Pro includes Chimmy, 100 answers a day (lib/chimmy/planAllowance.ts): a subscriber's drawer
   * says "Included with AF Pro: N left today" instead of quoting a token price they will not pay.
   * Null for plans without Chimmy and on any failure — the price then shows exactly as before.
   */
  const chimmyPlanState = await chimmyPlanRead
  const chimmyPlanAllowance = chimmyPlanState ? planAllowanceMeta(chimmyPlanState, chimmyPlanState.remaining > 0) : null

  /*
   * 23b docks the drawer beside the content on league-scoped screens — a roster
   * or a matchup, where "who should I flex" is asked about the thing on screen.
   * Cross-league screens overlay instead: there is no single place to lose.
   */
  /*
   * Which screens dock the Chimmy drawer beside the content instead of over it.
   *
   * The rule is whether there is ONE thing on screen to ask about. A roster, a
   * matchup, a standings table, this league's season — all have a subject, so
   * the drawer sits beside it and you can read both. Cross-league screens
   * overlay, because there is no single place to lose your position in.
   *
   * ⚠ THE 38a TABS WERE ALL MISSING FROM THIS LIST. Standings, Season Outlook,
   * League Career, Your Week, Commissioner and Sync are every bit as
   * league-scoped as My Team, and asking Chimmy about the table you are looking
   * at was covering that table up.
   *
   * `live` stays OFF deliberately: it carries a league id only to mark which
   * tie-ins are this league's, and the slate itself is every sport across every
   * league — there is no single subject to dock against.
   */
  const DOCKABLE_KEYS: CoreNavKey[] = [
    'home',
    'my-team',
    'matchup',
    'trades',
    'waivers',
    'draft-hq',
    'war-room',
    'week',
    'standings',
    'season-outlook',
    'career',
    'commissioner',
    'notifications',
    'sync',
  ]

  const dockable = selectedLeagueId != null && DOCKABLE_KEYS.includes(activeKey)

  /*
   * ── THE HOME'S SCOPE ─────────────────────────────────────────────────────────────────────────
   *
   * Which of the played leagues the cross-league home is about — lib/core-app/homeScope.ts. From the
   * URL when it names one, otherwise from the choice remembered for this browser session, so the
   * Home link and the rail logo return to the view the reader left.
   *
   * ⚠ ONLY THE HOME APPLIES IT. Every other cross-league screen still reads every league, so on
   * those the switcher must say "All leagues" — naming the remembered filter there would describe
   * data the screen never filtered.
   *
   * ⚠ IT NARROWS `playedLeagues` AND NOTHING ELSE. The league-id authorization check above has
   * already run on the full list; favorites are intersected with that list before use.
   */
  const cookieJar = cookies()
  const favoriteIds = parseFavoriteIds(
    cookieJar.get(FAVORITES_COOKIE)?.value,
    playedLeagues.map((l) => l.id),
  )
  const appliesHomeScope = activeKey === 'home' && segment !== 'dashboard-v2' && !selectedLeagueId
  const homeScope: HomeScope = appliesHomeScope
    ? parseHomeScope(sp[HOME_SCOPE_PARAM] ?? cookieJar.get(SCOPE_COOKIE)?.value)
    : { kind: 'all' }
  const shellScope = {
    value: serializeHomeScope(homeScope),
    label: scopeLabel(homeScope, selectedLeagueName),
    favoriteIds: [...favoriteIds],
    leagues: playedLeagues.map((l) => ({
      id: l.id,
      name: l.name,
      platform: platformOf(l),
      sport: sportOf(l),
    })),
  }

  recordRootDuration('af.shell_ms', shellStartedAt)

  /*
   * The same duration, against the budget it was measured against (`lib/sports-os/budgets.ts`).
   * `af.shell_ms` says how long; `af.budget.shell_verdict` says whether that was acceptable for
   * THIS screen on THIS device, which is the question a dashboard actually gets asked.
   *
   * ⚠ THE DEVICE IS READ HERE BECAUSE THE SHELL BUDGET IS DEVICE-SCALED (mobile x1.5). The route is
   * already dynamic — `cookies()` and `headers()` are both used elsewhere in this file — so this
   * adds no rendering constraint.
   *
   * ⚠ AND IT DECIDES NOTHING. A verdict is an observation; it never sheds a card or shortens a
   * timeout. A performance budget that can fail a request turns a slow page into a broken one.
   */
  try {
    const shellHeaders = await headers()
    const shellDevice = classifyDevice(shellHeaders.get('user-agent'), shellHeaders.get('sec-ch-ua-mobile'))

    /*
     * The shell as its own span, so the phase shows on a trace's waterfall.
     *
     * ⚠ `af.shell_ms` ABOVE IS AGGREGATABLE TOO — query it as `p75(tags[af.shell_ms,number])`.
     * This span was added believing it was not: a bare `p75(af.shell_ms)` fails with "Unknown
     * attribute", and that was read as a limit of the data (corrected 2026-09-17; see
     * `docs/observability/TRACING.md`). Both are kept and carry the same duration. This span's
     * `span.duration` needs no typed form.
     *
     * Created retroactively — see `recordCompletedSpan`. It cannot leak on the early returns
     * between the auth gate and here, because it only exists if control reaches this line.
     */
    recordCompletedSpan({
      name: 'shell',
      op: 'core.shell',
      startedAtMs: shellStartedAt,
      attributes: { 'af.screen': activeKey, 'af.device': shellDevice },
    })

    recordBudgetSince({ phase: 'shell', name: activeKey, device: shellDevice }, shellStartedAt)
  } catch {
    // Telemetry must never fail a render.
  }

  /*
   * The error boundaries reset on ANY change of URL, not just screen or league: Back/Forward between two
   * queries of one screen (`?week=`, `?player=`) must not carry a failure onto a URL that renders fine.
   * A refresh of the SAME URL keeps the panel — retrying is the user's call, and re-rendering a failing
   * screen on every game-day refresh would report the same failure every 20 seconds. The screen's
   * boundary and each home card's boundary use this one key.
   */
  const errorResetKey = [segment, ...Object.entries(sp).map(([key, value]) => `${key}=${String(value)}`).sort()].join('|')

  /*
   * Whether the league header bar renders above the screen. Decided HERE, before the body, because
   * the Overview reads it: when the bar already names the league, the screen must not name it again.
   *
   * ⚠ `dashboard-v2` RENDERS WITHOUT THE SHELL (see the early return below), so no bar is drawn
   * there whatever the league state says.
   */
  const showContextBar =
    segment !== 'dashboard-v2' &&
    Boolean(selectedLeagueId && selectedLeagueName && selectedLeagueRow && isCoreSurfaceKey(activeKey))

  const body = (
    <CoreScreenBody
      ctx={{
        chimmyMovesRead,
        screen,
        sp,
        segment,
        activeKey,
        userId,
        viewerEmail: session?.user?.email ?? null,
        selectedLeagueId,
        playerQuery,
        selectedPlayerId,
        leagueListPayload,
        leagues,
        playedLeagues,
        rail,
        tradeLeagueRow,
        tradeLeagueTypeKey,
        tradeStripLeagues,
        derivedIssues,
        coreActivity,
        unreadNotifications,
        devySlotCount,
        modelAdminAllowed,
        syncAge,
        plan,
        homeLaunchOffer,
        commissionerCount,
        now,
        errorResetKey,
        leagueHeaderShown: showContextBar,
        selectedLeagueRecord,
        leagueCtx,
        homeScope,
        favoriteIds,
      }}
    />
  )

  /*
   * Dashboard v2 renders OUTSIDE the shell — it brings its own 300px left panel (see its branch
   * in the body). With no shell to paint first there is nothing to stream ahead of, so it keeps
   * the fully awaited render it always had.
   */
  if (segment === 'dashboard-v2') return body

  /*
   * ⚠ THE SCREEN BOUNDARY'S KEY IS THE SCREEN AND THE LEAGUE. Changing either is a different
   * screen, so the boundary re-suspends and shows the skeleton rather than leaving the previous
   * screen on display under the new nav. Any other query change — a search, a week, a view, and
   * every game-day `router.refresh()` — keeps the current screen visible while the next render
   * streams in.
   *
   * The key is load-bearing for a league switch in particular: a query-only navigation updates this
   * page IN PLACE (Next leaves search params out of the page's template key), so without it React
   * would keep the old league's screen up until the new one had finished loading.
   */
  const screenKey = `${segment}|${selectedLeagueId ?? ''}`
  const leagueChatPreview = await leagueChatPreviewRead

  // ONE read shared by the bar's two streamed slots (the promise, not two calls).
  const leagueOs =
    showContextBar && selectedLeagueId ? resolveUserOsSnapshot(selectedLeagueId, userId).catch(() => null) : null

  return (
    <AfCoreShell
      active={activeKey}
      leagueFirst={leagueFirst}
      leagueChatPreview={leagueChatPreview}
      leagues={rail}
      syncAge={{ label: syncAge.label, stale: syncAge.stale }}
      syncEligibleCount={syncEligibleCount}
      leagueHasScoredWeek={leagueHasScoredWeek}
      selectedLeagueId={selectedLeagueId}
      scope={shellScope}
      hasIdpDefense={hasIdpDefense}
      devySlotCount={devySlotCount}
      devyInScope={devyInScope}
      isAdmin={isAdmin}
      importCapabilities={importCoverageSummary.capabilities}
      /* The screen publishes the week label, the tab badges and Chimmy's home signals when it
         arrives — see PublishShellSignals in CoreScreenBody and shellSignals.tsx. */
      weekLabel={null}
      railMatchups={railMatchups?.byLeague}
      railWeekLabel={railMatchups?.week != null ? `Week ${railMatchups.week}` : null}
      plan={plan}
      commissionerCount={commissionerCount}
      notificationCount={unreadNotifications}
      profile={shellProfile}
      /*
       * The activity snapshot's count, on every screen. The Live screen itself publishes the
       * count from the slate it loaded, which replaces this one while that screen is open.
       */
      liveGameCount={coreActivity.liveGameCount}
      gameDayActive={coreActivity.gameDayActive}
      draftLive={coreActivity.draftLive}
      comms={{
        leagues: commsLeagueRows.map((l) => ({
          id: l.id,
          name: l.name,
          platform: String(l.platform ?? 'manual').toLowerCase(),
          // Carries the `@global` affordance into the drawer; the broadcast
          // endpoint re-checks commissioner status against `League.userId`.
          isCommissioner: Boolean(l.isCommissioner),
          teamCount: Number((l as { teamCount?: number }).teamCount ?? 0) || 0,
          /*
           * The platform's OWN id for the league, which is what a Sleeper deep
           * link needs. `l.id` is the AllFantasy uuid and 404s off-site; the
           * drawer falls back to an in-app link where this is null.
           */
          platformLeagueId:
            (l as { platformLeagueId?: string | null }).platformLeagueId ?? null,
          hub: rail.find((item) => item.id === l.id)?.hub
            ? {
                id: rail.find((item) => item.id === l.id)!.hub!.id,
                name: rail.find((item) => item.id === l.id)!.hub!.name,
                members: rail.find((item) => item.id === l.id)!.hub!.members.map((member) => ({
                  id: member.id,
                  name: member.name,
                  platform: member.platform,
                })),
              }
            : undefined,
        })),
        chimmyTokenCost,
        chimmyPlanAllowance,
        dockable,
        supportEmail: (session?.user as { email?: string | null } | undefined)?.email ?? null,
        /*
         * Carried over from the /core home's old floating bubble, which the
         * shell's launcher replaced. Without this the badge would simply have
         * disappeared when that bubble was removed.
         */
        /*
         * Was `dash34?.chatUnread`, which nothing anywhere ever computed — the
         * badge had been hardcoded to zero since it was written.
         */
        unread: chatUnread.total,
        mentions: chatUnread.mentions,
      }}
    >
      {/*
       * 38a's in-league tab bar. Rendered once here rather than inside each of
       * the twelve screens: every screen would otherwise grow its own copy, and
       * the first one to drift would be the bug nobody notices.
       *
       * ⚠ ONLY WHEN A LEAGUE IS ACTUALLY SELECTED AND NAMED. Rendering it with a
       * placeholder name would put "In league —" above a screen that is not in
       * one, which is exactly the kind of confident-but-empty chrome the rest of
       * this suite refuses to draw.
       */}
      {selectedRailLeague?.hub && selectedLeagueId ? <ConnectedLeagueContext hub={selectedRailLeague.hub} selectedLeagueId={selectedLeagueId} /> : null}
      {selectedLeagueId && selectedLeagueName ? (
        <LeagueTabs
          leagueId={selectedLeagueId}
          leagueName={selectedLeagueName}
          activeKey={activeKey}
          hasScoredWeek={leagueHasScoredWeek}
          tradeSupported={importCoverageSummary.capabilities.trades !== false}
          draftSupported={importCoverageSummary.capabilities.draft !== false}
          /*
           * ⚠ `platformLabel`, NOT `String(platform)`. It is the same resolver
           * the "Open in <platform>" buttons use, so the sentence explaining
           * why Trades is absent names the provider exactly as the button that
           * sends you there does — and a native league resolves to
           * "AllFantasy" rather than printing a raw enum at the reader.
           */
          platform={platformLabel(selectedLeaguePlatform)}
          compact={leagueFirst}
        />
      ) : null}

      {showContextBar && selectedLeagueId && selectedLeagueName && selectedLeagueRow && isCoreSurfaceKey(activeKey) && leagueOs ? (
        <CoreLeagueContextBar
          leagueId={selectedLeagueId}
          leagueName={selectedLeagueName}
          platform={String(selectedLeaguePlatform ?? 'manual')}
          /*
           * The source chip opens the Overview's "what's on file" panel, from any tab. Only for an
           * imported league: a native one has no panel, and a link to a missing anchor lands on the
           * top of the Overview and looks like it did nothing.
           */
          coverageHref={
            isImportedPlatform(selectedLeaguePlatform)
              ? `/core?league=${encodeURIComponent(selectedLeagueId)}#${LEAGUE_DATA_COVERAGE_ANCHOR}`
              : null
          }
          logoUrl={selectedRailLeague?.imageUrl ?? null}
          logoLetter={selectedRailLeague?.mark}
          syncLabel={selectedSyncAge.label}
          syncStale={selectedSyncAge.stale}
          gameDayActive={coreActivity.gameDayActive}
          surface={activeKey}
          /*
           * ⚠ KEYED ON THE LEAGUE, LIKE THE SCREEN BOUNDARY BELOW. Switching league in the rail changes
           * only the query, and Next strips search params from the page's template key, so the bar is
           * updated in place, not remounted. An unkeyed slot is then an already-visible boundary, and
           * React holds the whole navigation — new league's tabs, skeleton, everything — until the new
           * league's Decision OS read finishes, rather than hide what it is showing.
           */
          decisionSlot={
            <Suspense key={selectedLeagueId} fallback={<CoreLeagueDecisionChip available={null} />}>
              <LeagueDecisionChip snapshot={leagueOs} />
            </Suspense>
          }
          recommendationSlot={
            <Suspense key={selectedLeagueId} fallback={null}>
              <LeagueRecommendation snapshot={leagueOs} leagueName={selectedLeagueName} surface={activeKey} />
            </Suspense>
          }
        />
      ) : null}

      {/*
        The screen area — the only part that swaps to a skeleton the moment a tab is clicked,
        while the shell, league tabs and league bar above stay put (components/core-app/coreNavPending.tsx).
      */}
      <CoreScreenArea>
        <CoreScreenErrorBoundary resetKey={errorResetKey}>
          <Suspense key={screenKey} fallback={<CoreScreenSkeleton />}>
            {body}
          </Suspense>
        </CoreScreenErrorBoundary>
      </CoreScreenArea>
    </AfCoreShell>
  )
}

type LeagueOsSnapshot = Awaited<ReturnType<typeof resolveUserOsSnapshot>> | null

/**
 * The Overview's "what's on file" panel, once its counts are in.
 *
 * ⚠ A NATIVE LEAGUE, OR A FAILED LOADER, RENDERS NOTHING — not the old banner. The loader returns
 * null for a native league because nothing was imported, and a thrown loader is caught to null
 * because one panel must not take the Overview down with it. Neither case has a coverage sentence
 * worth showing: a native league has none, and the per-row reads already degrade individually.
 */
async function LeagueDataCoverageSection({ record }: { record: LeagueDataCoverageRecord }) {
  const coverage = await getLeagueDataCoverage(record).catch(() => null)
  return coverage ? <LeagueDataCoverage coverage={coverage} /> : null
}

/** The Decision OS chip in the league context bar, once the league's snapshot has been read. */
async function LeagueDecisionChip({ snapshot }: { snapshot: Promise<LeagueOsSnapshot> }) {
  const os = await snapshot
  return <CoreLeagueDecisionChip available={os?.available === true} />
}

/** The league's top recommendation, or nothing, once the snapshot has been read. */
async function LeagueRecommendation({
  snapshot,
  leagueName,
  surface,
}: {
  snapshot: Promise<LeagueOsSnapshot>
  leagueName: string
  surface: CoreSurfaceKey
}) {
  const os = await snapshot
  const top = os?.available ? os.recommendations?.recommendations[0] : undefined
  if (!top) return null
  return (
    <CoreLeagueRecommendation
      leagueName={leagueName}
      surface={surface}
      recommendation={{
        action: top.recommendedActions[0]?.action ?? top.expectedImpact,
        rationale: top.recommendedActions[0]?.rationale ?? top.evidence[0] ?? top.expectedImpact,
      }}
    />
  )
}

/**
 * The shell chrome only the screen can know, published once its values have been read. Rendered
 * behind its own Suspense, so no screen waits for its tab badges (see `urgencyBadges` in the body).
 */
async function ScreenShellSignals({
  urgencyBadges,
  weekLabel,
  homeSignals,
  liveGameCount,
}: {
  urgencyBadges: Promise<ShellUrgencyBadges>
  weekLabel: Promise<string | null> | string | null
  homeSignals: Promise<string | null> | string | null
  liveGameCount: number | undefined
}) {
  const [badges, week, signals] = await Promise.all([urgencyBadges, weekLabel, homeSignals])
  return <PublishShellSignals weekLabel={week} urgencyBadges={badges} homeSignals={signals} liveGameCount={liveGameCount} />
}

/**
 * What a screen receives from the shell phase: values computed once above that screens also
 * read. Everything else a screen needs, it loads itself, inside its streamed boundary.
 */
type CoreScreenContext = {
  /** League-first: Chimmy's one-tap moves for the selected league, started beside the shell reads. */
  chimmyMovesRead: Promise<ChimmyMoves | null>
  screen: string[] | undefined
  sp: Record<string, string | string[] | undefined>
  segment: string
  activeKey: CoreNavKey
  userId: string
  /** For the plan lookup only — admin and QA accounts bypass the paywall by email. */
  viewerEmail: string | null
  selectedLeagueId: string | null
  playerQuery: string
  selectedPlayerId: string | null
  leagueListPayload: { leagues: unknown[]; sleeperUserId?: string | null } | null
  leagues: UserLeague[]
  playedLeagues: UserLeague[]
  rail: RailLeague[]
  tradeLeagueRow: UserLeague | null
  tradeLeagueTypeKey: ReturnType<typeof resolveLeagueCardTypeKey> | null
  tradeStripLeagues: Array<{ id: string; name: string; platform: string; mark: string; meta: string | null }>
  derivedIssues: ReturnType<typeof deriveOutstandingIssues>['issues']
  coreActivity: { liveDraftLeagueIds: string[]; gameDayActive: boolean }
  /** Stored unread notifications — the shell badge's count, reused by the home's prewarm. */
  unreadNotifications: number
  devySlotCount: number
  /** Decided in `AfCorePage` from the one admin read — see the gate there. */
  modelAdminAllowed: boolean
  syncAge: { label: string; stale: boolean }
  plan: { name: string; tokensLeft: number | null } | null
  /** The home's launch countdown — non-null only before launch for a viewer without a plan. */
  homeLaunchOffer: LaunchOfferView | null
  commissionerCount: number
  now: Date
  /** The URL key the error boundaries reset on — computed once, beside the screen's own. */
  errorResetKey: string
  /** The shell's league header is drawn above this screen, so the screen must not repeat it. */
  leagueHeaderShown: boolean
  /** The selected league's row, read once by the shell. Null with no league or on a failed read. */
  selectedLeagueRecord: LeagueDataCoverageRecord | null
  /**
   * The same row, plus the viewer's claimed team, for the screen's loaders — the context the shell
   * read it through, so a loader awaiting it costs no query. Null with no league selected.
   */
  leagueCtx: LeagueContext | null
  /** The home's scope — `all` everywhere else. See "THE HOME'S SCOPE" in `AfCorePage`. */
  homeScope: HomeScope
  /** Starred league ids, already intersected with `playedLeagues`. */
  favoriteIds: ReadonlySet<string>
}

/**
 * Every /core screen's own loaders and its render, streamed inside the shell.
 *
 * ⚠ NOTHING HERE MAY REDIRECT. By the time this renders, the shell has been sent and its reads
 * have run — so a redirect from here would paint the app, and read the user's data, for a visitor
 * who was never allowed to see it, and only then send them away. Every redirect in this route —
 * the sign-in gate, the commissioner and import forwards, and the league authorisation check —
 * runs in `AfCorePage` above, before the shell renders. Keep new ones there.
 *
 * (None of them is an HTTP 307: `loading.tsx` already streams ahead of the page, so Next delivers
 * each redirect inside the stream. Measured on `next dev`: a signed-out `/core` answers 200 with a
 * meta refresh to /login.)
 */
async function CoreScreenBody({ ctx }: { ctx: CoreScreenContext }) {
  const {
    chimmyMovesRead,
    screen,
    sp,
    segment,
    activeKey,
    userId,
    viewerEmail,
    selectedLeagueId,
    playerQuery,
    selectedPlayerId,
    leagueListPayload,
    leagues,
    playedLeagues,
    rail,
    tradeLeagueRow,
    tradeLeagueTypeKey,
    tradeStripLeagues,
    derivedIssues,
    coreActivity,
    unreadNotifications,
    devySlotCount,
    modelAdminAllowed,
    syncAge,
    plan,
    homeLaunchOffer,
    commissionerCount,
    now,
    errorResetKey,
    leagueHeaderShown,
    selectedLeagueRecord,
    leagueCtx,
    homeScope,
    favoriteIds,
  } = ctx

  /*
   * The /core depth paywall (lib/core-app/coreDepthAccess.ts) — one plan read per render, and only
   * on the screens that carry paid depth (Waivers for its Competitive Edge). Started here and awaited at the first loader that
   * needs it, so it runs beside the reads in between rather than in front of them.
   *
   * ⚠ THE LOADERS BELOW SKIP WHAT A LOCKED VIEWER MAY NOT SEE. A lock card over data the page
   * already sent is a client-only gate; the screens' own locks only decide what is drawn.
   */
  const corePaywallRead =
    activeKey === 'players' ||
    activeKey === 'trades' ||
    activeKey === 'commissioner' ||
    activeKey === 'waivers' ||
    activeKey === 'draft-hq'
      ? resolveCorePaywall(userId, { email: viewerEmail, now })
      : Promise.resolve(null)

  // Rendered above the matchup and the league home (league-first only; null everywhere else).
  const chimmyMoves = await chimmyMovesRead
  const chimmyMovesCard = chimmyMoves ? (
    <ChimmyMovesCard
      data={chimmyMoves}
      leagueName={playedLeagues.find((l) => l.id === selectedLeagueId)?.name ?? 'this league'}
    />
  ) : null

  // Screen 2 is the same route with a league selected — the handoff describes it
  // as the main column becoming "that league's world", not a separate page.
  /*
   * The week the viewer is looking at, from the URL.
   *
   * A query param rather than client state, for the same reason Player Finder
   * uses one: no new API route (the repo is at the route ceiling), the server
   * does the work, and the URL is shareable -- "look at week 6" is a link.
   *
   * Nonsense is dropped to null here and validated again against the league's
   * real season length in the loader, which is the half that knows how long
   * this league's season is.
   */
  const requestedWeekRaw = Array.isArray(sp.week) ? sp.week[0] : sp.week
  const requestedWeek = requestedWeekRaw != null ? Number.parseInt(requestedWeekRaw, 10) : NaN

  const leagueHome =
    activeKey === 'home' && selectedLeagueId
      ? await getLeagueHomeData(
          selectedLeagueId,
          userId,
          Number.isFinite(requestedWeek) ? requestedWeek : null,
          leagueCtx,
        ).catch(() => null)
      : null

  // Player Finder searches and selects entirely through query params — no client
  // fetch and no new API route, which matters because the repo is at the route
  // ceiling and a search box is not worth a route.
  /*
   * Portfolio is the league INVENTORY — the thing /core home deliberately is not.
   * Home answers "what needs me now" from a queue; this answers "what do I have".
   */
  /*
   * ── PORTFOLIO ON SUMMARIES ─────────────────────────────────────────
   *
   * ⚠ ONLY `getPortfolio` IS SUMMARISED — the two panels below it are NOT, and that boundary is
   * forced rather than chosen. `ScreenSummaryDefinition.build` takes a `SummaryScope` and nothing
   * else, and a scope holds short scalars; the exposure and value-action loaders take the league
   * LIST, which cannot go in one. Having the builder re-derive that list would compile and pass,
   * and would be wrong — the fingerprint in the key comes from the page's list, so a builder
   * resolving its own could file one portfolio's panels under another's key. See the module header.
   *
   * ⚠ ITS COST IS A SERIAL FAN-OUT, NOT A WIDE JOIN: `getPortfolio` runs one `findRosterForTeam`
   * per claimed team inside a sequential loop, so an eight-league account pays ten non-overlapping
   * round trips. That is why a short list is worth caching here.
   */
  /*
   * 🛑 `portfolioScreenOnSummary`, NOT `portfolioOnSummary` — THAT NAME IS ALREADY TAKEN, BY A
   * DIFFERENT PORTFOLIO. `portfolioOnSummary` further down belongs to the HOME's portfolio card
   * (lib/core-app/homePortfolioSummary.ts), which is the "what needs me now" queue. This is the
   * `/core/portfolio` SCREEN — the league inventory, the thing home deliberately is not. Two
   * unrelated surfaces both reasonably called "portfolio"; the collision was a redeclare error
   * rather than a silent shadow only because both are `const` in one function scope.
   */
  const portfolioScreenOnSummary = isEnabled('sports-os.screen-summaries', userId, DEFAULT_ROLLOUTS)

  const portfolioScreenFresh =
    activeKey === 'portfolio' && portfolioScreenOnSummary
      ? await readPortfolioSummary(userId, leagues as unknown as Dash34LeagueRow[]).catch(() => null)
      : null

  const portfolio =
    activeKey === 'portfolio'
      ? portfolioScreenOnSummary
        ? (portfolioScreenFresh?.data ?? null)
        : await getPortfolio(userId).catch(() => null)
      : null
  /*
   * ── THE CROSS-LEAGUE BOARD ─────────────────────────────────────────────
   *
   * Exposure, risk, league mix, value movement and the action ranking all come from ONE stored
   * build (lib/core-app/portfolioInsights.ts, read through portfolioInsightsSummary.ts), which
   * replaced the two panels loaded here before — `getCrossLeagueExposure` and
   * `getCrossLeagueValueActions` read rosters two different ways, so an ESPN player never matched
   * his own value move. The build reads every roster once; this reads the stored result.
   *
   * ⚠ THE LIST PASSED FOR THE KEY IS `leagues`, UNFILTERED — the same reason as
   * `readPortfolioSummary` above: the build resolves its own leagues from claimed teams.
   *
   * ⚠ LINEUP COUNTS COME FROM THE HOME'S LOADER, not from the stored build. They are "now" facts —
   * a starter ruled out ten minutes ago — and the home and the tab badges already show them; the
   * action ranking must agree with both. Same summary-or-live choice as `loadLineupLeagues` below.
   */
  const [portfolioInsights, portfolioRecorded, portfolioLineup] = activeKey === 'portfolio'
    ? await Promise.all([
        readPortfolioInsights(userId, leagues as unknown as Array<{ id: string; season?: number | string | null }>).catch(
          () => null,
        ),
        readRecordedValueDays(userId, now).catch(() => []),
        (portfolioScreenOnSummary
          ? readHomePortfolio(userId, leagues as unknown as Dash34LeagueRow[], now).then((d) =>
              d.summary.source === 'last-known' ? getDash34Data(userId, leagues as unknown as Dash34LeagueRow[], now) : d,
            )
          : getDash34Data(userId, leagues as unknown as Dash34LeagueRow[], now)
        )
          .then((d) => {
            const out: Record<string, LineupSignal> = {}
            for (const l of d?.allLeagues ?? []) {
              out[l.id] = {
                empty: l.emptyStarters ?? 0,
                hurt: l.hurtStarters ?? 0,
                drafting: l.priority === 'draft' || (l.chips ?? []).some((c) => c.label === 'DRAFTING'),
              }
            }
            return out
          })
          .catch(() => null),
      ])
    : [null, [], null]
  const portfolioFilter = activeKey === 'portfolio'
    ? parseFilter((param) => (typeof sp[param] === 'string' ? (sp[param] as string) : null))
    : null
  const portfolioView = activeKey === 'portfolio' ? parseView(sp.pf_view) : 'overview'
  const portfolioPaidIds = activeKey === 'portfolio'
    ? leagues.filter((l) => (l as { isPaid?: boolean | null }).isPaid === true).map((l) => l.id)
    : []

  // /core/hubs/<format>. An unknown or missing format opens the first hub the reader has leagues in.
  const formatHub =
    segment === 'hubs'
      ? await getFormatHub(userId, parseHubFormat(screen?.[1])).catch(() => null)
      : null

  /*
   * ── CAREER (2026-09-16 brief) ─────────────────────────────────────
   *
   * One stored profile per user (`careerProfile.ts`), rebuilt when an import or a rank
   * recalculation finishes, and every filter — league (`lg`), platform, sport, era (`from`/`to`) —
   * built from it in memory. `?view=` picks the tab, and only that tab's extra loaders run
   * (`careerScreen.ts`).
   *
   * ⚠ THIS REPLACES TWO SUMMARIES. `careerSummary` cached the default view per platform behind the
   * 10% `sports-os.screen-summaries` flag and rebuilt on a league-list fingerprint; the profile is
   * for everyone, keyed on the history tables themselves rather than on the league list (which
   * never covered `legacy_leagues`). `careerRecordsSummary` still serves the unfiltered weekly book
   * under that flag, from inside `careerScreen`.
   *
   * ⚠ `lg`, NOT `league`. `?league=` is the page's authorization boundary and swaps this screen for
   * that one league's own career below.
   */
  const careerView = activeKey === 'career' ? parseCareerView(sp.view) : null
  const careerScreen =
    activeKey === 'career'
      ? await getCareerScreen(
          userId,
          parseCareerFilter(sp as Record<string, string | string[] | undefined>),
          careerView ?? 'overview',
          sp as Record<string, string | string[] | undefined>,
        ).catch((e: unknown) => {
          console.error('[core/career] read failed', e)
          return null
        })
      : null

  /*
   * Rankings, its FAQ and the compare view share one screen key and one data
   * read. `?view=` picks the panel — three sibling routes for one product
   * surface is exactly the spend that pushed this repo against the route
   * ceiling, and the ladder is the same on all three.
   */
  const rankingsView = activeKey === 'rankings' ? (typeof sp.view === 'string' ? sp.view : null) : null
  /*
   * The compare view does not need the rankings payload at all — it reads its own
   * two sides — so it is skipped there rather than computed and discarded.
   * `?scope=`, the filters, `?board=`, `?sort=` and `?explain=` are all parsed
   * inside the loader from `sp`, against whitelists.
   */
  const rankings =
    activeKey === 'rankings' && rankingsView !== 'compare'
      ? await getRankingsData(userId, selectedLeagueId, sp as Record<string, string | string[] | undefined>).catch(
          (e: unknown) => {
            console.error('[core/rankings] read failed', e)
            return null
          },
        )
      : null

  const compareKind = rankingsView === 'compare' ? parseCompareKind(typeof sp.kind === 'string' ? sp.kind : null) : null
  const rankingFilterPairs =
    rankingsView === 'compare' ? filterParams(parseRankingFilters(sp as Record<string, string | string[] | undefined>)) : []
  // Only run the comparison when a handle was actually submitted — an empty box
  // is the initial state, not a failed lookup.
  const compareQuery =
    compareKind === 'managers' && typeof sp.user === 'string' ? sp.user.trim() : ''
  const compare: CompareResult | null =
    compareKind === 'managers' && compareQuery
      ? await getCompareData(userId, compareQuery, sp as Record<string, string | string[] | undefined>).catch(() => null)
      : null
  const leagueCompare =
    compareKind === 'leagues'
      ? await getLeagueCompareData(userId, sp as Record<string, string | string[] | undefined>).catch(() => null)
      : null
  const teamCompare =
    compareKind === 'teams'
      ? await getTeamCompareData(userId, selectedLeagueId, sp as Record<string, string | string[] | undefined>).catch(() => null)
      : null
  const playerPick =
    compareKind === 'players'
      ? await getPlayerPickData(sp as Record<string, string | string[] | undefined>).catch(() => null)
      : null

  /*
   * The share card (13b) is derived from the career read that is already in
   * hand — build rule 2 is that every number on it traces to a value 13a shows,
   * and re-reading would let the two drift within a single request.
   */
  const shareCard =
    activeKey === 'career' && careerView === 'share' && careerScreen ? toShareCard(careerScreen.data) : null

  const corePaywall = await corePaywallRead
  // Player depth: compare, the trade visual, trade windows and free-agent pickups (AF Pro).
  const playerDepthOpen = corePaywall?.player_depth.unlocked !== false

  const playerMatches = activeKey === 'players' ? await searchPlayers(playerQuery).catch(() => []) : []
  /*
   * playedLeagues, NOT leagues — same reason as the rail and week loaders: the
   * unfiltered list carries AF Legacy board rows (hasUnifiedRecord: false), and
   * passing them here inflated "on N of your M leagues" to the 604 count and let
   * career-import snapshots into the every-platform table.
   */
  /*
   * 2a. With a league in context the Player Finder FILTERS to it (Guap,
   * 2026-09-02), so the loaders are handed that one league and do no work the
   * screen will not show. Without one, every played league.
   */
  const playerDetail =
    activeKey === 'players' && selectedPlayerId
      ? await getPlayerDetail(
          selectedPlayerId,
          selectedLeagueId ? [selectedLeagueId] : playedLeagues.map((l) => l.id),
          userId,
          { includeMoves: playerDepthOpen },
        ).catch(() => null)
      : null

  /*
   * Compare (2026-09-06): a second player held beside the first, the same
   * loader over the same leagues, so the two columns are priced the same way.
   * Only when the first resolved — a `vs` with no `player` is nothing to
   * compare against.
   */
  const vsRef = typeof sp.vs === 'string' && sp.vs.trim() ? sp.vs.trim() : null
  const playerCompare =
    activeKey === 'players' && playerDepthOpen && playerDetail && vsRef
      ? await getPlayerDetail(vsRef, selectedLeagueId ? [selectedLeagueId] : playedLeagues.map((l) => l.id), userId).catch(() => null)
      : null

  /*
   * "Recently searched", per account. The write is fire-and-forget by design
   * (the module never throws), and the read excludes the player on screen.
   */
  if (activeKey === 'players' && playerDetail && userId) {
    await recordRecentPlayerSearch(userId, {
      sport: playerDetail.player.sport,
      externalId: playerDetail.player.externalId,
      sleeperId: playerDetail.player.sleeperId,
      name: playerDetail.player.name,
      position: playerDetail.player.position,
      team: playerDetail.player.team,
    })
  }
  const recentPlayerSearches =
    activeKey === 'players' && userId
      ? await listRecentPlayerSearches(userId, {
          exclude: playerDetail
            ? { sport: playerDetail.player.sport, externalId: playerDetail.player.externalId }
            : null,
        })
      : []

  /*
   * Game-day home (2026-09-06): your flagged starters across every league,
   * with their locks — only when NO player is open, on the finder's own
   * bounded joins (never the lineup-actions engine).
   */
  const gameDayTriage =
    activeKey === 'players' && userId && !playerDetail
      ? await loadGameDayTriage(userId, playedLeagues.map((l) => l.id)).catch(() => null)
      : null

  /*
   * 2a, league in context: who has him in THIS league — you, a named manager,
   * or nobody. Only when a league is held AND the player resolved to a
   * platform id; without the id there is no roster to look him up on, and the
   * detail's own impact section already says so.
   */
  const playerLeagueView =
    activeKey === 'players' && selectedLeagueId && playerDetail?.player.sleeperId
      ? await getPlayerLeagueView(
          selectedLeagueId,
          playerDetail.player.sleeperId,
          userId,
          { position: playerDetail.player.position },
          leagueCtx,
        ).catch(() => null)
      : null

  /*
   * "Trade for him" as a visual (Guap, 2026-09-02): only when the held league's
   * card says another manager has him. Values, packages and the engine grade
   * all come from existing services; a miss is reported, never invented.
   *
   * ⚠ BELOW `playerLeagueView`, WHICH IT READS. A first cut sat above it, and
   * the detached typecheck caught the temporal dead zone (TS2448 at this
   * line) that would have thrown on every signed-in Player Finder view.
   */
  const playerTradeVisual =
    playerDepthOpen && playerLeagueView?.ownership.kind === 'other' && selectedLeagueId && playerDetail?.player.sleeperId
      ? await getPlayerTradeVisual(selectedLeagueId, playerDetail.player.sleeperId, userId, leagueCtx).catch(
          () => null,
        )
      : null

  /*
   * Trade window (2026-09-05): who to pitch for him and when they move. In a
   * held league it is that league. In the core view it is the first league
   * where someone else has him (the pitch), else the first where he is yours
   * (the buyers) — one league at a time, because the loader reads a league's
   * whole transaction history, and the card names the league it is about.
   */
  /*
   * Trade windows across leagues (2026-09-06). In the core view, every league
   * where someone ELSE has him is read for its owner's window, in parallel,
   * capped — a player is rarely on more than a handful of other rosters, and
   * each read is a league's teams, rosters and activity. In league mode the
   * single card for the held league stands, as before.
   */
  const MAX_WINDOW_LEAGUES = 6
  const otherLeagueIds =
    activeKey === 'players' && playerDepthOpen && playerDetail?.player.sleeperId && !selectedLeagueId && playerDetail.leagues.available
      ? playerDetail.leagues.data
          .filter((r) => !r.isYours && r.owner)
          .map((r) => r.leagueId)
          .slice(0, MAX_WINDOW_LEAGUES)
      : []
  const windowStates =
    otherLeagueIds.length > 0 && playerDetail?.player.sleeperId
      ? await Promise.all(
          otherLeagueIds.map((id) =>
            getManagerPresence(id, playerDetail.player.sleeperId as string, userId, { position: playerDetail.player.position }).catch(() => null),
          ),
        )
      : []
  const playerWindows = windowStates.flatMap((s) => (s && s.available ? [s.data] : []))
  const playerWindowsUnread = otherLeagueIds.length - playerWindows.length

  const presenceLeagueId = (() => {
    if (activeKey !== 'players' || !playerDepthOpen || !playerDetail?.player.sleeperId) return null
    if (selectedLeagueId) return selectedLeagueId
    // The cross-league card covers the other owners; the single card is only for a player who is yours everywhere.
    if (playerWindows.length > 0) return null
    const rows = playerDetail.leagues.available ? playerDetail.leagues.data : []
    return rows.find((r) => !r.isYours && r.owner)?.leagueId ?? rows.find((r) => r.isYours)?.leagueId ?? null
  })()
  const playerPresence =
    presenceLeagueId && playerDetail?.player.sleeperId
      ? await getManagerPresence(presenceLeagueId, playerDetail.player.sleeperId, userId, {
          position: playerDetail.player.position,
        }).catch(() => null)
      : null

  /*
   * 28a. Not league-scoped — a bracket pool is its own thing, unrelated to the
   * leagues you play in.
   */
  const bracket =
    segment === 'bracket'
      ? await getBracketChallenge(resolveSport(typeof sp.sport === 'string' ? sp.sport : null)).catch(
          () => null,
        )
      : null

  /*
   * 32a. League-scoped and commissioner-only. The screen is scoped to `?league=` whenever that
   * league is in this user's rail (the shell's gate already redirected away any id they cannot see),
   * and it tells apart a failed read, a league they do not run, and no league at all — they all used
   * to render "Pick a league you commission", which read as though `?league=` had been ignored
   * (E2/E6, 2026-09-25). See lib/core-app/discordBridgeScreen.ts.
   */
  const discordLeague =
    segment === 'discord' && selectedLeagueId
      ? (playedLeagues.find((league) => league.id === selectedLeagueId) ?? null)
      : null
  const discordScreen =
    segment === 'discord' ? await loadDiscordBridgeScreen(userId, discordLeague) : null

  /*
   * My team needs a league in context; without one the screen says which league
   * to pick rather than guessing at the user's "main" league.
   *
   * 🛑 A FAILED READ IS NOT "NO LEAGUE SELECTED", AND CONFLATING THEM SENT PEOPLE
   * TO THE PICKER. `.catch(() => null)` returned the same `null` as the no-league
   * case, so any transient failure rendered the cross-league board to a manager
   * who HAD chosen a league — no error, nothing logged, and choosing the same
   * league again usually "fixed" it, which is how a bug like this never gets
   * reported. The flag keeps the two apart; the log follows the
   * `[core/<screen>] read failed` convention career and rankings already use.
   */
  let myTeamLoadFailed = false
  const myTeam =
    activeKey === 'my-team' && selectedLeagueId
      ? await getMyTeamData(selectedLeagueId, userId, leagueCtx).catch((e: unknown) => {
          console.error('[core/my-team] read failed', e)
          myTeamLoadFailed = true
          return null
        })
      : null

  /*
   * The cross-league lineup check, for `/core/my-team` with no league in
   * context.
   *
   * ⚠ ONLY ON THE NO-LEAGUE PATH, for the same reason as `matchupPulse` below.
   * It reads every claimed team's starting lineup across the whole portfolio;
   * running it while a single league is selected would put that whole board on
   * the critical path of a screen that never renders it.
   */
  const myTeamPulse =
    activeKey === 'my-team' && !selectedLeagueId
      ? await getMyTeamPulse(userId).catch(() => null)
      : null

  /* Same split as my-team above: a failed read must not read as "no league". */
  let matchupLoadFailed = false
  const matchup =
    activeKey === 'matchup' && selectedLeagueId
      ? await getMatchupData(selectedLeagueId, userId, null, leagueCtx).catch((e: unknown) => {
          console.error('[core/matchup] read failed', e)
          matchupLoadFailed = true
          return null
        })
      : null

  /*
   * The cross-league pulse, for `/core/matchup` with no league in context.
   *
   * ⚠ ONLY ON THE NO-LEAGUE PATH. It reads every claimed team's current week
   * across the whole portfolio; running it while a single league is selected
   * would put that whole board on the critical path of a screen that never
   * renders it.
   */
  const matchupPulse =
    activeKey === 'matchup' && !selectedLeagueId
      ? await getMatchupPulse(userId).catch(() => null)
      : null

  /*
   * The cross-league trade board. `weekBoard` is not loaded on this screen, so
   * the current week comes from the same resolver the rest of the app uses —
   * and null is fine: the board then prints the deadline WEEK without a
   * countdown rather than inventing one.
   */
  const wantsTradesBoard = activeKey === 'trades' && !selectedLeagueId

  /*
   * ── THE TRADE BOARD ON SUMMARIES ───────────────────────────────────
   *
   * `tradesBoard.ts` has no `new Date()` and no `Date.now()`, and `getTradesBoard` takes no `now` —
   * the week arrives as a plain NUMBER the caller already resolved. That is an identifier for which
   * slate the board is about, not a clock, so it belongs in the cache key.
   *
   * ⚠ THE WEEK IS RESOLVED ONCE HERE AND PASSED TO BOTH ARMS, so the summary's key and the direct
   * call describe the same board. `SummaryScope.period` already existed for exactly this ("a week
   * for NFL") and was unused until now — no new scope field.
   */
  const tradesBoardWeek = wantsTradesBoard
    ? await resolveCurrentWeek(
        playedLeagues
          .map((l) => (l as { platformLeagueId?: string | null }).platformLeagueId ?? '')
          .filter((v) => v.length > 0),
      )
        .then((w) => w?.week ?? null)
        .catch(() => null)
    : null

  const tradesBoardOnSummary = isEnabled('sports-os.screen-summaries', userId, DEFAULT_ROLLOUTS)

  const tradesBoardFresh =
    wantsTradesBoard && tradesBoardOnSummary
      ? await readTradesBoardSummary(userId, tradesBoardWeek, leagues as unknown as Dash34LeagueRow[]).catch(
          () => null,
        )
      : null

  const tradesBoardRead = wantsTradesBoard
    ? tradesBoardOnSummary
      ? (tradesBoardFresh?.data ?? null)
      : await getTradesBoard(userId, tradesBoardWeek).catch(() => null)
    : null
  /*
   * 🛑 EVERY CARD LINKS TO A LEAGUE ROW THIS PAGE WILL ACCEPT (2026-09-25). The board picks the copy
   * of a league the reader claimed a team on, which can be another importer's; `?league=` is gated
   * on `playedLeagues` below, so that link bounced straight back here. Applied after BOTH reads, so
   * the cached summary path is covered too.
   */
  const tradesBoard = tradesBoardRead
    ? pointBoardAtReachableLeagues(
        tradesBoardRead,
        playedLeagues.map((l) => ({
          id: l.id,
          platform: l.platform,
          platformLeagueId: (l as { platformLeagueId?: string | null }).platformLeagueId ?? null,
          season: l.season ?? null,
        })),
      )
    : null

  /* Same split as my-team above: a failed read must not read as "no league". */
  let tradesLoadFailed = false
  const trades =
    activeKey === 'trades' && selectedLeagueId
      ? await getTradesData(selectedLeagueId, userId, leagueCtx).catch((e: unknown) => {
          console.error('[core/trades] read failed', e)
          tradesLoadFailed = true
          return null
        })
      : null

  const tradeValueActions =
    activeKey === 'trades' && selectedLeagueId
      ? await getCrossLeagueValueActions(
          userId,
          playedLeagues.filter((league) => league.id === selectedLeagueId).map((league) => ({
            id: league.id,
            name: league.name,
            platform: String(league.platform ?? 'manual'),
            sport: String(league.sport ?? 'NFL'),
          })),
        ).catch(() => [])
      : []

  /*
   * The cross-league waiver board. Bounded to one candidate-pool read for the
   * whole portfolio — see `waiversBoard.ts` for why a per-league free-agent
   * query is the fan-out that must not be reintroduced here.
   */
  const wantsWaiversBoard = activeKey === 'waivers' && !selectedLeagueId

  /*
   * ⚠ THE SHORTEST TTL OF THE USER-SCOPED SUMMARIES (2 min), because this is the one screen where
   * staleness could change what a reader DOES rather than only what they read: they are usually
   * checking against a waiver deadline and deciding whether to bid. See the module header.
   */
  const waiversBoardOnSummary = isEnabled('sports-os.screen-summaries', userId, DEFAULT_ROLLOUTS)

  const waiversBoardFresh =
    wantsWaiversBoard && waiversBoardOnSummary
      ? await readWaiversBoardSummary(userId, leagues as unknown as Dash34LeagueRow[]).catch(() => null)
      : null

  const waiversBoard = wantsWaiversBoard
    ? waiversBoardOnSummary
      ? (waiversBoardFresh?.data ?? null)
      : await getWaiversBoard(userId).catch(() => null)
    : null

  const waivers =
    activeKey === 'waivers' && selectedLeagueId
      ? await getWaiversData(selectedLeagueId, userId, leagueCtx).catch(() => null)
      : null
  // Competitive Edge on Waivers — read only for a viewer whose plan includes it.
  const waiverEdgeAccess = activeKey === 'waivers' ? (corePaywall?.competitive_edge ?? null) : null
  const waiverEdge = await loadWaiverEdgeForScreen({ waivers, access: waiverEdgeAccess, userId })

  const draftHq =
    activeKey === 'draft-hq' && selectedLeagueId
      ? await getDraftHqData(selectedLeagueId, userId, leagueCtx).catch(() => null)
      : null
  // Competitive Edge on Draft HQ — read only for a viewer whose plan includes it.
  const draftEdgeAccess = activeKey === 'draft-hq' ? (corePaywall?.competitive_edge ?? null) : null
  const draftEdge = await loadDraftEdgeForScreen({
    leagueId: draftHq ? selectedLeagueId : null,
    access: draftEdgeAccess,
    userId,
  })

  /*
   * The per-league draft grid and clock, which Draft HQ now renders above its own
   * board settings — see `draftBoard.ts` for why it moved off the War Room.
   */
  const draftBoard =
    activeKey === 'draft-hq' && selectedLeagueId
      ? await getDraftBoardData(selectedLeagueId, userId, leagueCtx).catch(() => null)
      : null

  /*
   * The War Room carries two rooms on one screen key, the same way `week` carries
   * Rivalry Radar behind `?view=rivalries` — same shell, same header, and no new
   * route at a repo already against the platform's route ceiling.
   *
   * Scout is per-league; Game Plan is CROSS-league and needs no selection, which
   * is also what gives the War Room something to show before a league is picked.
   */
  const gamePlanView = activeKey === 'war-room' && sp.view === 'plan'

  /* The War Room's first room: every manager in the league, profiled. */
  const connectedToolScreen = ['war-room', 'trades', 'waivers', 'my-team', 'draft-hq', 'players'].includes(activeKey)
  const [scout, connectedFranchise] = await Promise.all([
    activeKey === 'war-room' && !gamePlanView && selectedLeagueId
      ? getScoutData(selectedLeagueId, userId, leagueCtx).catch(() => null)
      : Promise.resolve(null),
    connectedToolScreen && selectedLeagueId
      ? resolvePairedHalf(selectedLeagueId, userId, {
          includeOperationalSummary: activeKey === 'war-room',
          leagueContext: leagueCtx,
        }).catch(() => null)
      : Promise.resolve(null),
  ])

  /*
   * The War Room's second room: every flagged starter across every league,
   * soonest lock first.
   *
   * ⚠ THE SAME LOADER THE PLAYER FINDER USES, UNCHANGED — bounded joins over
   * starters, the injury feed and the week's kickoffs. 🛑 NEVER
   * `computeLineupActionsForUser`, which is far too expensive for a page render.
   *
   * 🛑 IT IS ALSO THE WAR ROOM'S NO-LEAGUE STATE NOW, WHICH THE COMMENT ON
   * `gamePlanView` ABOVE HAS CLAIMED SINCE THE SCREEN WAS BUILT: "Game Plan is
   * CROSS-league and needs no selection, which is also what gives the War Room
   * something to show before a league is picked." It was never wired that way.
   * Without a league in scope `/core/war-room` fell straight through to
   * `PickALeague` — reported from a phone as "War room only shows the league
   * list, but none of the important information", which is an exact description
   * of what `PickALeague` renders.
   *
   * ⚠ NO NEW LOADER AND NO NEW QUERY — the condition widened, nothing else.
   */
  const wantsWarRoomPlan = activeKey === 'war-room' && !selectedLeagueId
  const gamePlan =
    (gamePlanView || wantsWarRoomPlan) && userId
      ? await loadGameDayTriage(userId, playedLeagues.map((l) => l.id)).catch(() => null)
      : null

  /*
   * Devy data is loaded only on the devy screens — it is several queries across the whole
   * prospect pool and no other screen reads it.
   */
  const devyCore =
    activeKey === 'devy' && userId
      ? await getDevyCoreData(
          userId,
          rail.map((l) => l.id),
        ).catch(() => null)
      : null

  /*
   * 38a·2 — the live slate.
   *
   * ⚠ NULL USER IS A SUPPORTED INPUT AND MUST STAY ONE. `getLivePageData` takes
   * a nullable userId and simply returns no roster tie-ins; the screen then says
   * so instead of rendering an empty panel. Passing a non-null id here is fine
   * because /core is behind the session gate, but the loader's contract is what
   * lets the same data layer serve the public /live page.
   *
   * `scope` and `sport` are read from the URL so a shared link lands on the same
   * slate the sender was looking at; the client takes over from there.
   */
  /*
   * The clicked-game view opens as `/core/live?game=<id>` — a query on the live
   * screen, not a new route (the repo is at its route ceiling). When it is
   * requested the slate itself is not loaded: the view has its own data.
   */
  const liveGameId = activeKey === 'live' && typeof sp.game === 'string' && sp.game ? sp.game : null
  const liveGameSport = typeof sp.sport === 'string' ? sp.sport : 'NFL'
  const liveGame = liveGameId
    ? await getEspnGameSummary({ sport: liveGameSport, gameId: liveGameId }).catch((err) => {
        console.error('[core/live] game view read threw:', err instanceof Error ? err.message : err)
        return { detail: null, stale: false, failed: true }
      })
    : null

  const liveScores =
    activeKey === 'live' && !liveGameId
      ? await getLivePageData({
          userId,
          sport: typeof sp.sport === 'string' ? sp.sport : 'NFL',
          scope: sp.scope === 'all' ? 'all' : 'my',
        }).catch((err) => {
          /*
           * ⚠ LOG IT. A bare `.catch(() => null)` here is what made the
           * 2026-08-27 outage take three sessions and two wasted deploys to
           * find: the screen says "We could not read the slate", which points
           * at the score fetch, while the actual throw was a missing
           * `league_player_weekly_scores` table in the roster tie-in read.
           * The null return is still the right fallback — but silent it is not.
           */
          console.error(
            '[core/live] getLivePageData threw, rendering the read-failure notice:',
            err instanceof Error ? err.message : err,
          )
          return null
        })
      : null

  /*
   * 38a·7 — the league's points-for board. Reads WeeklyMatchup through the
   * shared frontier rule and refuses to rank a season nobody has played, rather
   * than publishing twelve teams tied on zero.
   */
  /*
   * 38a·6 — your record inside ONE league. Only when a league is held; the
   * cross-league trophy room is what `/core/career` renders without one.
   */
  const leagueCareer =
    activeKey === 'career' && selectedLeagueId && sp.view !== 'share'
      ? await getLeagueCareer(selectedLeagueId, userId, leagueCtx).catch(() => null)
      : null

  const leagueSync =
    activeKey === 'sync' && selectedLeagueId
      ? await getLeagueSync(selectedLeagueId, userId, undefined, leagueCtx).catch(() => null)
      : null

  /*
   * ── Sports OS point 4 + 10: the first screen served from a precomputed summary ──
   *
   * `getLeagueStandings` reads every `WeeklyMatchup` row the league has and re-derives the board on
   * every visit, for every member. `readLeagueStandingsSummary` is the same function behind
   * `lib/sports-os/summaries.ts` — read-through, so a miss costs one rebuild and never a blank
   * board, and the envelope it returns carries the timestamp the screen labels it with.
   *
   * ⚠ BEHIND A ROLLOUT, AND THE FALLBACK IS THE UNCHANGED CALL. Off-cohort users take exactly the
   * path they took before this shipped, so widening the flag is the only thing that changes
   * behaviour and narrowing it is a complete rollback. `userId` is the bucket subject, so a user
   * does not flip cohort between two loads of the same screen.
   *
   * ⚠ `.catch(() => null)` IS KEPT ON BOTH ARMS. The screen already distinguishes a read failure
   * from an unpicked league, and a summary rebuild can fail for exactly the reasons the direct read
   * could. Letting it reject here would replace that message with a Suspense error boundary.
   */
  const standingsOnSummary = isEnabled('sports-os.screen-summaries', userId, DEFAULT_ROLLOUTS)
  /*
   * ⚠ THE SAME FLAG AND THE SAME SUBJECT AS STANDINGS, SO A USER IS WHOLLY ON SUMMARIES OR WHOLLY
   * OFF. A second flag would put one user on a cached standings board and a live week board, which
   * is two experiments at once and neither cleanly measurable.
   */
  const weekOnSummary = standingsOnSummary
  /*
   * ⚠ AND THE SAME SUBJECT AGAIN, FOR THE THIRD SURFACE. `/core/standings` with no league held
   * renders BOTH the standings board and the outlook, so splitting the cohorts would put one
   * screen's two halves on different data paths — the one configuration nothing here could
   * meaningfully measure.
   */
  const outlookOnSummary = standingsOnSummary

  const standingsFresh =
    activeKey === 'standings' && selectedLeagueId && standingsOnSummary
      ? await readLeagueStandingsSummary(selectedLeagueId, userId, leagueCtx).catch(() => null)
      : null

  const standings =
    activeKey === 'standings' && selectedLeagueId
      ? standingsOnSummary
        ? (standingsFresh?.data ?? null)
        : await getLeagueStandings(selectedLeagueId, userId, leagueCtx).catch(() => null)
      : null

  /*
   * Point 9's visible half. The envelope's age becomes a chip in the board's header.
   *
   * ⚠ THE LABEL IS COMPUTED HERE, ON THE SERVER, AND PASSED DOWN. `FreshnessChip` renders this
   * exact string on first paint and only starts recomputing after mount, so SSR and hydration
   * agree by construction rather than by luck — the same reason the board pins its number locale.
   *
   * ⚠ NULL FOR THE OFF-COHORT READ, DELIBERATELY. Most readers still take the direct call, which
   * has no envelope; a chip over that board would be inventing an age for a value that was just
   * computed. No envelope means no chip, never a chip reading "unknown".
   */
  /* View, division and layout — URL state, written back by the board with replaceState. */
  const standingsView = parseStandingsView((param) => sp[param])

  const standingsFreshness = standingsFresh
    ? {
        meta: freshnessMeta(standingsFresh),
        initialLabel: freshnessLabel(standingsFresh),
        initialWarn: shouldWarnAboutFreshness(standingsFresh),
      }
    : null

  /*
   * ── 24a / 24b / 26b / 22c / 26a ────────────────────────────────────
   *
   * Each is loaded only when it is the screen being rendered. Two of them are
   * genuinely expensive — the outlook runs ten thousand simulations per league,
   * and the week board reads every WeeklyMatchup row the user's leagues have —
   * so paying for either on /core/trades would be a cost for something nobody
   * is looking at. Same rule the 34a home loader follows.
   *
   * They take `playedLeagues`, never `leagues`: the unfiltered list carries AF
   * Legacy board rows (hasUnifiedRecord: false), 543 of them on one production
   * account against 60 real teams, and none of them has a schedule to read.
   */
  const weekLeagues = playedLeagues.map((l) => ({
    id: l.id,
    name: l.name,
    platform: String(l.platform ?? ''),
    platformLeagueId: (l as { platformLeagueId?: string | null }).platformLeagueId ?? null,
    /* Only to flag elimination formats — the list already carries it. */
    leagueType: (l as { leagueType?: string | null }).leagueType ?? null,
    /*
     * The league's crest on the week board. Raw columns on purpose: the loader
     * resolves them through `leagueArtUrl`, because a Sleeper `avatarUrl` is an
     * avatar id, not a link.
     */
    logoUrl: (l as { logoUrl?: string | null }).logoUrl ?? null,
    avatarUrl: (l as { avatarUrl?: string | null }).avatarUrl ?? null,
  }))

  /*
   * `?all=1` — the escape hatch out of every ranked board back to the full
   * league picker.
   *
   * ⚠ THIS IS THE ONLY REMAINING ROUTE TO `PickALeague` ON A BOARD SCREEN, and
   * the 2026-09-07 handoff is why: each board replaced the picker's grid with a
   * footer line that accounts for the leagues it did not show. Every board's
   * footer CTA points here unconditionally, so a manager whose leagues are all
   * quiet still has a way in — which was the stated reason (2026-08-30) the old
   * boards were composed ABOVE the picker rather than replacing it.
   */
  const showAllLeagues = sp.all === '1' || sp.all === 'true'

  /*
   * The current URL, rebuilt — what `ScreenLoadError`'s "try again" points at.
   *
   * ⚠ IT KEEPS `?league=`, WHICH IS THE WHOLE POINT. A retry that dropped the
   * league would land on the picker, i.e. exactly the behaviour the error screen
   * exists to replace. Same reconstruction the guard at the top of this file uses
   * for its redirect, minus that one's deliberate `league` exclusion.
   */
  const retryHref = (() => {
    const params = new URLSearchParams()
    for (const [key, value] of Object.entries(sp)) {
      if (typeof value === 'string') params.set(key, value)
      else if (Array.isArray(value) && typeof value[0] === 'string') params.set(key, value[0])
    }
    const query = params.toString()
    return `/core${segment ? `/${segment}` : ''}${query ? `?${query}` : ''}`
  })()

  const rivalriesView = activeKey === 'week' && sp.view === 'rivalries'

  const weekBoard =
    activeKey === 'week' && !rivalriesView
      ? // 38a·3 — the focused league gets its own board (hero + the league's
        // other matchups). Passing null keeps the cross-league board exactly as
        // it was and pays nothing for the extra pairing.
        await getWeekBoard(userId, weekLeagues, selectedLeagueId).catch(() => null)
      : null

  const rivalries = rivalriesView
    ? await getRivalryRadar(userId, weekLeagues).catch(() => null)
    : null

  /*
   * ⚠ SHARED WITH `/core/standings`, WHICH IS NOT A SECOND SIMULATION. The
   * cross-league standings board ranks on `you.seed` and prints `you.playoffPct`
   * beside it — both come out of this one run. Computing seeds separately for
   * that screen would give two surfaces two different answers to "where do I
   * sit", which is the failure `seasonOutlook.ts` documents at its own head.
   *
   * The cost only lands on a standings request that has NO league held; with a
   * league selected the per-league screen loads instead and this stays null.
   */
  const wantsOutlook =
    activeKey === 'season-outlook' ||
    ((activeKey === 'standings' || activeKey === 'week') && !selectedLeagueId && !rivalriesView)

  /*
   * ── 26b ON SUMMARIES ───────────────────────────────────────────────
   *
   * The most expensive read in this file by orders of magnitude: ~49 million simulated games on a
   * 63-league account, on a `force-dynamic` route that pays it every visit. See
   * `lib/core-app/seasonOutlookSummary.ts` for why the focus league is part of the cache key and
   * why the summary cannot change the board's numbers — the model is seeded, so a hit and a cold
   * run produce the same board.
   *
   * ⚠ `selectedLeagueId` IS PASSED THROUGH UNCHANGED ON BOTH ARMS. It is `getSeasonOutlook`'s
   * `focusLeagueId`, and it is what guarantees the league on screen gets its swing card; handing
   * the summary a different value than the direct call takes is how the two paths would come to
   * disagree about a card's presence rather than its contents.
   *
   * ⚠ `.catch(() => null)` ON BOTH ARMS, as with standings: a rebuild fails for the same reasons
   * the direct read does, and the screen already renders an outlook-less state. Rejecting here
   * would replace it with a Suspense error boundary.
   */
  const outlookLeagues = playedLeagues.map((l) => ({
    id: l.id,
    name: l.name,
    platform: String(l.platform ?? ''),
    platformLeagueId: (l as { platformLeagueId?: string | null }).platformLeagueId ?? null,
    settings: (l as { settings?: unknown }).settings ?? null,
  }))

  /*
   * ⚠ THE FINGERPRINT IS PART OF THE SUMMARY KEY. A scored week, an import, a roster move, an
   * injury-feed run or a new projection week changes it, so the next read is a cold build rather
   * than the previous board served until a TTL runs out — see `seasonOutlookSummary.ts`. The roster
   * stamps are only read for the league on screen, which is the only board that uses rosters.
   */
  const outlookFingerprint =
    wantsOutlook && outlookOnSummary
      ? await seasonOutlookFingerprint(
          outlookLeagues,
          activeKey === 'season-outlook' ? selectedLeagueId : null,
        ).catch(() => null)
      : null

  const outlookFresh =
    wantsOutlook && outlookOnSummary
      ? await readSeasonOutlookSummary(userId, selectedLeagueId, outlookFingerprint).catch(() => null)
      : null

  const outlook = wantsOutlook
    ? outlookOnSummary
      ? (outlookFresh?.data ?? null)
      : await getSeasonOutlook(userId, outlookLeagues, selectedLeagueId).catch(() => null)
    : null

  /* The board's age, for the same chip Standings shows. Null off-cohort, as there. */
  const outlookFreshness = outlookFresh
    ? {
        meta: freshnessMeta(outlookFresh),
        initialLabel: freshnessLabel(outlookFresh),
        initialWarn: shouldWarnAboutFreshness(outlookFresh),
      }
    : null

  const notifications =
    activeKey === 'notifications'
      ? await getNotificationsCenter({
          userId,
          issues: derivedIssues,
          now,
          // 38a filters the feed to the league in the rail. Scoped in the
          // loader, not the screen: counts and the unread total are derived
          // from the rows, so filtering afterwards would show one league's
          // rows under the whole account's numbers.
          leagueId: selectedLeagueId,
        }).catch(() => null)
      : null

  // 26a reads the same career payload the career screen does — no second source
  // of truth for the numbers that end up on a card the user posts publicly.
  const shareCareer =
    activeKey === 'share' ? await getCareerData(userId).catch(() => null) : null

  /*
   * The Tools hub's stat teasers. Counted, not estimated — `LeagueTrade` is the
   * table the Trades screen itself reads, so the teaser and the screen behind it
   * cannot disagree. A `catch` returns null rather than 0, because "we could not
   * count" and "there are none" are different claims and the card says so.
   */
  /*
   * ⚠ THE JOIN IS `history.sleeperLeagueId`, WHICH IS THE PLATFORM ID, NOT
   * `League.id`. `LeagueTrade` has no leagueId column at all — it hangs off
   * `LeagueTradeHistory`, which is keyed on (sleeperLeagueId, sleeperUsername).
   * That table is ingestion PROGRESS, so its row exists whether or not any trade
   * was ever loaded; counting the child rows is what actually answers "how many
   * trades do we hold".
   */
  const tradesOnFile =
    activeKey === 'tools' && weekLeagues.some((l) => l.platformLeagueId)
      ? await prisma.leagueTrade
          .count({
            where: {
              history: {
                sleeperLeagueId: {
                  in: weekLeagues
                    .map((l) => l.platformLeagueId)
                    .filter((v): v is string => typeof v === 'string' && v.length > 0),
                },
              },
            },
          })
          .catch(() => null)
      : null


  /*
   * The 34a summary. Only loaded when a screen that shows it is being rendered — it reads
   * rosters and the injury feed, and paying for that on /core/trades would be a
   * cost for something nobody is looking at.
   *
   * ⚠ AWAITED HERE FOR DASHBOARD V2 ONLY. The /core home starts the same read without waiting
   * (`homeLoads.dash34` below) so each of its cards can stream the moment its own data lands.
   * On every other screen this stays null.
   */
  const dash34 =
    segment === 'dashboard-v2' && !selectedLeagueId
      ? await getDash34Data(userId, leagues as unknown as Dash34LeagueRow[], now).catch(() => null)
      : null

  /*
   * ONE URGENCY VOICE. dash34's brief states urgent facts — "N leagues have a
   * starter who cannot play", "N drafts are on the clock" — that
   * deriveOutstandingIssues cannot detect (its only live detectors are
   * stale_sync and draft_upcoming). Ask Chimmy's count and the "Nothing is
   * waiting on you" empty state key off this array, so without the merge the
   * queue could read clean while the brief two cards up says otherwise.
   * Synthesized from reads the loader already performed (the injury feed and
   * the draft stage), never invented — and dash34 is null on every screen but
   * dashboard v2, so the merge is the identity everywhere else. The home applies
   * this same merge to its streamed read (`homeLoads.issues`).
   */
  const issues = mergeDash34Issues(derivedIssues, dash34)

  /*
   * ── 38a·9 Commissioner Hub ─────────────────────────────────────────
   *
   * ⚠ THIS KEY HAD NO RENDER BRANCH AND FELL THROUGH TO "has not been built
   * yet". It is a real screen now, and the gate that decides whether you see it
   * runs inside `getCommissionerHub`, server-side, before any league figure is
   * read — not in the component, and not in the browser.
   *
   * The issue list is passed in rather than re-derived so the queue on this
   * screen and the badge in the nav cannot disagree about what "needs
   * attention" means. It is computed above, and this call deliberately sits
   * after it: reading `issues` any earlier is a temporal-dead-zone crash,
   * not merely a stale list.
   */
  const commissionerHub =
    activeKey === 'commissioner' && segment !== 'discord' && selectedLeagueId
      ? await getCommissionerHub({
          leagueId: selectedLeagueId,
          userId,
          issues: issues.filter((i) => i.leagueId === selectedLeagueId),
          now,
          depth: corePaywall?.commissioner_depth ?? null,
        }).catch(() => null)
      : null

  /*
   * The all-leagues Commissioner Hub — `/core/commissioner` with no league. Matched on
   * `segment` because /core/discord and /core/hubs share the commissioner nav key. The
   * candidates are the leagues the nav badge counts, so the "All leagues" pill and the
   * badge describe the same set; the loader keeps only those the one-league gate admits.
   */
  const commissionerOverview =
    activeKey === 'commissioner' && segment === 'commissioner' && !selectedLeagueId
      ? await getCommissionerOverview({
          userId,
          candidateLeagueIds: playedLeagues.filter((l) => Boolean(l.isCommissioner)).map((l) => l.id),
          issues,
          now,
        }).catch((e: unknown) => {
          console.error('[core/commissioner] overview read failed', e)
          return null
        })
      : null

  /*
   * The 3a home panels — the same loader set app/dashboard/page.tsx ran before
   * that route retired into a redirect here. Loaded ONLY when the 3a home is
   * the screen being rendered, never for the dashboard-v2 segment. Exposure and
   * rivals read every played league, but the win probability is priced ONLY for
   * the four leagues whose matchup cards actually render — getMatchupData runs
   * several queries per league, and pricing 60 of them to display four would be
   * work nobody sees.
   */
  const isHome3a = activeKey === 'home' && segment !== 'dashboard-v2' && !selectedLeagueId

  /*
   * ── THE HOME'S READS: STARTED HERE, AWAITED BY THE CARD THAT SHOWS THEM ──────────────────────
   *
   * Every read below used to be awaited in line — the summary, then the week, then thirteen reads
   * together, then the brief, the win probabilities and the drafts — so the home arrived when its
   * SLOWEST read finished. Now each is a promise, started immediately, and handed to
   * `CoreHomeCards` (components/core-app/home/HomeCards.tsx), where every card waits only for what
   * it shows. A read that depends on another chains on that one promise; nothing is read twice.
   *
   * Each keeps the fallback it had. A read that CANNOT fail by itself (a derived value built from
   * reads that already degrade) is left to reject on a real bug — its card's error boundary then
   * reports it — rather than being hidden behind a `.catch`.
   *
   * `traceCard` names each read in the request's trace (lib/observability/cardTelemetry.ts), so a
   * slow card is attributable.
   */
  /*
   * The home's leagues, narrowed to its scope (`all` everywhere but a scoped home, where these are
   * the same lists as above). Every home read below takes these, so every card describes the same
   * set of leagues the switcher names.
   *
   * ⚠ A SCOPED HOME MUST NOT WRITE WHOLE-PORTFOLIO STATE FROM A PARTIAL READ:
   *   - the "since your last visit" marker stores standings and injury baselines, and the next visit
   *     diffs against them, skipping whatever is absent — so a scoped render does not move the visit;
   *   - the tab badges' lineup cache is the whole portfolio's, so a scoped summary does not refresh
   *     it (`lineupLeagues` below).
   * The pending-offers write is per league and merges, so a scoped trade scan records only what it
   * saw and forgets nothing.
   */
  const homeScoped = isHome3a && isScoped(homeScope)
  const homePlayed = homeScoped ? applyHomeScope(playedLeagues, homeScope, favoriteIds) : playedLeagues
  const homeIds = new Set(homePlayed.map((l) => l.id))
  const homeLeagueRows = homeScoped ? leagues.filter((l) => homeIds.has(l.id)) : leagues
  const homeWeekLeagues = homeScoped ? weekLeagues.filter((l) => homeIds.has(l.id)) : weekLeagues
  const homeDerivedIssues = homeScoped
    ? deriveOutstandingIssues({
        leagues: homePlayed,
        lastSyncByLeague: lastSyncByLeagueFrom(
          homePlayed as unknown as Array<{ id: string; lastSyncedAt?: Date | string | null }>,
        ),
      }).issues
    : derivedIssues

  const homeRecordVisit = isHome3a ? !isSpeculativeRequestHeaders(await headers()) : false
  /*
   * The portfolio summary rides the same flag and bucket as the week and standings summaries — see
   * `weekOnSummary` above — and serves both the home and the tab badges on every other screen.
   */
  const portfolioOnSummary = standingsOnSummary
  const homeLoads: HomeLoads | null = !isHome3a
    ? null
    : homeScoped && homePlayed.length === 0
      ? /*
         * A scope that matches no league renders only its "no leagues in this view" panel, so it
         * reads nothing — not the summary, not the trade scan, not a single card's query.
         */
        emptyHomeLoads()
      : (() => {
        /*
         * The whole-portfolio home reads its prebuilt summary (lib/core-app/homePortfolioSummary.ts)
         * for users on screen summaries; a scoped home always joins live, because a subset's result
         * is not a filter of the whole one. Both reject the same way, so the fallback is unchanged.
         */
        const summary = traceCard('dash34', () =>
          portfolioOnSummary && !homeScoped
            ? readHomePortfolio(userId, homeLeagueRows as unknown as Dash34LeagueRow[], now)
            : getDash34Data(userId, homeLeagueRows as unknown as Dash34LeagueRow[], now),
        ).catch(() => null)
        const mergedIssues = summary.then((data) => mergeDash34Issues(homeDerivedIssues, data))

        const tradeWeek = traceCard('trade-week', () =>
          resolveCurrentWeek(
            homePlayed
              .map((league) => (league as { platformLeagueId?: string | null }).platformLeagueId ?? '')
              .filter(Boolean),
          ),
        )
          .then((value) => value?.week ?? null)
          .catch(() => null)

        /*
         * Sports OS point 4: the cross-league week board from a precomputed summary.
         *
         * ⚠ STILL INSIDE `traceCard`, DELIBERATELY. The card span is what makes this read visible
         * per-card in Sentry and what carries its budget verdict; a cache HIT should show up there
         * as a fast card, not vanish from the trace. Measuring the cheap path is the point.
         *
         * 🛑 NEVER ON A SCOPED HOME (#928's scope switcher, lib/core-app/homeScope.ts). The summary is
         * the user's WHOLE portfolio — its build re-derives the league list itself — so on a home
         * filtered to one sport or platform it would show every league's scores under a
         * "Showing NBA leagues" note. A scoped home reads its own leagues, live.
         */
        const weekAll = traceCard('week', () =>
          weekOnSummary && !homeScoped
            ? readWeekAllSummary(userId).then((entry) => entry?.data ?? null)
            : getWeekAll(userId, homeWeekLeagues),
        ).catch(() => null)

        /*
         * WHO you play, which getWeekAll cannot answer: it drops every 0-0 row
         * by design, so before a week is scored the matchup section has
         * nothing to render. getWeekBoard pairs on matchupId without ever
         * reading points, and costs three set-based queries plus one shared
         * cached kickoff read no matter how many leagues — the same shape as
         * its neighbours here, not a per-league fan-out. `activeKey` is 'home'
         * on this branch and 'week' on the other caller above, so the two are
         * mutually exclusive and nothing is fetched twice.
         */
        const schedule = traceCard('schedule', () => getWeekBoard(userId, homeWeekLeagues)).catch(() => null)

        /*
         * Trades that landed in the last fortnight. Reads the cache the
         * fifteen-minute grade cron already fills — see lib/core-app/recentTrades
         * for why the product has been telling users this data does not exist.
         */
        /*
         * Set when the trades read cannot stand behind what it returned, so the brief below does not
         * close the TRADE window over trades it never saw. Two different things:
         *   `tradesFailed`     — the whole read rejected. Rare, and its fallback is `[]`.
         *   `tradesIncomplete` — the read RESOLVED while blind to part of the picture. That is the
         *                        common case, because every source inside it degrades instead of
         *                        throwing: the grade cache falls back to `[]`, each league's live
         *                        scan catches its own failure, and a scan that answered for one of
         *                        its three weeks still reports success. `onIncomplete` below is the
         *                        loader saying which of those happened.
         */
        let tradesFailed = false
        let tradesIncomplete = false
        // The pending-offers cache write the trade scan fires — see `offersSettled` below.
        let offersRecorded: Promise<unknown> = Promise.resolve()
        // Only a Sleeper identity makes the scan report offers at all, and only a report writes the row.
        const scanWillRecordOffers = Boolean(leagueListPayload?.sleeperUserId)
        const trades = traceCard('trades', () =>
          tradeWeek.then((currentWeek) =>
            getRecentTrades(
              homePlayed.map((l) => ({
                id: l.id,
                name: l.name,
                platformLeagueId: (l as { platformLeagueId?: string | null }).platformLeagueId ?? null,
                platform: String(l.platform ?? ''),
                avatarUrl: (l as { avatarUrl?: string | null }).avatarUrl ?? null,
                sport: String(l.sport ?? 'NFL'),
              })),
              now,
              HOME_RECENT_TRADES_LIMIT,
              {
                viewerUserId: userId,
                ownerSleeperId: leagueListPayload?.sleeperUserId ?? null,
                currentWeek,
                reconcileLive: true,
                enrichLeagueContext: true,
                maxLeagues: 8,
                /*
                 * The same scan sees offers waiting on you; the Trades urgency badge
                 * reads them from the cache instead of scanning again on every tab.
                 * Not awaited by any card: a badge that lags one render is inside the
                 * 10-minute freshness rule, and recording it must never slow the home.
                 */
                onPendingOffers: (scanned) => {
                  offersRecorded = recordPendingOffers(userId, scanned, now).catch(() => undefined)
                },
                // Every way this read can come back partial — see the flag above, and the loader's
                // own note on the three permanent bounds it deliberately does NOT report.
                onIncomplete: () => {
                  tradesIncomplete = true
                },
              },
            ),
          ),
        ).catch(() => {
          tradesFailed = true
          return []
        })
        /*
         * ⚠ THE TAB BADGES WAIT FOR THIS, NOT FOR THE SUMMARY ALONE. `getUrgencyBadges` and
         * `recordPendingOffers` each read the one `core-urgency` cache row and write it back WHOLE.
         * When the badges ran after every home read, the offers write had a head start; running
         * independently, either could overwrite the other — dropping the new offers, or restoring an
         * old lineup count. The badges stream, so no card waits for this.
         *
         * ⚠ BUT ONLY WHEN A WRITE IS ACTUALLY COMING. Without a Sleeper identity the scan reports
         * nothing and writes nothing, so waiting on it would put the slowest read on the page in
         * front of the badges for no reason at all.
         *
         * ⚠ AND THERE IS A THIRD WRITER, safe today only by sequencing: lib/core-app/leagueHome.ts
         * also calls `recordPendingOffers` on the `/core?league=<id>` path. Nothing orders it against
         * these two except that `leagueHome` is awaited long before this runs. Move either read into
         * the streaming set and it is the same clobber.
         *
         * The real fix is for all three to stop sharing a row they each rewrite whole — a
         * field-scoped write, so none can clobber another and the badges need not wait.
         */
        const offersSettled = scanWillRecordOffers
          ? trades.then(() => offersRecorded).then(() => undefined)
          : Promise.resolve()

        // A fresh array per reader, as each had before: neither can see what the other does to its input.
        const routineLeagues = () =>
          homePlayed.map((l) => ({
            id: l.id,
            name: l.name,
            platform: String(l.platform ?? ''),
            platformLeagueId: (l as { platformLeagueId?: string | null }).platformLeagueId ?? null,
            season: (l as { season?: number | string | null }).season ?? null,
          }))

        /*
         * Decision receipts (2026-09-14): how your trades and waiver adds turned out.
         * Trades: one read of the trade-grade cache the sweep already fills, your side found
         * by your Sleeper user id. Waiver adds: this season's transaction facts for your
         * claimed rosters plus the weekly scores of the players you added (five set-based
         * queries, at most 12 leagues). Each kind fails on its own; null hides the card.
         */
        const receipts = traceCard('receipts', () =>
          tradeWeek.then((currentWeek) =>
            getDecisionReceipts({
              userId,
              leagues: routineLeagues(),
              ownerSleeperId: leagueListPayload?.sleeperUserId ?? null,
              currentWeek,
            }),
          ),
        ).catch(() => null)

        /*
         * The weekly routine's reads (2026-09-14): the last fully played week and its top
         * starter, and this week's adds from the transaction facts the receipts already read.
         * Each fails to null ("unknown"), never to "none".
         */
        const routineFacts = traceCard('routine-facts', () =>
          tradeWeek.then((currentWeek) =>
            getRoutineFacts({
              userId,
              leagues: routineLeagues(),
              currentWeek,
              // Weekly awards are keyed by your Sleeper user id; read from the H2H cache, never Sleeper.
              ownerSleeperId: leagueListPayload?.sleeperUserId ?? null,
            }),
          ),
        ).catch(() => null)

        /*
         * The routine card, built from those reads plus what the home already holds: the injury book's
         * starters in doubt (the triage band's own rule) and this week's schedule. A missing dash34 is
         * "unknown" for lineups, not "no starters in doubt".
         */
        const routine = Promise.all([routineFacts, summary, schedule]).then(([facts, data, board]) =>
          buildWeeklyRoutine({
            now,
            lastWeek: facts?.lastWeek ?? null,
            topScorer: facts?.topScorer ?? null,
            addsThisWeek: facts?.addsThisWeek ?? null,
            startersInDoubt: data
              ? ((data.book ?? []) as unknown as TriageBookRow[]).filter((p) => p.tone === 'bad' && p.startingIn > 0).length
              : null,
            schedule: board ?? null,
            awards: facts?.awards ?? [],
            upsets: facts?.upsets ?? [],
          }),
        )

        /*
         * P4-5: the /core home's ONE Decision OS read — the deterministic user-os
         * snapshot for the league that most needs the user right now. "Most urgent"
         * follows the same ladder the home itself leads with: dash34's first
         * priority === 'urgent' league (a starter who cannot play), then its first
         * priority === 'draft' league, then the head of the issues queue (already
         * sorted severity-then-deadline inside deriveOutstandingIssues), falling
         * back to the first played league.
         * One league only, loaded only when the 3a home renders, and resolved
         * directly rather than through /api/decision-os/user-os: membership is
         * already established by the league list read above, and
         * resolveUserOsSnapshot scopes every fact to the caller's own managerId.
         * It never throws, and a null here renders NOTHING — see DashUserOs.
         */
        const userOs = traceCard('user-os', () =>
          Promise.all([summary, mergedIssues]).then(async ([data, merged]) => {
            const ranked = data?.allLeagues ?? data?.leagues ?? []
            const anchorId =
              ranked.find((l) => l.priority === 'urgent')?.id ??
              ranked.find((l) => l.priority === 'draft')?.id ??
              merged.find((i) => i.leagueId != null)?.leagueId ??
              null
            const league = homePlayed.find((l) => l.id === anchorId) ?? homePlayed[0] ?? null
            if (!league) return { snapshot: null, league: null }
            const snapshot = await resolveUserOsSnapshot(league.id, userId).catch(() => null)
            return { snapshot, league: { id: league.id, name: league.name } }
          }),
        )

        /*
         * "Since your last visit" — lib/core-app/sinceLastVisit. After the trades read
         * because its trade line summarises the trades loaded just above; passing
         * the same limit is what lets it say "3+" instead of a count it cannot stand
         * behind. A prefetch reads the brief but never moves the visit: Next prefetches
         * links as they scroll into view, and a window that reset on a hover would tell
         * someone away for a week that nothing changed.
         *
         * ⚠ AND A TRADES READ THAT COULD NOT SEE EVERYTHING DOES NOT MOVE THE TRADE BOUNDARY. Its
         * fallback is `[]` at every level, so the brief would say nothing traded AND close the
         * window — and the trades it never read would never appear in any brief. A rejection
         * (`tradesFailed`) is the rare shape; the common one is a resolve that is simply blind in
         * part (`tradesIncomplete`), which is why the loader now reports that itself.
         *
         * ⚠ THIS HOLDS THE TRADE BOUNDARY, NOT THE VISIT — and the difference is the whole design.
         * Holding the whole marker back (the first version of this) meant one flaky league froze
         * the standings and injury baselines too, and a new user whose first render had one league
         * fail would sit at "we cannot compare yet" indefinitely. See `tradesSeenAt` in
         * sinceLastVisit.
         *
         * 🛑 DO NOT READ THAT AS "THE OTHER READS SUCCEEDED". An earlier version of this note said
         * exactly that, and nothing checks it: `snapshotStandings` and `snapshotInjuries` degrade
         * to empty the same way the trades read does, and an empty snapshot is written as the NEXT
         * visit's baseline, where the diffs skip everything absent from it. The standings half is
         * PERMANENT, not one visit — results between a blind render and the one after it are never
         * reported by any brief. A real defect on a different axis, named on `tradesSeenAt`, and
         * NOT covered by this gate.
         */
        const brief = traceCard('since-last-visit', () =>
          trades.then((recentTrades) =>
            getSinceLastVisit({
              userId,
              leagues: homePlayed.map((l) => ({
                id: l.id,
                name: l.name ?? null,
                sport: (l as { sport?: string | null }).sport ?? null,
                // For the brief's provider handoff links (2026-09-14).
                platform: l.platform ?? null,
                platformLeagueId: (l as { platformLeagueId?: string | null }).platformLeagueId ?? null,
                season: l.season ?? null,
              })),
              recentTrades,
              tradesLimit: HOME_RECENT_TRADES_LIMIT,
              now,
              recordVisit: homeRecordVisit && !homeScoped,
              tradesComplete: !tradesFailed && !tradesIncomplete,
            }),
          ),
        ).catch(() => null)

        /*
         * ⚠ PRICE THE CARDS THAT RENDER, NOT THE FIRST FOUR LEAGUES. Dashboard3A's
         * matchup grid shows `scored.slice(0, 4)` — live-scored leagues first, then
         * weekAll's scored rows — and `scoredMatchupLeagueIds` replicates that exact
         * derivation from the same inputs. Pricing `playedLeagues.slice(0, 4)` paid
         * several queries per league for cards showing a DIFFERENT league — or,
         * before the season starts, no card at all. When the scored set is empty,
         * nothing is priced: zero round-trips instead of four.
         *
         * After the summary and the week, because it needs both; it only prices when
         * at least one card will render, which is exactly when the work is visible.
         *
         * Only leagues whose BOTH lineups priced land in the result. An absent entry renders no
         * percentage at all rather than a hedged one — a greyed-out probability still
         * reads as a probability.
         */
        const winProb = traceCard('win-probability', () =>
          Promise.all([summary, weekAll]).then(async ([data, week]) => {
            const scoredIds = scoredMatchupLeagueIds((data?.leagues ?? []).filter((l) => l.score).map((l) => l.id), week)
            const priced = scoredIds.length
              ? await Promise.all(
                  scoredIds.map((id) =>
                    getMatchupData(id, userId)
                      .then((m) => ({ id, m }))
                      .catch(() => ({ id, m: null })),
                  ),
                )
              : []
            const probabilities: Record<string, number> = {}
            for (const { id, m } of priced) {
              if (m?.winProbability.available) probabilities[id] = m.winProbability.data.pWin
            }
            return probabilities
          }),
        )

        /*
         * Drafts on the clock — the same cross-league aggregator the dashboard-v2
         * segment reads (three set-based queries regardless of league count).
         * playedLeagues, NOT leagues, for the same AF-Legacy reason as the v2 call
         * site — the unfiltered list carries hundreds of past-season board rows. A
         * loader failure is null, and null renders NOTHING — see DashDraftsBand.
         */
        const drafts = traceCard('drafts', () =>
          getDraftHqAll(
            userId,
            homePlayed.map((l) => ({
              id: l.id,
              name: l.name,
              platform: String(l.platform ?? ''),
              imageUrl: (l as { avatarUrl?: string | null }).avatarUrl ?? null,
            })),
          ),
        ).catch(() => null)

        // Derived values reject only on a bug, and their card reports it; mark them handled so a
        // navigation that drops the card before it awaits never surfaces as an unhandled rejection.
        for (const derived of [mergedIssues, routine, userOs, winProb]) derived.catch(() => undefined)

        return {
          dash34: summary,
          issues: mergedIssues,
          career: traceCard('career', () => getCareerData(userId)).catch(() => null),
          week: weekAll,
          winProb,
          /*
           * Exposure and rivals re-read every claim, roster and past result the user has — from
           * their own portfolio summaries on an unscoped home for users on screen summaries
           * (lib/core-app/homePortfolioSummary.ts), live otherwise. Separate records, so each
           * card still streams on its own.
           */
          exposure: traceCard('exposure', () =>
            portfolioOnSummary && !homeScoped
              ? readHomeExposure(userId, homeLeagueRows as unknown as Dash34LeagueRow[], now)
              : getCrossLeagueExposure(userId, homePlayed.map((l) => l.id)),
          ).catch(() => null),
          rivals: traceCard('rivals', () =>
            portfolioOnSummary && !homeScoped
              ? readHomeRivals(userId, homeLeagueRows as unknown as Dash34LeagueRow[], now)
              : getRivalRecords(userId, homePlayed.map((l) => l.id)),
          ).catch(() => null),
          /*
           * Players followed across every league (2026-09-14). One read of the follow list
           * plus the injury port and one fixture window for the shown rows. Null when follows
           * are unavailable, which hides the card. The leagues feed the waiver nudge ("free
           * agent in Ice Kings"), which reads every roster of up to 12 of your leagues once.
           */
          following: traceCard('following', () =>
            getFollowingCard(
              userId,
              now,
              homePlayed.map((l) => ({
                id: l.id,
                name: l.name,
                platform: String(l.platform ?? ''),
                sport: (l as { sport?: string | null }).sport ?? null,
              })),
            ),
          ).catch(() => null),
          receipts,
          routine,
          userOs,
          schedule,
          /*
           * The game-day pair. Both were built for the dashboard-v2 segment and
           * mounted nowhere else, so the home had nothing that moved during the
           * six hours a manager actually sits in it. getPlayFeed is
           * readPlayByPlayFeed plus headshots and a composed headline; both
           * return quiet values off a slate ([] and an unavailable record), and
           * the band renders nothing on them.
           */
          strip: traceCard('today-strip', () =>
            getTodayStrip(
              userId,
              homePlayed.map((l) => ({
                id: l.id,
                name: l.name,
                sport: (l as { sport?: string | null }).sport ?? null,
                platformLeagueId: (l as { platformLeagueId?: string | null }).platformLeagueId ?? null,
                /* The health tile's primary gate — see the v2 caller's note. */
                lastSyncedAt: (l as { lastSyncedAt?: Date | string | null }).lastSyncedAt ?? null,
              })),
              now,
            ),
          ).catch(() => null),
          plays: traceCard('plays', () => getPlayFeed(12)).catch(() => []),
          /*
           * Has the regular season actually kicked off? The game-day band claimed
           * in prose that it must not render over preseason football and then did
           * not enforce it — a live-looking band over a Saturday exhibition
           * nobody's lineup scores. Cached and user-independent, so it costs
           * nothing per viewer.
           */
          regularSeason: traceCard('regular-season', () => hasRegularSeasonStarted('NFL')).catch(() => false),
          trades,
          brief,
          drafts,
          offersSettled,
        }
      })()

  /*
   * ⚠ THE CROSS-LEAGUE DRAFT HQ BOARD reads the same aggregate the home's drafts band does —
   * the home now starts its own copy above, and this screen awaits it here. They are different
   * screens, so it is still one read per render.
   *
   * The cross-league War Room used to be a third consumer. It is now the Scout
   * hub and reads no drafts at all.
   */
  const wantsAllDrafts = activeKey === 'draft-hq' && !selectedLeagueId

  const homeDrafts = wantsAllDrafts
    ? await getDraftHqAll(
        userId,
        playedLeagues.map((l) => ({
          id: l.id,
          name: l.name,
          platform: String(l.platform ?? ''),
          imageUrl: (l as { avatarUrl?: string | null }).avatarUrl ?? null,
        })),
      ).catch(() => null)
    : null

  /*
   * The tail of each LIVE draft's board, for the cross-league Draft HQ.
   *
   * ⚠ SCOPED TO THE LIVE LEAGUES ONLY, AND ONLY ON THAT SCREEN. Reading the pick
   * tail for sixty finished drafts to render two running ones is the fan-out
   * `draftHqAll.ts` exists to avoid; with nothing live this does not query at all.
   *
   * ⚠ AND `undefined` WHEN IT DID NOT RUN, NOT AN EMPTY OBJECT. `DraftHqBoard`
   * treats an absent `picks` as "not loaded" and skips the live block entirely;
   * an empty object would be indistinguishable from a live draft whose board we
   * read and found empty, which is a different and wrong claim.
   */
  const liveDraftPicks =
    activeKey === 'draft-hq' && !selectedLeagueId && homeDrafts
      ? await getLiveDraftPicks(
          userId,
          homeDrafts.rows.filter((r) => r.phase === 'live').map((r) => r.leagueId),
        ).catch(() => undefined)
      : undefined

  /*
   * The activation funnel signal, carried over from /dashboard when that route
   * retired into a redirect here — a cut-over that silently stopped counting
   * activations would be invisible until someone asked why the funnel died.
   * Contract unchanged: not awaited, never throws, idempotent per user, and a
   * null league list means "unknown", not "zero".
   */
  if (isHome3a) {
    void recordDashboardActivation({
      userId,
      leagueCount: leagueListPayload ? leagueListPayload.leagues.length : null,
      getCookie: (name) => cookies().get(name)?.value,
    })
  }

  /*
   * Dashboard v2 — served AFTER the session gate (a signed-in surface that needs
   * the user's leagues) but OUTSIDE AfCoreShell, because it brings its own 300px
   * left panel. Inside the shell it would render a league rail beside a league
   * panel.
   *
   * No new route: a segment on the existing catch-all, which is what this route
   * exists for. The repo sits at Vercel's hard 2048-route ceiling.
   */

  /*
   * `plan` and `syncAge` arrive from the shell phase in `ctx`, computed once in `AfCorePage` for
   * the chrome and reused here — this dispatch reads both.
   */
  if (segment === 'dashboard-v2') {
    /*
     * Both of these are CROSS-LEAGUE, which is why they can feed this screen.
     * getDraftHqData and getScoutData take a leagueId — they are per-league
     * and cannot back a cross-league module. Wiring one of them to a single
     * arbitrary league would put one league's draft under a header that says
     * "all leagues", so those sections stay placeholders until an aggregator
     * exists.
     */
    const [careerData, portfolioData, draftData, weekData, stripData, playEvents] = await Promise.all([
      getCareerData(userId).catch(() => null),
      getPortfolio(userId).catch(() => null),
      /*
       * playedLeagues, NOT leagues. The unfiltered list carries AF Legacy board
       * rows (hasUnifiedRecord: false) — 543 of them on one production account
       * against 60 real teams. Passing those in would widen the IN () clause to
       * 604 ids and put past-season snapshots in a live draft rail. Same filter
       * the rail and the home loader apply, for the same reason.
       */
      getDraftHqAll(
        userId,
        playedLeagues.map((l) => ({
          id: l.id,
          name: l.name,
          platform: String(l.platform ?? ''),
          imageUrl: (l as { avatarUrl?: string | null }).avatarUrl ?? null,
        })),
      ).catch(() => null),
      /*
       * The same board, same rollout as the home card above — so a user in the cohort gets the
       * cached board on BOTH surfaces and one consistent answer, rather than a cached card beside
       * a freshly-computed board disagreeing with it.
       */
      (weekOnSummary
        ? readWeekAllSummary(userId).then((entry) => entry?.data ?? null)
        : getWeekAll(
            userId,
            playedLeagues.map((l) => ({
              id: l.id,
              name: l.name,
              platform: String(l.platform ?? ''),
              platformLeagueId: (l as { platformLeagueId?: string | null }).platformLeagueId ?? null,
            })),
          )
      ).catch(() => null),
      /*
       * The three top cards. `lastSyncedAt` is passed through because it is the
       * health tile's primary gate — the engine reports high confidence on the
       * strength of roster rows alone, and production has 873 rosters across
       * leagues that have never once been synced. Dropping this field here would
       * silently re-open the exact bug the tile exists to prevent.
       */
      getTodayStrip(
        userId,
        playedLeagues.map((l) => ({
          id: l.id,
          name: l.name,
          sport: (l as { sport?: string | null }).sport ?? null,
          platformLeagueId: (l as { platformLeagueId?: string | null }).platformLeagueId ?? null,
          lastSyncedAt: (l as { lastSyncedAt?: Date | string | null }).lastSyncedAt ?? null,
        })),
        now,
      ).catch(() => null),
      /*
       * The live play feed — the same cache the dashboard API's `plays` payload
       * reads (`getPlayFeed` is this reader plus headshots). [] on a quiet day;
       * a feed failure must never take down the dashboard.
       */
      readPlayByPlayFeed(12).catch(() => []),
    ])
    return (
      <DashboardV2
        data={dash34}
        weekLabel={dash34?.weekLabel ?? null}
        career={careerData}
        portfolio={portfolioData}
        drafts={draftData}
        week={weekData}
        strip={stripData}
        plays={playEvents}
        nowIso={now.toISOString()}
        planName={plan?.name ?? null}
        syncedLabel={syncAge.stale ? null : syncAge.label}
        commissionerCount={playedLeagues.filter((l) => Boolean(l.isCommissioner)).length}
      />
    )
  }

  /*
   * Urgency counts on the tabs — lib/core-app/urgencyBadges. On the home they wait for the
   * summary read, so the home's lineup facts refresh the cache in the same render. Any other
   * tab reuses the cache and reloads the lineup facts at most once per 10 minutes. A failure
   * renders no badges — never a zero.
   *
   * ⚠ STARTED, NOT AWAITED — ON EVERY SCREEN. This was the last `await` in front of every
   * screen's render, and a stale cache made it reload the whole cross-league summary: every
   * ten minutes, /core/trades waited on a read it does not show. The badges now stream to the
   * shell on their own (`ScreenShellSignals`, below) and the screen renders without them.
   */
  const urgencyBadges = traceCard('urgency-badges', () =>
    // On the home: after the summary AND the trade scan's pending-offers write — see `offersSettled`.
    (homeLoads
      ? Promise.all([homeLoads.dash34, homeLoads.offersSettled]).then(([summary]) => summary)
      : Promise.resolve(dash34)
    ).then((summary) =>
      getUrgencyBadges({
        userId,
        leagues: playedLeagues.map((l) => ({
          id: l.id,
          platform: (l as { platform?: string | null }).platform ?? null,
          draftDate: (l as { draftDate?: string | Date | null }).draftDate ?? null,
          lastSyncedAt: (l as { lastSyncedAt?: Date | string | null }).lastSyncedAt ?? null,
        })),
        liveDraftLeagueIds: coreActivity.liveDraftLeagueIds,
        now,
        /*
         * A scoped home's summary covers part of the portfolio; the badge cache is the whole of it.
         *
         * ⚠ AND A SUMMARY PAST ITS TTL DOES NOT REFRESH IT EITHER. The badge cache stamps what it is
         * given with NOW, so handing it a `last-known` portfolio summary (served while it rebuilds)
         * would relabel minutes-old lineup facts as fresh for another ten minutes.
         */
        lineupLeagues:
          homeScoped || (summary as { summary?: PortfolioSummaryMeta } | null)?.summary?.source === 'last-known'
            ? null
            : (summary?.allLeagues ?? null),
        /*
         * Every other screen: when the badge cache is stale, read the SAME per-user summary the home
         * reads rather than re-running the whole cross-league join for two counts. A `last-known`
         * summary is not used, for the reason above; that read has already started its rebuild.
         */
        loadLineupLeagues: () =>
          (portfolioOnSummary
            ? readHomePortfolio(userId, leagues as unknown as Dash34LeagueRow[], now).then((d) =>
                d.summary.source === 'last-known'
                  ? getDash34Data(userId, leagues as unknown as Dash34LeagueRow[], now)
                  : d,
              )
            : getDash34Data(userId, leagues as unknown as Dash34LeagueRow[], now)
          ).then((d) => d?.allLeagues ?? null),
      }),
    ),
  ).catch(() => null)

  return (
    <>
      {/*
       * The chrome only this screen could know, published up to the shell that has already
       * painted — see shellSignals.tsx. Streamed on its own, so no screen waits for its badges.
       */}
      <Suspense fallback={null}>
        <ScreenShellSignals
          urgencyBadges={urgencyBadges}
          weekLabel={
            homeLoads
              ? // No `.catch` here, unlike `homeSignals` below: `homeLoads.dash34` already falls back
                // to null at its own read, and reading one optional field off it cannot throw. A catch
                // that can never fire reads as "this can fail" to the next person and hides that the
                // one below genuinely can.
                homeLoads.dash34.then((summary) => summary?.weekLabel ?? null)
              : (dash34?.weekLabel ?? null)
          }
          /*
           * The home's own claims, handed to the assistant the user opens FROM
           * those claims. Derived from the same dash34 facts that feed the brief
           * and the issues queue, so the three cannot disagree. Ids and counts
           * only — the route resolves names itself; see lib/core-app/homeSignals.ts
           * for why nothing free-text crosses that boundary.
           */
          homeSignals={
            homeLoads
              ? Promise.all([homeLoads.dash34, homeLoads.issues])
                  .then(([summary, merged]) => serializeHomeSignals(buildHomeSignals(summary, merged.length)))
                  // Chrome, not a card: a bug here must not take the screen down. The same merge feeds
                  // the issues card, whose boundary reports it.
                  .catch(() => null)
              : serializeHomeSignals(buildHomeSignals(dash34, issues.length))
          }
          /*
           * Only on the Live screen itself — the count comes from the payload already
           * loaded there. Reading the slate on every /core page to decorate one nav badge
           * would put a provider call in front of every screen in the product, which is
           * exactly the cost the per-screen loader pattern above exists to avoid. Elsewhere
           * this stays undefined and the shell keeps the activity snapshot's count.
           */
          liveGameCount={liveScores ? liveScores.games.filter((g) => g.isLive).length : undefined}
        />
      </Suspense>

      {connectedFranchise && selectedLeagueId && activeKey !== 'war-room' ? (
        <ConnectedDecisionScopeBar
          linkId={connectedFranchise.linkId}
          franchiseName={connectedFranchise.franchiseName}
          screen={activeKey}
          selectedLeagueId={selectedLeagueId}
          sides={connectedFranchise.sides.map((side) => ({
            memberId: side.memberId,
            leagueId: side.leagueId,
            name: side.name,
            platform: side.platform,
            sport: side.sport ?? null,
          }))}
        />
      ) : null}

      {segment === 'bracket' ? (
        bracket ? (
          <BracketChallenge data={bracket} />
        ) : (
          <div className="af-frame" style={{ padding: 24, maxWidth: 720 }}>
            <h1 className="af-display" style={{ margin: 0, fontSize: 22, letterSpacing: '-0.03em' }}>
              Bracket Challenge
            </h1>
            <p style={{ marginTop: 8, fontSize: 13, lineHeight: 1.5, color: 'var(--muted)' }}>
              The team list for this sport could not be read just now. Nothing is lost — reload, or
              pick another sport.
            </p>
          </div>
        )
      ) : segment === 'hubs' ? (
        /* Segment-matched and above every activeKey branch — see the model-admin note below. */
        formatHub ? (
          <FormatHub data={formatHub} />
        ) : (
          <div className="af-frame" style={{ padding: 24, maxWidth: 720 }}>
            <h1 className="af-display" style={{ margin: 0, fontSize: 22, letterSpacing: '-0.03em' }}>
              Format hubs
            </h1>
            <p style={{ marginTop: 8, fontSize: 13, lineHeight: 1.5, color: 'var(--muted)' }}>
              We could not read your leagues just now. This is a read failure on our side, not a sign
              that you have none.
            </p>
          </div>
        )
      ) : segment === 'discord' && discordScreen ? (
        discordScreen.state === 'ready' ? (
          <DiscordBridge data={discordScreen.data} />
        ) : (
          <DiscordBridgeNotice screen={discordScreen} />
        )
      ) : leagueHome ? (
        <>
        {chimmyMovesCard}
        <LeagueHome
          data={leagueHome}
          identityInShell={leagueHeaderShown}
          /*
           * "What's on file", streamed. Its nine counts wait behind their own boundary so the rest
           * of the Overview never waits on them; the skeleton holds the panel's height.
           *
           * ⚠ ONLY WITH THE SHELL'S ROW FOR THIS SAME LEAGUE. The record is read by id, but a
           * mismatch here would print one league's history under another's name, so it is checked
           * rather than assumed. Without it the screen keeps its one-sentence banner.
           *
           * ⚠ AND ONLY FOR AN IMPORTED LEAGUE. A native one has no panel to show, so a slot would
           * paint the skeleton and then collapse it to nothing — a layout jump for no content.
           */
          coverageSlot={
            selectedLeagueRecord &&
            selectedLeagueRecord.id === leagueHome.league.id &&
            isImportedPlatform(selectedLeagueRecord.platform) ? (
              <Suspense key={selectedLeagueRecord.id} fallback={<LeagueDataCoverageSkeleton />}>
                <LeagueDataCoverageSection record={selectedLeagueRecord} />
              </Suspense>
            ) : undefined
          }
          otherLeagueIssueCount={issues.filter((i) => i.leagueId !== leagueHome.league.id).length}
          // 3b renders one urgent action. Already sorted by severity then
          // deadline inside deriveOutstandingIssues, so the head of this list is
          // the row the screen shows.
          issues={issues.filter((i) => i.leagueId === leagueHome.league.id)}
        />
        </>
      ) : segment === 'model-admin' ? (
        /*
         * Model Admin, moved off `/leagues/[leagueId]/admin/model` so it runs on
         * the core shell like everything else.
         *
         * ⚠ THIS BRANCH MUST STAY ABOVE EVERY `activeKey` BRANCH, beside
         * `bracket` and `discord`. It shares the commissioner nav key, so
         * `activeKey === 'commissioner'` matches it too — and that branch is
         * lower down the same ternary. Placed after it, /core/model-admin
         * silently renders the Commissioner screen instead ("Commissioners and
         * co-commissioners only"), which is what it did on first deploy. Every
         * segment-matched screen sits at the top of this chain for this reason.
         *
         * ⚠ MATCHED ON `segment`, NOT `activeKey`. It shares the commissioner
         * nav key — same reason /core/discord does — so the rail highlights
         * Commissioner while you are here, and no rail entry is added. That is
         * deliberate: the gate is the AllFantasy admin ALLOWLIST, not league
         * commissionership, so a visible nav item would show a door to every
         * user and 403 almost all of them.
         *
         * ⚠ THE PANELS ARE LEAGUE-SCOPED, so this needs a held league. Without
         * one it says so rather than rendering empty weight boxes against no
         * league — the same rule the rest of the shell follows.
         */
        !modelAdminAllowed ? (
          <div className="af-frame" style={{ padding: 24, maxWidth: 620 }}>
            <h1 className="af-display" style={{ margin: 0, fontSize: 22 }}>Model Admin</h1>
            <p style={{ marginTop: 8, fontSize: 13, lineHeight: 1.5, color: 'var(--muted)' }}>
              This account is not on the AllFantasy admin allowlist.
            </p>
          </div>
        ) : !selectedLeagueId ? (
          <PickALeague
            tabKey="model-admin"
            title="Model Admin"
            blurb="V3 weights and drift are stored per league, so this needs one held."
            issues={issues}
            leagues={rail}
          />
        ) : (
          <div className="space-y-4">
            <header className="af-frame" style={{ padding: 16 }}>
              <p className="af-label" style={{ color: 'var(--muted)' }}>Admin</p>
              <h1 className="af-display" style={{ margin: 0, fontSize: 22, letterSpacing: '-0.03em' }}>
                Model Admin
              </h1>
              <p className="af-num" style={{ marginTop: 4, fontSize: 12, color: 'var(--muted)' }}>
                League {selectedLeagueId}
              </p>
            </header>
            <V3WeightsPanel
              leagueId={selectedLeagueId}
              season={String(new Date().getFullYear())}
              defaultWeek={1}
            />
            <UsageAnalyticsPanel leagueId={selectedLeagueId} />
          </div>
        )
      ) : activeKey === 'my-team' ? (
        myTeam ? (
          <MyTeam data={myTeam} />
        ) : myTeamLoadFailed ? (
          /* The read failed for a league the user HAS selected — say so, and keep
             them on this screen. Falling through to the picker below would tell
             them to choose a league they already chose. */
          <ScreenLoadError screen="My team" retryHref={retryHref} />
        ) : /*
           * 2026-09-07 handoff. The ranked board IS the screen now; the picker
           * lives behind `?all=1`, which the board's own footer links to.
           *
           * ⚠ A FAILED PULSE READ FALLS BACK TO THE PICKER, NOT TO AN EMPTY
           * BOARD. `getMyTeamPulse` is `.catch(() => null)` at its call site, so
           * null here means we could not read — which is not the same fact as
           * "nothing needs you", and the board must never be asked to draw it.
           */
        showAllLeagues || !myTeamPulse ? (
          <PickALeague
            tabKey="my-team"
            title="My team"
            blurb="Which lineups still need setting, and how long you have left. Pick one below for the full roster."
            issues={issues}
            leagues={rail}
          />
        ) : (
          <MyTeamBoard pulse={myTeamPulse} allHref="/core/my-team?all=1" />
        )
      ) : activeKey === 'matchup' ? (
        matchup ? (
          <>
            {chimmyMovesCard}
            <Matchup data={matchup} />
          </>
        ) : matchupLoadFailed ? (
          <ScreenLoadError screen="Matchup" retryHref={retryHref} />
        ) : showAllLeagues || !matchupPulse ? (
          /* A failed pulse read is not "no games" — fall back to the picker. */
          <PickALeague
            tabKey="matchup"
            title="Matchup"
            blurb="Every league with a head-to-head this week, ranked by margin. Pick one below for the full box score."
            issues={issues}
            leagues={rail}
          />
        ) : (
          <MatchupPulseBoard
            pulse={matchupPulse}
            issues={issues}
            allHref="/core/matchup?all=1"
            totalLeagues={playedLeagues.length}
          />
        )
      ) : activeKey === 'trades' ? (
        trades ? (
          <>
            {/*
              Screen 36a. The builder leads and the existing history sits under
              it — additive rather than a replacement, so nothing that already
              works is lost while the new surface settles.
            */}
            <TradeCenter
              league={{
                id: trades.league.id,
                name: trades.league.name,
                format: trades.gradingContext.available
                  ? trades.gradingContext.data.format
                  : null,
                teamCount: trades.gradingContext.available
                  ? trades.gradingContext.data.teamCount
                  : null,
              }}
              deadlineLabel={
                trades.deadline.available && trades.deadline.data.week != null
                  ? `Deadline · week ${trades.deadline.data.week}`
                  : null
              }
              platform={trades.league.platform}
              sourceLink={trades.league.sourceLink}
              leagueType={tradeLeagueTypeKey}
              leagueVariant={tradeLeagueRow?.leagueVariant ?? null}
              leagues={tradeStripLeagues.filter((league) => league.id === selectedLeagueId)}
              valueActions={tradeValueActions}
              depthAccess={corePaywall?.trade_depth ?? null}
              history={<Trades data={trades} />}
              edgeAccess={corePaywall?.competitive_edge ?? null}
            />
          </>
        ) : tradesLoadFailed ? (
          <ScreenLoadError screen="Trade Center" retryHref={retryHref} />
        ) : !showAllLeagues && tradesBoard ? (
          <TradesBoard data={tradesBoard} allHref="/core/trades?all=1" />
        ) : (
          <PickALeague
            tabKey="trades"
            title="Trades"
            blurb="Every trade grade is scored against one league's own scoring and roster rules, so a grade only means something inside a league."
            issues={issues}
            leagues={rail}
          />
        )
      ) : activeKey === 'waivers' ? (
        waivers ? (
          <Waivers data={waivers} edge={waiverEdge} edgeAccess={waiverEdgeAccess} />
        ) : !showAllLeagues && waiversBoard ? (
          <WaiversBoard
            data={waiversBoard}
            allHref="/core/waivers?all=1"
            totalLeagues={playedLeagues.length}
          />
        ) : (
          <PickALeague
            tabKey="waivers"
            title="Waivers"
            blurb="FAAB, waiver order and bid pricing are all per-league — the same player is worth a different amount in a different league."
            issues={issues}
            leagues={rail}
          />
        )
      ) : activeKey === 'devy' ? (
        /*
         * Cross-league, so it renders without a league selected — no PickALeague gate.
         * `viewState` is derived from what the loader returned, never from a control on
         * the screen: the handoff's own state pills are a QA affordance its README says
         * must not ship.
         *
         * An empty prospect pool and a failed load both land on `empty` deliberately.
         * The screen's copy ("connect a league with devy or taxi slots") is true in both
         * cases, and inventing a third "something went wrong" state would tell a user
         * with no devy leagues that the product is broken.
         */
        <DevyCore viewState={devyCore && devyCore.prospects.length > 0 ? 'populated' : 'empty'} {...(devyCore ?? { prospects: [], exposure: [], rankingsByPosition: {}, watchlist: [], colleges: [], news: [] })} />
      ) : activeKey === 'devy-league' ? (
        selectedLeagueId ? (
          /*
           * ⚠ SLOT COUNT DRIVES THE STATE, NOT THE PRESENCE OF PROSPECTS. A league with
           * devy slots and nobody rostered yet is populated-and-empty-handed, which the
           * screen draws as dashed slots. A league with NO slots is the `empty` state,
           * and its copy is commissioner-gated because only a commissioner can act on it.
           *
           * The remaining sections are unwired on purpose — free agents, the devy draft
           * board and per-league trade values each need league-scoped queries that do not
           * exist yet. They render their own empty copy rather than fabricated rows.
           */
          <DevyLeagueTab
            viewState={devySlotCount > 0 ? 'populated' : 'empty'}
            leagueName={rail.find((l) => l.id === selectedLeagueId)?.name ?? 'This league'}
            /* Per-league, from the loader's own flag — `commissionerCount` is an
               account-wide total and would show the CTA to a manager who commissions
               some OTHER league. */
            isCommissioner={Boolean(playedLeagues.find((l) => l.id === selectedLeagueId)?.isCommissioner)}
            slots={Array.from({ length: devySlotCount }, (_, i) => ({ id: `slot-${i}`, player: null }))}
            freeAgents={[]}
            draftRoundLabel="Round 1"
            draftCountdown={null}
            draftBoard={[]}
            news={[]}
            tradeValues={[]}
            settingsHref={`/core/commissioner?league=${encodeURIComponent(selectedLeagueId)}`}
          />
        ) : (
          <PickALeague
            tabKey="devy-league"
            title="Devy"
            blurb="Devy slots, the devy draft and prospect values are all per-league, so pick a league."
            issues={issues}
            leagues={rail}
          />
        )
      ) : activeKey === 'defense-hub' ? (
        selectedLeagueId ? (
          /*
           * The same client the standalone /idp/defense-hub page renders, embedded. It owns its
           * own fetch and its own blocked states — including "this league doesn't roster
           * individual defenders" — so a manager who reaches this by URL in a non-IDP league
           * gets that explanation rather than an empty screen.
           */
          <DefenseHubClient leagueId={selectedLeagueId} embedded />
        ) : (
          <PickALeague
            tabKey="defense-hub"
            title="Defense Hub"
            blurb="Defenders and kickers are priced by one league's scoring and starting slots, so pick a league."
            issues={issues}
            leagues={rail}
          />
        )
      ) : activeKey === 'draft-hq' ? (
        draftHq ? (
          <>
            {/*
              The live board and clock first — it is the only thing on this
              screen with a deadline measured in seconds. Settings, pick
              inventory and grades read after it.
            */}
            {/* Only when AllFantasy is running a draft here. Without one, every section of the board
                said "no draft has been set up" — three times above Draft HQ's own record of the
                draft the league already ran. */}
            {draftBoard?.session.available ? <DraftBoard data={draftBoard} /> : null}
            <DraftHq data={draftHq} edge={draftEdge} edgeAccess={draftEdgeAccess} />
          </>
        ) : showAllLeagues || !homeDrafts ? (
          <PickALeague
            tabKey="draft-hq"
            title="Draft HQ"
            blurb="Draft order, pick slots and board settings are all per-league."
            issues={issues}
            leagues={rail}
          />
        ) : (
          <DraftHqBoard
            data={homeDrafts}
            allHref="/core/draft-hq?all=1"
            totalLeagues={playedLeagues.length}
            picks={liveDraftPicks}
          />
        )
      ) : activeKey === 'war-room' ? (
        /*
         * Two rooms, one screen key. `?view=plan` picks Game Plan — cross-league,
         * so unlike Scout it renders without a league in context.
         */
        gamePlanView ? (
          gamePlan?.available ? (
            <GamePlan
              data={gamePlan.data}
              nowIso={new Date().toISOString()}
              weekHref="/core/week"
              waiversHref={
                selectedLeagueId
                  ? `/core/waivers?league=${encodeURIComponent(selectedLeagueId)}`
                  : '/core/waivers'
              }
            />
          ) : (
            <PickALeague
              tabKey="war-room"
              title="Game plan"
              blurb={
                gamePlan?.available === false
                  ? gamePlan.reason
                  : 'No starting lineups could be read, so there is nothing to plan against yet.'
              }
              issues={issues}
              leagues={rail}
            />
          )
        ) : scout || connectedFranchise ? (
          <>
            {connectedFranchise && selectedLeagueId ? (
              <ConnectedFranchiseWarRoom
                linkId={connectedFranchise.linkId}
                franchiseName={connectedFranchise.franchiseName}
                primaryMemberId={connectedFranchise.primaryMemberId}
                selectedLeagueId={selectedLeagueId}
                sides={connectedFranchise.sides.map((side) => ({
                  memberId: side.memberId,
                  role: side.role,
                  leagueId: side.leagueId,
                  memberLeagueId: side.memberLeagueId,
                  name: side.name,
                  platform: side.platform,
                  sport: side.sport ?? null,
                  season: side.season,
                  teamLabel: side.teamLabel,
                  teamCandidates: side.teamCandidates,
                  avatarUrl: side.avatarUrl,
                  playerCount: side.playerCount,
                  unavailableReason: side.unavailableReason,
                  draft: side.draft,
                  activity: side.activity,
                  sync: side.sync,
                  players: (side.players ?? []).map((player) => ({
                    id: player.id,
                    name: player.name,
                    position: player.position,
                    team: player.team,
                  })),
                }))}
              />
            ) : null}
            {scout ? (
              <Scout
                data={scout}
                gamePlanHref={
                  selectedLeagueId
                    ? `/core/war-room?view=plan&league=${encodeURIComponent(selectedLeagueId)}`
                    : '/core/war-room?view=plan'
                }
              />
            ) : null}
          </>
        ) : (
          <PickALeague
            tabKey="war-room"
            title="War Room"
            /*
              ⚠ THE BLURB HAD TO CHANGE WITH THE CONTENT. "Pick the league whose
              managers you want read" was the whole screen; with Game Plan above
              the picker it would be a caption on the wrong thing, telling a
              reader the page is a chooser while the page is showing them their
              week.
            */
            blurb={
              gamePlan?.available
                ? 'Every decision still open across all your leagues, soonest deadline first. Scouting a room is per-league — pick one below for that.'
                : 'Scouting a room means scouting one room — pick the league whose managers you want read.'
            }
            issues={issues}
            leagues={rail}
            /*
              The slot `PickALeague` has carried unused since it was written:
              "rendered between the header and 'Needs you first'". This is what
              it was for — the cross-league half of the screen, above the
              per-league chooser, with the queue and the tiles unchanged below.
            */
            above={
              /*
                ⚠ `gamePlan.data`, AND `available` IS NOT A NULL CHECK. The loader
                returns a `SectionState<GameDayTriage>` — `{ available: false,
                reason }` is a perfectly non-null object, so `gamePlan ? …` passes
                for a triage that could not be read and hands the component a
                wrapper where it expects rows. The typecheck caught it; nothing at
                runtime would have, beyond an empty section.

                A failed read renders no section at all rather than an empty one:
                the picker below is a complete screen on its own, which is what it
                was before this change.
              */
              gamePlan?.available ? (
                <GamePlan
                  data={gamePlan.data}
                  nowIso={new Date().toISOString()}
                  weekHref="/core/week"
                  waiversHref="/core/waivers"
                  showHead={false}
                />
              ) : null
            }
          />
        )
      ) : activeKey === 'players' ? (
        <PlayerFinder
          query={playerQuery}
          matches={playerMatches}
          detail={playerDetail}
          leagueCount={playedLeagues.length}
          selectedLeagueId={selectedLeagueId}
          leagueView={playerLeagueView}
          recent={recentPlayerSearches}
          tradeVisual={playerTradeVisual}
          presence={playerPresence}
          windows={playerWindows.length > 0 ? playerWindows : null}
          windowsUnread={playerWindowsUnread}
          compare={playerCompare}
          compareRequested={Boolean(vsRef)}
          depthAccess={corePaywall?.player_depth ?? null}
          triage={gameDayTriage}
          nowIso={new Date().toISOString()}
        />
      ) : activeKey === 'week' ? (
        /*
         * 24a and 24b share one screen key. `?view=rivalries` picks the panel —
         * they read the same WeeklyMatchup rows through the same pairing, and two
         * sibling routes for one data layer is the spend that pushed this repo
         * against the route ceiling.
         */
        rivalriesView ? (
          rivalries ? (
            <RivalryRadar data={rivalries} weekHref="/core/week" />
          ) : (
            <div className="af-frame" style={{ padding: 24, maxWidth: 720 }}>
              <h1 className="af-display" style={{ margin: 0, fontSize: 22, letterSpacing: '-0.03em' }}>
                Rivalry Radar
              </h1>
              <p style={{ marginTop: 8, fontSize: 13, lineHeight: 1.5, color: 'var(--muted)' }}>
                We could not read your matchup history just now. This is a read failure on our side,
                not a sign that you have never played anybody.
              </p>
            </div>
          )
        ) : weekBoard ? (
          /*
           * 38a·3. A league in the rail renders that league's own week; without
           * one the cross-league board is what you get. `leagueBoard` is null
           * unless a focus league was asked for AND found, so this falls back
           * rather than rendering an empty hero.
           */
          weekBoard.leagueBoard ? (
            <YourWeekLeague board={weekBoard.leagueBoard} allWeeksHref="/core/week" />
          ) : showAllLeagues ? (
            /*
             * The full cross-league table, kept whole behind `?all=1`. The two
             * ranked columns above it are a summary, not a replacement — a
             * manager who wants every game still has one page that lists them.
             */
            <YourWeek data={weekBoard} rivalriesHref="/core/week?view=rivalries" />
          ) : (
            <WeekBoard
              board={weekBoard}
              outlook={outlook}
              rivalriesHref="/core/week?view=rivalries"
              allHref="/core/week?all=1"
              totalLeagues={playedLeagues.length}
            />
          )
        ) : (
          <div className="af-frame" style={{ padding: 24, maxWidth: 720 }}>
            <h1 className="af-display" style={{ margin: 0, fontSize: 22, letterSpacing: '-0.03em' }}>
              Your week
            </h1>
            <p style={{ marginTop: 8, fontSize: 13, lineHeight: 1.5, color: 'var(--muted)' }}>
              We could not read this week&apos;s matchups just now. This is a read failure on our
              side, not a week with no games.
            </p>
          </div>
        )
      ) : activeKey === 'commissioner' ? (
        /*
         * 38a·9. `segment === 'discord'` also maps to this nav key and is
         * handled above, so this branch is only ever the hub itself.
         *
         * ⚠ THE SCREEN DECIDES NOTHING ABOUT ACCESS. `getCommissionerHub`
         * already returned either the data or a denial, server-side; the
         * component renders whichever it was handed. There is no client-side
         * role check to bypass because there is no client-side role check.
         */
        commissionerHub ? (
          <CommissionerHub data={commissionerHub} />
        ) : /*
           * ⚠ TWO DIFFERENT FACTS, TWO DIFFERENT RENDERINGS. "A league is
           * selected and we failed to read it" is a read failure on our side.
           * "No league is selected" is a routing state. Collapsing them would
           * tell a commissioner their league is unreadable when in fact they
           * had simply not picked one yet.
           */
        selectedLeagueId ? (
          <div className="af-frame" style={{ padding: 24, maxWidth: 720 }}>
            <h1 className="af-display" style={{ margin: 0, fontSize: 22, letterSpacing: '-0.03em' }}>
              Commissioner
            </h1>
            <p style={{ marginTop: 8, fontSize: 13, lineHeight: 1.5, color: 'var(--muted)' }}>
              We could not read this league just now. This is a read failure on our side, not a
              sign that you do not run it.
            </p>
          </div>
        ) : commissionerOverview ? (
          <CommissionerOverview data={commissionerOverview} />
        ) : (
          /* The all-leagues read failed outright — fall back to the plain league picker. */
          <PickALeague
            tabKey="commissioner"
            title="Commissioner"
            blurb="Health, disputes and settings all belong to one league. Below is what needs a commissioner across the leagues you run."
            issues={issues}
            leagues={rail}
          />
        )
      ) : activeKey === 'sync' ? (
        leagueSync ? (
          <LeagueSync data={leagueSync} manageHref="/import" />
        ) : (
          <PickALeague
            tabKey="sync"
            title="Sync"
            blurb="What AllFantasy reads for a league, and when it last read it. Connecting a platform or re-syncing everything lives on Manage connections, linked from the account-wide League Sync page."
            issues={issues}
            leagues={rail}
          />
        )
      ) : activeKey === 'standings' ? (
        standings ? (
          <Standings data={standings} freshness={standingsFreshness} view={standingsView} />
        ) : (
          /* Same split as Commissioner: a read failure is not an unpicked league. */
          selectedLeagueId ? (
            <div className="af-frame" style={{ padding: 24, maxWidth: 720 }}>
              <h1 className="af-display" style={{ margin: 0, fontSize: 22, letterSpacing: '-0.03em' }}>
                Standings
              </h1>
              <p style={{ marginTop: 8, fontSize: 13, lineHeight: 1.5, color: 'var(--muted)' }}>
                We could not read this league&apos;s weekly results just now. This is a read failure
                on our side, not a season with no games in it.
              </p>
            </div>
          ) : showAllLeagues || !outlook ? (
            /*
             * A failed simulation is not "no standings" — fall back to the
             * picker rather than drawing an empty board.
             */
            <PickALeague
              tabKey="standings"
              title="Standings"
              blurb="Points-for only means something inside one league — two leagues with different scoring settings produce numbers that cannot be compared."
              issues={issues}
              leagues={rail}
            />
          ) : (
            <StandingsBoard
              outlook={outlook}
              allHref="/core/standings?all=1"
              totalLeagues={playedLeagues.length}
            />
          )
        )
      ) : activeKey === 'live' ? (
        liveGameId ? (
          <LiveGameView
            initial={liveGame}
            sport={liveGameSport}
            gameId={liveGameId}
            backHref={`/core/live?sport=${encodeURIComponent(liveGameSport)}`}
          />
        ) : liveScores ? (
          <LiveScores data={liveScores} selectedLeagueId={selectedLeagueId} />
        ) : (
          <div className="af-frame" style={{ padding: 24, maxWidth: 720 }}>
            <h1 className="af-display" style={{ margin: 0, fontSize: 22, letterSpacing: '-0.03em' }}>
              Live Scores
            </h1>
            <p style={{ marginTop: 8, fontSize: 13, lineHeight: 1.5, color: 'var(--muted)' }}>
              We could not read the slate just now. This is a read failure on our side, not a day
              with no games on — your players may well be playing.
            </p>
          </div>
        )
      ) : activeKey === 'season-outlook' ? (
        outlook ? (
          /*
           * 38a·5 — one league's full field when a league is held, the
           * cross-league board when it is not. Same key, same loader, same
           * simulation: the league view renders the per-team numbers the
           * cross-league table collapses into a single row.
           */
          selectedLeagueId && outlook.leagues.some((l) => l.leagueId === selectedLeagueId) ? (
            <SeasonOutlookLeague
              league={outlook.leagues.find((l) => l.leagueId === selectedLeagueId)!}
              swing={outlook.swingByLeague[selectedLeagueId] ?? null}
              basis={outlook.basis}
              priorities={outlook.priorities}
              freshness={outlookFreshness}
            />
          ) : (
            <SeasonOutlook data={slimOutlookForBoard(outlook)} freshness={outlookFreshness} />
          )
        ) : (
          <div className="af-frame" style={{ padding: 24, maxWidth: 720 }}>
            <h1 className="af-display" style={{ margin: 0, fontSize: 22, letterSpacing: '-0.03em' }}>
              Season Outlook
            </h1>
            <p style={{ marginTop: 8, fontSize: 13, lineHeight: 1.5, color: 'var(--muted)' }}>
              We could not run the simulations just now. This is a read failure on our side, not a
              season with nothing left to decide.
            </p>
          </div>
        )
      ) : activeKey === 'notifications' ? (
        notifications ? (
          <NotificationsCenter data={notifications} />
        ) : (
          <div className="af-frame" style={{ padding: 24, maxWidth: 720 }}>
            <h1 className="af-display" style={{ margin: 0, fontSize: 22, letterSpacing: '-0.03em' }}>
              Notifications
            </h1>
            <p style={{ marginTop: 8, fontSize: 13, lineHeight: 1.5, color: 'var(--muted)' }}>
              We could not read your notifications just now. This is a read failure on our side, not
              an empty inbox.
            </p>
          </div>
        )
      ) : activeKey === 'share' ? (
        shareCareer ? (
          <CareerShare
            career={shareCareer}
            leagues={playedLeagues.slice(0, 12).map((l) => ({
              id: l.id,
              name: l.name,
              platform: String(l.platform ?? 'manual').toLowerCase(),
              /*
               * Resolved here rather than in the component: `avatarUrl` on a
               * Sleeper league is an avatar ID, not a link, so the raw column
               * would render a broken image on most rows.
               */
              imageUrl: leagueArtUrl({
                logoUrl: (l as { logoUrl?: string | null }).logoUrl ?? null,
                avatarUrl: (l as { avatarUrl?: string | null }).avatarUrl ?? null,
                platform: l.platform,
              }),
            }))}
            selectedLeagueId={selectedLeagueId}
            /*
             * ⚠ NULL BECAUSE THE CALL IS NOT CHARGED, NOT BECAUSE WE DID NOT LOOK.
             * /api/share/generate-copy takes no token spend and has no rule in
             * lib/tokens/pricing-matrix.ts. The button says "included in your
             * plan" rather than printing a price we do not take. If a caption
             * spend rule is ever added, read it here the way the drawer reads
             * `ai_chimmy_chat_message`.
             */
            tokenCost={null}
            /*
             * The real reward, from server/api-route-modules/legacy/share-reward:
             * tokensAwarded is 1 and the route gates on one share per day. The
             * handoff flags the vague "earn tokens for sharing" copy as a bug
             * precisely because it states no number.
             */
            reward={{ tokensPerShare: 1, oncePerDay: true }}
          />
        ) : (
          <div className="af-frame" style={{ padding: 24, maxWidth: 720 }}>
            <h1 className="af-display" style={{ margin: 0, fontSize: 22, letterSpacing: '-0.03em' }}>
              Career Share
            </h1>
            <p style={{ marginTop: 8, fontSize: 13, lineHeight: 1.5, color: 'var(--muted)' }}>
              We could not read your career just now, and this card is built from it. This is a read
              failure on our side, not a career with nothing in it.
            </p>
          </div>
        )
      ) : activeKey === 'tools' ? (
        <Tools
          data={buildToolsHub({
            issues,
            stats: {
              leaguesPlayed: playedLeagues.length,
              /*
               * Read, not estimated. These feed the "Understand something" cards'
               * stat teasers, and a teaser that overstates what is on file is the
               * same lie as an invented deadline.
               */
              tradesOnFile,
              /*
               * ⚠ LEAGUES, AND THE FIELD IS NAMED FOR IT. This briefly read
               * `seasonsOnFile: playedLeagues.length`, which put a league count
               * under the word "seasons" on the Manager Psychology card — a
               * dynasty league running six years is one league and six seasons,
               * so the two are not interchangeable. Career history is a separate
               * read and is not worth paying for to fill a teaser.
               */
              connectedLeagues: playedLeagues.filter(
                (l) => (l as { platformLeagueId?: string | null }).platformLeagueId,
              ).length,
            },
            selectedLeagueId,
          })}
        />
      ) : activeKey === 'rankings' ? (
        rankingsView === 'compare' && compareKind ? (
          <RankingsCompare
            kind={compareKind}
            result={compare}
            query={compareQuery}
            leagues={leagueCompare}
            teams={teamCompare}
            players={playerPick}
            filterPairs={rankingFilterPairs}
          />
        ) : rankings ? (
          rankingsView === 'faq' ? (
            <RankingsFaq data={rankings} />
          ) : (
            <Rankings data={rankings} leagueId={selectedLeagueId} />
          )
        ) : (
          <div className="af-frame" style={{ padding: 24, maxWidth: 720 }}>
            <h1 className="af-display" style={{ margin: 0, fontSize: 22, letterSpacing: '-0.03em' }}>
              Rankings
            </h1>
            <p style={{ marginTop: 8, fontSize: 13, lineHeight: 1.5, color: 'var(--muted)' }}>
              We could not read the rankings just now. This is a read failure on our side, not a sign
              that nobody is ranked.
            </p>
          </div>
        )
      ) : activeKey === 'career' ? (
        /*
         * 38a·6. A league in the rail renders that league's own career; without
         * one, the cross-league trophy room. `?view=share` still belongs to the
         * share card, which is cross-league by nature.
         */
        leagueCareer ? (
          <LeagueCareer data={leagueCareer} allLeaguesHref="/core/career" />
        ) : careerScreen ? (
          <Career screen={careerScreen} share={shareCard} />
        ) : (
          <div className="af-frame" style={{ padding: 24, maxWidth: 720 }}>
            <h1 className="af-display" style={{ margin: 0, fontSize: 22, letterSpacing: '-0.03em' }}>
              Career
            </h1>
            <p style={{ marginTop: 8, fontSize: 13, lineHeight: 1.5, color: 'var(--muted)' }}>
              We could not read your career history just now. This is a read failure on our side, not a
              sign that you have none.
            </p>
          </div>
        )
      ) : activeKey === 'portfolio' ? (
        portfolio ? (
          <Portfolio
            data={portfolio}
            insights={portfolioInsights?.data ?? null}
            insightsBuiltAt={portfolioInsights?.data?.builtAt ?? null}
            insightsStale={portfolioInsights?.source === 'last-known'}
            recorded={portfolioRecorded}
            lineup={portfolioLineup}
            favoriteIds={[...favoriteIds]}
            paidIds={portfolioPaidIds}
            initialFilter={portfolioFilter ?? undefined}
            initialView={portfolioView}
          />
        ) : (
          <div className="af-frame" style={{ padding: 24, maxWidth: 720 }}>
            <h1 className="af-display" style={{ margin: 0, fontSize: 22, letterSpacing: '-0.03em' }}>
              Portfolio
            </h1>
            <p style={{ marginTop: 8, fontSize: 13, lineHeight: 1.5, color: 'var(--muted)' }}>
              We could not load your leagues just now. This is a read failure on our side, not a
              sign that you have none.
            </p>
          </div>
        )
      ) : activeKey === 'home' ? (
        /*
         * ⚠ THIS REPLACED THE "OUTSTANDING ISSUES" QUEUE, AND THE QUEUE IS WHY.
         * That screen derived one row per league per problem and rendered 604 of
         * them — the same "League data is stale" sentence, 604 times — for a real
         * account. 34a leads with the single most time-critical thing, then a
         * league list ranked by what needs you, capped, with the account-wide
         * facts stated once. The queue's one genuinely load-bearing feature, the
         * "not yet watched" disclosure, is carried across as `coverage`.
         */
        /*
         * The cards stream one by one — each behind its own boundary, each waiting only for its
         * own reads (components/core-app/home/HomeCards.tsx, which also carries the reasons for
         * their order).
         *
         * 🛑 `homeLoads` IS NULL HERE FOR A LEAGUE WHOSE HOME COULD NOT BE READ. `isHome3a` is false
         * the moment a league is selected, so this is the ONLY way to reach the fallback: `/core?league=<id>`
         * where `leagueHome` came back null — `getLeagueHomeData` threw (its error is swallowed above)
         * or its League row went away underneath us. Rendering nothing left a blank screen with no
         * message and no report.
         *
         * ⚠ AND THE PANEL IS ABOUT ONE LEAGUE, NOT THE ACCOUNT. It first reused the summary's
         * "we could not read your leagues" copy, which is wrong twice over here: the league list read
         * FINE — `AfCorePage` redirects a stale, deleted or foreign `?league=` away before the shell
         * renders, so reaching this line means the id was in that list — and the rail beside this
         * panel is showing those leagues while the panel claims they could not be read.
         */
        homeLoads ? (
          <CoreHomeCards
            loads={homeLoads}
            now={now}
            resetKey={errorResetKey}
            planName={plan?.name ?? null}
            commissionerCount={commissionerCount}
            syncLabel={syncAge.stale ? null : syncAge.label}
            scope={{
              label: scopeLabel(homeScope, null),
              key: serializeHomeScope(homeScope) ?? 'all',
              scoped: homeScoped,
              count: homePlayed.length,
              total: playedLeagues.length,
            }}
            leagueData={leagueDataFreshness(
              homePlayed as unknown as Array<{ platform?: string | null; lastSyncedAt?: Date | string | null }>,
            )}
            order={orderHomeCards({
              usage: parseCardUsage(cookies().get(CARD_USE_COOKIE)?.value),
              timeSensitive: timeSensitiveCards({
                gameDayActive: coreActivity.gameDayActive,
                draftLive: coreActivity.liveDraftLeagueIds.length > 0,
              }),
            })}
            prefetch={{ unreadNotifications, gameDayActive: coreActivity.gameDayActive }}
            lead={
              <>
                {/* Pre-launch, no plan: "Everything's free until Oct 15" + countdown. Null otherwise. */}
                {homeLaunchOffer ? <LaunchOfferStrip offer={homeLaunchOffer} surface="core" /> : null}
                <ConnectLeagueCard userId={userId} leagueCount={playedLeagues.length} />
              </>
            }
          />
        ) : (
          <div className="af-frame" style={{ padding: 24, maxWidth: 720 }}>
            <h1 className="af-display" style={{ margin: 0, fontSize: 22, letterSpacing: '-0.03em' }}>
              {rail.find((l) => l.id === selectedLeagueId)?.name ?? 'This league'}
            </h1>
            <p style={{ marginTop: 8, fontSize: 13, lineHeight: 1.5, color: 'var(--muted)' }}>
              We could not read this league just now. This is a read failure on our side — your other
              leagues are unaffected, and nothing about this one has changed. Reload, or{' '}
              <a href="/core" style={{ color: 'var(--accent)' }}>
                go back to all leagues
              </a>
              .
            </p>
          </div>
        )
      ) : (
        <div className="af-frame" style={{ padding: 24, maxWidth: 720 }}>
          <h1 className="af-display" style={{ margin: 0, fontSize: 22, letterSpacing: '-0.03em' }}>
            {activeKey.replace(/-/g, ' ')}
          </h1>
          <p style={{ marginTop: 8, fontSize: 13, lineHeight: 1.5, color: 'var(--muted)' }}>
            This screen is part of the core-app redesign and has not been built yet. It is listed in
            the nav so the shell matches the design, and says so rather than rendering an empty page.
          </p>
        </div>
      )}
    </>
  )
}
