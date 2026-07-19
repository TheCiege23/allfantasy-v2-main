'use client'

/**
 * Nocturne dashboard — Phase 1 (Global context), preview route `/dashboard/nocturne`.
 *
 * Reskins the logged-in dashboard to the Nocturne design, wired to the EXISTING
 * live-data systems (no new backend except the cross-league player-search route):
 *  - rank        → initialUserRankPayload (SSR) / GET /api/user/rank
 *  - leagues     → initialLeagueList (SSR) / GET /api/league/list
 *  - tier/gates  → useAccessTier() (guest|free|paid) — REAL subscription state
 *  - tokens      → useTokenBalance()
 *  - plan chip   → useEntitlements()
 *  - theme mode  → useOptionalThemeMode()
 *  - language    → useOptionalLanguage()
 *  - priorities  → GET /api/dashboard/today-actions
 *  - player srch → GET /api/players/my-exposure (real, across the user's leagues)
 *  - upgrade/tokens → /upgrade, /pricing (real monetization surfaces)
 *
 * The live `/dashboard` is untouched; this route is the staging ground for the
 * eventual cut-over. Commissioner/Team contexts, the full chart galleries, and
 * chat are later phases — the context tabs switch, and those contexts show a
 * clearly-labeled "coming in the next phase" placeholder for now.
 *
 * Tier is driven by REAL state; a small "Preview as" override is included ONLY
 * because this is a design-review preview route (drop it at production cut-over).
 */

import { useEffect, useMemo, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutGrid, ShieldCheck, User, Plus, ChevronDown, ChevronRight, LifeBuoy, Sparkles,
  Rocket, AlertCircle, Trophy, ListChecks, ArrowLeftRight, Handshake, Filter, Lock,
  List as ListIcon, X, MousePointerClick, LineChart, History, Brain, Share2, Scale,
  Sun, Moon, Monitor, Search, Lightbulb, Info, Settings, MessageCircle, Swords, Check,
} from 'lucide-react'
import { useAccessTier } from '@/hooks/useAccessTier'
import { useTokenBalance } from '@/hooks/useTokenBalance'
import { useEntitlements } from '@/hooks/useEntitlements'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { useOptionalThemeMode } from '@/components/theme/ThemeProvider'
import type { CommissionerLeagueHealthSnapshot } from '@/lib/commissioner-hub/commissionerHubHealth'
import type { UserLeague } from '@/app/dashboard/types'
import { TeamThisWeek } from '@/app/dashboard/components/warroom/TeamThisWeek'
import { SeasonOutlook } from '@/app/dashboard/components/warroom/SeasonOutlook'
import { InjuryImpactPanel } from '@/app/dashboard/components/warroom/InjuryImpactPanel'
import { SeasonJourney } from '@/app/dashboard/components/warroom/SeasonJourney'
import { WaiverWirePreview } from '@/app/dashboard/components/warroom/WaiverWirePreview'
import type { WaiverDashboardResponse } from '@/app/dashboard/dashboardStripApiTypes'
import { StartSitLauncher } from '@/components/dashboard/StartSitLauncher'
import { FloatingCommunications } from '@/app/dashboard/components/FloatingCommunications'
import { LineupIssuesModal, type LineupCheckPayload } from '@/app/dashboard/components/LineupIssuesModal'
import { WaiverRecommendationsModal } from '@/app/dashboard/components/WaiverRecommendationsModal'
import { PendingTradesModal } from '@/app/dashboard/components/PendingTradesModal'
import { useGeoRestriction } from '@/lib/geo/useGeoRestriction'
import { scopeBySelectedLeague } from '@/lib/dashboard/scope-by-selected-league'
import type { LeftChatInitialTab } from '@/app/dashboard/types'
import type { TradesDashboardResponse } from '@/app/dashboard/dashboardStripApiTypes'
import './nocturne-dashboard.css'

type RankPayload = Record<string, unknown>
type LeagueListPayload = { leagues?: unknown[]; sleeperUserId?: string | null } | undefined

type NocturneDashboardProps = {
  userId: string
  userName: string
  userImage?: string | null
  initialLeagueList?: LeagueListPayload
  initialUserRankPayload?: RankPayload
  initialCommissionerHealthSnapshots?: CommissionerLeagueHealthSnapshot[]
  emailVerified?: boolean
  discordConnected?: boolean
}

type PrimaryContext = 'global' | 'commissioner' | 'team'
type PreviewTier = 'visitor' | 'free' | 'premium'

const PLATFORM_COLORS: Record<string, string> = {
  sleeper: '#1f2a4d', espn: '#4a1414', yahoo: '#3a1d55', mfl: '#143a2e', fantrax: '#5a3a14',
}
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
/**
 * Season year off a league row. MUST tolerate strings: `SleeperLeague.season` is a
 * `String` column while `League.season` / `LegacyLeague.season` are `Int`. Reading it
 * as a number only would silently null every Sleeper league and dump them all into
 * the Historical bucket.
 */
const seasonYear = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string') {
    const n = Number.parseInt(v.trim(), 10)
    if (Number.isFinite(n) && n > 1900 && n < 2200) return n
  }
  return null
}

/**
 * Season timeline steps, in order. "Trade deadline" is a genuine milestone but we have NO
 * per-league deadline week (the only `tradeDeadlineWeek` in the codebase is a hardcoded 12
 * inside season-strategy), so it is never marked complete on a guess — a regular-season
 * league simply shows it as upcoming.
 */
const SEASON_STEPS = ['Pre-season', 'Draft', 'Reg. season', 'Trade deadline', 'Playoffs', 'Champion', 'Offseason'] as const

/**
 * Which step a league is on, from its real lifecycle status and week.
 * Returns null when the league carries no usable status — the timeline is then hidden
 * rather than defaulted to a phase we can't substantiate.
 */
function resolveSeasonPhase(
  league: { status: string; playoffStartWeek: number | null } | null,
  week: number | null,
): { index: number; week: number | null } | null {
  if (!league) return null
  const s = (league.status ?? '').toLowerCase().trim().replace(/\s+/g, '_')
  if (s === 'pre_draft' || s === 'predraft' || s === 'setup') return { index: 0, week: null }
  if (s === 'drafting') return { index: 1, week: null }
  if (s === 'complete' || s === 'completed') return { index: 5, week: null }
  // In-season (or post-draft): regular season until the playoff week, then playoffs.
  const playoffStart = league.playoffStartWeek
  if (week != null && playoffStart != null && week >= playoffStart) return { index: 4, week }
  if (s === 'post_draft' || s === 'postdraft') return { index: 2, week }
  if (s === 'in_season' || s === 'active' || week != null) return { index: 2, week }
  return null
}

/**
 * Compact "time from now" for the priority cards ("Locks in 4h"). Returns null for a
 * missing/unparseable/past timestamp so callers fall back to generic copy — the card must
 * never claim a deadline the data doesn't actually carry.
 */
function relativeUntil(iso: string | null | undefined): string | null {
  if (!iso) return null
  const ms = new Date(iso).getTime() - Date.now()
  if (!Number.isFinite(ms) || ms <= 0) return null
  const mins = Math.round(ms / 60000)
  if (mins < 60) return `${mins}m`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h`
  return `${Math.round(hrs / 24)}d`
}

/**
 * Sleeper drives a league through pre_draft → drafting → post_draft → in_season →
 * complete. A league being set up for the upcoming year is often still keyed to last
 * season, so season-year alone misfiles it as history; conversely `complete` means the
 * season is over no matter what year it carries. Native AF leagues don't model this yet
 * (first season), so they fall through to the season-year comparison.
 */
const PRE_SEASON_STATUSES = new Set(['pre_draft', 'predraft', 'drafting', 'post_draft', 'postdraft'])
function isCurrentSeasonLeague(l: { season: number | null; status: string }, currentYear: number): boolean {
  const s = (l.status ?? '').toLowerCase().trim().replace(/\s+/g, '_')
  if (s === 'complete' || s === 'completed') return false
  if (PRE_SEASON_STATUSES.has(s)) return true
  if (l.season != null) return l.season >= currentYear
  return false
}
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)

function platformColor(platform: string): string {
  return PLATFORM_COLORS[platform.toLowerCase()] ?? 'var(--color-accent-800)'
}

type DisplayLeague = {
  id: string; name: string; platform: string; initial: string; color: string
  isCommissioner: boolean; status: string; unified: boolean
  // Real fields off the league-list payload (native + AF-Legacy board rows both carry these).
  // `season` drives the Current vs Historical split; the rest populate the league detail popup.
  season: number | null; teamCount: number | null; format: string | null
  scoring: string | null; sport: string | null; platformLeagueId: string | null
  /** Drives the season timeline's regular-season vs playoffs boundary. */
  playoffStartWeek: number | null
}

function mapLeagues(payload: LeagueListPayload): DisplayLeague[] {
  const rows = Array.isArray(payload?.leagues) ? payload!.leagues! : []
  return rows.map((raw) => {
    const r = (raw ?? {}) as Record<string, unknown>
    const id = str(r.navigationLeagueId) ?? str(r.unifiedLeagueId) ?? str(r.id) ?? cryptoLikeId(r)
    const name = str(r.name) ?? 'League'
    const platform = (str(r.platform) ?? 'native').toLowerCase()
    return {
      id,
      name,
      platform,
      initial: (platform === 'native' ? name : platform).charAt(0).toUpperCase(),
      color: platformColor(platform),
      isCommissioner: r.isCommissioner === true || r.userRole === 'commissioner',
      status: str(r.status) ?? str(r.lifecycleState) ?? 'Active',
      // Only leagues with a unified record resolve on /league/[id]; AF-Legacy board
      // rows (hasUnifiedRecord=false) 404 there — they open the detail popup instead.
      unified: r.hasUnifiedRecord === true,
      season: seasonYear(r.season),
      teamCount: num(r.teamCount) ?? num(r.leagueSize),
      format: str(r.format) ?? str(r.leagueType),
      scoring: str(r.scoring) ?? str(r.scoringType),
      sport: str(r.sport) ?? str(r.sport_type),
      platformLeagueId: str(r.platformLeagueId) ?? str(r.sleeperLeagueId),
      playoffStartWeek: num(r.playoffStartWeek),
    }
  })
}

// Raw league row → full UserLeague (what the reused warroom Team components need).
// Focused replica of app/dashboard/DashboardShell.tsx mapLeague, reading the same raw rows.
function toUserLeague(raw: unknown): UserLeague | null {
  const r = (raw ?? {}) as Record<string, unknown>
  const id = str(r.navigationLeagueId) ?? str(r.unifiedLeagueId) ?? str(r.id)
  if (!id) return null
  const platform = (str(r.platform) ?? 'allfantasy').toLowerCase()
  const settings = (r.settings && typeof r.settings === 'object' ? r.settings : {}) as Record<string, unknown>
  const role = r.userRole === 'commissioner' || r.userRole === 'member' || r.userRole === 'imported' ? r.userRole : 'member'
  return {
    id,
    name: str(r.name) ?? 'League',
    platform,
    sport: str(r.sport) ?? str(r.sport_type) ?? 'NFL',
    format: str(r.leagueType) ?? str(r.leagueVariant) ?? (r.isDynasty === true ? 'dynasty' : 'redraft'),
    scoring: str(r.scoring) ?? 'Standard',
    teamCount: num(r.teamCount) ?? num(r.leagueSize) ?? 0,
    season: num(r.season) ?? str(r.season) ?? undefined,
    status: str(r.status) ?? str(r.syncStatus) ?? undefined,
    currentWeek: num(r.currentWeek) ?? num(settings.leg) ?? num(settings.week) ?? null,
    isDynasty: r.isDynasty === true,
    avatarUrl: str(r.avatarUrl),
    logoUrl: str(r.logoUrl),
    leagueType: str(r.leagueType),
    leagueVariant: str(r.leagueVariant),
    hasUnifiedRecord: r.hasUnifiedRecord === true,
    isCommissioner: r.isCommissioner === true || r.userRole === 'commissioner',
    userRole: role,
    lifecycleState: str(r.lifecycleState),
    tradeDeadlineWeek: num(r.tradeDeadlineWeek),
    playoffStartWeek: num(r.playoffStartWeek),
    sleeperLeagueId: platform === 'sleeper' ? str(r.platformLeagueId) ?? undefined : undefined,
  }
}
function cryptoLikeId(r: Record<string, unknown>): string {
  return str(r.platformLeagueId) ?? `lg-${str(r.name) ?? Math.abs(hashStr(JSON.stringify(r))).toString(36)}`
}
function hashStr(s: string): number { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h }

// ── Rank payload readers (defensive; empty user → nulls) ──────────────────────
function readRank(p: RankPayload | undefined) {
  const rank = (p?.rank ?? null) as Record<string, unknown> | null
  return {
    imported: p?.imported === true,
    level: num(p?.level),
    levelName: str(p?.levelName) ?? str(p?.tierName),
    tier: str(p?.tier),
    xpInto: num(p?.xpIntoLevel),
    xpFor: num(p?.xpForLevel),
    progressPct: num(p?.progressPct),
    nextLevelName: str(p?.nextLevelName),
    wins: num(p?.careerWins),
    losses: num(p?.careerLosses),
    titles: num(p?.careerChampionships),
    playoffs: num(p?.careerPlayoffAppearances),
    seasons: num(p?.careerSeasonsPlayed),
    grade: str(rank?.aiReportGrade),
    insight: str(rank?.aiInsight),
  }
}

// ── Tools (reference set → real AF Legacy destinations, tier-gated) ───────────
const TOOLS = [
  { key: 'waiver', label: 'Waiver Assistant', desc: 'Ranked pickups for every league.', Icon: MousePointerClick, href: '/af-legacy?tab=waiver', premiumOnly: false },
  { key: 'trade', label: 'Trade Analyzer', desc: 'Fairness scoring on any proposal.', Icon: ArrowLeftRight, href: '/af-legacy?tab=trade', premiumOnly: true },
  { key: 'outlook', label: 'Season Outlook', desc: 'Playoff & championship odds.', Icon: LineChart, href: '/af-legacy?tab=pulse', premiumOnly: true },
  { key: 'history', label: 'Trade History', desc: 'Every trade, by week.', Icon: History, href: '/af-legacy?tab=finder', premiumOnly: true },
  { key: 'psych', label: 'Manager Psychology', desc: 'Your play style, decoded.', Icon: Brain, href: '/af-legacy?tab=compare', premiumOnly: true },
  { key: 'social', label: 'Social Media Sharing', desc: 'Share your season highlights.', Icon: Share2, href: '/career-share', premiumOnly: false },
  { key: 'compare', label: 'Manager Compare', desc: 'You vs. league average.', Icon: Scale, href: '/af-legacy?tab=compare', premiumOnly: true },
] as const

const UPGRADE_HREF = '/upgrade'
const TOKENS_HREF = '/pricing'
// Design-review tier override: dev only. Next inlines process.env.NODE_ENV at build
// time, so this is `false` in the production bundle → the toggle can't ship or bypass gates.
const PREVIEW_TIER_TOGGLE = process.env.NODE_ENV !== 'production'

export default function NocturneDashboard({
  userId, userName, userImage, initialLeagueList, initialUserRankPayload, initialCommissionerHealthSnapshots,
  emailVerified = true, discordConnected = false,
}: NocturneDashboardProps) {
  const access = useAccessTier()
  const { balance: tokenBalance } = useTokenBalance()
  const entitlements = useEntitlements()
  const lang = useOptionalLanguage()
  const theme = useOptionalThemeMode()
  // Mount-location-aware self URL for auth/import round-trips. This component renders at both
  // `/dashboard` (production cut-over) and `/dashboard/nocturne` (preview) — hardcoding either
  // sends post-import / post-sign-in users to the wrong home, so derive it from the live path.
  const pathname = usePathname()
  const selfHref = pathname || '/dashboard'

  // ── Client state ────────────────────────────────────────────────────────────
  const [context, setContext] = useState<PrimaryContext>('global')
  const [tierOverride, setTierOverride] = useState<PreviewTier | null>(null)
  const [dashLeagueFilter, setDashLeagueFilter] = useState('all')
  // League detail popup + the collapsed Historical section (547-league accounts need both).
  const [leagueModal, setLeagueModal] = useState<DisplayLeague | null>(null)
  const [showHistorical, setShowHistorical] = useState(false)
  const [leagueSearch, setLeagueSearch] = useState('')
  const [platformFilter, setPlatformFilter] = useState('all')
  const [view, setView] = useState<'cards' | 'list'>('cards')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [playerQuery, setPlayerQuery] = useState('')
  const [playerResults, setPlayerResults] = useState<PlayerResult[]>([])
  const [activePlayer, setActivePlayer] = useState<PlayerResult | null>(null)
  const [today, setToday] = useState<TodayState>(null)
  const [commLeagueId, setCommLeagueId] = useState<string | null>(null)
  const [checkedActions, setCheckedActions] = useState<Record<string, boolean>>({})
  const [teamLeagueId, setTeamLeagueId] = useState<string | null>(null)
  const [todayFull, setTodayFull] = useState<Record<string, unknown> | null>(null)

  const userLeagues = useMemo(
    () => (Array.isArray(initialLeagueList?.leagues) ? initialLeagueList!.leagues! : [])
      .map(toUserLeague)
      .filter((l): l is UserLeague => l !== null),
    [initialLeagueList],
  )
  // Team context lists every league you play; the live game-day components render only
  // for unified leagues (AF-Legacy board rows 404 on /league APIs — they get a view-only note).
  const teamLeagues = userLeagues
  const activeTeamLeague = teamLeagues.find((l) => l.id === teamLeagueId) ?? teamLeagues[0] ?? null

  const [commsOpen, setCommsOpen] = useState(false)
  const [commsTab, setCommsTab] = useState<LeftChatInitialTab | null>(null)
  const [openModal, setOpenModal] = useState<'lineup' | 'waiver' | 'trade' | null>(null)
  const geo = useGeoRestriction()
  const commissionerLeagues = useMemo(
    () => userLeagues.filter((l) => l.isCommissioner).map((l) => ({ id: l.id, name: l.name, teamCount: l.teamCount ?? 0 })),
    [userLeagues],
  )
  const hasPro = entitlements.hasPro

  // Commissioner HQ honors the top-bar league scope too — otherwise selecting one league
  // still listed every commissioned league and kept the previous health card on screen.
  const commHealth = useMemo(() => {
    const all = initialCommissionerHealthSnapshots ?? []
    return dashLeagueFilter === 'all' ? all : all.filter((s) => s.leagueId === dashLeagueFilter)
  }, [initialCommissionerHealthSnapshots, dashLeagueFilter])
  const activeCommSnapshot = useMemo(
    () => commHealth.find((s) => s.leagueId === commLeagueId) ?? commHealth[0] ?? null,
    [commHealth, commLeagueId],
  )

  const leagues = useMemo(() => mapLeagues(initialLeagueList), [initialLeagueList])
  // Hero chips + the commission callout follow the league scope (not the section-local
  // search/platform filters), so "547 Leagues" collapses to the one you selected.
  const scopedLeagues = useMemo(
    () => (dashLeagueFilter === 'all' ? leagues : leagues.filter((l) => l.id === dashLeagueFilter)),
    [leagues, dashLeagueFilter],
  )
  const rank = useMemo(() => readRank(initialUserRankPayload), [initialUserRankPayload])

  // Real tier → Visitor/Free/Premium. While entitlements load, default to 'free'
  // (the route is auth-gated server-side, so the user is never really a visitor) to
  // avoid flashing the visitor UI to paying users (SF3).
  const realTier: PreviewTier = access.loading
    ? 'free'
    : access.tier === 'paid' ? 'premium' : access.tier === 'free' ? 'free' : 'visitor'
  // The "Preview as" override is a DESIGN-REVIEW affordance only — it must NEVER be
  // able to flip a real user's gates in production (B3). Ignored outside dev, and the
  // control itself only renders in dev (see PREVIEW_TIER_TOGGLE below).
  const tier: PreviewTier = (PREVIEW_TIER_TOGGLE ? tierOverride : null) ?? realTier
  const isVisitor = tier === 'visitor'
  const isFree = tier === 'free'
  const isPremium = tier === 'premium'
  const showLock = isFree // free accounts see blur+lock; visitors get signup prompts

  const planChip = resolvePlanChip(entitlements)

  // ── Today's actions (priorities + need-attention count) ──────────────────────
  useEffect(() => {
    if (leagues.length === 0) { setToday(null); return }
    let cancelled = false
    // 503/degraded is surfaced as 'unavailable', never as "all clear" (the API returns
    // 503 on failure precisely so the client doesn't tell the user everything is fine).
    void fetch('/api/dashboard/today-actions', { cache: 'no-store' })
      .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json() })
      .then((data) => {
        if (cancelled) return
        setToday(parseToday(data) ?? 'unavailable')
        setTodayFull(data && typeof data === 'object' ? (data as Record<string, unknown>) : null)
      })
      .catch(() => { if (!cancelled) { setToday('unavailable'); setTodayFull(null) } })
    return () => { cancelled = true }
  }, [leagues.length])

  // ── Live player search (debounced) ───────────────────────────────────────────
  useEffect(() => {
    const q = playerQuery.trim()
    if (q.length < 2) { setPlayerResults([]); return }
    let cancelled = false
    const t = setTimeout(() => {
      void fetch(`/api/players/my-exposure?q=${encodeURIComponent(q)}`, { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => { if (!cancelled) setPlayerResults(Array.isArray(data?.players) ? data.players : []) })
        .catch(() => { if (!cancelled) setPlayerResults([]) })
    }, 250)
    return () => { cancelled = true; clearTimeout(t) }
  }, [playerQuery])

  // Today's priorities, scoped to the top-bar league filter. `/api/dashboard/today-actions`
  // reports counts across EVERY league, so with a league selected the global counts are
  // simply wrong for what's on screen. The payload's lineup.actions / waivers.recommendations
  // / trades.trades each carry a leagueId, so we re-derive the counts from the scoped rows
  // (same approach as the old shell's scopeBySelectedLeague usage) rather than fetching again.
  const todayData = useMemo<TodayShape | null>(() => {
    if (!today || today === 'unavailable') return null
    if (dashLeagueFilter === 'all') return today
    const lineupActions = scopeBySelectedLeague(
      ((todayFull?.lineup as { actions?: Array<{ leagueId: string }> } | undefined)?.actions ?? []),
      dashLeagueFilter,
    )
    const waiverRecs = scopeBySelectedLeague(
      ((todayFull?.waivers as { recommendations?: Array<{ leagueId: string; pickups?: unknown[] }> } | undefined)?.recommendations ?? []),
      dashLeagueFilter,
    )
    const trades = scopeBySelectedLeague(
      ((todayFull?.trades as { trades?: Array<{ leagueId: string }> } | undefined)?.trades ?? []),
      dashLeagueFilter,
    )
    const waivers = waiverRecs.reduce((n, r) => n + (Array.isArray(r.pickups) ? r.pickups.length : 0), 0)
    return {
      lineups: lineupActions.length,
      waivers,
      trades: trades.length,
      urgent: lineupActions.length + trades.length,
    }
  }, [today, todayFull, dashLeagueFilter])
  // Reused components (RankingsCard, action modals, hero chips) dispatch window events to open chat.
  useEffect(() => {
    const openChimmy = () => { setCommsTab('chimmy'); setCommsOpen(true) }
    const openDefault = () => { setCommsTab('league'); setCommsOpen(true) }
    window.addEventListener('af-dashboard-focus-left-chimmy', openChimmy)
    window.addEventListener('af-dashboard-open-chimmy', openChimmy)
    window.addEventListener('af-dashboard-open-mobile-left', openDefault)
    return () => {
      window.removeEventListener('af-dashboard-focus-left-chimmy', openChimmy)
      window.removeEventListener('af-dashboard-open-chimmy', openChimmy)
      window.removeEventListener('af-dashboard-open-mobile-left', openDefault)
    }
  }, [])

  const urgentCount = todayData ? todayData.urgent : 0

  // ── Filtered leagues (search + platform + top-bar league scope) ──────────────
  const platformOptions = useMemo(
    () => Array.from(new Set(leagues.map((l) => l.platform))).filter((p) => p !== 'native'),
    [leagues],
  )
  const filteredLeagues = useMemo(() => {
    const q = leagueSearch.trim().toLowerCase()
    return leagues.filter((l) => {
      if (dashLeagueFilter !== 'all' && l.id !== dashLeagueFilter) return false
      if (platformFilter !== 'all' && l.platform !== platformFilter) return false
      if (q && !l.name.toLowerCase().includes(q)) return false
      return true
    })
  }, [leagues, leagueSearch, platformFilter, dashLeagueFilter])

  // Real current week per league. `/api/dashboard/live-scores` already resolves this from
  // RedraftSeason (it returns { scores: [{ leagueId, week, ... }] }), so the timeline needs
  // no new endpoint. Leagues without a redraft season (Sleeper/AF-Legacy imports) simply
  // aren't in the response and fall back to a week-less phase.
  const [weekByLeague, setWeekByLeague] = useState<Record<string, number> | null>(null)
  useEffect(() => {
    if (leagues.length === 0) return
    let cancelled = false
    void fetch('/api/dashboard/live-scores', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled || !d) return
        const rows = Array.isArray(d.scores) ? (d.scores as Array<{ leagueId?: string; week?: number }>) : []
        const map: Record<string, number> = {}
        for (const row of rows) {
          if (typeof row.leagueId === 'string' && typeof row.week === 'number') map[row.leagueId] = row.week
        }
        setWeekByLeague(map)
      })
      .catch(() => { if (!cancelled) setWeekByLeague(null) })
    return () => { cancelled = true }
  }, [leagues.length])

  // Timeline follows the selected league; with no selection it uses the payload's primary
  // league (the one today-actions itself treats as primary), else the first current league.
  const timelineLeague = useMemo(() => {
    if (dashLeagueFilter !== 'all') return leagues.find((l) => l.id === dashLeagueFilter) ?? null
    const primaryId = str(todayFull?.primaryLeagueId)
    return (primaryId ? leagues.find((l) => l.id === primaryId) : null) ?? leagues[0] ?? null
  }, [leagues, dashLeagueFilter, todayFull])

  const seasonPhase = useMemo(
    () => resolveSeasonPhase(timelineLeague, timelineLeague ? (weekByLeague?.[timelineLeague.id] ?? null) : null),
    [timelineLeague, weekByLeague],
  )

  // Real urgency for the priority cards. `lockTime` rides each lineup action and
  // `waiverTiming` carries the server's next waiver run — so "Locks in 4h" is measured,
  // not decorative. Scoped the same way the counts are; falls back to generic copy
  // whenever the timestamps aren't actually present.
  const priorityTiming = useMemo(() => {
    const rawActions = ((todayFull?.lineup as { actions?: Array<{ leagueId: string; lockTime?: string | null }> } | undefined)?.actions) ?? []
    const actions = dashLeagueFilter === 'all' ? rawActions : scopeBySelectedLeague(rawActions, dashLeagueFilter)
    const upcoming = actions
      .map((a) => (a.lockTime ? new Date(a.lockTime).getTime() : NaN))
      .filter((t) => Number.isFinite(t) && t > Date.now())
    const soonestLock = upcoming.length ? new Date(Math.min(...upcoming)).toISOString() : null
    const wt = (todayFull?.waiverTiming ?? null) as { nextWaiverProcessIsoUtc?: string | null; waiverTimingHint?: string | null } | null
    return {
      lockIn: relativeUntil(soonestLock),
      waiverIn: relativeUntil(wt?.nextWaiverProcessIsoUtc),
      waiverHint: wt?.waiverTimingHint ?? null,
    }
  }, [todayFull, dashLeagueFilter])

  // ── Top outstanding issues ───────────────────────────────────────────────────
  // Built ONLY from rows that already exist in the today-actions bundle: each lineup
  // action carries its own message/severity/urgency, and pending trades carry a league.
  // Nothing is synthesised — if the payload has no rows, the section reports empty.
  const outstandingIssues = useMemo(() => {
    const nameOf = (id: string) => leagues.find((l) => l.id === id)?.name ?? 'League'
    const inScope = (id: string) => dashLeagueFilter === 'all' || id === dashLeagueFilter
    const sevRank: Record<string, number> = { critical: 0, warning: 1, info: 2 }
    const urgRank: Record<string, number> = { urgent: 0, soon: 1, normal: 2, low: 3 }

    const rows: Array<{ key: string; label: string; league: string; severity: string; sev: number; urg: number; count: number }> = []

    // Lineup actions are per-slot, so one underlying problem ("Missing N starter slots")
    // arrives as N identical messages. Collapse identical (league, message) pairs into a
    // single row with a count — otherwise a Top 10 list is just the same line ten times.
    const actions = ((todayFull?.lineup as { actions?: Array<Record<string, unknown>> } | undefined)?.actions) ?? []
    const grouped = new Map<string, { label: string; league: string; severity: string; sev: number; urg: number; count: number }>()
    for (const a of actions) {
      const leagueId = str(a.leagueId)
      if (!leagueId || !inScope(leagueId)) continue
      const message = str(a.message)
      if (!message) continue
      const severity = str(a.severity) ?? 'info'
      const sev = sevRank[severity] ?? 2
      const urg = urgRank[str(a.urgency) ?? 'normal'] ?? 2
      const key = `lineup:${leagueId}:${message}`
      const hit = grouped.get(key)
      if (hit) {
        hit.count += 1
        // Keep the most severe / most urgent variant of a collapsed group.
        hit.sev = Math.min(hit.sev, sev)
        hit.urg = Math.min(hit.urg, urg)
        if (sev < (sevRank[hit.severity] ?? 2)) hit.severity = severity
      } else {
        grouped.set(key, { label: message, league: nameOf(leagueId), severity, sev, urg, count: 1 })
      }
    }
    for (const [key, v] of grouped) rows.push({ key, ...v })

    const tradeLeagues = ((todayFull?.trades as { trades?: Array<Record<string, unknown>> } | undefined)?.trades) ?? []
    for (const tl of tradeLeagues) {
      const leagueId = str(tl.leagueId)
      if (!leagueId || !inScope(leagueId)) continue
      const count = Array.isArray(tl.trades) ? tl.trades.length : 0
      if (count === 0) continue
      rows.push({
        key: `trade:${leagueId}`,
        label: `${count} trade offer${count > 1 ? 's' : ''} waiting on your response`,
        league: str(tl.leagueName) ?? nameOf(leagueId),
        severity: 'warning',
        sev: 1,
        urg: 0,
        count: 1,
      })
    }

    return rows.sort((a, b) => a.sev - b.sev || a.urg - b.urg).slice(0, 10)
  }, [todayFull, leagues, dashLeagueFilter])

  // ── Current vs Historical ────────────────────────────────────────────────────
  // An imported account can carry hundreds of past-season snapshots (547 here). Only
  // leagues whose season is the live one belong in the main list; everything older is
  // history and collapses behind a disclosure. Client-only route (ssr:false), so
  // reading the clock during render can't cause a hydration mismatch.
  const currentSeasonYear = useMemo(() => new Date().getFullYear(), [])
  const currentLeagues = useMemo(
    () => filteredLeagues.filter((l) => isCurrentSeasonLeague(l, currentSeasonYear)),
    [filteredLeagues, currentSeasonYear],
  )
  const historicalLeagues = useMemo(
    () => filteredLeagues.filter((l) => !isCurrentSeasonLeague(l, currentSeasonYear)),
    [filteredLeagues, currentSeasonYear],
  )

  const dashFilterLeagueName = dashLeagueFilter === 'all' ? null : leagues.find((l) => l.id === dashLeagueFilter)?.name ?? null
  const commissionedCount = scopedLeagues.filter((l) => l.isCommissioner).length

  // Time-of-day greeting, matching the design. Uses the existing warroom greeting keys so
  // the language switcher keeps working (EN + ES already translated) instead of hardcoding
  // English. Client-only route (ssr:false), so reading the clock can't desync hydration.
  const heroTitle = useMemo(() => {
    const firstName = userName.split(' ')[0] || userName
    const hour = new Date().getHours()
    const slot = hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening'
    return lang.tInterpolate(`dashboard.warroom.hero.greeting.${slot}`, { name: firstName })
  }, [userName, lang])
  const heroSubtitle = context === 'global'
    ? 'Everything across your leagues, in one place.'
    : context === 'commissioner' ? 'Health and analytics for the leagues you run.' : 'Your matchup, league by league.'

  const modeIcon = theme?.mode === 'dark' ? Moon : theme?.mode === 'light' ? Sun : Monitor
  const ModeIcon = modeIcon

  return (
    <div className="nocturne-dash" style={{ minHeight: '100vh' }}>
      {/* ═══ TOP BAR ═══ */}
      <div style={{ borderBottom: '1px solid color-mix(in srgb, var(--color-text) 7%, transparent)', background: 'var(--color-surface)', position: 'sticky', top: 0, zIndex: 5 }}>
        <div style={{ maxWidth: 1400, margin: '0 auto', padding: '12px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
            <Image src="/brand/allfantasy-wordmark-transparent.png" alt="AllFantasy" width={1198} height={306} priority style={{ height: 24, width: 'auto' }} />
            <div style={{ display: 'flex', gap: 3, background: 'color-mix(in srgb, var(--color-bg) 55%, transparent)', border: '1px solid var(--color-neutral-800)', borderRadius: 'var(--radius-md)', padding: 3 }}>
              {([['global', 'Global', LayoutGrid], ['commissioner', 'Commissioner', ShieldCheck], ['team', 'Team', User]] as const).map(([id, label, Icon]) => (
                <button key={id} type="button" className={`aftab${context === id ? ' is-active' : ''}`} onClick={() => setContext(id)}>
                  <Icon size={15} />{label}
                </button>
              ))}
            </div>
            {leagues.length > 0 && (
              <select className="input" value={dashLeagueFilter} onChange={(e) => setDashLeagueFilter(e.target.value)} style={{ width: 'auto', minHeight: 34, padding: '0 8px', fontSize: 12.5 }}>
                <option value="all">All leagues</option>
                {leagues.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
            {/* Preview-as override — DEV ONLY (never renders in production) */}
            {PREVIEW_TIER_TOGGLE && (
            <div className="seg" title="Preview tier (design review)">
              {(['visitor', 'free', 'premium'] as const).map((t, i) => (
                <button key={t} type="button" onClick={() => setTierOverride(t === realTier ? null : t)}
                  style={{ border: 'none', borderLeft: i ? '1px solid var(--color-divider)' : 'none', padding: '7px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer', textTransform: 'capitalize', background: tier === t ? 'var(--color-accent)' : 'none', color: tier === t ? '#fff' : 'var(--color-neutral-500)' }}>
                  {t}
                </button>
              ))}
            </div>
            )}
            {lang && (
              <select className="input" value={lang.language} onChange={(e) => lang.setLanguage(e.target.value as never)} style={{ width: 'auto', minHeight: 30, padding: '0 8px', fontSize: 12 }} aria-label="Language">
                <option value="en">English</option>
                <option value="es">Español</option>
              </select>
            )}
            {theme && (
              <button type="button" onClick={() => theme.cycleMode()} title={`Theme: ${theme.mode}`} aria-label="Toggle theme" style={{ background: 'none', border: '1px solid var(--color-neutral-800)', borderRadius: 'var(--radius-md)', width: 30, height: 30, display: 'grid', placeItems: 'center', color: 'var(--color-neutral-400)', cursor: 'pointer' }}>
                <ModeIcon size={15} />
              </button>
            )}
            <a href="/support" style={{ fontSize: 12.5, color: 'var(--color-neutral-500)', display: 'flex', alignItems: 'center', gap: 5 }}><LifeBuoy size={15} />Contact support</a>
            {isVisitor ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Link href={`/login?callbackUrl=${encodeURIComponent(selfHref)}`} className="btn btn-secondary" style={{ fontSize: 12.5 }}>Sign in</Link>
                <Link href={`/signup?next=${encodeURIComponent(selfHref)}`} className="btn btn-primary" style={{ fontSize: 12.5 }}>Sign up free</Link>
              </div>
            ) : (
              <>
                <StartSitLauncher userId={userId} variant="compact" />
                <button type="button" onClick={() => setImportOpen(true)} className="btn btn-secondary" style={{ fontSize: 12.5 }}><Plus size={14} />Import league</button>
                <button type="button" onClick={() => setSettingsOpen((s) => !s)} style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px', borderRadius: 6 }}>
                  <Avatar name={userName} image={userImage} size={28} />
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)' }}>{userName.split(' ')[0]}</span>
                  <ChevronDown size={12} style={{ color: 'var(--color-neutral-500)' }} />
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 1400, margin: '0 auto', padding: '24px 20px 64px', display: 'flex', flexDirection: 'column', gap: 24 }}>
        {/* ═══ CTA BANNERS ═══ (suppressed until entitlements resolve, so paid users don't flash the free banner) */}
        {!access.loading && isVisitor && (
          <Banner icon={<Sparkles size={22} style={{ color: 'var(--color-accent-400)' }} />} accent
            title="You're browsing as a visitor"
            body="Create a free account to save your leagues, track rankings, and unlock more.">
            <Link href={`/login?callbackUrl=${encodeURIComponent(selfHref)}`} className="btn btn-secondary">Sign in</Link>
            <Link href={`/signup?next=${encodeURIComponent(selfHref)}`} className="btn btn-primary">Sign up for free</Link>
          </Banner>
        )}
        {!access.loading && isFree && (
          <Banner icon={<Rocket size={22} style={{ color: 'var(--color-accent-400)' }} />}
            title="You're on the free plan"
            body="Upgrade to unlock live scores, projected edge, and the full analytics suite — or unlock features à la carte with tokens.">
            <Link href={TOKENS_HREF} className="btn btn-secondary">Buy tokens</Link>
            <Link href={UPGRADE_HREF} className="btn btn-primary">Upgrade</Link>
          </Banner>
        )}
        {/* Activation: email verification */}
        {!emailVerified && (
          <Banner icon={<AlertCircle size={22} style={{ color: 'var(--color-accent-400)' }} />}
            title="Verify your email"
            body="Confirm your email to unlock leagues, brackets, and chat.">
            <Link href="/verify" className="btn btn-primary">Verify now →</Link>
          </Banner>
        )}
        {/* Compliance: paid-restricted geo */}
        {!geo.loading && geo.isPaidBlocked && geo.stateCode && (
          <Banner icon={<AlertCircle size={22} style={{ color: 'var(--color-accent-400)' }} />}
            title={`Paid features aren't available in ${geo.stateName ?? geo.stateCode}`}
            body="You can still use the free features — paid leagues and subscriptions are restricted in your state.">
            <Link href={`/paid-restricted?state=${geo.stateCode}`} className="btn btn-secondary">Learn more</Link>
          </Banner>
        )}

        {/* ═══ HERO ═══ */}
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 600, letterSpacing: '-0.01em', margin: '0 0 6px' }}>{heroTitle}</h1>
          <p style={{ fontSize: 14, color: 'var(--color-neutral-500)', margin: '0 0 16px' }}>{heroSubtitle}</p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <StatChip icon={<AlertCircle size={18} style={{ color: 'var(--color-accent-400)' }} />} value={String(urgentCount)} label="Need attention" />
            <StatChip icon={<LayoutGrid size={18} style={{ color: 'var(--color-accent-400)' }} />} value={String(scopedLeagues.length)} label="Leagues" />
            <Link href="/af-rankings" className="afcard" style={{ padding: '12px 18px', flexDirection: 'row', display: 'flex', alignItems: 'center', gap: 10, color: 'inherit' }}>
              <Trophy size={18} style={{ color: 'var(--color-accent-400)' }} />
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.2 }}>{rank.level && rank.levelName ? `Lv.${rank.level} · ${rank.levelName}` : 'Unranked'}</div>
                <div style={{ fontSize: 11, color: 'var(--color-neutral-600)' }}>AF Rank →</div>
              </div>
            </Link>
          </div>
          {/* Quick actions (reference NavChips): War Room / Commissioner Hub / Ask Chimmy / Communications */}
          {!isVisitor && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
              <Link href="/war-room" className="btn btn-secondary" style={{ fontSize: 12.5 }}><Swords size={14} />War Room</Link>
              <Link href="/commissioner-hub" className="btn btn-secondary" style={{ fontSize: 12.5 }}><ShieldCheck size={14} />Commissioner Hub</Link>
              <button type="button" onClick={() => { setCommsTab('chimmy'); setCommsOpen(true) }} className="btn btn-secondary" style={{ fontSize: 12.5 }}><Sparkles size={14} />Ask Chimmy</button>
              <button type="button" onClick={() => { setCommsTab('league'); setCommsOpen(true) }} className="btn btn-secondary" style={{ fontSize: 12.5 }}><MessageCircle size={14} />Communications</button>
            </div>
          )}
        </div>

        {/* ═══ PLAYER SEARCH (global) ═══ */}
        {context === 'global' && !isVisitor && (
          <div style={{ position: 'relative' }}>
            <div className="dash-kicker" style={{ marginBottom: 12 }}>Player search</div>
            <div style={{ position: 'relative', maxWidth: 360 }}>
              <Search size={15} style={{ position: 'absolute', left: 12, top: 12, color: 'var(--color-neutral-600)' }} />
              <input className="input" style={{ width: '100%', minHeight: 40, padding: '0 14px 0 34px', fontSize: 13 }} value={playerQuery} onChange={(e) => setPlayerQuery(e.target.value)} placeholder="Search a player across all your leagues..." />
            </div>
            {playerResults.length > 0 && (
              <div className="afcard" style={{ maxWidth: 520, marginTop: 8, padding: 6, position: 'relative', zIndex: 2 }}>
                {playerResults.map((pl) => (
                  <button key={pl.playerId} type="button" onClick={() => setActivePlayer(pl)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px', borderRadius: 'var(--radius-md)', cursor: 'pointer', background: 'none', border: 'none', textAlign: 'left' }}>
                    <div style={{ width: 34, height: 34, borderRadius: '50%', background: 'var(--color-accent-900)', display: 'grid', placeItems: 'center', font: '700 11px ui-monospace,Menlo,monospace', color: 'var(--color-accent-400)', flex: 'none' }}>{pl.position ?? '—'}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 13.5 }}>{pl.name ?? 'Unknown player'}</div>
                      <div style={{ fontSize: 11, color: 'var(--color-neutral-600)' }}>{pl.team ?? '—'} · in {pl.leagueCount} of your leagues</div>
                    </div>
                    <ChevronRight size={14} style={{ color: 'var(--color-neutral-600)' }} />
                  </button>
                ))}
              </div>
            )}
            {playerQuery.trim().length >= 2 && playerResults.length === 0 && (
              <p style={{ fontSize: 12, color: 'var(--color-neutral-600)', marginTop: 8 }}>No matching player found on your rosters.</p>
            )}
          </div>
        )}

        {/* ═══ SEASON TIMELINE ═══ */}
        {context === 'global' && seasonPhase && timelineLeague && (
          <div>
            <div className="dash-kicker" style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
              Season timeline
              <span title={`Phase for ${timelineLeague.name}${seasonPhase.week ? ` · week ${seasonPhase.week}` : ''}`} style={{ display: 'inline-flex' }}>
                <Info size={13} style={{ color: 'var(--color-neutral-600)' }} />
              </span>
            </div>
            <SeasonTimeline phaseIndex={seasonPhase.index} week={seasonPhase.week} />
          </div>
        )}

        {/* ═══ TODAY'S PRIORITIES ═══ */}
        {context === 'global' && (
          <div>
            <div className="dash-kicker" style={{ marginBottom: 12 }}>Today's priorities</div>
            {today === 'unavailable' ? (
              <div className="afcard" style={{ fontSize: 13, color: 'var(--color-neutral-400)', display: 'flex', alignItems: 'center', gap: 8 }}>
                <AlertCircle size={16} style={{ color: 'var(--color-accent-400)', flex: 'none' }} />
                Priorities are temporarily unavailable — refresh in a moment.
              </div>
            ) : todayData && (todayData.lineups + todayData.waivers + todayData.trades) > 0 ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 10 }}>
                {todayData.lineups > 0 && <Priority icon={<ListChecks size={17} style={{ color: 'var(--color-accent-400)' }} />} title={`${todayData.lineups} lineup${todayData.lineups > 1 ? 's' : ''} to set`} sub={priorityTiming.lockIn ? `Locks in ${priorityTiming.lockIn}` : 'Across your leagues'} onClick={() => setOpenModal('lineup')} />}
                {todayData.waivers > 0 && <Priority icon={<ArrowLeftRight size={17} style={{ color: 'var(--color-accent-400)' }} />} title={`${todayData.waivers} waiver target${todayData.waivers > 1 ? 's' : ''}`} sub={priorityTiming.waiverHint ?? (priorityTiming.waiverIn ? `Runs in ${priorityTiming.waiverIn}` : 'Runs coming up')} onClick={() => setOpenModal('waiver')} />}
                {todayData.trades > 0 && <Priority icon={<Handshake size={17} style={{ color: 'var(--color-accent-400)' }} />} title={`${todayData.trades} trade${todayData.trades > 1 ? 's' : ''} pending`} sub="Waiting on you" onClick={() => setOpenModal('trade')} />}
              </div>
            ) : (
              <div className="afcard" style={{ fontSize: 13, color: 'var(--color-neutral-400)' }}>
                {leagues.length === 0 ? 'Import a league to see your priorities here.' : today === null ? 'Loading your priorities…' : "You're all set — nothing needs attention right now."}
              </div>
            )}
          </div>
        )}

        {/* ═══ TOP OUTSTANDING ISSUES ═══ */}
        {context === 'global' && outstandingIssues.length > 0 && (
          <div>
            <div className="dash-kicker" style={{ marginBottom: 12 }}>
              Top {outstandingIssues.length} outstanding issue{outstandingIssues.length > 1 ? 's' : ''} — {dashFilterLeagueName ?? 'all leagues'}
            </div>
            <div className="afcard" style={{ padding: 6 }}>
              {outstandingIssues.map((iss) => (
                <div key={iss.key} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px', borderRadius: 'var(--radius-md)' }}>
                  <span
                    aria-hidden
                    style={{
                      width: 8, height: 8, borderRadius: '50%', flex: 'none',
                      background: iss.severity === 'critical' ? '#e5675f' : iss.severity === 'warning' ? '#d8a657' : 'var(--color-accent-500)',
                    }}
                  />
                  <span style={{ fontSize: 13, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{iss.label}</span>
                  {iss.count > 1 && <span className="tag tag-neutral" style={{ flex: 'none' }}>×{iss.count}</span>}
                  <span style={{ fontSize: 11.5, color: 'var(--color-neutral-600)', flex: 'none', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{iss.league}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {dashFilterLeagueName && (
          <div className="afcard" style={{ display: 'flex', alignItems: 'center', gap: 10, borderColor: 'var(--color-accent-700)' }}>
            <Filter size={18} style={{ color: 'var(--color-accent-400)' }} />
            <span style={{ fontSize: 13 }}>Showing this dashboard scoped to <strong>{dashFilterLeagueName}</strong> only.</span>
          </div>
        )}

        {/* ═══ CONTEXT: GLOBAL — MY LEAGUES ═══ */}
        {context === 'global' && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
              <span className="dash-kicker">My leagues ({filteredLeagues.length})</span>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <input className="input" style={{ minHeight: 32, padding: '0 10px', fontSize: 12.5, width: 160 }} value={leagueSearch} onChange={(e) => setLeagueSearch(e.target.value)} placeholder="Search leagues..." />
                <select className="input" value={platformFilter} onChange={(e) => setPlatformFilter(e.target.value)} style={{ width: 'auto', minHeight: 32, padding: '0 8px', fontSize: 12.5 }}>
                  <option value="all">All platforms</option>
                  {platformOptions.map((p) => <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
                </select>
                <div style={{ display: 'flex', gap: 2, background: 'color-mix(in srgb, var(--color-bg) 55%, transparent)', border: '1px solid var(--color-neutral-800)', borderRadius: 'var(--radius-md)', padding: 2 }}>
                  <button type="button" onClick={() => setView('cards')} aria-label="Cards view" style={{ border: 'none', padding: '5px 8px', borderRadius: 5, cursor: 'pointer', background: view === 'cards' ? 'var(--color-accent)' : 'none', color: view === 'cards' ? '#fff' : 'var(--color-neutral-500)' }}><LayoutGrid size={14} /></button>
                  <button type="button" onClick={() => setView('list')} aria-label="List view" style={{ border: 'none', padding: '5px 8px', borderRadius: 5, cursor: 'pointer', background: view === 'list' ? 'var(--color-accent)' : 'none', color: view === 'list' ? '#fff' : 'var(--color-neutral-500)' }}><ListIcon size={14} /></button>
                </div>
              </div>
            </div>
            {filteredLeagues.length === 0 ? (
              <div className="afcard" style={{ fontSize: 13, color: 'var(--color-neutral-500)' }}>
                {leagues.length === 0 ? 'No leagues yet — import one to get started.' : 'No leagues match your filters.'}
              </div>
            ) : (
              <>
                {/* Current season — the leagues you're actually playing this year. */}
                {currentLeagues.length > 0 ? (
                  <LeagueCollection leagues={currentLeagues} view={view} onOpen={setLeagueModal} />
                ) : (
                  <div className="afcard" style={{ fontSize: 13, color: 'var(--color-neutral-500)' }}>
                    No {currentSeasonYear} leagues yet — once a league is renewed for {currentSeasonYear} it shows here. Past seasons are under Historical below.
                  </div>
                )}

                {/* Historical — past-season snapshots, collapsed by default. */}
                {historicalLeagues.length > 0 && (
                  <div style={{ marginTop: 14 }}>
                    <button
                      type="button"
                      onClick={() => setShowHistorical((s) => !s)}
                      aria-expanded={showHistorical}
                      className="afcard"
                      style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', textAlign: 'left', color: 'inherit', padding: '12px 16px' }}
                    >
                      <ChevronRight size={16} style={{ color: 'var(--color-neutral-500)', transition: 'transform .15s', transform: showHistorical ? 'rotate(90deg)' : 'none', flex: 'none' }} />
                      <History size={16} style={{ color: 'var(--color-neutral-500)', flex: 'none' }} />
                      <span style={{ fontWeight: 600, fontSize: 13.5, flex: 1 }}>
                        Historical leagues ({historicalLeagues.length})
                      </span>
                      <span style={{ fontSize: 11.5, color: 'var(--color-neutral-600)' }}>
                        {showHistorical ? 'Hide' : 'Show'} past seasons
                      </span>
                    </button>
                    {showHistorical && (
                      <div style={{ marginTop: 12 }}>
                        <LeagueCollection leagues={historicalLeagues} view={view} onOpen={setLeagueModal} />
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
            {commissionedCount > 0 && (
              <div className="afcard" style={{ marginTop: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', borderColor: 'var(--color-accent-800)', background: 'linear-gradient(180deg,color-mix(in srgb, var(--color-accent-800) 20%, transparent),var(--color-surface))' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <ShieldCheck size={22} style={{ color: 'var(--color-accent-400)' }} />
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>You commission {commissionedCount} league{commissionedCount > 1 ? 's' : ''}</div>
                    <div style={{ fontSize: 12.5, color: 'var(--color-neutral-500)' }}>Open Commissioner HQ for health, analytics, and recommendations.</div>
                  </div>
                </div>
                <button type="button" onClick={() => setContext('commissioner')} className="btn btn-primary">Open Commissioner HQ</button>
              </div>
            )}
          </div>
        )}

        {/* ═══ CONTEXT: COMMISSIONER HQ (live commissioner-health engine) ═══ */}
        {context === 'commissioner' && (
          activeCommSnapshot ? (
            <CommissionerHQ
              snapshots={commHealth}
              active={activeCommSnapshot}
              onSelect={setCommLeagueId}
              platformLabel={commPlatformLabel(activeCommSnapshot, leagues)}
              showLock={showLock}
              checked={checkedActions}
              onToggle={(k) => setCheckedActions((s) => ({ ...s, [k]: !s[k] }))}
              tokensHref={TOKENS_HREF}
              upgradeHref={UPGRADE_HREF}
            />
          ) : (
            <div className="afcard" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 10, padding: '40px 24px' }}>
              <ShieldCheck size={30} style={{ color: 'var(--color-accent-400)' }} />
              <div style={{ fontWeight: 600, fontSize: 16 }}>No commissioned leagues yet</div>
              <p style={{ fontSize: 13, color: 'var(--color-neutral-500)', maxWidth: '44ch' }}>Commissioner HQ shows health, analytics, and recommendations for leagues you run. Import or create a league you commission to see it here.</p>
            </div>
          )
        )}

        {/* ═══ CONTEXT: TEAM — live game-day view (reuses the warroom Team components) ═══ */}
        {context === 'team' && (
          activeTeamLeague ? (
            <div>
              <div className="dash-kicker" style={{ marginBottom: 12 }}>Choose a league</div>
              {teamLeagues.length > 1 && (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
                  {teamLeagues.map((l) => {
                    const sel = l.id === activeTeamLeague.id
                    return (
                      <button key={l.id} type="button" onClick={() => setTeamLeagueId(l.id)}
                        style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', borderRadius: 999, border: `1px solid ${sel ? 'var(--color-accent)' : 'var(--color-neutral-800)'}`, background: sel ? 'color-mix(in srgb, var(--color-accent) 14%, transparent)' : 'none', color: 'var(--color-text)', cursor: 'pointer', fontSize: 13.5, fontWeight: 500 }}>
                        {l.name} <span style={{ color: 'var(--color-neutral-500)', fontWeight: 400, textTransform: 'capitalize' }}>· {l.platform}</span>
                      </button>
                    )
                  })}
                </div>
              )}
              {activeTeamLeague.hasUnifiedRecord ? (
                <>
                  <div style={{ marginBottom: 16 }}>
                    <SeasonJourney lifecycleState={activeTeamLeague.lifecycleState ?? null} currentWeek={activeTeamLeague.currentWeek ?? null} tradeDeadlineWeek={activeTeamLeague.tradeDeadlineWeek ?? null} playoffStartWeek={activeTeamLeague.playoffStartWeek ?? null} />
                  </div>
                  <TeamThisWeek league={activeTeamLeague} userId={userId} />
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 12, marginTop: 12 }}>
                    <SeasonOutlook league={activeTeamLeague} userId={userId} />
                    <InjuryImpactPanel league={activeTeamLeague} />
                  </div>
                  <div style={{ marginTop: 12 }}>
                    <WaiverWirePreview data={(todayFull?.waivers as WaiverDashboardResponse) ?? null} onOpenAll={() => setContext('global')} />
                  </div>
                </>
              ) : (
                <div className="afcard" style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                  <Info size={18} style={{ color: 'var(--color-accent-400)', flex: 'none', marginTop: 1 }} />
                  <div style={{ fontSize: 13, color: 'var(--color-neutral-400)' }}>
                    <strong style={{ color: 'var(--color-text)' }}>{activeTeamLeague.name}</strong> is an imported (view-only) league, so the live matchup, season outlook, and injury view aren't available for it. It still counts toward your AF Rank &amp; legacy. Sync or create a native league to get the full game-day view.
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="afcard" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 10, padding: '40px 24px' }}>
              <User size={30} style={{ color: 'var(--color-accent-400)' }} />
              <div style={{ fontWeight: 600, fontSize: 16 }}>No team leagues to show yet</div>
              <p style={{ fontSize: 13, color: 'var(--color-neutral-500)', maxWidth: '46ch' }}>Import a league (Sleeper, ESPN, Yahoo, MFL or Fantrax) to see your matchup, season outlook, injuries, and waiver targets here.</p>
              <button type="button" onClick={() => setImportOpen(true)} className="btn btn-primary" style={{ fontSize: 12.5 }}>Import a league</button>
            </div>
          )
        )}

        {/* ═══ RANKINGS & LEGACY (global) ═══ */}
        {context === 'global' && !isVisitor && (
          <div>
            <div className="dash-kicker" style={{ marginBottom: 12 }}>Rankings &amp; legacy</div>
            {rank.imported ? (
              <div className="afcard" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: 24, alignItems: 'center' }}>
                <div>
                  {rank.tier && <div style={{ fontSize: 12, color: 'var(--color-accent-400)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4 }}>{rank.tier} Tier</div>}
                  <div style={{ fontSize: 26, fontWeight: 700, marginBottom: 2 }}>Level {rank.level ?? '—'} · {rank.levelName ?? 'Manager'}</div>
                  {rank.xpInto != null && rank.xpFor != null && (
                    <div style={{ fontSize: 12.5, color: 'var(--color-neutral-500)', marginBottom: 10 }}>{rank.xpInto.toLocaleString()} / {rank.xpFor.toLocaleString()} XP{rank.nextLevelName ? ` to ${rank.nextLevelName}` : ''}</div>
                  )}
                  <div style={{ height: 6, borderRadius: 3, background: 'var(--color-neutral-800)', overflow: 'hidden', maxWidth: 340 }}>
                    <div style={{ height: '100%', width: `${Math.max(0, Math.min(100, rank.progressPct ?? 0))}%`, background: 'var(--color-accent)' }} />
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, marginTop: 16, maxWidth: 440 }}>
                    <Career value={rank.wins != null && rank.losses != null ? `${rank.wins}-${rank.losses}` : '—'} label="Record" />
                    <Career value={rank.titles} label="Titles" />
                    <Career value={rank.playoffs} label="Playoffs" />
                    <Career value={rank.seasons} label="Seasons" />
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
                  <div className="afring" style={{ width: 92, height: 92, background: `conic-gradient(var(--color-accent) ${gradePct(rank.grade)}%, var(--color-neutral-800) ${gradePct(rank.grade)}% 100%)` }}>
                    <div className="afringval"><span style={{ fontSize: 24, fontWeight: 700 }}>{rank.grade ?? '—'}</span><span style={{ fontSize: 9, color: 'var(--color-neutral-600)', textTransform: 'uppercase', letterSpacing: '.04em' }}>Chimmy Grade</span></div>
                  </div>
                  {/* Don't put premium insight text in the DOM for locked tiers (SF1) —
                      render a lock placeholder instead of blur-over-real-text. */}
                  {showLock ? (
                    <div style={{ maxWidth: 170, textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, fontSize: 10.5, color: 'var(--color-neutral-500)' }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Lock size={12} style={{ color: 'var(--color-accent-400)' }} />Projected edge & insight</span>
                      <Link href={TOKENS_HREF} style={{ fontSize: 10, color: 'var(--color-accent-400)' }}>Unlock with tokens</Link>
                    </div>
                  ) : rank.insight ? (
                    <p style={{ fontSize: 11.5, color: 'var(--color-neutral-500)', textAlign: 'center', margin: 0, maxWidth: 170 }}>{rank.insight}</p>
                  ) : null}
                </div>
              </div>
            ) : (
              <div className="afcard" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 10, padding: '28px 20px' }}>
                <Trophy size={26} style={{ color: 'var(--color-accent-400)' }} />
                <div style={{ fontSize: 14, fontWeight: 600 }}>Import a league to build your AF Rank</div>
                <button type="button" onClick={() => setImportOpen(true)} className="btn btn-primary">Import a league</button>
              </div>
            )}
          </div>
        )}

        {/* ═══ TOOLS ═══ */}
        {context === 'global' && !isVisitor && (
          <div>
            <div className="dash-kicker" style={{ marginBottom: 12 }}>Tools</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 12 }}>
              {TOOLS.map((tool) => {
                const locked = tool.premiumOnly && !isPremium
                const Inner = (
                  <>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <tool.Icon size={20} style={{ color: 'var(--color-accent-400)' }} />
                    </div>
                    <div style={{ fontWeight: 600, fontSize: 14, margin: '10px 0 4px' }}>{tool.label}</div>
                    <div style={{ fontSize: 12.5, color: 'var(--color-neutral-600)' }}>{tool.desc}</div>
                  </>
                )
                if (locked) {
                  return (
                    <div key={tool.key} className="afcard" style={{ position: 'relative', overflow: 'hidden' }}>
                      <div style={{ filter: 'blur(3px)' }}>{Inner}</div>
                      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, background: 'color-mix(in srgb, var(--color-surface) 80%, transparent)' }}>
                        <Lock size={15} style={{ color: 'var(--color-accent-400)' }} />
                        <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--color-neutral-200)' }}>Premium</span>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <Link href={TOKENS_HREF} className="btn btn-secondary" style={{ padding: '5px 10px', fontSize: 10.5 }}>Buy tokens</Link>
                          <Link href={UPGRADE_HREF} className="btn btn-primary" style={{ padding: '5px 10px', fontSize: 10.5 }}>Upgrade</Link>
                        </div>
                      </div>
                    </div>
                  )
                }
                return <Link key={tool.key} href={tool.href} className="afcard" style={{ cursor: 'pointer', display: 'block', color: 'inherit' }}>{Inner}</Link>
              })}
            </div>
          </div>
        )}
      </div>

      {/* ═══ SETTINGS POPUP ═══ */}
      {settingsOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 35, display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-end', padding: '70px 20px 20px' }} onClick={() => setSettingsOpen(false)}>
          <div className="afcard" style={{ width: 300 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
              <Avatar name={userName} image={userImage} size={44} />
              <div><div style={{ fontWeight: 600, fontSize: 14 }}>{userName}</div><div style={{ fontSize: 11.5, color: 'var(--color-neutral-600)' }}>{planChip} plan</div></div>
            </div>
            <div style={{ height: 1, background: 'var(--color-neutral-800)', marginBottom: 14 }} />
            <Row label="Subscription" value={planChip} />
            <Row label="Tokens remaining" value={tokenBalance != null ? tokenBalance.toLocaleString() : '—'} accent />
            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <Link href="/settings?tab=billing" className="btn btn-primary" style={{ flex: 1, fontSize: 12 }}>Manage plan</Link>
              <Link href={TOKENS_HREF} className="btn btn-secondary" style={{ flex: 1, fontSize: 12 }}>Buy tokens</Link>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 12 }}>
              <Link href="/profile" style={{ fontSize: 12.5, color: 'var(--color-neutral-400)', padding: '6px 0' }}>Profile</Link>
              <Link href="/settings" style={{ fontSize: 12.5, color: 'var(--color-neutral-400)', padding: '6px 0' }}>Settings</Link>
            </div>
          </div>
        </div>
      )}

      {/* ═══ IMPORT POPUP ═══ */}
      {importOpen && (
        <div className="nocturne-dash-modal" onClick={() => setImportOpen(false)}>
          <div className="afcard" style={{ width: '100%', maxWidth: 420, position: 'relative' }} onClick={(e) => e.stopPropagation()}>
            <button type="button" onClick={() => setImportOpen(false)} aria-label="Close" style={{ position: 'absolute', top: 12, right: 12, background: 'none', border: 'none', color: 'var(--color-neutral-500)', cursor: 'pointer' }}><X size={16} /></button>
            <h2 style={{ fontSize: 16, margin: '0 0 4px' }}>Import a league</h2>
            <p style={{ fontSize: 12.5, color: 'var(--color-neutral-500)', margin: '0 0 14px' }}>Add another league right from your dashboard.</p>
            <p style={{ fontSize: 12.5, color: 'var(--color-neutral-400)', margin: '0 0 14px' }}>
              Sleeper imports instantly by username; ESPN, Yahoo, MFL and Fantrax take one quick connect step.
            </p>
            <Link href={`/import?returnTo=${encodeURIComponent(selfHref)}`} className="btn btn-primary btn-block" style={{ width: '100%' }}>Go to import →</Link>
            <Link href="/create-league" className="btn btn-secondary btn-block" style={{ width: '100%', marginTop: 8 }}>Or create a league from scratch</Link>
          </div>
        </div>
      )}

      {/* ═══ PLAYER MODAL ═══ */}
      {activePlayer && (
        <div className="nocturne-dash-modal" onClick={() => setActivePlayer(null)}>
          <div className="afcard" style={{ width: '100%', maxWidth: 460, position: 'relative' }} onClick={(e) => e.stopPropagation()}>
            <button type="button" onClick={() => setActivePlayer(null)} aria-label="Close" style={{ position: 'absolute', top: 12, right: 12, background: 'none', border: 'none', color: 'var(--color-neutral-500)', cursor: 'pointer' }}><X size={16} /></button>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'var(--color-accent-900)', display: 'grid', placeItems: 'center', font: '700 12px ui-monospace,Menlo,monospace', color: 'var(--color-accent-400)' }}>{activePlayer.position ?? '—'}</div>
              <div><div style={{ fontWeight: 600, fontSize: 16 }}>{activePlayer.name ?? 'Unknown player'}</div><div style={{ fontSize: 12, color: 'var(--color-neutral-600)' }}>{activePlayer.team ?? '—'}</div></div>
            </div>
            <div className="dash-kicker" style={{ marginBottom: 8 }}>Your exposure</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, textAlign: 'center' }}>
              <Career value={activePlayer.leagueCount} label="Leagues" />
              <Career value={activePlayer.startingCount} label="Starting" />
              <Career value={activePlayer.benchCount} label="Bench" />
            </div>
            <p style={{ fontSize: 11.5, color: 'var(--color-neutral-600)', margin: '14px 0 0', textAlign: 'center' }}>
              On {activePlayer.leagueCount} of your leagues ({Math.round(activePlayer.exposurePercent * 100)}% exposure).
            </p>
          </div>
        </div>
      )}

      {/* ── Chat bubble — the design's circular launcher, on Nocturne tokens. Replaces
             FloatingCommunications' own pill (hideLauncher), which was desktop-only
             (`hidden md:inline-flex`) and so vanished on narrow screens. ── */}
      {!isVisitor && !commsOpen && (
        <button
          type="button"
          onClick={() => { setCommsTab(null); setCommsOpen(true) }}
          data-testid="nocturne-chat-bubble"
          aria-label="Open communications"
          title="Chat"
          style={{
            position: 'fixed', bottom: 20, right: 20, zIndex: 40,
            width: 52, height: 52, borderRadius: '50%',
            display: 'grid', placeItems: 'center', cursor: 'pointer',
            background: 'var(--color-accent)', color: '#fff',
            border: '1px solid color-mix(in srgb, var(--color-accent-300) 40%, transparent)',
            boxShadow: '0 10px 30px -8px color-mix(in srgb, var(--color-accent) 70%, transparent)',
          }}
        >
          <MessageCircle size={22} />
        </button>
      )}

      {/* ── League detail popup — real fields off the league-list payload, nothing fabricated ── */}
      {leagueModal && (
        <div className="nocturne-dash-modal" onClick={() => setLeagueModal(null)}>
          <div className="afcard" style={{ width: '100%', maxWidth: 480, position: 'relative' }} onClick={(e) => e.stopPropagation()}>
            <button type="button" onClick={() => setLeagueModal(null)} aria-label="Close" style={{ position: 'absolute', top: 12, right: 12, background: 'none', border: 'none', color: 'var(--color-neutral-500)', cursor: 'pointer' }}><X size={16} /></button>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, paddingRight: 24 }}>
              <span className="afsrc" style={{ width: 44, height: 44, fontSize: 15, background: leagueModal.color }}>{leagueModal.initial}</span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 16 }}>{leagueModal.name}</div>
                <div style={{ fontSize: 12, color: 'var(--color-neutral-600)', textTransform: 'capitalize' }}>
                  {leagueModal.platform}{leagueModal.season ? ` · ${leagueModal.season} season` : ''}
                  {(leagueModal.season ?? 0) < currentSeasonYear ? ' · historical' : ''}
                </div>
              </div>
            </div>
            <div className="dash-kicker" style={{ marginBottom: 10 }}>League details</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 12 }}>
              <LeagueDetailRow label="Season" value={leagueModal.season ? String(leagueModal.season) : '—'} />
              <LeagueDetailRow label="Status" value={(leagueModal.status ?? '—').replace(/_/g, ' ')} />
              <LeagueDetailRow label="Sport" value={leagueModal.sport ?? '—'} />
              <LeagueDetailRow label="Teams" value={leagueModal.teamCount ? String(leagueModal.teamCount) : '—'} />
              <LeagueDetailRow label="Format" value={leagueModal.format ?? '—'} />
              <LeagueDetailRow label="Scoring" value={leagueModal.scoring ?? '—'} />
              <LeagueDetailRow label="Your role" value={leagueModal.isCommissioner ? 'Commissioner' : 'Manager'} />
            </div>
            <div style={{ marginTop: 18 }}>
              {leagueModal.unified ? (
                <Link href={`/league/${leagueModal.id}`} className="btn btn-primary btn-block" style={{ width: '100%' }}>Open league →</Link>
              ) : (
                <>
                  <p style={{ fontSize: 11.5, color: 'var(--color-neutral-600)', margin: '0 0 10px' }}>
                    This is an imported {leagueModal.season ?? 'past'}-season snapshot, so it has no live league page. Its history feeds your AF Rank and Legacy tools.
                  </p>
                  <Link href="/af-legacy" className="btn btn-secondary btn-block" style={{ width: '100%' }}>Open AF Legacy tools →</Link>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Communications hub — League / Chimmy / DMs (own floating launcher + hero NavChips) ── */}
      {!isVisitor && (
        <FloatingCommunications
          open={commsOpen}
          requestedTab={commsTab}
          hideLauncher
          onOpen={() => setCommsOpen(true)}
          onClose={() => { setCommsOpen(false); setCommsTab(null) }}
          userId={userId}
          userName={userName}
          userImage={userImage ?? null}
          leagues={userLeagues}
          activeLeagueId={teamLeagueId}
          discordConnected={discordConnected}
          commissionerLeagues={commissionerLeagues}
        />
      )}

      {/* ── Today's-priorities action modals — full payloads pulled off the today-actions bundle ── */}
      <LineupIssuesModal
        isOpen={openModal === 'lineup'}
        onClose={() => setOpenModal(null)}
        data={(todayFull?.lineup as LineupCheckPayload) ?? null}
        loading={today === null}
        hasProAccess={hasPro}
      />
      <WaiverRecommendationsModal
        isOpen={openModal === 'waiver'}
        onClose={() => setOpenModal(null)}
        data={(todayFull?.waivers as WaiverDashboardResponse) ?? null}
        loading={today === null}
        hasProAccess={hasPro}
      />
      <PendingTradesModal
        isOpen={openModal === 'trade'}
        onClose={() => setOpenModal(null)}
        data={(todayFull?.trades as TradesDashboardResponse) ?? null}
        loading={today === null}
        hasProAccess={hasPro}
      />
    </div>
  )
}

// ── Types ─────────────────────────────────────────────────────────────────────
type PlayerResult = {
  playerId: string; name: string | null; position: string | null; team: string | null
  leagueCount: number; startingCount: number; benchCount: number; irTaxiCount: number; exposurePercent: number
}
type TodayShape = { lineups: number; waivers: number; trades: number; urgent: number }
/** 'unavailable' = today-actions failed/degraded (503) — must NOT be shown as "all clear". */
type TodayState = TodayShape | 'unavailable' | null

// ── Parsers / helpers ─────────────────────────────────────────────────────────
function parseToday(data: unknown): TodayShape | null {
  if (!data || typeof data !== 'object') return null
  const d = data as Record<string, unknown>
  const counts = (d.counts ?? {}) as Record<string, unknown>
  // Real TodayActionsEngineResponse.counts keys (lib/today-actions-engine/types.ts).
  const lineups = num(counts.unresolvedLineupSlotActions) ?? 0
  const urgentLineups = num(counts.urgentLineupActions) ?? 0
  const waivers = num(counts.waiverPickupSuggestions) ?? 0
  const urgentWaivers = num(counts.waiverUrgentAdds) ?? 0
  const trades = num(counts.pendingTrades) ?? 0
  return { lineups, waivers, trades, urgent: urgentLineups + urgentWaivers + trades }
}

function resolvePlanChip(e: ReturnType<typeof useEntitlements>): string {
  if (e.hasSupreme) return 'AF Supreme'
  if (e.hasWarRoom) return 'AF Legacy'
  if (e.hasCommissioner) return 'AF Commissioner'
  if (e.hasPro) return 'AF Pro'
  return 'Free'
}

function gradePct(grade: string | null): number {
  if (!grade) return 0
  const map: Record<string, number> = { 'A+': 98, A: 94, 'A-': 90, 'B+': 86, B: 82, 'B-': 78, 'C+': 72, C: 66, 'C-': 60, 'D+': 54, D: 48, F: 35 }
  return map[grade] ?? 70
}

// ── Small presentational components ───────────────────────────────────────────
function Avatar({ name, image, size }: { name: string; image?: string | null; size: number }) {
  const initials = name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase() || 'AF'
  // Plain <img>, not next/image: the avatar URL may be an external provider
  // (Discord/Google) not in the images allowlist, and it needs no optimization.
  if (image) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={image} alt="" width={size} height={size} style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover' }} />
  }
  return <div style={{ width: size, height: size, borderRadius: '50%', background: 'var(--color-accent-800)', display: 'grid', placeItems: 'center', font: `700 ${Math.round(size * 0.4)}px ui-monospace,Menlo,monospace`, color: 'var(--color-accent-100)' }}>{initials}</div>
}

/**
 * Cards/list renderer shared by the Current and Historical league sections.
 * Rows OPEN THE DETAIL POPUP rather than navigating: AF-Legacy board rows have no
 * `/league/[id]` page (they 404), and the old behaviour of sending them all to the
 * generic `/af-legacy` landing page is what made "Open" feel random. The popup then
 * offers the real deep-link for leagues that actually have one.
 */
function LeagueCollection({ leagues, view, onOpen }: { leagues: DisplayLeague[]; view: 'cards' | 'list'; onOpen: (lg: DisplayLeague) => void }) {
  if (view === 'cards') {
    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 12 }}>
        {leagues.map((lg) => (
          <div
            key={lg.id}
            className="afcard"
            role="button"
            tabIndex={0}
            onClick={() => onOpen(lg)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(lg) } }}
            style={{ cursor: 'pointer' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <span className="afsrc" style={{ background: lg.color }}>{lg.initial}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{lg.name}</div>
                <div style={{ fontSize: 11.5, color: 'var(--color-neutral-600)', textTransform: 'capitalize' }}>
                  {lg.platform}{lg.season ? ` · ${lg.season}` : ''}
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              {lg.isCommissioner ? <span className="tag tag-accent">Commissioner</span> : <span className="tag tag-neutral">Manager</span>}
              <span style={{ fontSize: 12, color: 'var(--color-accent-400)' }}>Open →</span>
            </div>
          </div>
        ))}
      </div>
    )
  }
  return (
    <div className="afcard" style={{ padding: 6 }}>
      {leagues.map((lg) => (
        <button
          key={lg.id}
          type="button"
          onClick={() => onOpen(lg)}
          style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 'var(--radius-md)', color: 'inherit', background: 'none', border: 'none', width: '100%', cursor: 'pointer', textAlign: 'left' }}
        >
          <span className="afsrc" style={{ width: 24, height: 24, fontSize: 10, background: lg.color }}>{lg.initial}</span>
          <span style={{ fontWeight: 600, fontSize: 13, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{lg.name}</span>
          <span style={{ fontSize: 11.5, color: 'var(--color-neutral-600)', width: 46, flex: 'none' }}>{lg.season ?? '—'}</span>
          <span style={{ fontSize: 11.5, color: 'var(--color-neutral-600)', width: 66, flex: 'none', textTransform: 'capitalize' }}>{lg.platform}</span>
          {lg.isCommissioner ? <span className="tag tag-accent">Comm</span> : <span className="tag tag-neutral">Mgr</span>}
        </button>
      ))}
    </div>
  )
}

/**
 * Season stepper: completed phases get a check, the active phase shows the real week
 * number when we have one, upcoming phases stay hollow. Scrolls horizontally on narrow
 * screens rather than squashing the labels.
 */
function SeasonTimeline({ phaseIndex, week }: { phaseIndex: number; week: number | null }) {
  return (
    <div className="afcard" style={{ overflowX: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', minWidth: 620 }}>
        {SEASON_STEPS.map((label, i) => {
          const done = i < phaseIndex
          const active = i === phaseIndex
          const reached = done || active
          return (
            <div key={label} style={{ display: 'flex', alignItems: 'flex-start', flex: i === SEASON_STEPS.length - 1 ? '0 0 auto' : 1 }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, flex: 'none', width: 84 }}>
                <div
                  style={{
                    width: 28, height: 28, borderRadius: '50%', display: 'grid', placeItems: 'center',
                    fontSize: 11, fontWeight: 700, flex: 'none',
                    background: reached ? 'var(--color-accent)' : 'transparent',
                    color: reached ? '#fff' : 'var(--color-neutral-600)',
                    border: reached ? 'none' : '1.5px solid var(--color-neutral-700)',
                    boxShadow: active ? '0 0 0 4px color-mix(in srgb, var(--color-accent) 22%, transparent)' : 'none',
                  }}
                >
                  {active && week != null ? week : done ? <Check size={14} /> : i === 5 ? <Trophy size={13} /> : null}
                </div>
                <span style={{ fontSize: 11, textAlign: 'center', lineHeight: 1.25, color: active ? 'var(--color-text)' : 'var(--color-neutral-600)', fontWeight: active ? 600 : 400 }}>
                  {label}
                </span>
              </div>
              {i < SEASON_STEPS.length - 1 && (
                <div style={{ flex: 1, height: 2, marginTop: 13, background: done ? 'var(--color-accent)' : 'var(--color-neutral-800)', borderRadius: 2 }} />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function LeagueDetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: 'var(--color-neutral-600)' }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 600, textTransform: 'capitalize' }}>{value}</div>
    </div>
  )
}

function StatChip({ icon, value, label }: { icon: React.ReactNode; value: string; label: string }) {
  return (
    <div className="afcard" style={{ padding: '12px 18px', flexDirection: 'row', display: 'flex', alignItems: 'center', gap: 10 }}>
      {icon}
      <div><div style={{ fontSize: 18, fontWeight: 700, lineHeight: 1 }}>{value}</div><div style={{ fontSize: 11, color: 'var(--color-neutral-600)' }}>{label}</div></div>
    </div>
  )
}

function Priority({ icon, title, sub, onClick }: { icon: React.ReactNode; title: string; sub: string; onClick?: () => void }) {
  return (
    <div className="afcard" onClick={onClick} role={onClick ? 'button' : undefined} tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() } } : undefined}
      style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: onClick ? 'pointer' : 'default' }}>
      <div style={{ width: 36, height: 36, borderRadius: 'var(--radius-md)', background: 'var(--color-accent-900)', display: 'grid', placeItems: 'center' }}>{icon}</div>
      <div><div style={{ fontWeight: 600, fontSize: 13.5 }}>{title}</div><div style={{ fontSize: 11.5, color: 'var(--color-neutral-600)' }}>{sub}</div></div>
    </div>
  )
}

function Banner({ icon, title, body, accent, children }: { icon: React.ReactNode; title: string; body: string; accent?: boolean; children: React.ReactNode }) {
  return (
    <div style={{ background: accent ? 'linear-gradient(135deg,color-mix(in srgb, var(--color-accent) 22%, transparent),var(--color-surface))' : 'linear-gradient(135deg,color-mix(in srgb, var(--color-accent) 14%, transparent),var(--color-surface))', border: `1px solid ${accent ? 'var(--color-accent-700)' : 'var(--color-neutral-800)'}`, borderRadius: 'var(--radius-lg)', padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {icon}
        <div><div style={{ fontWeight: 700, fontSize: 14.5 }}>{title}</div><div style={{ fontSize: 12.5, color: 'var(--color-neutral-400)' }}>{body}</div></div>
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>{children}</div>
    </div>
  )
}

function Career({ value, label }: { value: number | string | null; label: string }) {
  return <div><div style={{ fontSize: 15, fontWeight: 700 }}>{value == null ? '—' : value}</div><div style={{ fontSize: 10.5, color: 'var(--color-neutral-600)' }}>{label}</div></div>
}

function Row({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
      <span style={{ fontSize: 12, color: 'var(--color-neutral-500)' }}>{label}</span>
      <span style={{ fontSize: 12.5, fontWeight: 600, color: accent ? 'var(--color-accent-400)' : 'var(--color-text)' }}>{value}</span>
    </div>
  )
}

// Best-effort platform name for the read-only "do this on {platform}" copy.
function commPlatformLabel(snap: CommissionerLeagueHealthSnapshot, leagues: DisplayLeague[]): string {
  const match = leagues.find((l) => l.name === snap.leagueName)
  if (match && match.platform !== 'native') return match.platform.charAt(0).toUpperCase() + match.platform.slice(1)
  return 'your platform'
}

const dividerLine = <div style={{ height: 1, background: 'var(--color-neutral-800)' }} />

function CommissionerHQ({
  snapshots, active, onSelect, platformLabel, showLock, checked, onToggle, tokensHref, upgradeHref,
}: {
  snapshots: CommissionerLeagueHealthSnapshot[]
  active: CommissionerLeagueHealthSnapshot
  onSelect: (id: string) => void
  platformLabel: string
  showLock: boolean
  checked: Record<string, boolean>
  onToggle: (key: string) => void
  tokensHref: string
  upgradeHref: string
}) {
  const m = active.metrics
  const lineupPct = Math.round(m.lineupSubmissionRate <= 1 ? m.lineupSubmissionRate * 100 : m.lineupSubmissionRate)
  const health = Math.max(0, Math.min(100, Math.round(active.healthScore)))
  return (
    <div>
      <div className="dash-kicker" style={{ marginBottom: 12 }}>Your commissioned leagues</div>
      {snapshots.length > 1 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
          {snapshots.map((s) => {
            const sel = s.leagueId === active.leagueId
            // Leagues created from the default template all share one name, so several
            // chips can read identically and become unpickable. When a name repeats,
            // append a short stable id fragment to tell them apart. Names that are
            // already unique are left completely alone.
            const duplicated = snapshots.filter((o) => o.leagueName === s.leagueName).length > 1
            return (
              <button key={s.leagueId} type="button" onClick={() => onSelect(s.leagueId)}
                title={duplicated ? `${s.leagueName} · id ${s.leagueId}` : s.leagueName}
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', borderRadius: 999, border: `1px solid ${sel ? 'var(--color-accent)' : 'var(--color-neutral-800)'}`, background: sel ? 'color-mix(in srgb, var(--color-accent) 14%, transparent)' : 'none', color: 'var(--color-text)', cursor: 'pointer', fontSize: 13.5, fontWeight: 500 }}>
                {s.leagueName}
                {duplicated && (
                  <span style={{ fontSize: 11, color: 'var(--color-neutral-500)', fontFamily: 'ui-monospace,Menlo,monospace' }}>
                    #{s.leagueId.slice(-4)}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      )}

      <div className="afcard" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        {/* Health ring + sub-scores */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
            <div className="afring" style={{ width: 84, height: 84, background: `conic-gradient(var(--color-accent) ${health}%, var(--color-neutral-800) ${health}% 100%)` }}>
              <div className="afringval"><span style={{ fontSize: 22, fontWeight: 700 }}>{health}</span><span style={{ fontSize: 9.5, color: 'var(--color-neutral-600)', letterSpacing: '.04em', textTransform: 'uppercase' }}>Health</span></div>
            </div>
            <div>
              <div style={{ fontWeight: 600, fontSize: 17 }}>{active.leagueName}</div>
              <span className="tag tag-accent" style={{ marginTop: 6, textTransform: 'capitalize' }}>{active.overallStatus ?? 'Healthy'}</span>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 14, textAlign: 'center' }}>
            <SubScore value={active.fairnessScore} label="Fairness" />
            <SubScore value={active.engagementScore} label="Engagement" />
            <SubScore value={active.sustainabilityScore} label="Sustain." />
          </div>
        </div>

        {dividerLine}

        {/* Activity metrics */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', gap: 12 }}>
          <Metric value={m.tradeActivity} label="Trades (7d)" />
          <Metric value={m.waiverActivity} label="Waiver claims (7d)" />
          <Metric value={m.chatMessagesLast7Days} label="Chat msgs (7d)" />
          <Metric value={m.inactiveTeams} label={`Inactive team${m.inactiveTeams === 1 ? '' : 's'}`} />
          <Metric value={`${lineupPct}%`} label="Lineups set" />
        </div>

        {active.recommendations.length > 0 && (
          <>
            {dividerLine}
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-neutral-500)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 10 }}>Recommendations</div>
              {/* Locked: show the COUNT + unlock CTA, never the premium text (SF1). */}
              {showLock ? (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '10px 12px', borderRadius: 'var(--radius-md)', border: '1px dashed var(--color-accent-700)', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 12.5, color: 'var(--color-neutral-400)', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Lock size={13} style={{ color: 'var(--color-accent-400)', flex: 'none' }} />
                    {active.recommendations.length} commissioner recommendation{active.recommendations.length === 1 ? '' : 's'} — Premium
                  </span>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <Link href={tokensHref} className="btn btn-secondary" style={{ padding: '5px 10px', fontSize: 11 }}>Buy tokens</Link>
                    <Link href={upgradeHref} className="btn btn-primary" style={{ padding: '5px 10px', fontSize: 11 }}>Unlock</Link>
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {active.recommendations.slice(0, 4).map((rec, i) => (
                    <div key={i} style={{ display: 'flex', gap: 9, alignItems: 'flex-start', fontSize: 13.5, color: 'var(--color-neutral-300)' }}>
                      <Lightbulb size={16} style={{ color: 'var(--color-accent-400)', flex: 'none', marginTop: 1 }} />{rec}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {active.actions.length > 0 && (
          <>
            {dividerLine}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 4 }}>
                <Info size={13} style={{ color: 'var(--color-neutral-600)' }} />
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-neutral-500)', textTransform: 'uppercase', letterSpacing: '.05em' }}>Recommended for you to do on {platformLabel}</span>
              </div>
              <p style={{ fontSize: 12, color: 'var(--color-neutral-600)', margin: '0 0 12px' }}>
                AllFantasy reads {platformLabel} data but can't make changes there — here's what's worth doing; check it off once it's handled.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {active.actions.slice(0, 5).map((a) => {
                  // Key check-off state by league + action so it doesn't bleed across leagues (SF2).
                  const ck = `${active.leagueId}:${a.key}`
                  const isChecked = !!checked[ck]
                  return (
                    <label key={a.key} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-neutral-800)', cursor: 'pointer', opacity: isChecked ? 0.6 : 1 }}>
                      <input type="checkbox" checked={isChecked} onChange={() => onToggle(ck)} style={{ accentColor: 'var(--color-accent)', width: 16, height: 16, flex: 'none', marginTop: 2 }} />
                      <span>
                        <span style={{ display: 'block', fontSize: 13.5, fontWeight: 600, color: 'var(--color-text)' }}>{a.label}</span>
                        <span style={{ display: 'block', fontSize: 12, color: 'var(--color-neutral-600)', marginTop: 2 }}>{a.description}</span>
                      </span>
                    </label>
                  )
                })}
              </div>
              <Link href="/commissioner-hub" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 12, fontSize: 12.5, color: 'var(--color-neutral-500)' }}>
                <Settings size={13} />AllFantasy settings for this league
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function SubScore({ value, label }: { value: number; label: string }) {
  return <div><div style={{ fontSize: 16, fontWeight: 700 }}>{Math.round(value)}</div><div style={{ fontSize: 10.5, color: 'var(--color-neutral-600)', textTransform: 'uppercase', letterSpacing: '.04em' }}>{label}</div></div>
}
function Metric({ value, label }: { value: number | string; label: string }) {
  return <div><div style={{ fontSize: 19, fontWeight: 700 }}>{value}</div><div style={{ fontSize: 11, color: 'var(--color-neutral-600)' }}>{label}</div></div>
}
