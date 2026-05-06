'use client'

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { normalizeOpenChatQueryParam } from '@/lib/dashboard/open-chat-query'
import { LeagueLiveStrip } from '@/components/sports/LeagueLiveStrip'
import { LeagueStoryCard } from '@/components/sports/LeagueStoryCard'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import type { LucideIcon } from 'lucide-react'
import {
  ArrowLeftRight,
  Ban,
  BarChart3,
  CalendarDays,
  CalendarRange,
  ClipboardList,
  Crosshair,
  Crown,
  Eye,
  Flame,
  History,
  Home,
  LayoutDashboard,
  LayoutGrid,
  LineChart,
  ListOrdered,
  Lock,
  Repeat2,
  RotateCcw,
  Scale,
  Scissors,
  Settings,
  ScrollText,
  Shield,
  ShieldPlus,
  Shirt,
  Skull,
  Sparkles,
  Table,
  Telescope,
  TreePalm,
  Trophy,
  House,
  Bot,
  X,
  User,
  Users,
  Vote,
  Wand2,
  Zap,
  Brain,
  Swords,
  Wallet,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { League, LeagueInvite, LeagueTeam } from '@prisma/client'
import { DEFAULT_SPORT, normalizeToSupportedSport } from '@/lib/sport-scope'
import { mapLeagueTeamsToSlots } from '@/lib/league/map-league-teams-to-slots'
import type { LeagueSeasonSnapshot } from '@/lib/league/sort-teams-standings'
import type { LeagueDashboardView } from '@/app/league/[leagueId]/league-dashboard-types'
import AppShell from '@/app/components/AppShell'
import { LeftChatPanel } from '@/app/dashboard/components/LeftChatPanel'
import { RightControlPanel } from '@/app/dashboard/components/RightControlPanel'
import type { UserLeague, UserLeagueTeam } from '@/app/dashboard/types'
import {
  getLeagueTabs,
  leagueTabSportEmoji,
  localizeLeagueTabs,
  type TabDef,
} from './LeagueTabs'
import { isNflRedraftCoreDashboardLeague } from '@/lib/league/is-nfl-redraft-core-dashboard'
import { DraftTab } from './tabs/DraftTab'
import { TeamTab } from './tabs/TeamTab'
import { LeagueTab } from './tabs/LeagueTab'
import { PlayersTab } from './tabs/PlayersTab'
import { TrendTab } from './tabs/TrendTab'
import { TradesTab } from './tabs/TradesTab'
import { ScoresTab } from './tabs/ScoresTab'
import { WarRoomTab } from './tabs/WarRoomTab'
import { AICoachingTab } from './tabs/AICoachingTab'
import { HistoryTab } from './tabs/HistoryTab'
import { StandingsTab } from './tabs/StandingsTab'
import { FixturesTab } from './tabs/FixturesTab'
import { TransfersTab } from './tabs/TransfersTab'
import { TableTab } from './tabs/TableTab'
import { LeaderboardTab } from './tabs/LeaderboardTab'
import { MyPicksTab } from './tabs/MyPicksTab'
import { ScheduleTab } from './tabs/ScheduleTab'
import { LeagueTabPlaceholder } from './tabs/LeagueTabPlaceholder'
import { PlayerStatCard } from './components/PlayerStatCard'
import { LeagueSettingsModal } from './components/LeagueSettingsModal'
import { CommissionerSettingsModal } from './components/CommissionerSettingsModal'
import { useIdpCapSummary, useRedraftRosterId } from '@/app/idp/hooks/useIdpTeamCap'
import { LeagueSettingsTab as LeagueSettingsContentTab } from './tabs/LeagueSettingsTab'
import { postOpenDraftOverlayMessage } from '@/lib/dashboard/dashboard-draft-overlay-bridge'
import { RedraftTab } from './tabs/RedraftTab'
import { KeeperSelectionTab } from './tabs/KeeperSelectionTab'
import { BestBallTab } from './tabs/BestBallTab'
import { GuillotineTab } from './tabs/GuillotineTab'
import { DynastyHome } from './tabs/DynastyHome'
import { SurvivorHome } from '@/components/survivor/SurvivorHome'
import { SurvivorLeagueDeepLinkPanel } from '@/components/survivor/SurvivorLeagueDeepLinkPanel'
import { SurvivorFirstEntryModal } from '@/components/survivor/SurvivorFirstEntryModal'
import { BigBrotherFirstEntryModal } from '@/components/big-brother/BigBrotherFirstEntryModal'
import { IDPFirstEntryModal } from '@/components/idp/IDPFirstEntryModal'
import { BigBrotherHome } from '@/components/big-brother/BigBrotherHome'
import { BigBrotherCommandDashboard } from '@/components/big-brother/BigBrotherCommandDashboard'
import IDPHome from '@/components/idp/IDPHome'
import { DevyFirstEntryModal } from '@/components/devy/DevyFirstEntryModal'
import { GuillotineFirstEntryModal } from '@/components/guillotine/GuillotineFirstEntryModal'
import { LeagueClipOverlayHost } from '@/components/league/LeagueClipOverlayHost'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'
import { ZombieHome } from '@/components/zombie/ZombieHome'
import type { C2CConfigClient } from '@/lib/c2c/c2cUiLabels'
import { c2cScoreModeChip, c2cSportPairShort } from '@/lib/c2c/c2cUiLabels'
import { RenewLeagueBanner } from '@/components/league/RenewLeagueBanner'
import { PostCreateSetupGuideBanner } from '@/components/league/PostCreateSetupGuideBanner'
import { useMyLeaguesRailCollapse } from '@/hooks/useMyLeaguesRailCollapse'
import { SpecialtyLeagueAtmosphere } from '@/components/league-atmosphere/SpecialtyLeagueAtmosphere'
import { TournamentIntroVideoOverlay } from '@/components/tournament/TournamentIntroVideoOverlay'
import {
  SpecialtyLeagueHomeHero,
  type TournamentHeroContext,
} from '@/components/league-home/SpecialtyLeagueHomeHero'
import { DevyLeagueHomeHero } from '@/components/devy/DevyLeagueHomeHero'
import { applyMatchupPrimaryTab, shouldUseMatchupInsteadOfDraft } from '@/lib/matchup-center/tabTransition'
import { MatchupTabContainer } from '@/components/matchup-center/MatchupTabContainer'
import { FinanceTab } from '@/components/league-finance/FinanceTab'

export type SleeperMemberMap = Record<string, { display_name: string; avatar: string | null }>

export type LeagueShellLeague = League & {
  teams: LeagueTeam[]
  invites: LeagueInvite[]
  rosters?: { platformUserId: string; faabRemaining: number | null; waiverPriority: number | null }[]
}

function weekFromLeagueSettings(settings: unknown): number | null {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return null
  const o = settings as Record<string, unknown>
  const w = o.currentWeek ?? o.current_week ?? o.week
  if (typeof w === 'number' && Number.isFinite(w)) return w
  if (typeof w === 'string') {
    const n = parseInt(w, 10)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function prismaLeagueToUserLeague(
  l: League,
  extra?: { draftDate?: string | null },
): UserLeague {
  const sport = normalizeToSupportedSport(String(l.sport)) ?? DEFAULT_SPORT
  const settings = (l.settings as Record<string, unknown> | undefined) ?? undefined
  return {
    id: l.id,
    name: l.name ?? 'League',
    platform: l.platform,
    sport,
    format: l.leagueVariant ?? (l.isDynasty ? 'dynasty' : 'redraft'),
    scoring: l.scoring ?? 'Standard',
    teamCount: l.leagueSize ?? 10,
    season: l.season ?? new Date().getFullYear(),
    status: l.status ?? undefined,
    currentWeek: weekFromLeagueSettings(l.settings) ?? undefined,
    isDynasty: l.isDynasty,
    settings,
    avatarUrl: l.avatarUrl ?? undefined,
    sleeperLeagueId: l.platform === 'sleeper' ? l.platformLeagueId : undefined,
    draftDate: extra?.draftDate ?? undefined,
    leagueVariant: l.leagueVariant ?? undefined,
    leagueType: l.leagueType ?? undefined,
    bestBallMode: l.bestBallMode ?? undefined,
    guillotineMode: l.guillotineMode ?? undefined,
    keeperPhaseActive: l.keeperPhaseActive ?? undefined,
    isCommissioner: Boolean(l.isCommissioner),
  }
}

export type LeagueShellProps = {
  league: LeagueShellLeague
  userTeam: LeagueTeam | null
  isOwner: boolean
  /** Head commissioner or co-commissioner — controls ⚙ Settings tab. */
  isCommissioner: boolean
  /** Head commissioner only (reset draft, co-comm management). */
  isHeadCommissioner: boolean
  allLeagues: League[]
  userId: string
  userName: string
  userImage?: string | null
  draftDateIso: string | null
  sleeperCommissionerId: string | null
  sleeperUsersByPlatformId: SleeperMemberMap
  currentSleeperUserId: string | null
  discordConnected?: boolean
  /** Deep-link prefill for league chat composer (`?zombieChimmy=`). */
  zombieChimmyPrefill?: string | null
  /** Active dispersal draft — show join/setup banner on league home. */
  dispersalDraftInProgress?: { draftId: string; status: string } | null
  /** Season snapshot for post-season manager ordering (champion first). */
  seasonSnapshot?: LeagueSeasonSnapshot | null
  /** AF-native league settings copy + standings layout (divisions / guillotine / survivor). */
  leagueDashboard: LeagueDashboardView
  /**
   * When true, only the center column renders (no chat / My Leagues rails).
   * Used when this shell is loaded inside the dashboard center panel (`?embed=1`).
   */
  embedMode?: boolean
}

export function LeagueShell({
  league,
  userTeam,
  isOwner,
  isCommissioner,
  isHeadCommissioner,
  allLeagues,
  userId,
  userName,
  userImage = null,
  draftDateIso,
  sleeperCommissionerId,
  sleeperUsersByPlatformId,
  currentSleeperUserId,
  discordConnected = false,
  zombieChimmyPrefill = null,
  dispersalDraftInProgress = null,
  seasonSnapshot = null,
  leagueDashboard,
  embedMode = false,
}: LeagueShellProps) {
  const router = useRouter()
  const pathname = usePathname()
  const myLeaguesRail = useMyLeaguesRailCollapse()
  const searchParams = useSearchParams()
  const openChatQuery = searchParams?.get('openChat') ?? null
  const initialOpenChat = useMemo(
    () => normalizeOpenChatQueryParam(openChatQuery) ?? 'league',
    [openChatQuery],
  )
  const { rosterId: capRosterId } = useRedraftRosterId(league.id)
  const { summary: capSummary } = useIdpCapSummary(league.id, capRosterId)
  const idpCapEnabled = Boolean(capSummary)
  const { t, language } = useLanguage()
  const shouldUseMatchupPrimary = shouldUseMatchupInsteadOfDraft(league.lifecycleState)
  const nflRedraftCore = useMemo(
    () =>
      isNflRedraftCoreDashboardLeague({
        sport: league.sport,
        leagueType: league.leagueType,
        isDynasty: league.isDynasty,
        leagueVariant: league.leagueVariant,
        bestBallMode: league.bestBallMode,
        guillotineMode: league.guillotineMode,
        keeperPhaseActive: league.keeperPhaseActive,
      }),
    [
      league.sport,
      league.leagueType,
      league.isDynasty,
      league.leagueVariant,
      league.bestBallMode,
      league.guillotineMode,
      league.keeperPhaseActive,
    ],
  )

  const tabDefs = useMemo(() => {
    if (nflRedraftCore) {
      const core: TabDef[] = [
        { id: 'home', label: 'Home' },
        { id: 'roster', label: 'Roster' },
        { id: 'matchups', label: 'Matchups' },
        { id: 'players', label: 'Players' },
        { id: 'trades', label: 'Trades' },
        { id: 'league', label: 'League' },
      ]
      return localizeLeagueTabs(core, t)
    }

    let base = getLeagueTabs(String(league.sport))
    if (league.bestBallMode) {
      const idx = base.findIndex((t) => t.id === 'redraft')
      const bb = { id: 'bestball', label: 'Best Ball' }
      base = idx >= 0 ? [...base.slice(0, idx + 1), bb, ...base.slice(idx + 1)] : [bb, ...base]
    }
    if (league.guillotineMode) {
      const idx = base.findIndex((t) => t.id === 'redraft')
      const g = { id: 'guillotine', label: 'Guillotine' }
      base = idx >= 0 ? [...base.slice(0, idx + 1), g, ...base.slice(idx + 1)] : [g, ...base]
    }
    if (league.leagueVariant === 'survivor') {
      const idx = base.findIndex((t) => t.id === 'redraft')
      const core: TabDef[] = [
        { id: 'survivor', label: '🏝 Island' },
        { id: 'survivor_tribal', label: '🗳 Tribal' },
        { id: 'survivor_challenges', label: '⚡ Challenges' },
        { id: 'survivor_chimmy', label: '🤖 Chimmy' },
        { id: 'survivor_exile', label: '🏚 Exile' },
        { id: 'survivor_jury', label: '⚖️ Jury' },
      ]
      const command: TabDef[] = isCommissioner
        ? [{ id: 'survivor_command', label: '🎛 Command' }]
        : []
      const block = [...core, ...command]
      base = idx >= 0 ? [...base.slice(0, idx + 1), ...block, ...base.slice(idx + 1)] : [...block, ...base]
    }
    if (league.leagueVariant === 'zombie') {
      const idx = base.findIndex((t) => t.id === 'redraft')
      const z = { id: 'zombie', label: '🧟 Zombie' }
      base = idx >= 0 ? [...base.slice(0, idx + 1), z, ...base.slice(idx + 1)] : [z, ...base]
    }
    if (league.leagueVariant === 'big_brother') {
      const idx = base.findIndex((t) => t.id === 'redraft')
      const core: TabDef[] = [
        { id: 'big_brother', label: '👁 Big Brother' },
        { id: 'bb_hoh', label: '👑 HOH' },
        { id: 'bb_veto', label: '🛡 Veto' },
        { id: 'bb_voting', label: '🗳 Voting' },
        { id: 'bb_jury', label: '⚖ Jury' },
        { id: 'bb_twists', label: '✨ Twists' },
        { id: 'bb_history', label: '📜 History' },
      ]
      const command: TabDef[] = isCommissioner ? [{ id: 'bb_command', label: '🎛 Command' }] : []
      const block = [...core, ...command]
      base = idx >= 0 ? [...base.slice(0, idx + 1), ...block, ...base.slice(idx + 1)] : [...block, ...base]
    }
    if (league.leagueVariant === 'idp' || league.leagueVariant === 'dynasty_idp') {
      const idx = base.findIndex((t) => t.id === 'redraft')
      const idp = { id: 'idp', label: '🛡 IDP' }
      base = idx >= 0 ? [...base.slice(0, idx + 1), idp, ...base.slice(idx + 1)] : [idp, ...base]
    }
    if (league.leagueType === 'keeper' && league.keeperPhaseActive) {
      base = [{ id: 'keeper', label: 'Keepers' }, ...base]
    }
    if (league.leagueType === 'dynasty' || league.leagueType === 'devy' || league.leagueType === 'c2c') {
      const idx = base.findIndex((t) => t.id === 'redraft')
      const dynastyTabs: TabDef[] = [
        { id: 'dynasty', label: '🏆 Dynasty' },
        { id: 'dynasty_taxi', label: '🚕 Taxi' },
        { id: 'dynasty_picks', label: '📋 Picks' },
      ]
      base = idx >= 0 ? [...base.slice(0, idx + 1), ...dynastyTabs, ...base.slice(idx + 1)] : [...dynastyTabs, ...base]
    }
    const withSettings = [...base, { id: 'settings', label: '⚙ Settings' }]
    return localizeLeagueTabs(applyMatchupPrimaryTab(withSettings, shouldUseMatchupPrimary), t)
  }, [
    nflRedraftCore,
    league.sport,
    league.lifecycleState,
    league.leagueType,
    league.keeperPhaseActive,
    league.bestBallMode,
    league.guillotineMode,
    league.leagueVariant,
    isCommissioner,
    shouldUseMatchupPrimary,
    t,
    language,
  ])
  const [activeTab, setActiveTab] = useState<string>(() => tabDefs[0]?.id ?? 'draft')
  const [rosterLegalityIssueCount, setRosterLegalityIssueCount] = useState(0)
  const guillotineLandingApplied = useRef(false)
  const survivorLandingApplied = useRef(false)
  const zombieLandingApplied = useRef(false)
  const bigBrotherLandingApplied = useRef(false)

  useEffect(() => {
    guillotineLandingApplied.current = false
    survivorLandingApplied.current = false
    zombieLandingApplied.current = false
    bigBrotherLandingApplied.current = false
  }, [league.id])

  useEffect(() => {
    setRosterLegalityIssueCount(0)
  }, [league.id])

  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<{ leagueId?: string; count?: number }>
      if (ce.detail?.leagueId !== league.id) return
      const n = ce.detail?.count
      setRosterLegalityIssueCount(typeof n === 'number' && n > 0 ? Math.min(99, n) : 0)
    }
    window.addEventListener('af-roster-legality', handler as EventListener)
    return () => window.removeEventListener('af-roster-legality', handler as EventListener)
  }, [league.id])

  useEffect(() => {
    const ids = new Set(tabDefs.map((t) => t.id))
    setActiveTab((prev) => (ids.has(prev) ? prev : tabDefs[0]?.id ?? 'draft'))
  }, [tabDefs])

  const nflMatchupLandingApplied = useRef(false)
  const nflMatchupLandingDeepLinkSeen = useRef(false)
  useEffect(() => {
    nflMatchupLandingApplied.current = false
    nflMatchupLandingDeepLinkSeen.current = false
  }, [league.id])

  /** NFL redraft in-season default: Matchups tab once per visit when no ?view= deep link. */
  useEffect(() => {
    const deepLink = searchParams?.get('view') ?? searchParams?.get('tab')
    if (deepLink?.trim()) nflMatchupLandingDeepLinkSeen.current = true
  }, [league.id, searchParams])

  useEffect(() => {
    const deepLink = searchParams?.get('view') ?? searchParams?.get('tab')
    if (deepLink?.trim() || nflMatchupLandingDeepLinkSeen.current) return
    if (!nflRedraftCore || !shouldUseMatchupPrimary || nflMatchupLandingApplied.current) return
    const ids = new Set(tabDefs.map((t) => t.id))
    if (!ids.has('matchups')) return
    setActiveTab('matchups')
    nflMatchupLandingApplied.current = true
  }, [league.id, nflRedraftCore, shouldUseMatchupPrimary, tabDefs, searchParams])

  /** First load per league navigation: guillotine leagues open on the Guillotine hub (once per visit). */
  useEffect(() => {
    const deepLink = searchParams?.get('view') ?? searchParams?.get('tab')
    if (deepLink?.trim()) return
    if (shouldUseMatchupPrimary) return
    if (!league.guillotineMode || guillotineLandingApplied.current) return
    const ids = new Set(tabDefs.map((t) => t.id))
    if (!ids.has('guillotine')) return
    setActiveTab('guillotine')
    guillotineLandingApplied.current = true
  }, [league.id, league.guillotineMode, tabDefs, searchParams, shouldUseMatchupPrimary])

  /** Survivor leagues default to the Survivor hub (once per visit) when no deep link. */
  useEffect(() => {
    const deepLink = searchParams?.get('view') ?? searchParams?.get('tab')
    if (deepLink?.trim()) return
    if (shouldUseMatchupPrimary) return
    if (league.guillotineMode) return
    if (league.leagueVariant !== 'survivor' || survivorLandingApplied.current) return
    const ids = new Set(tabDefs.map((t) => t.id))
    if (!ids.has('survivor')) return
    setActiveTab('survivor')
    survivorLandingApplied.current = true
  }, [league.id, league.leagueVariant, tabDefs, searchParams, shouldUseMatchupPrimary])

  /** Zombie leagues default to the Zombie hub (once per visit) when no deep link. */
  useEffect(() => {
    const deepLink = searchParams?.get('view') ?? searchParams?.get('tab')
    if (deepLink?.trim()) return
    if (shouldUseMatchupPrimary) return
    if (league.guillotineMode) return
    if (league.leagueVariant !== 'zombie' || zombieLandingApplied.current) return
    const ids = new Set(tabDefs.map((t) => t.id))
    if (!ids.has('zombie')) return
    setActiveTab('zombie')
    zombieLandingApplied.current = true
  }, [league.id, league.leagueVariant, league.guillotineMode, tabDefs, searchParams, shouldUseMatchupPrimary])

  /** Big Brother leagues default to the Big Brother hub. */
  useEffect(() => {
    const deepLink = searchParams?.get('view') ?? searchParams?.get('tab')
    if (deepLink?.trim()) return
    if (shouldUseMatchupPrimary) return
    if (league.leagueVariant !== 'big_brother' || bigBrotherLandingApplied.current) return
    const ids = new Set(tabDefs.map((t) => t.id))
    if (!ids.has('big_brother')) return
    setActiveTab('big_brother')
    bigBrotherLandingApplied.current = true
  }, [league.id, league.leagueVariant, tabDefs, searchParams, shouldUseMatchupPrimary])

  /** IDP leagues default to the IDP hub. */
  const idpLandingApplied = useRef(false)
  useEffect(() => {
    const deepLink = searchParams?.get('view') ?? searchParams?.get('tab')
    if (deepLink?.trim()) return
    if (shouldUseMatchupPrimary) return
    if (league.leagueVariant !== 'idp' && league.leagueVariant !== 'dynasty_idp') return
    if (idpLandingApplied.current) return
    const ids = new Set(tabDefs.map((t) => t.id))
    if (!ids.has('idp')) return
    setActiveTab('idp')
    idpLandingApplied.current = true
  }, [league.id, league.leagueVariant, tabDefs, searchParams])

  useEffect(() => {
    const view = searchParams?.get('view')
    const tabParam = searchParams?.get('tab')
    const raw = view ?? tabParam
    if (!raw) return
    const key = raw.trim().toLowerCase()
    if (key === 'settings' && nflRedraftCore) return
    const sportU = String(league.sport ?? '').toUpperCase()
    const intelligenceFallback = sportU === 'NFL' || sportU === 'NCAAF' ? 'trend' : 'players'
    const map: Record<string, string> = {
      home: 'home',
      team: nflRedraftCore ? 'roster' : 'team',
      roster: nflRedraftCore ? 'roster' : 'team',
      squad: 'squad',
      matchup: nflRedraftCore ? 'matchups' : 'matchup',
      matchups: 'matchups',
      scores: nflRedraftCore ? 'matchups' : 'scores',
      war_room: 'war_room',
      warroom: 'war_room',
      af_war_room: 'war_room',
      ai_coaching: 'ai_coaching',
      coaching: 'ai_coaching',
      ai_coach: 'ai_coaching',
      draft: nflRedraftCore ? 'home' : shouldUseMatchupPrimary ? 'matchup' : 'draft',
      redraft: 'redraft',
      trades: 'trades',
      league: 'league',
      players: 'players',
      waivers: 'players',
      settings: 'settings',
      guillotine: 'guillotine',
      bestball: 'bestball',
      keeper: 'keeper',
      intelligence: nflRedraftCore ? 'players' : intelligenceFallback,
      trend: nflRedraftCore ? 'players' : 'trend',
      standings: 'standings',
      fixtures: 'fixtures',
      transfers: 'transfers',
      table: 'table',
      leaderboard: 'leaderboard',
      'my-picks': 'my-picks',
      schedule: 'schedule',
      survivor: 'survivor',
      island: 'survivor',
      tribal: 'survivor_tribal',
      survivor_tribal: 'survivor_tribal',
      challenges: 'survivor_challenges',
      survivor_challenges: 'survivor_challenges',
      chimmy: 'survivor_chimmy',
      survivor_chimmy: 'survivor_chimmy',
      exile: 'survivor_exile',
      survivor_exile: 'survivor_exile',
      jury: 'survivor_jury',
      survivor_jury: 'survivor_jury',
      command: 'survivor_command',
      survivor_command: 'survivor_command',
      zombie: 'zombie',
      horde: 'zombie',
      outbreak: 'zombie',
      big_brother: 'big_brother',
      bb: 'big_brother',
      bb_hoh: 'bb_hoh',
      hoh: 'bb_hoh',
      bb_veto: 'bb_veto',
      veto: 'bb_veto',
      bb_voting: 'bb_voting',
      eviction: 'bb_voting',
      bb_jury: 'bb_jury',
      bb_twists: 'bb_twists',
      twists: 'bb_twists',
      bb_history: 'bb_history',
      bb_command: 'bb_command',
      bb_commissioner: 'bb_command',
    }
    const target = map[key]
    if (!target) return
    const ids = new Set(tabDefs.map((t) => t.id))
    if (ids.has(target)) setActiveTab(target)
  }, [searchParams, tabDefs, league.sport, shouldUseMatchupPrimary, nflRedraftCore])

  useEffect(() => {
    const ids = new Set(tabDefs.map((t) => t.id))
    if (!ids.has(activeTab)) return

    const next = new URLSearchParams(searchParams?.toString() ?? '')
    if (next.get('view') === activeTab) return

    next.set('view', activeTab)
    router.replace(`${pathname}?${next.toString()}`, { scroll: false })
  }, [activeTab, pathname, router, searchParams, tabDefs])

  const [selectedPlayer, setSelectedPlayer] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsInitialPanel, setSettingsInitialPanel] = useState<string | null>(null)
  const [leaveLeagueHintOpen, setLeaveLeagueHintOpen] = useState(false)
  const [portalMounted, setPortalMounted] = useState(false)
  const [idpUi, setIdpUi] = useState<{ active: boolean; positionMode: string } | null>(null)
  const [idpViewMode, setIdpViewMode] = useState<'offense' | 'defense' | 'full'>('full')
  const [devyConfig, setDevyConfig] = useState<Record<string, unknown> | null | 'none'>(null)
  const [devyBucketStats, setDevyBucketStats] = useState({ active: 0, taxi: 0, devy: 0 })
  const [commissionerSettingsOpen, setCommissionerSettingsOpen] = useState(false)
  const [c2cConfig, setC2cConfig] = useState<C2CConfigClient | null>(null)
  const [c2cChecked, setC2cChecked] = useState(false)
  const conceptIntroVideoUrl = useMemo(() => {
    const settings =
      league.settings && typeof league.settings === 'object' && !Array.isArray(league.settings)
        ? (league.settings as Record<string, unknown>)
        : null
    if (!settings) return null
    const intro = settings.intro_video ?? settings.introVideo
    if (!intro || typeof intro !== 'object' || Array.isArray(intro)) return null
    const url = (intro as Record<string, unknown>).url
    return typeof url === 'string' && url.trim().length > 0 ? url.trim() : null
  }, [league.settings])

  useEffect(() => {
    setPortalMounted(true)
  }, [])

  useEffect(() => {
    let cancelled = false
    fetch(`/api/c2c?leagueId=${encodeURIComponent(league.id)}`, { credentials: 'include' })
      .then((r) => {
        if (cancelled) return
        setC2cChecked(true)
        if (!r.ok) {
          setC2cConfig(null)
          return
        }
        return r.json().then((d: { c2c?: C2CConfigClient }) => {
          if (!cancelled) setC2cConfig(d.c2c ?? null)
        })
      })
      .catch(() => {
        if (!cancelled) {
          setC2cChecked(true)
          setC2cConfig(null)
        }
      })
    return () => {
      cancelled = true
    }
  }, [league.id])

  useEffect(() => {
    let cancelled = false
    fetch(`/api/leagues/${encodeURIComponent(league.id)}/idp/config`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { config?: { positionMode?: string } } | null) => {
        if (cancelled) return
        if (d?.config) {
          setIdpUi({ active: true, positionMode: d.config.positionMode ?? 'standard' })
        } else {
          setIdpUi({ active: false, positionMode: 'standard' })
        }
      })
      .catch(() => {
        if (!cancelled) setIdpUi({ active: false, positionMode: 'standard' })
      })
    return () => {
      cancelled = true
    }
  }, [league.id])

  useEffect(() => {
    let cancelled = false
    fetch(`/api/devy?leagueId=${encodeURIComponent(league.id)}`, { credentials: 'include' })
      .then((r) => {
        if (r.status === 404) return 'none' as const
        return r.ok ? r.json() : 'none' as const
      })
      .then((d) => {
        if (cancelled) return
        if (d === 'none') setDevyConfig('none')
        else if (d && typeof d === 'object' && 'config' in d && d.config)
          setDevyConfig(d.config as Record<string, unknown>)
        else setDevyConfig('none')
      })
      .catch(() => {
        if (!cancelled) setDevyConfig('none')
      })
    return () => {
      cancelled = true
    }
  }, [league.id])

  useEffect(() => {
    if (devyConfig === null || devyConfig === 'none') return
    let cancelled = false
    fetch(`/api/redraft/season?leagueId=${encodeURIComponent(league.id)}`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { season?: { rosters?: { id: string; ownerId: string | null }[] } } | null) => {
        const roster = data?.season?.rosters?.find((r) => r.ownerId === userId)
        if (!roster?.id) return null
        return fetch(
          `/api/devy/roster?leagueId=${encodeURIComponent(league.id)}&rosterId=${encodeURIComponent(roster.id)}`,
          { credentials: 'include' },
        )
      })
      .then((r) => (r && r.ok ? r.json() : null))
      .then(
        (d: {
          playerStates?: { bucketState: string }[]
          taxiSlots?: unknown[]
          devySlots?: unknown[]
        } | null) => {
          if (cancelled || !d) return
          const ps = d.playerStates ?? []
          const active = ps.filter((s) =>
            ['active_starter', 'active_bench', 'ir'].includes(s.bucketState),
          ).length
          setDevyBucketStats({
            active,
            taxi: (d.taxiSlots ?? []).length,
            devy: (d.devySlots ?? []).length,
          })
        },
      )
      .catch(() => {
        if (!cancelled) setDevyBucketStats({ active: 0, taxi: 0, devy: 0 })
      })
    return () => {
      cancelled = true
    }
  }, [devyConfig, league.id, userId])

  const selectedLeague = useMemo(
    () => prismaLeagueToUserLeague(league, { draftDate: draftDateIso }),
    [league, draftDateIso],
  )

  const rosterWalletByPlatformUserId = useMemo(() => {
    const m = new Map<string, { faabRemaining: number | null; waiverPriority: number | null }>()
    for (const r of league.rosters ?? []) {
      m.set(r.platformUserId, {
        faabRemaining: r.faabRemaining ?? null,
        waiverPriority: r.waiverPriority ?? null,
      })
    }
    return m
  }, [league.rosters])

  const teamSlots = useMemo(() => {
    const base = mapLeagueTeamsToSlots(league.teams, league.settings, rosterWalletByPlatformUserId)
    if (league.platform !== 'sleeper') return base
    return base.map((slot) => {
      const pid = slot.platformUserId
      if (!pid) return slot
      const su = sleeperUsersByPlatformId[pid]
      if (!su?.avatar) return slot
      return { ...slot, avatarUrl: su.avatar }
    })
  }, [
    league.platform,
    league.teams,
    league.settings,
    rosterWalletByPlatformUserId,
    sleeperUsersByPlatformId,
  ])

  const leagueList: UserLeague[] = useMemo(
    () => allLeagues.map((l) => prismaLeagueToUserLeague(l)),
    [allLeagues],
  )

  const commissionerLeagues = useMemo(
    () =>
      leagueList
        .filter((l) => l.isCommissioner)
        .map((l) => ({ id: l.id, name: l.name, teamCount: l.teamCount ?? 0 })),
    [leagueList],
  )

  const [mobileLeftOpen, setMobileLeftOpen] = useState(false)
  const [mobileRightOpen, setMobileRightOpen] = useState(false)

  const navigateDashboardHome = useCallback(() => {
    if (embedMode && typeof window !== 'undefined' && window.parent !== window) {
      try {
        window.parent.location.assign('/dashboard')
        return
      } catch {
        /* cross-origin or restricted — fall back */
      }
    }
    router.push('/dashboard')
  }, [embedMode, router])

  const openLeagueChatOrNavigate = useCallback(() => {
    if (embedMode && typeof window !== 'undefined' && window.parent !== window) {
      try {
        window.parent.dispatchEvent(new CustomEvent('af-dashboard-open-mobile-left'))
        return
      } catch {
        /* fall through */
      }
    }
    router.push(`/league/${league.id}?openChat=league`)
  }, [embedMode, league.id, router])

  const settingsInviteCode =
    league.settings &&
    typeof league.settings === 'object' &&
    !Array.isArray(league.settings) &&
    typeof (league.settings as Record<string, unknown>).inviteCode === 'string'
      ? String((league.settings as Record<string, unknown>).inviteCode).trim()
      : ''
  const inviteToken = settingsInviteCode || league.invites[0]?.token || ''

  /** Sidebar rows navigate via `<Link>` (`getLeagueListDestinationHref`); avoid `router.push(/league/${id})` so tournament hub links work. */
  const handleLeagueSelect = (l: UserLeague | null) => {
    if (!l) {
      navigateDashboardHome()
    }
  }

  const handleImport = () => {
    router.push('/import')
  }

  useEffect(() => {
    const openMobileLeft = () => {
      if (typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches) {
        setMobileLeftOpen(true)
      }
    }
    window.addEventListener('af-dashboard-open-mobile-left', openMobileLeft)
    return () => window.removeEventListener('af-dashboard-open-mobile-left', openMobileLeft)
  }, [])

  const handlePlayerClick = (playerId: string) => setSelectedPlayer(playerId)
  const closePlayerCard = () => setSelectedPlayer(null)

  const openLeagueSettingsModal = useCallback((initialPanel: string | null = null) => {
    setSettingsInitialPanel(initialPanel)
    setSettingsOpen(true)
  }, [])

  const closeLeagueSettingsModal = () => {
    setSettingsOpen(false)
    setSettingsInitialPanel(null)
  }

  /** `/league/[id]?view=settings` opens the modal (NFL redraft has no Settings tab). */
  useEffect(() => {
    if (!nflRedraftCore) return
    const raw = (searchParams?.get('view') ?? searchParams?.get('tab') ?? '').trim().toLowerCase()
    if (raw !== 'settings') return
    openLeagueSettingsModal(null)
    const params = new URLSearchParams(searchParams?.toString() ?? '')
    params.delete('view')
    params.delete('tab')
    const q = params.toString()
    const base = pathname ?? `/league/${league.id}`
    router.replace(q ? `${base}?${q}` : base, { scroll: false })
  }, [nflRedraftCore, searchParams, pathname, router, league.id, openLeagueSettingsModal])

  const settingsPanelDeepLinkRef = useRef<string | null>(null)
  /** Deep-link from draft room gear: `/league/{id}?settingsPanel=draft` opens Draft settings panel. */
  useEffect(() => {
    const panel = searchParams?.get('settingsPanel')
    if (!panel) {
      settingsPanelDeepLinkRef.current = null
      return
    }
    if (settingsPanelDeepLinkRef.current === panel) return
    settingsPanelDeepLinkRef.current = panel
    openLeagueSettingsModal(panel)
    const params = new URLSearchParams(searchParams?.toString() ?? '')
    params.delete('settingsPanel')
    const q = params.toString()
    const base = pathname ?? `/league/${league.id}`
    router.replace(q ? `${base}?${q}` : base, { scroll: false })
  }, [searchParams, pathname, router, league.id, openLeagueSettingsModal])

  /**
   * Slice H — listen for the navigation-free `af-pre-draft-fix-action`
   * CustomEvent the draft-room PreDraftWizard fires when a commissioner
   * clicks a "Fix" button. The wizard's host (`DraftRoomPageClient`) cannot
   * mount `LeagueSettingsModal` (a different route owns it), so it
   * dispatches the event and closes itself; this listener picks it up on
   * the dashboard side and opens the modal at the right panel.
   *
   * Scoped to this league only — a draft-room event from a different
   * league is ignored. No router navigation, no `window.location` —
   * Commit E's unified-state contract is preserved on both sides.
   */
  useEffect(() => {
    if (typeof window === 'undefined') return
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ leagueId?: string; panel?: string | null }>).detail
      if (!detail || detail.leagueId !== league.id) return
      const panel = typeof detail.panel === 'string' && detail.panel.trim().length > 0
        ? detail.panel.trim()
        : null
      openLeagueSettingsModal(panel)
    }
    window.addEventListener('af-pre-draft-fix-action', handler)
    return () => window.removeEventListener('af-pre-draft-fix-action', handler)
  }, [league.id, openLeagueSettingsModal])

  const specialtyAtmosphereMood = useMemo(() => {
    if (league.leagueVariant === 'survivor') {
      if (activeTab === 'survivor_tribal') return 'tribal'
      if (activeTab === 'survivor_exile') return 'exile'
      if (activeTab === 'survivor_jury') return 'jury'
      return 'default'
    }
    if (league.leagueVariant === 'big_brother') {
      if (activeTab === 'bb_hoh') return 'hoh'
      if (activeTab === 'bb_veto') return 'veto'
      if (activeTab === 'bb_voting') return 'eviction'
      if (activeTab === 'bb_jury') return 'jury'
      return 'default'
    }
    return 'default'
  }, [league.leagueVariant, activeTab])

  const [tournamentHeroContext, setTournamentHeroContext] = useState<TournamentHeroContext | null>(null)

  useEffect(() => {
    if (league.leagueVariant === 'survivor' || league.leagueVariant === 'big_brother') {
      setTournamentHeroContext(null)
      return
    }
    let cancelled = false
    fetch(`/api/leagues/${encodeURIComponent(league.id)}/tournament-context`, { cache: 'no-store' })
      .then((r) => r.json().catch(() => ({})))
      .then((data: { tournament?: TournamentHeroContext | null }) => {
        if (cancelled) return
        const t = data?.tournament
        if (t?.tournamentId && t.tournamentName) setTournamentHeroContext(t)
        else setTournamentHeroContext(null)
      })
      .catch(() => {
        if (!cancelled) setTournamentHeroContext(null)
      })
    return () => {
      cancelled = true
    }
  }, [league.id, league.leagueVariant])

  const specialtyHeroVariant = useMemo(() => {
    if (league.leagueVariant === 'survivor') return 'survivor' as const
    if (league.leagueVariant === 'big_brother') return 'big_brother' as const
    if (tournamentHeroContext) return 'tournament' as const
    return null
  }, [league.leagueVariant, tournamentHeroContext])

  const showSpecialtyHero = specialtyHeroVariant !== null

  // `specialtyImmersive` controls the global immersive atmosphere layer (full-viewport
  // background + AppShell padding tweaks). Tournament leagues opt in once their
  // tournament context resolves so the bracket-themed background reaches every tab.
  const specialtyImmersive =
    league.leagueVariant === 'survivor' ||
    league.leagueVariant === 'big_brother' ||
    Boolean(tournamentHeroContext)

  const showDevyHero =
    league.leagueType === 'devy' || (devyConfig !== null && devyConfig !== 'none')

  const draftTabForHero = useMemo(() => {
    const ids = new Set(tabDefs.map((x) => x.id))
    const prefer = nflRedraftCore
      ? (['matchups', 'home', 'roster', 'players'] as const)
      : (['matchup', 'draft', 'roster', 'squad', 'leaderboard', 'my-picks'] as const)
    for (const id of prefer) {
      if (ids.has(id)) return id
    }
    return tabDefs[0]?.id ?? 'draft'
  }, [tabDefs, nflRedraftCore])

  const standingsTabForHero = useMemo(() => {
    const ids = new Set(tabDefs.map((x) => x.id))
    const prefer = nflRedraftCore
      ? (['league', 'matchups', 'home'] as const)
      : (['standings', 'table', 'leaderboard'] as const)
    for (const id of prefer) {
      if (ids.has(id)) return id
    }
    return ids.has('scores') ? 'scores' : tabDefs[0]?.id ?? 'league'
  }, [tabDefs, nflRedraftCore])

  return (
    <>
      {specialtyImmersive ? (
        <SpecialtyLeagueAtmosphere
          variant={
            league.leagueVariant === 'survivor'
              ? 'survivor'
              : league.leagueVariant === 'big_brother'
                ? 'big_brother'
                : 'tournament'
          }
          mood={specialtyAtmosphereMood}
        />
      ) : null}
      {tournamentHeroContext ? (
        <TournamentIntroVideoOverlay
          leagueId={league.id}
          tournamentId={tournamentHeroContext.tournamentId}
          tournamentName={tournamentHeroContext.tournamentName}
        />
      ) : null}
      <div className="contents" data-league-id={league.id}>
        <AppShell
          immersive={specialtyImmersive && !embedMode}
          embedCenterOnly={embedMode}
          rootClassName={
            embedMode
              ? 'min-h-0 h-full flex-1'
              : 'h-[calc(100dvh-8.5rem)] min-h-0 lg:h-[calc(100dvh-3.5rem)]'
          }
          rightRailCollapsed={myLeaguesRail.collapsed}
          onRightRailExpand={() => myLeaguesRail.setCollapsed(false)}
          rightRailCollapsedHint={leagueList.length ? String(leagueList.length) : undefined}
          leftPanel={
            embedMode ? (
              <></>
            ) : (
              <LeftChatPanel
                selectedLeague={selectedLeague}
                activeLeagueId={league.id}
                userId={userId}
                userDisplayName={userName}
                userImage={userImage}
                rootId="league-left-chat"
                leagues={leagueList}
                discordConnected={discordConnected}
                commissionerLeagues={commissionerLeagues}
                zombieChimmyPrefill={zombieChimmyPrefill}
                initialOpenChat={initialOpenChat}
              />
            )
          }
          rightPanel={
            embedMode ? (
              <></>
            ) : (
              <RightControlPanel
                leagues={leagueList}
                leaguesLoading={false}
                selectedId={league.id}
                activeLeagueId={league.id}
                onSelectLeague={handleLeagueSelect}
                userId={userId}
                userName={userName}
                userImage={userImage}
                onImport={handleImport}
                onRailCollapse={() => myLeaguesRail.setCollapsed(true)}
              />
            )
          }
      >
        <main
          className={`relative z-[1] flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden ${
            league.leagueVariant === 'survivor'
              ? specialtyImmersive
                ? 'border-x border-emerald-500/12 bg-gradient-to-b from-black/50 via-emerald-950/15 to-black/55'
                : 'border-x border-amber-500/10 bg-gradient-to-b from-[#081018] via-[#07071a] to-[#07071a]'
              : league.leagueVariant === 'zombie'
                ? 'border-x border-violet-500/15 bg-gradient-to-b from-[#120818] via-[#07071a] to-[#07071a]'
                : league.leagueVariant === 'big_brother'
                  ? specialtyImmersive
                    ? 'border-x border-fuchsia-500/12 bg-gradient-to-b from-black/50 via-violet-950/20 to-black/58'
                    : 'border-x border-amber-500/12 bg-gradient-to-b from-[#0a0e1c] via-[#070a14] to-[#040915]'
                  : league.leagueVariant === 'merged_devy_c2c'
                    ? 'border-x border-sky-500/15 bg-gradient-to-b from-[#07111f] via-[#050a16] to-[#060b14]'
                    : league.leagueType === 'devy' || league.leagueVariant === 'devy_dynasty'
                      ? 'border-x border-indigo-500/15 bg-gradient-to-b from-[#0a1022] via-[#070a18] to-[#060913]'
                  : ''
          }`}
          data-league-variant={
            league.leagueVariant === 'survivor'
              ? 'survivor'
              : league.leagueVariant === 'zombie'
                ? 'zombie'
                : league.leagueVariant === 'big_brother'
                  ? 'big_brother'
                  : undefined
          }
        >
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto [scrollbar-gutter:stable]">
            {!embedMode ? (
              <div className="shrink-0 border-b border-white/[0.08] bg-[#050814] px-3 py-2 md:hidden">
                <div className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => setMobileLeftOpen(true)}
                    className="touch-manipulation inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.04] text-white active:bg-white/[0.08]"
                    aria-label={t('dashboard.shell.openChat')}
                  >
                    <Bot className="h-5 w-5" aria-hidden />
                  </button>
                  <p className="min-w-0 flex-1 truncate text-center text-sm font-semibold text-white/90">
                    {selectedLeague.name}
                  </p>
                  <button
                    type="button"
                    onClick={() => setMobileRightOpen(true)}
                    className="touch-manipulation inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.04] text-white active:bg-white/[0.08]"
                    aria-label={t('dashboard.shell.openMyLeagues')}
                  >
                    <LayoutGrid className="h-5 w-5" aria-hidden />
                  </button>
                </div>
              </div>
            ) : null}
            {showSpecialtyHero && specialtyHeroVariant ? (
              <SpecialtyLeagueHomeHero
                leagueId={league.id}
                leagueName={selectedLeague.name ?? 'League'}
                sport={String(selectedLeague.sport)}
                season={Number(selectedLeague.season ?? new Date().getFullYear())}
                teamCount={league.leagueSize ?? selectedLeague.teamCount ?? 12}
                teamsFilled={league.teams?.length ?? 0}
                variant={specialtyHeroVariant}
                tournamentContext={specialtyHeroVariant === 'tournament' ? tournamentHeroContext : null}
                draftDateIso={draftDateIso}
                rightRailCollapsed={myLeaguesRail.collapsed}
                isCommissioner={isCommissioner}
                isHeadCommissioner={isHeadCommissioner}
                onOpenDraftTab={() => setActiveTab(draftTabForHero)}
                onOpenStandingsTab={() => setActiveTab(standingsTabForHero)}
                onOpenChat={openLeagueChatOrNavigate}
                onOpenSettings={() => openLeagueSettingsModal(null)}
                onOpenCommissionerSettings={() => setCommissionerSettingsOpen(true)}
              />
            ) : null}
            {showDevyHero ? (
              <DevyLeagueHomeHero
                leagueId={league.id}
                leagueName={selectedLeague.name ?? 'League'}
                sport={String(selectedLeague.sport)}
                season={Number(selectedLeague.season ?? new Date().getFullYear())}
                isCommissioner={isCommissioner}
                onOpenChat={openLeagueChatOrNavigate}
                onOpenSettings={() =>
                  isCommissioner
                    ? openLeagueSettingsModal('devy-command-center')
                    : openLeagueSettingsModal(null)
                }
              />
            ) : null}
            <LeagueHeader
              league={selectedLeague}
              leagueId={league.id}
              tabs={tabDefs}
              activeTab={activeTab}
              onTabChange={setActiveTab}
              rosterIssueCount={rosterLegalityIssueCount}
              compactTitleRow={showSpecialtyHero || showDevyHero}
              onOpenLeagueSettingsModal={() => openLeagueSettingsModal(null)}
              memberGearMenu={
                isCommissioner
                  ? null
                  : {
                      onEditTeam: () => openLeagueSettingsModal('my-team'),
                      onCoOwners: () => openLeagueSettingsModal('co-owners'),
                      onPreviousLeagues: () => openLeagueSettingsModal('league-history'),
                      onLeaveLeague: () => setLeaveLeagueHintOpen(true),
                    }
              }
              onGoHome={navigateDashboardHome}
              idpLeagueActive={idpUi?.active ?? false}
              idpViewMode={idpViewMode}
              onIdpViewModeChange={setIdpViewMode}
              devyLeagueActive={devyConfig !== null && devyConfig !== 'none'}
              devyBucketStats={devyBucketStats}
              c2cLeagueActive={c2cConfig !== null}
              c2cConfig={c2cConfig}
              isCommissioner={isCommissioner}
              onOpenCommissionerSettings={() =>
                nflRedraftCore
                  ? openLeagueSettingsModal('commish-controls')
                  : setCommissionerSettingsOpen(true)
              }
              survivorLeagueActive={league.leagueVariant === 'survivor'}
              zombieLeagueActive={league.leagueVariant === 'zombie'}
              idpCapEnabled={idpCapEnabled}
              capSummary={capSummary}
              capRosterId={capRosterId}
            />

            {dispersalDraftInProgress ? (
              <div className="shrink-0 border-b border-cyan-500/20 bg-[#081226] px-4 py-2.5">
                {embedMode ? (
                  <button
                    type="button"
                    className="flex w-full flex-wrap items-center justify-between gap-2 text-left text-[12px] text-cyan-100/95 hover:text-cyan-50"
                    data-testid="league-shell-dispersal-draft-embed-cta"
                    onClick={() =>
                      postOpenDraftOverlayMessage({
                        leagueId: league.id,
                        dispersalDraftId: dispersalDraftInProgress.draftId,
                        source: 'LeagueShell-dispersal-banner',
                      })
                    }
                  >
                    <span>
                      {dispersalDraftInProgress.status === 'in_progress'
                        ? 'Dispersal draft in progress — join the draft room to make picks.'
                        : 'Dispersal draft open — continue setup or open the draft room.'}
                    </span>
                    <span className="font-semibold text-cyan-300 underline decoration-cyan-500/40 underline-offset-2">
                      {dispersalDraftInProgress.status === 'in_progress' ? 'Join draft room →' : 'Open →'}
                    </span>
                  </button>
                ) : (
                  <Link
                    href={`/league/${league.id}/dispersal-draft/${dispersalDraftInProgress.draftId}`}
                    className="flex flex-wrap items-center justify-between gap-2 text-[12px] text-cyan-100/95 hover:text-cyan-50"
                  >
                    <span>
                      {dispersalDraftInProgress.status === 'in_progress'
                        ? 'Dispersal draft in progress — join the draft room to make picks.'
                        : 'Dispersal draft open — continue setup or open the draft room.'}
                    </span>
                    <span className="font-semibold text-cyan-300 underline decoration-cyan-500/40 underline-offset-2">
                      {dispersalDraftInProgress.status === 'in_progress' ? 'Join draft room →' : 'Open →'}
                    </span>
                  </Link>
                )}
              </div>
            ) : null}

            {isCommissioner ? (
              <Suspense fallback={null}>
                <PostCreateSetupGuideBanner leagueId={league.id} isCommissioner={isCommissioner} />
              </Suspense>
            ) : null}

            {/* Live scores strip */}
            <LeagueLiveStrip sport={String(league.sport)} />

            {/* League story card — shown on league tab */}
            {activeTab === 'league' && (
              <div className="px-4 pt-3">
                <LeagueStoryCard leagueId={league.id} sport={String(league.sport)} />
              </div>
            )}

            {/* Renew League banner — shown to commissioner when season ends */}
            <RenewLeagueBanner
              leagueId={league.id}
              currentSeason={Number(selectedLeague.season ?? new Date().getFullYear())}
              isCommissioner={isCommissioner}
              leagueStatus={league.status ?? undefined}
              seasonPhase={
                ((league.settings as Record<string, unknown> | undefined)?.dynastySeasonPhase as string)
                ?? ((league.settings as Record<string, unknown> | undefined)?.season_phase as string)
                ?? undefined
              }
              lifecycleState={league.lifecycleState}
            />

            <LeagueTabRouter
              activeTab={activeTab}
              tabDefs={tabDefs}
              leagueId={league.id}
              selectedLeague={selectedLeague}
              userTeam={userTeam}
              teamSlots={teamSlots}
              inviteToken={inviteToken}
              isOwner={isOwner}
              isCommissioner={isCommissioner}
              isHeadCommissioner={isHeadCommissioner}
              onPlayerClick={handlePlayerClick}
              idpLeagueActive={idpUi?.active ?? false}
              idpViewMode={idpViewMode}
              idpPositionMode={idpUi?.positionMode ?? 'standard'}
              seasonSnapshot={seasonSnapshot}
              leagueDashboard={leagueDashboard}
              onOpenLeagueSettingsModal={openLeagueSettingsModal}
              dashboardEmbed={embedMode}
            />
          </div>
        </main>
        </AppShell>
      </div>

      {mobileLeftOpen ? (
        <div
          className="fixed inset-0 z-[60] bg-black/60 md:hidden"
          role="presentation"
          onClick={() => setMobileLeftOpen(false)}
        >
          <div
            className="absolute inset-x-0 bottom-0 flex max-h-[85dvh] min-h-[50dvh] flex-col overflow-hidden rounded-t-[24px] border-t border-white/[0.07] bg-[#0a0a1f] pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-12px_48px_rgba(0,0,0,0.45)]"
            role="dialog"
            aria-modal="true"
            aria-label={t('dashboard.shell.chat')}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-center pt-2">
              <span className="h-1 w-10 shrink-0 rounded-full bg-white/20" aria-hidden />
            </div>
            <div className="flex items-center justify-between border-b border-white/[0.07] px-4 py-3">
              <p className="text-[10px] uppercase tracking-[0.08em] text-white/30">{t('dashboard.shell.chat')}</p>
              <button
                type="button"
                onClick={() => setMobileLeftOpen(false)}
                className="touch-manipulation inline-flex h-11 w-11 items-center justify-center rounded-xl border border-white/[0.07] bg-white/[0.04] text-white"
                aria-label={t('dashboard.shell.closeChat')}
              >
                <X className="h-5 w-5" aria-hidden />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
              <LeftChatPanel
                selectedLeague={selectedLeague}
                activeLeagueId={league.id}
                userId={userId}
                userDisplayName={userName}
                userImage={userImage}
                rootId={null}
                leagues={leagueList}
                discordConnected={discordConnected}
                commissionerLeagues={commissionerLeagues}
                zombieChimmyPrefill={zombieChimmyPrefill}
                initialOpenChat={initialOpenChat}
              />
            </div>
          </div>
        </div>
      ) : null}

      {!embedMode && mobileRightOpen ? (
        <div
          className="fixed inset-0 z-[60] bg-black/60 md:hidden"
          role="presentation"
          onClick={() => setMobileRightOpen(false)}
        >
          <div
            className="absolute inset-x-0 bottom-0 flex max-h-[90dvh] min-h-[50dvh] flex-col overflow-hidden rounded-t-[24px] border-t border-white/[0.07] bg-[#0a0a1f] pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-12px_48px_rgba(0,0,0,0.45)]"
            role="dialog"
            aria-modal="true"
            aria-label={t('dashboard.right.myLeagues')}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-center pt-2">
              <span className="h-1 w-10 shrink-0 rounded-full bg-white/20" aria-hidden />
            </div>
            <div className="flex items-center justify-between border-b border-white/[0.07] px-4 py-3">
              <p className="text-[10px] uppercase tracking-[0.08em] text-white/30">{t('dashboard.right.myLeagues')}</p>
              <button
                type="button"
                onClick={() => setMobileRightOpen(false)}
                className="touch-manipulation inline-flex h-11 w-11 items-center justify-center rounded-xl border border-white/[0.07] bg-white/[0.04] text-white"
                aria-label={t('dashboard.shell.closePanel')}
              >
                <X className="h-5 w-5" aria-hidden />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
              <div className="h-full w-full max-w-none">
                <RightControlPanel
                  leagues={leagueList}
                  leaguesLoading={false}
                  selectedId={league.id}
                  activeLeagueId={league.id}
                  onSelectLeague={handleLeagueSelect}
                  userId={userId}
                  userName={userName}
                  userImage={userImage}
                  onImport={handleImport}
                  onAfterLeagueNavigate={() => setMobileRightOpen(false)}
                  onSettingsNavigate={() => setMobileRightOpen(false)}
                  onRailCollapse={() => myLeaguesRail.setCollapsed(true)}
                />
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {selectedPlayer ? (
        <PlayerStatCard
          playerId={selectedPlayer}
          leagueId={league.id}
          sport={selectedLeague.sport}
          onClose={closePlayerCard}
        />
      ) : null}

      {portalMounted &&
      isCommissioner &&
      !nflRedraftCore &&
      ((devyConfig !== null && devyConfig !== 'none') ||
        (c2cChecked && c2cConfig !== null) ||
        league.leagueVariant === 'survivor')
        ? createPortal(
            <CommissionerSettingsModal
              leagueId={league.id}
              isOpen={commissionerSettingsOpen}
              onClose={() => setCommissionerSettingsOpen(false)}
            />,
            document.body,
          )
        : null}

      {portalMounted && league.leagueVariant === 'survivor'
        ? createPortal(
            <SurvivorFirstEntryModal leagueId={league.id} userId={userId} enabled onClose={() => {}} />,
            document.body,
          )
        : null}

      {portalMounted && league.leagueVariant === 'big_brother'
        ? createPortal(
            <BigBrotherFirstEntryModal leagueId={league.id} userId={userId} enabled onClose={() => {}} />,
            document.body,
          )
        : null}

      {portalMounted && (league.leagueVariant === 'idp' || league.leagueVariant === 'dynasty_idp')
        ? createPortal(
            <IDPFirstEntryModal leagueId={league.id} userId={userId} enabled onClose={() => {}} />,
            document.body,
          )
        : null}

      {portalMounted && league.leagueVariant === 'merged_devy_c2c'
        ? createPortal(
            <DevyFirstEntryModal
              leagueId={league.id}
              userId={userId}
              enabled
              mode="c2c"
              videoSrc={conceptIntroVideoUrl ?? '/league-type-c2c-intro.mp4'}
              onClose={() => {}}
            />,
            document.body,
          )
        : null}

      {portalMounted &&
      (league.leagueType === 'devy' ||
        league.leagueVariant === 'devy_dynasty')
        ? createPortal(
            <DevyFirstEntryModal leagueId={league.id} userId={userId} enabled onClose={() => {}} />,
            document.body,
          )
        : null}

      {portalMounted && league.guillotineMode
        ? createPortal(
            <GuillotineFirstEntryModal leagueId={league.id} show onClose={() => {}} />,
            document.body,
          )
        : null}

      {portalMounted && (league.leagueVariant === 'zombie' || league.leagueVariant === 'survivor')
        ? createPortal(
            <LeagueClipOverlayHost
              leagueId={league.id}
              variant={league.leagueVariant === 'zombie' ? 'zombie' : 'survivor'}
              enabled
            />,
            document.body,
          )
        : null}

      {portalMounted
        ? createPortal(
            <LeagueSettingsModal
              open={settingsOpen}
              onClose={closeLeagueSettingsModal}
              league={league}
              displayLeague={selectedLeague}
              userId={userId}
              userTeam={userTeam}
              sleeperLeagueId={league.platform === 'sleeper' ? league.platformLeagueId ?? null : null}
              isCommissioner={isCommissioner}
              isHeadCommissioner={isHeadCommissioner}
              sleeperMemberMap={sleeperUsersByPlatformId}
              initialActivePanel={settingsInitialPanel}
              onGoToDraftTab={() => {
                closeLeagueSettingsModal()
                setActiveTab(nflRedraftCore ? 'home' : tabDefs[0]?.id ?? 'draft')
              }}
            />,
            document.body,
          )
        : null}

      {leaveLeagueHintOpen ? (
        <div
          className="fixed inset-0 z-[85] flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="leave-league-hint-title"
          data-testid="leave-league-hint-dialog"
        >
          <button
            type="button"
            className="absolute inset-0 bg-black/75 backdrop-blur-[2px]"
            aria-label="Close"
            onClick={() => setLeaveLeagueHintOpen(false)}
          />
          <div className="relative z-10 w-full max-w-md rounded-2xl border border-white/[0.1] bg-[#0a1228] p-5 shadow-2xl">
            <h2 id="leave-league-hint-title" className="text-lg font-bold text-white">
              Leave league
            </h2>
            <p className="mt-3 text-[13px] leading-relaxed text-white/65">
              Leaving works through your host platform or your commissioner. AllFantasy will add self-serve leave where
              the platform API allows it.
            </p>
            {league.platform === 'sleeper' && league.platformLeagueId ? (
              <a
                href={`https://sleeper.com/leagues/${encodeURIComponent(league.platformLeagueId)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-4 inline-flex text-[13px] font-semibold text-cyan-400 hover:text-cyan-300"
              >
                Open league in Sleeper →
              </a>
            ) : null}
            <button
              type="button"
              onClick={() => setLeaveLeagueHintOpen(false)}
              className="mt-5 w-full rounded-xl border border-white/[0.12] bg-white/[0.06] py-2.5 text-[13px] font-semibold text-white/90 hover:bg-white/[0.1]"
            >
              Close
            </button>
          </div>
        </div>
      ) : null}
    </>
  )
}

function LeagueTabRouter({
  activeTab,
  tabDefs,
  leagueId,
  selectedLeague,
  userTeam,
  teamSlots,
  inviteToken,
  isOwner,
  isCommissioner,
  isHeadCommissioner,
  onPlayerClick,
  idpLeagueActive,
  idpViewMode,
  idpPositionMode,
  seasonSnapshot,
  leagueDashboard,
  onOpenLeagueSettingsModal,
  dashboardEmbed = false,
}: {
  activeTab: string
  tabDefs: TabDef[]
  leagueId: string
  selectedLeague: UserLeague
  userTeam: LeagueTeam | null
  teamSlots: UserLeagueTeam[]
  inviteToken: string | undefined
  isOwner: boolean
  isCommissioner: boolean
  isHeadCommissioner: boolean
  onPlayerClick: (playerId: string) => void
  idpLeagueActive: boolean
  idpViewMode: 'offense' | 'defense' | 'full'
  idpPositionMode: string
  seasonSnapshot: LeagueSeasonSnapshot | null
  leagueDashboard: LeagueDashboardView
  onOpenLeagueSettingsModal: (initialPanel?: string | null) => void
  dashboardEmbed?: boolean
}) {
  const router = useRouter()
  const tab = tabDefs.find((t) => t.id === activeTab)
  const tabLabel = tab?.label ?? activeTab
  const sport = selectedLeague.sport

  switch (activeTab) {
    case 'home':
      return (
        <DraftTab
          league={selectedLeague}
          teams={teamSlots}
          isOwner={isOwner}
          isCommissioner={isCommissioner}
          inviteToken={inviteToken}
          idpLeagueUi={idpLeagueActive}
          seasonSnapshot={seasonSnapshot}
          standingsPresentation={leagueDashboard.standings}
          onOpenLeagueSettings={onOpenLeagueSettingsModal}
          dashboardEmbed={dashboardEmbed}
        />
      )
    case 'matchups':
      return <MatchupTabContainer league={selectedLeague} />
    case 'matchup':
      return <MatchupTabContainer league={selectedLeague} />
    case 'draft':
      return (
        <DraftTab
          league={selectedLeague}
          teams={teamSlots}
          isOwner={isOwner}
          isCommissioner={isCommissioner}
          inviteToken={inviteToken}
          idpLeagueUi={idpLeagueActive}
          seasonSnapshot={seasonSnapshot}
          standingsPresentation={leagueDashboard.standings}
          onOpenLeagueSettings={onOpenLeagueSettingsModal}
          dashboardEmbed={dashboardEmbed}
        />
      )
    case 'redraft':
      return <RedraftTab leagueId={leagueId} idpLeagueUi={idpLeagueActive} />
    case 'bestball':
      return <BestBallTab leagueId={leagueId} sport={sport} />
    case 'guillotine':
      return (
        <GuillotineTab leagueId={leagueId} sport={sport} leagueName={selectedLeague.name} />
      )
    case 'dynasty':
    case 'dynasty_taxi':
    case 'dynasty_picks':
      return <DynastyHome leagueId={leagueId} view={activeTab as 'dynasty' | 'dynasty_taxi' | 'dynasty_picks'} />
    case 'survivor':
      return <SurvivorHome leagueId={leagueId} />
    case 'survivor_tribal':
      return <SurvivorLeagueDeepLinkPanel leagueId={leagueId} tabId="survivor_tribal" />
    case 'survivor_challenges':
      return <SurvivorLeagueDeepLinkPanel leagueId={leagueId} tabId="survivor_challenges" />
    case 'survivor_chimmy':
      return <SurvivorLeagueDeepLinkPanel leagueId={leagueId} tabId="survivor_chimmy" />
    case 'survivor_exile':
      return <SurvivorLeagueDeepLinkPanel leagueId={leagueId} tabId="survivor_exile" />
    case 'survivor_jury':
      return <SurvivorLeagueDeepLinkPanel leagueId={leagueId} tabId="survivor_jury" />
    case 'survivor_command':
      return <SurvivorLeagueDeepLinkPanel leagueId={leagueId} tabId="survivor_command" />
    case 'zombie':
      return <ZombieHome leagueId={leagueId} />
    case 'big_brother':
    case 'bb_hoh':
    case 'bb_veto':
    case 'bb_voting':
    case 'bb_jury':
    case 'bb_twists':
    case 'bb_history': {
      const bbView =
        activeTab === 'bb_hoh'
          ? 'hoh'
          : activeTab === 'bb_veto'
            ? 'veto'
            : activeTab === 'bb_voting'
              ? 'voting'
              : activeTab === 'bb_jury'
                ? 'jury'
                : activeTab === 'bb_twists'
                  ? 'twists'
                  : activeTab === 'bb_history'
                    ? 'history'
                    : 'house'
      return (
        <BigBrotherHome leagueId={leagueId} initialView={bbView} isCommissioner={isCommissioner} />
      )
    }
    case 'bb_command':
      return isCommissioner ? (
        <BigBrotherCommandDashboard leagueId={leagueId} />
      ) : (
        <div className="rounded-xl border border-white/[0.08] bg-[#0a1228]/80 p-6 text-center text-sm text-white/55">
          Commissioner tools only.
        </div>
      )
    case 'idp':
      return <IDPHome leagueId={leagueId} />
    case 'keeper':
      return <KeeperSelectionTab leagueId={leagueId} />
    case 'team':
    case 'roster':
    case 'squad':
      return (
        <TeamTab
          league={selectedLeague}
          userTeam={userTeam}
          onPlayerClick={onPlayerClick}
          inviteToken={inviteToken}
          sport={sport}
          idpLeagueUi={idpLeagueActive}
          idpViewMode={idpViewMode}
          idpPositionMode={idpPositionMode}
          onUserSettingsClick={() => router.push('/settings')}
        />
      )
    case 'league':
      return (
        <LeagueTab
          league={selectedLeague}
          teams={teamSlots}
          seasonSnapshot={seasonSnapshot}
          leagueDashboard={leagueDashboard}
          isOwner={isOwner}
          isCommissioner={isCommissioner}
          inviteToken={inviteToken}
          idpLeagueUi={idpLeagueActive}
          userTeam={userTeam ? { id: userTeam.id, teamName: userTeam.teamName } : null}
          dashboardEmbed={dashboardEmbed}
        />
      )
    case 'players':
      return <PlayersTab league={selectedLeague} onPlayerClick={onPlayerClick} sport={sport} />
    case 'trend':
      return <TrendTab league={selectedLeague} onPlayerClick={onPlayerClick} sport={sport} />
    case 'trades':
      return <TradesTab league={selectedLeague} teams={teamSlots} />
    case 'scores':
      return (
        <ScoresTab league={selectedLeague} sport={sport} idpLeagueUi={idpLeagueActive} />
      )
    case 'finance':
      return <FinanceTab leagueId={leagueId} isCommissioner={isCommissioner} />
    case 'war_room':
      return <WarRoomTab league={selectedLeague} sport={sport} dashboardEmbed={dashboardEmbed} />
    case 'ai_coaching':
      return <AICoachingTab league={selectedLeague} userTeam={userTeam} sport={sport} />
    case 'history':
      return <HistoryTab league={selectedLeague} />
    case 'settings':
      return (
        <LeagueSettingsContentTab
          leagueId={leagueId}
          isCommissioner={isCommissioner}
          isHeadCommissioner={isHeadCommissioner}
          dashboardEmbed={dashboardEmbed}
        />
      )
    case 'standings':
      return (
        <StandingsTab league={selectedLeague} tabLabel={tabLabel} idpLeagueUi={idpLeagueActive} />
      )
    case 'fixtures':
      return <FixturesTab league={selectedLeague} tabLabel={tabLabel} />
    case 'transfers':
      return <TransfersTab league={selectedLeague} tabLabel={tabLabel} />
    case 'table':
      return <TableTab league={selectedLeague} tabLabel={tabLabel} />
    case 'leaderboard':
      return <LeaderboardTab league={selectedLeague} tabLabel={tabLabel} />
    case 'my-picks':
      return <MyPicksTab league={selectedLeague} tabLabel={tabLabel} />
    case 'schedule':
      return <ScheduleTab league={selectedLeague} tabLabel={tabLabel} />
    default:
      return <LeagueTabPlaceholder league={selectedLeague} tabLabel={tabLabel} />
  }
}

const LEAGUE_TAB_NAV_ICONS: Record<string, LucideIcon> = {
  home: House,
  matchup: Swords,
  matchups: Swords,
  draft: LayoutGrid,
  redraft: RotateCcw,
  team: User,
  roster: ClipboardList,
  squad: Users,
  league: Shield,
  players: Shirt,
  trend: LineChart,
  trades: ArrowLeftRight,
  scores: BarChart3,
  finance: Wallet,
  war_room: Telescope,
  ai_coaching: Brain,
  history: History,
  standings: ListOrdered,
  fixtures: CalendarDays,
  transfers: Repeat2,
  table: Table,
  leaderboard: Trophy,
  'my-picks': Crosshair,
  schedule: CalendarRange,
  bestball: Sparkles,
  guillotine: Scissors,
  survivor: TreePalm,
  survivor_tribal: Flame,
  survivor_challenges: Zap,
  survivor_chimmy: Sparkles,
  survivor_exile: Ban,
  survivor_jury: Scale,
  survivor_command: LayoutDashboard,
  zombie: Skull,
  big_brother: Eye,
  bb_hoh: Crown,
  bb_veto: Shield,
  bb_voting: Vote,
  bb_jury: Scale,
  bb_twists: Wand2,
  bb_history: ScrollText,
  bb_command: LayoutDashboard,
  idp: ShieldPlus,
  keeper: Lock,
  settings: Settings,
}

function LeagueTabNavGlyph({
  tabId,
  className,
  active,
}: {
  tabId: string
  className?: string
  active: boolean
}) {
  const Icon = LEAGUE_TAB_NAV_ICONS[tabId] ?? LayoutGrid
  return (
    <span className="relative inline-flex shrink-0">
      <Icon className={className} strokeWidth={2.25} aria-hidden />
      {tabId === 'trend' && !active ? (
        <span
          className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-cyan-400 ring-2 ring-[#0a1228]"
          aria-hidden
        />
      ) : null}
    </span>
  )
}

function LeagueHeader({
  league,
  leagueId,
  tabs,
  activeTab,
  onTabChange,
  rosterIssueCount = 0,
  compactTitleRow = false,
  onOpenLeagueSettingsModal,
  memberGearMenu,
  onGoHome,
  idpLeagueActive = false,
  idpViewMode = 'full',
  onIdpViewModeChange,
  devyLeagueActive = false,
  devyBucketStats = { active: 0, taxi: 0, devy: 0 },
  c2cLeagueActive = false,
  c2cConfig = null,
  isCommissioner = false,
  onOpenCommissionerSettings,
  survivorLeagueActive = false,
  zombieLeagueActive = false,
  idpCapEnabled = false,
  capSummary = null,
  capRosterId = null,
}: {
  league: UserLeague
  leagueId: string
  tabs: TabDef[]
  activeTab: string
  onTabChange: (t: string) => void
  /** Illegal roster / lineup issue count for Team / Roster / Squad tab badge. */
  rosterIssueCount?: number
  /** When true, title row is hidden (content lives in `SpecialtyLeagueHomeHero`). */
  compactTitleRow?: boolean
  /** Opens the full League Settings modal (commissioner / co-comm hub, or member card grid). */
  onOpenLeagueSettingsModal: () => void
  /** When set, header gear opens a compact menu (regular members) instead of the full modal. */
  memberGearMenu: null | {
    onEditTeam: () => void
    onCoOwners: () => void
    onPreviousLeagues: () => void
    onLeaveLeague: () => void
  }
  onGoHome: () => void
  idpLeagueActive?: boolean
  idpViewMode?: 'offense' | 'defense' | 'full'
  onIdpViewModeChange?: (m: 'offense' | 'defense' | 'full') => void
  devyLeagueActive?: boolean
  devyBucketStats?: { active: number; taxi: number; devy: number }
  c2cLeagueActive?: boolean
  c2cConfig?: C2CConfigClient | null
  isCommissioner?: boolean
  onOpenCommissionerSettings?: () => void
  /** Survivor format — show quick links + Commissioner entry (same pattern as Devy/C2C). */
  survivorLeagueActive?: boolean
  /** Zombie format — horde hub quick links + Commissioner. */
  zombieLeagueActive?: boolean
  idpCapEnabled?: boolean
  capSummary?: {
    totalCap: number
    availableCap: number
  } | null
  capRosterId?: string | null
}) {
  const { t } = useLanguage()
  const [memberGearOpen, setMemberGearOpen] = useState(false)
  const memberGearWrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!memberGearOpen) return
    const close = () => setMemberGearOpen(false)
    const onDocDown = (e: MouseEvent) => {
      const el = memberGearWrapRef.current
      if (el && !el.contains(e.target as Node)) close()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('mousedown', onDocDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [memberGearOpen])

  const capPct =
    capSummary && capSummary.totalCap > 0 ? capSummary.availableCap / capSummary.totalCap : 0
  const capPillClass =
    capPct > 0.3
      ? 'border-[color:var(--cap-green)]/50 bg-[color:var(--cap-green)]/15 text-emerald-100'
      : capPct > 0.1
        ? 'border-[color:var(--cap-amber)]/45 bg-[color:var(--cap-amber)]/15 text-amber-100'
        : 'border-[color:var(--cap-red)]/45 bg-[color:var(--cap-red)]/15 text-red-100'
  return (
    <div className="sticky top-0 z-[45] flex-shrink-0 border-b border-white/[0.08] bg-[#050814] shadow-[0_10px_28px_rgba(0,0,0,0.42)]">
      <div
        className={cn(
          'flex flex-wrap items-start gap-3 px-4 pb-2 sm:px-5',
          compactTitleRow ? 'pt-3' : 'pt-4',
        )}
      >
        <div
          className={cn(
            'flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] overflow-hidden',
            compactTitleRow && 'hidden',
            !league.avatarUrl ? 'bg-gradient-to-br from-fuchsia-500 via-rose-500 to-rose-700 text-lg' : '',
          )}
          aria-hidden
        >
          {league.avatarUrl ? (
            <img
              src={league.avatarUrl.startsWith('http') ? league.avatarUrl : `https://sleepercdn.com/avatars/${league.avatarUrl}`}
              alt=""
              className="h-10 w-10 object-cover rounded-xl"
            />
          ) : (
            <span className="drop-shadow">{leagueTabSportEmoji(league.sport)}</span>
          )}
        </div>

        <div
          className={cn(
            'min-w-0 flex-1 basis-[min(100%,12rem)]',
            compactTitleRow && 'hidden',
          )}
        >
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <h1 className="max-w-full truncate text-base font-bold leading-tight text-white sm:text-[17px]">
              {league.name}
            </h1>
            {isCommissioner ? (
              <span
                className="inline-flex shrink-0 items-center gap-1 rounded-full border border-amber-400/35 bg-amber-400/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-200/90"
                data-testid="league-header-commissioner-badge"
                title="You are a commissioner of this league"
              >
                <Crown className="h-2.5 w-2.5" aria-hidden />
                Commish
              </span>
            ) : null}
            <span className="whitespace-normal text-[12px] leading-snug text-white/45 sm:text-[13px]">
              {league.season} {league.teamCount}-Team {league.isDynasty ? 'Dynasty' : 'Redraft'} {league.scoring}
            </span>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            {idpLeagueActive ? (
              <span className="idp-creator-badge flex-shrink-0 whitespace-nowrap">✦ Created by TheCiege</span>
            ) : null}
            {c2cLeagueActive && c2cConfig ? (
              <>
                {c2cConfig.createdByTheCiege !== false ? (
                  <span className="c2c-creator-badge flex-shrink-0 whitespace-nowrap" data-testid="c2c-creator-badge">
                    ✦ Created by TheCiege
                  </span>
                ) : null}
                <span
                  className="flex h-6 flex-shrink-0 items-stretch overflow-hidden rounded-full border border-white/[0.12] text-[9px] font-bold uppercase tracking-wide"
                  data-testid="c2c-sport-pair-pill"
                  title={c2cSportPairShort(c2cConfig.sportPair).label}
                >
                  <span className="flex items-center bg-violet-600/45 px-2 text-violet-50">
                    {c2cSportPairShort(c2cConfig.sportPair).left}
                  </span>
                  <span className="flex items-center px-1 text-white/50">↔</span>
                  <span className="flex items-center bg-blue-600/45 px-2 text-blue-50">
                    {c2cSportPairShort(c2cConfig.sportPair).right}
                  </span>
                </span>
                <span
                  className="flex-shrink-0 rounded-full border border-white/[0.1] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white/90"
                  style={{
                    background: 'linear-gradient(90deg, rgba(124,58,237,0.35), rgba(37,99,235,0.35))',
                  }}
                  data-testid="c2c-dynasty-pill"
                >
                  Dynasty · C2C
                </span>
              </>
            ) : null}
            {devyLeagueActive ? (
              <>
                <span
                  className="devy-creator-badge flex-shrink-0 whitespace-nowrap"
                  data-testid="devy-creator-badge"
                >
                  ✦ Created by TheCiege
                </span>
                <span
                  className="flex-shrink-0 rounded-full border border-white/[0.1] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white/90"
                  style={{
                    background: 'linear-gradient(90deg, rgba(124,58,237,0.35), rgba(37,99,235,0.35))',
                  }}
                  data-testid="devy-dynasty-pill"
                >
                  Dynasty · Devy
                </span>
              </>
            ) : null}
          </div>
          {idpLeagueActive && onIdpViewModeChange ? (
            <div className="mt-2 flex max-w-md flex-wrap gap-1 rounded-lg border border-white/[0.08] bg-black/20 p-1">
              {(['offense', 'defense', 'full'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => onIdpViewModeChange(m)}
                  className={`flex-1 rounded-md px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide ${
                    idpViewMode === m
                      ? m === 'offense'
                        ? 'bg-[color:var(--idp-offense)]/25 text-blue-100'
                        : m === 'defense'
                          ? 'bg-[color:var(--idp-defense)]/25 text-red-100'
                          : 'bg-[color:var(--idp-combined)]/25 text-violet-100'
                      : 'text-white/45 hover:bg-white/[0.04]'
                  }`}
                  data-testid={`idp-view-${m}`}
                >
                  {m === 'full' ? 'Full team' : m}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div
          className={cn(
            'ml-auto flex min-w-0 flex-shrink-0 flex-col items-end gap-2 sm:max-w-[42%]',
            compactTitleRow && 'w-full',
          )}
        >
          <div className="flex w-full flex-col items-end gap-1">
            {c2cLeagueActive && c2cConfig ? (
              <span
                className="whitespace-nowrap rounded-full border border-violet-500/35 bg-violet-500/10 px-2.5 py-1 text-[9px] font-bold uppercase tracking-wide text-violet-100"
                data-testid="c2c-score-mode-chip"
              >
                {c2cScoreModeChip(c2cConfig)}
              </span>
            ) : null}
            {idpCapEnabled && capSummary && capRosterId ? (
              <Link
                href={`/idp/cap/${leagueId}?rosterId=${encodeURIComponent(capRosterId)}`}
                className={`whitespace-nowrap rounded-full border px-2.5 py-1 text-[10px] font-bold tracking-wide transition hover:brightness-110 ${capPillClass}`}
                data-testid="idp-cap-header-pill"
              >
                CAP: ${capSummary.availableCap.toFixed(1)}M
              </Link>
            ) : null}
            {devyLeagueActive ? (
              <div
                className="flex max-w-[200px] flex-wrap items-center justify-end gap-x-2 gap-y-0.5 text-[9px] font-semibold text-white/70 sm:max-w-none sm:text-[10px]"
                data-testid="devy-bucket-stats"
              >
                <span className="inline-flex items-center gap-1">
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'var(--devy-active)' }} />
                  {devyBucketStats.active} NFL
                </span>
                <span className="text-white/25">·</span>
                <span className="inline-flex items-center gap-1">
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'var(--devy-taxi)' }} />
                  {devyBucketStats.taxi} Taxi
                </span>
                <span className="text-white/25">·</span>
                <span className="inline-flex items-center gap-1">
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'var(--devy-devy)' }} />
                  {devyBucketStats.devy} Devy
                </span>
              </div>
            ) : null}
          </div>

          <div className="relative flex flex-wrap items-center justify-end gap-1" ref={memberGearWrapRef}>
            <button
              type="button"
              onClick={onGoHome}
              className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl border border-white/[0.1] bg-[#121826] text-white/55 transition hover:border-white/[0.14] hover:bg-[#161d2e] hover:text-white/90"
              aria-label={t('league.header.dashboardHome')}
              data-testid="league-header-home"
            >
              <Home className="h-[18px] w-[18px]" strokeWidth={2} />
            </button>
            <button
              type="button"
              onClick={() => {
                if (memberGearMenu) setMemberGearOpen((o) => !o)
                else onOpenLeagueSettingsModal()
              }}
              aria-expanded={memberGearMenu ? memberGearOpen : undefined}
              aria-haspopup={memberGearMenu ? 'menu' : undefined}
              className={cn(
                'flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl border border-white/[0.1] bg-[#121826] transition hover:border-white/[0.14] hover:bg-[#161d2e]',
                memberGearOpen ? 'text-cyan-300' : 'text-white/45 hover:text-white/85',
              )}
              aria-label={memberGearMenu ? t('league.header.leagueMenu') : t('league.header.leagueSettings')}
              data-testid="league-header-settings"
            >
              <Settings className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden />
            </button>
            {memberGearMenu && memberGearOpen ? (
              <div
                className="absolute right-0 top-[calc(100%+8px)] z-[60] w-[min(calc(100vw-32px),280px)] overflow-hidden rounded-xl border border-white/[0.1] bg-[#0a1228] py-1 shadow-[0_12px_40px_rgba(0,0,0,0.55)]"
                role="menu"
                data-testid="member-league-gear-menu"
              >
                <div
                  className="absolute -top-1.5 right-4 h-3 w-3 rotate-45 border-l border-t border-white/[0.1] bg-[#0a1228]"
                  aria-hidden
                />
                <div className="relative pt-0.5">
                  {(
                    [
                      {
                        id: 'edit-team',
                        title: t('league.memberMenu.editTeam'),
                        sub: t('league.memberMenu.editTeam.sub'),
                        onSelect: memberGearMenu.onEditTeam,
                      },
                      {
                        id: 'co-owners',
                        title: t('league.memberMenu.coOwners'),
                        sub: t('league.memberMenu.coOwners.sub'),
                        onSelect: memberGearMenu.onCoOwners,
                      },
                      {
                        id: 'leave',
                        title: t('league.memberMenu.leave'),
                        sub: t('league.memberMenu.leave.sub'),
                        onSelect: memberGearMenu.onLeaveLeague,
                      },
                      {
                        id: 'previous',
                        title: t('league.memberMenu.previous'),
                        sub: t('league.memberMenu.previous.sub'),
                        onSelect: memberGearMenu.onPreviousLeagues,
                      },
                    ] as const
                  ).map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      role="menuitem"
                      data-testid={`member-gear-${item.id}`}
                      onClick={() => {
                        setMemberGearOpen(false)
                        item.onSelect()
                      }}
                      className="flex w-full flex-col items-start gap-0.5 px-3 py-2.5 text-left transition hover:bg-white/[0.06]"
                    >
                      <span className="text-[13px] font-semibold text-white/95">{item.title}</span>
                      <span className="text-[11px] leading-snug text-white/40">{item.sub}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {idpLeagueActive && idpCapEnabled && capRosterId ? (
        <div className="scrollbar-none -mx-1 mt-2 flex snap-x snap-mandatory gap-1 overflow-x-auto scroll-pb-1 border-t border-white/[0.05] px-4 py-2 sm:mx-0 sm:px-5 [-webkit-overflow-scrolling:touch]">
          {(
            [
              ['Roster', `/league/${leagueId}?view=team`],
              ['Matchup', `/league/${leagueId}?view=scores`],
              ['Contracts', `/idp/contracts/${leagueId}?rosterId=${encodeURIComponent(capRosterId)}`],
              ['Defense Hub', `/idp/defense-hub/${leagueId}?rosterId=${encodeURIComponent(capRosterId)}`],
              ['Cap Room', `/idp/cap/${leagueId}?rosterId=${encodeURIComponent(capRosterId)}`],
              ['Chat', `/league/${leagueId}`],
            ] as const
          ).map(([label, href]) => (
            <Link
              key={label}
              href={href}
              className="inline-flex snap-start min-h-[40px] shrink-0 touch-manipulation items-center whitespace-nowrap rounded-lg border border-white/[0.08] bg-black/25 px-3 py-2 text-[11px] font-semibold text-cyan-200/90 transition-colors hover:bg-cyan-500/10"
              data-testid={`idp-cap-quick-${label.toLowerCase().replace(/\s+/g, '-')}`}
            >
              {label}
            </Link>
          ))}
        </div>
      ) : null}

      {c2cLeagueActive ? (
        <div className="scrollbar-none -mx-1 mt-2 flex snap-x snap-mandatory gap-1 overflow-x-auto scroll-pb-1 border-t border-white/[0.05] px-4 py-2 sm:mx-0 sm:px-5 [-webkit-overflow-scrolling:touch]">
          {(
            [
              ['Roster', `/c2c/${leagueId}/roster`],
              ['Campus', `/c2c/${leagueId}/campus`],
              ['Canton', `/c2c/${leagueId}/canton`],
              ['Matchup', `/c2c/${leagueId}/matchup`],
              ['Picks', `/c2c/${leagueId}/picks`],
              ['Chat', `/league/${leagueId}`],
              ['History', `/league/${leagueId}?view=history`],
              ['Commissioner', '__commish__'],
            ] as const
          ).map(([label, href]) =>
            href === '__commish__' ? (
              <button
                key={`c2c-${label}`}
                type="button"
                onClick={() => {
                  if (isCommissioner && onOpenCommissionerSettings) onOpenCommissionerSettings()
                  else onOpenLeagueSettingsModal()
                }}
                className="inline-flex snap-start min-h-[40px] shrink-0 touch-manipulation items-center whitespace-nowrap rounded-lg border border-white/[0.08] bg-black/25 px-3 py-2 text-[11px] font-semibold text-white/80 transition-colors hover:bg-white/[0.06] hover:text-white"
                data-testid={`c2c-quick-${label.toLowerCase()}`}
              >
                {label}
              </button>
            ) : (
              <Link
                key={`c2c-${label}`}
                href={href}
                className="inline-flex snap-start min-h-[40px] shrink-0 touch-manipulation items-center whitespace-nowrap rounded-lg border border-white/[0.08] bg-black/25 px-3 py-2 text-[11px] font-semibold text-cyan-200/90 transition-colors hover:bg-cyan-500/10"
                data-testid={`c2c-quick-${label.toLowerCase()}`}
              >
                {label}
              </Link>
            ),
          )}
        </div>
      ) : null}

      {devyLeagueActive ? (
        <div className="scrollbar-none -mx-1 mt-2 flex snap-x snap-mandatory gap-1 overflow-x-auto scroll-pb-1 border-t border-white/[0.05] px-4 py-2 sm:mx-0 sm:px-5 [-webkit-overflow-scrolling:touch]">
          {(
            [
              ['Roster', `/devy/${leagueId}/roster`],
              ['Taxi', `/devy/${leagueId}/roster#taxi`],
              ['Devy', `/devy/${leagueId}/roster#devy`],
              ['Picks', `/devy/${leagueId}/picks`],
              ['Matchup', `/league/${leagueId}`],
              ['Chat', `/league/${leagueId}`],
              ['History', `/devy/${leagueId}/history`],
              ['Commissioner', '__commish__'],
            ] as const
          ).map(([label, href]) =>
            href === '__commish__' ? (
              <button
                key={label}
                type="button"
                onClick={() => {
                  if (isCommissioner && onOpenCommissionerSettings) onOpenCommissionerSettings()
                  else onOpenLeagueSettingsModal()
                }}
                className="inline-flex snap-start min-h-[40px] shrink-0 touch-manipulation items-center whitespace-nowrap rounded-lg border border-white/[0.08] bg-black/25 px-3 py-2 text-[11px] font-semibold text-white/80 transition-colors hover:bg-white/[0.06] hover:text-white"
                data-testid={`devy-quick-${label.toLowerCase()}`}
              >
                {label}
              </button>
            ) : (
              <Link
                key={label}
                href={href}
                className="inline-flex snap-start min-h-[40px] shrink-0 touch-manipulation items-center whitespace-nowrap rounded-lg border border-white/[0.08] bg-black/25 px-3 py-2 text-[11px] font-semibold text-cyan-200/90 transition-colors hover:bg-cyan-500/10"
                data-testid={`devy-quick-${label.toLowerCase()}`}
              >
                {label}
              </Link>
            ),
          )}
        </div>
      ) : null}

      {survivorLeagueActive ? (
        <div className="scrollbar-none -mx-1 mt-2 flex snap-x snap-mandatory gap-1 overflow-x-auto scroll-pb-1 border-t border-amber-500/15 bg-gradient-to-r from-amber-950/20 to-transparent px-4 py-2 sm:mx-0 sm:px-5 [-webkit-overflow-scrolling:touch]">
          {(
            [
              ['Island', `/league/${leagueId}?view=survivor`],
              ['Full hub', `/survivor/${leagueId}`],
              ['Tribal', `/survivor/${leagueId}/tribal`],
              ['Challenges', `/survivor/${leagueId}/challenges`],
              ['Chimmy', `/survivor/${leagueId}/chimmy`],
              ['Team', `/league/${leagueId}?view=team`],
              ['Chat', `/league/${leagueId}?tab=Chat`],
              ['Scores', `/league/${leagueId}?view=scores`],
              ...(isCommissioner ? ([['Command', `/survivor/${leagueId}/commissioner`]] as const) : []),
              ['Commissioner', '__commish__'],
            ] as Array<[string, string] | [string, '__commish__']>
          ).map(([label, href]) =>
            href === '__commish__' ? (
              <button
                key={`survivor-${label}`}
                type="button"
                onClick={() => {
                  if (isCommissioner && onOpenCommissionerSettings) onOpenCommissionerSettings()
                  else onOpenLeagueSettingsModal()
                }}
                className="inline-flex snap-start min-h-[40px] shrink-0 touch-manipulation items-center whitespace-nowrap rounded-lg border border-amber-500/25 bg-amber-950/25 px-3 py-2 text-[11px] font-semibold text-amber-100/95 transition-colors hover:bg-amber-500/15"
                data-testid="survivor-quick-commissioner"
              >
                {label}
              </button>
            ) : (
              <Link
                key={`survivor-${label}`}
                href={href}
                className="inline-flex snap-start min-h-[40px] shrink-0 touch-manipulation items-center whitespace-nowrap rounded-lg border border-white/[0.08] bg-black/25 px-3 py-2 text-[11px] font-semibold text-amber-100/85 transition-colors hover:bg-amber-500/10"
                data-testid={`survivor-quick-${label.toLowerCase().replace(/\s+/g, '-')}`}
              >
                {label}
              </Link>
            ),
          )}
        </div>
      ) : null}

      {zombieLeagueActive ? (
        <div className="scrollbar-none -mx-1 mt-2 flex snap-x snap-mandatory gap-1 overflow-x-auto scroll-pb-1 border-t border-violet-500/20 bg-gradient-to-r from-violet-950/25 to-transparent px-4 py-2 sm:mx-0 sm:px-5 [-webkit-overflow-scrolling:touch]">
          {(
            [
              ['Horde', `/league/${leagueId}?view=zombie`],
              ['Full hub', `/zombie/${leagueId}`],
              ['Rules', `/zombie/${leagueId}/rules`],
              ['Team', `/league/${leagueId}?view=team`],
              ['Chat', `/league/${leagueId}?tab=Chat`],
              ['Commissioner', '__commish__'],
            ] as const
          ).map(([label, href]) =>
            href === '__commish__' ? (
              <button
                key={`zombie-${label}`}
                type="button"
                onClick={() => {
                  if (isCommissioner && onOpenCommissionerSettings) onOpenCommissionerSettings()
                  else onOpenLeagueSettingsModal()
                }}
                className="inline-flex snap-start min-h-[40px] shrink-0 touch-manipulation items-center whitespace-nowrap rounded-lg border border-violet-500/30 bg-violet-950/30 px-3 py-2 text-[11px] font-semibold text-violet-100/95 transition-colors hover:bg-violet-500/15"
                data-testid="zombie-quick-commissioner"
              >
                {label}
              </button>
            ) : (
              <Link
                key={`zombie-${label}`}
                href={href}
                className="inline-flex snap-start min-h-[40px] shrink-0 touch-manipulation items-center whitespace-nowrap rounded-lg border border-white/[0.08] bg-black/25 px-3 py-2 text-[11px] font-semibold text-violet-100/90 transition-colors hover:bg-violet-500/10"
                data-testid={`zombie-quick-${label.toLowerCase().replace(/\s+/g, '-')}`}
              >
                {label}
              </Link>
            ),
          )}
        </div>
      ) : null}

      <div className="scrollbar-none mt-2 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-5 sm:pb-3">
        <div
          className="flex snap-x snap-mandatory gap-1 overflow-x-auto scroll-pb-1 rounded-xl border border-white/[0.1] bg-[#0a1228] p-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] [-webkit-overflow-scrolling:touch]"
          role="tablist"
          aria-label="League navigation"
        >
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id
            const rosterTab = tab.id === 'team' || tab.id === 'roster' || tab.id === 'squad'
            const showRosterBadge = rosterIssueCount > 0 && rosterTab
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                data-testid={`league-tab-${tab.id}`}
                onClick={() => onTabChange(tab.id)}
                className={cn(
                  'touch-manipulation flex snap-start min-h-[44px] min-w-0 shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-2 text-[10px] font-bold uppercase tracking-wide transition-colors sm:min-h-[40px] sm:px-3 sm:text-[11px]',
                  isActive
                    ? 'bg-cyan-400 text-[#050814] shadow-sm'
                    : 'text-cyan-400/95 hover:bg-white/[0.06] hover:text-cyan-300',
                )}
              >
                <LeagueTabNavGlyph
                  tabId={tab.id}
                  active={isActive}
                  className={cn(
                    'h-3.5 w-3.5 sm:h-4 sm:w-4',
                    isActive ? 'text-[#050814]' : 'text-cyan-400',
                  )}
                />
                <span className="truncate">{tab.label}</span>
                {showRosterBadge ? (
                  <span
                    className={cn(
                      'ml-0.5 min-w-[1.125rem] rounded-full px-1 text-center text-[9px] font-extrabold tabular-nums ring-1',
                      isActive
                        ? 'bg-amber-500 text-[#050814] ring-amber-700/40'
                        : 'bg-amber-500/95 text-[#050814] ring-amber-400/30',
                    )}
                    aria-label={`${rosterIssueCount} roster issues`}
                    data-testid={`league-tab-${tab.id}-roster-issues-badge`}
                  >
                    {rosterIssueCount > 99 ? '99+' : rosterIssueCount}
                  </span>
                ) : null}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
