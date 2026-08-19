'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Bot, LayoutGrid, X } from 'lucide-react'
import { useGeoRestriction } from '@/lib/geo/useGeoRestriction'
import { DEFAULT_SPORT, normalizeToSupportedSport } from '@/lib/sport-scope'
import AppShell from '@/app/components/AppShell'
import type { DashboardLeagueListPayload } from '@/lib/dashboard/get-dashboard-league-list'
import type { CommissionerLeagueHealthSnapshot } from '@/lib/commissioner-hub/commissionerHubHealth'
import { DashboardOverview } from './components/DashboardOverview'
import { DraftRoomOverlay } from './components/DraftRoomOverlay'
import { RightControlPanel } from './components/RightControlPanel'
import { FantasyOsLaunchCard } from './components/FantasyOsLaunchCard'
import type { FantasyOsAccessView } from '@/lib/fantasy-os/access'
import { DashboardHeaderControls } from './components/DashboardHeaderControls'
import { FloatingCommunications } from './components/FloatingCommunications'
import { SelectedLeagueHomePanel } from './components/SelectedLeagueHomePanel'
import type { DashboardConnectedLeague, LeftChatInitialTab, UserLeague } from './types'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'
import LanguageToggle from '@/components/i18n/LanguageToggle'
import { useMyLeaguesRailCollapse } from '@/hooks/useMyLeaguesRailCollapse'
import { StartSitLauncher } from '@/components/dashboard/StartSitLauncher'
import { ThemeModeSelect } from '@/components/theme/ThemeModeSelect'
import {
  buildDashboardDraftOverlayUrl,
  fetchLiveDraftSessionIdForLeague,
  type DashboardDraftOverlayBridgePayload,
} from '@/lib/dashboard/dashboard-draft-overlay-bridge'

type DashboardShellProps = {
  userId: string
  userName: string
  /** Resolved avatar URL (session image or DB avatar; hashes → Sleeper CDN server-side) */
  userImage?: string | null
  /** When set (e.g. /league/[id]), shell highlights this league in left + right panels */
  activeLeagueId?: string | null
  /** False when the user has not yet clicked the email verification link. */
  emailVerified?: boolean
  discordConnected?: boolean
  /** From dashboard RSC — My Leagues hydrates immediately (no client waterfall). */
  initialLeagueList?: DashboardLeagueListPayload | null
  /** From dashboard RSC — rankings card + tier badge hydrate from same payload as `/api/user/rank`. */
  initialUserRankPayload?: Record<string, unknown> | null
  /** From dashboard RSC — Commissioner HQ (Phase 2.3) hydrates from the same health/actions/
   *  recommendations engine as the real `/commissioner-hub` page, one snapshot per commissioned league. */
  initialCommissionerHealthSnapshots?: CommissionerLeagueHealthSnapshot[] | null
  /** Server-resolved Fantasy OS enterprise-workspace access (owner/admin/enterprise). Gates the launch card. */
  fantasyOsAccess?: FantasyOsAccessView | null
}

type DraftOverlayState = {
  leagueId: string
  draftId?: string
  dispersalDraftId?: string
  iframeSrc: string | null
  leagueName: string | null
  loading: boolean
  errorMessage: string | null
}

function buildDraftOverlayIframeSrc({
  draftId,
  dispersalDraftId,
  leagueId,
}: {
  leagueId: string
  draftId?: string
  dispersalDraftId?: string
}): string | null {
  if (dispersalDraftId) {
    return `/league/${encodeURIComponent(leagueId)}/dispersal-draft/${encodeURIComponent(dispersalDraftId)}?embed=1`
  }
  if (draftId) {
    return `/draft/${encodeURIComponent(draftId)}`
  }
  return null
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function toStringValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

/** Primary keys in API payloads are usually strings; coerce so mapping never drops leagues. */
function toCoercedIdString(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value === 'bigint') return String(value)
  return ''
}

function readSessionDeletedLeagueIds(): Set<string> {
  if (typeof window === 'undefined') return new Set()
  try {
    const raw = sessionStorage.getItem('af_dashboard_deleted_leagues')
    if (!raw) return new Set()
    const parsed = JSON.parse(raw) as unknown
    return new Set(
      Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [],
    )
  } catch {
    return new Set()
  }
}

function mapPayloadLeagues(rawList: unknown, tombstones: Set<string>): DashboardConnectedLeague[] {
  if (!Array.isArray(rawList)) return []
  return rawList
    .map((league) => mapLeague(league))
    .filter((league): league is DashboardConnectedLeague => Boolean(league))
    .filter((league) => !tombstones.has(league.id))
}

function toNumberValue(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function toBooleanValue(value: unknown): boolean {
  return value === true
}

function parseSeasonValue(raw: unknown): number | string {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw
  if (typeof raw === 'string' && raw.trim()) {
    const n = parseInt(raw, 10)
    if (Number.isFinite(n)) return n
    return raw
  }
  return new Date().getFullYear()
}

type LegacyTierBadgeData = {
  imported?: boolean
  tier?: string | null
  tierName?: string | null
  level?: number | null
  levelName?: string | null
  color?: string | null
  bgColor?: string | null
  rank?: { careerTier: number; careerTierName: string; careerLevel?: number }
}

function legacyBadgeFromRankApi(data: LegacyTierBadgeData | null): {
  state: 'ranked' | 'empty'
  rank: { label: string; name: string; bg: string; fg: string } | null
} {
  if (!data) {
    return { state: 'empty', rank: null }
  }
  const tierCode = data.tier?.trim()
  if (data.imported && (typeof data.level === 'number' || tierCode || data.rank)) {
    const label =
      typeof data.level === 'number' && data.levelName?.trim()
        ? `L${data.level}`
        : tierCode ?? `L${data.rank?.careerLevel ?? data.rank?.careerTier ?? 1}`
    const name =
      data.levelName?.trim() ||
      data.tierName?.trim() ||
      data.rank?.careerTierName ||
      (tierCode ? String(tierCode) : 'Ranked')
    const bg = data.bgColor?.trim() || 'rgba(255,255,255,0.08)'
    const fg = data.color?.trim() || 'rgba(255,255,255,0.9)'
    return { state: 'ranked', rank: { label, name, bg, fg } }
  }
  return { state: 'empty', rank: null }
}

function DashboardLegacyRankBadge({
  initialUserRankPayload,
}: {
  initialUserRankPayload?: Record<string, unknown> | null
}) {
  const fromSsr =
    initialUserRankPayload != null ? legacyBadgeFromRankApi(initialUserRankPayload as LegacyTierBadgeData) : null
  const [state, setState] = useState<'loading' | 'ranked' | 'empty'>(() =>
    fromSsr ? fromSsr.state : 'loading'
  )
  const [rank, setRank] = useState<{ label: string; name: string; bg: string; fg: string } | null>(
    () => fromSsr?.rank ?? null
  )

  useEffect(() => {
    if (initialUserRankPayload != null) return
    let active = true
    fetch('/api/user/rank', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: LegacyTierBadgeData | null) => {
        if (!active) return
        const parsed = legacyBadgeFromRankApi(data)
        setRank(parsed.rank)
        setState(parsed.state)
      })
      .catch(() => {
        if (active) setState('empty')
      })
    return () => {
      active = false
    }
  }, [initialUserRankPayload])

  if (state === 'loading') {
    return (
      <div
        className="h-7 w-28 animate-pulse rounded-full bg-white/[0.06]"
        aria-hidden
        data-testid="dashboard-legacy-tier-badge-loading"
      />
    )
  }

  if (state === 'empty' || !rank) {
    return (
      <Link
        href="/import"
        className="inline-flex max-w-full items-center gap-2 rounded-full border border-white/15 bg-white/[0.04] px-3 py-1.5 text-[11px] font-semibold text-white/70 transition-colors hover:border-cyan-500/30 hover:text-white"
        data-testid="dashboard-legacy-tier-badge"
      >
        Import to get ranked
      </Link>
    )
  }

  return (
    <Link
      href="/af-rankings"
      className="inline-flex max-w-full items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-semibold transition-opacity hover:opacity-95"
      style={{
        background: rank.bg,
        color: rank.fg,
        borderColor: `${rank.fg}33`,
      }}
      data-testid="dashboard-legacy-tier-badge"
    >
      <span className="truncate">
        {rank.label} · {rank.name}
      </span>
    </Link>
  )
}

function weekFromSettings(settings: unknown): number | null {
  const o = toRecord(settings)
  if (!o) return null
  const w = o.currentWeek ?? o.current_week ?? o.week
  if (typeof w === 'number' && Number.isFinite(w)) return w
  if (typeof w === 'string') {
    const n = parseInt(w, 10)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function mapLeague(rawValue: unknown): DashboardConnectedLeague | null {
  const raw = toRecord(rawValue)
  if (!raw) return null

  const sourceLeagueId = toCoercedIdString(raw.id)
  const selectedLeagueId =
    toCoercedIdString(raw.navigationLeagueId) ||
    toCoercedIdString(raw.unifiedLeagueId) ||
    sourceLeagueId

  if (!selectedLeagueId) return null

  const sport =
    normalizeToSupportedSport(toStringValue(raw.sport) || toStringValue(raw.sport_type)) ?? DEFAULT_SPORT
  const platform = toStringValue(raw.platform, 'allfantasy')
  const platformLeagueId = toCoercedIdString(raw.platformLeagueId) || null

  const settings = toRecord(raw.settings) ?? undefined
  const currentWeek = weekFromSettings(raw.settings)

  const userRoleRaw = raw.userRole
  const userRole: 'commissioner' | 'member' | 'imported' =
    userRoleRaw === 'commissioner' || userRoleRaw === 'member' || userRoleRaw === 'imported'
      ? userRoleRaw
      : 'member'

  const leagueTypeRaw =
    toStringValue(raw.leagueType) || toStringValue((raw as Record<string, unknown>).league_type) || null

  return {
    id: selectedLeagueId,
    sourceLeagueId: sourceLeagueId || selectedLeagueId,
    name: toStringValue(raw.name, 'Unnamed League'),
    platform,
    sport,
    leagueVariant:
      toStringValue(raw.leagueVariant) || toStringValue(raw.league_variant) || null,
    leagueType: leagueTypeRaw,
    guillotineMode:
      raw.guillotineMode === true || raw.guillotine_mode === true
        ? true
        : raw.guillotineMode === false || raw.guillotine_mode === false
          ? false
          : null,
    bestBallMode:
      raw.bestBallMode === true || raw.best_ball_mode === true
        ? true
        : raw.bestBallMode === false || raw.best_ball_mode === false
          ? false
          : null,
    format:
      leagueTypeRaw ||
      toStringValue(raw.leagueVariant) ||
      toStringValue(raw.league_variant) ||
      (toBooleanValue(raw.isDynasty) ? 'dynasty' : 'redraft'),
    scoring: toStringValue(raw.scoring, 'Standard'),
    teamCount: toNumberValue(raw.teamCount ?? raw.leagueSize ?? raw.totalTeams),
    season: parseSeasonValue(raw.season),
    status: toStringValue(raw.status) || toStringValue(raw.syncStatus) || undefined,
    currentWeek: currentWeek ?? undefined,
    isDynasty: toBooleanValue(raw.isDynasty),
    settings,
    sleeperLeagueId: platform === 'sleeper' ? platformLeagueId ?? undefined : undefined,
    syncStatus: toStringValue(raw.syncStatus) || null,
    avatarUrl: toStringValue(raw.avatarUrl) || null,
    logoUrl: toStringValue(raw.logoUrl) || null,
    platformLeagueId,
    isCommissioner: toBooleanValue(raw.isCommissioner),
    userRole,
    isPaid: toBooleanValue(raw.isPaid),
    entryFee:
      typeof raw.entryFee === 'number' && Number.isFinite(raw.entryFee) ? raw.entryFee : null,
    lifecycleState: toStringValue(raw.lifecycleState) || null,
    draftDate: toStringValue(raw.draftDate) || null,
    tradeDeadlineWeek:
      typeof raw.tradeDeadlineWeek === 'number' && Number.isFinite(raw.tradeDeadlineWeek)
        ? raw.tradeDeadlineWeek
        : null,
    playoffStartWeek:
      typeof raw.playoffStartWeek === 'number' && Number.isFinite(raw.playoffStartWeek)
        ? raw.playoffStartWeek
        : null,
  }
}

function LeagueCenterContent({
  leagueId,
  league,
  leaguesLoading,
  onDraftOverlayRequest,
}: {
  leagueId: string
  league: UserLeague | null
  leaguesLoading: boolean
  onDraftOverlayRequest: (payload: DashboardDraftOverlayBridgePayload) => void
}) {
  const { t } = useLanguage()
  if (leaguesLoading) {
    return (
      <div
        className="flex h-full min-h-0 flex-col items-center justify-center overflow-y-auto px-6"
        style={{ background: 'var(--bg)' }}
      >
        <p className="text-sm" style={{ color: 'var(--muted)' }}>
          {t('dashboard.shell.loadingLeague')}
        </p>
      </div>
    )
  }

  if (!league) {
    return (
      <div
        className="flex h-full min-h-0 flex-col items-center justify-center overflow-y-auto px-6 text-center"
        style={{ background: 'var(--bg)' }}
      >
        <p className="text-sm font-semibold" style={{ color: 'var(--text)' }}>
          {t('dashboard.shell.leagueNotFound')}
        </p>
        <p className="mt-2 text-xs" style={{ color: 'var(--muted2)' }}>
          {t('dashboard.shell.leagueNotInList')}
        </p>
        <p className="mt-1 font-mono text-[10px] text-white/25">{leagueId}</p>
      </div>
    )
  }

  return <SelectedLeagueHomePanel league={league} onDraftOverlayRequest={onDraftOverlayRequest} />
}

export function DashboardShell({
  userId,
  userName,
  userImage = null,
  activeLeagueId = null,
  emailVerified = true,
  discordConnected = false,
  initialLeagueList = null,
  initialUserRankPayload = null,
  initialCommissionerHealthSnapshots = null,
  fantasyOsAccess = null,
}: DashboardShellProps) {
  const { t } = useLanguage()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [draftOverlay, setDraftOverlay] = useState<DraftOverlayState | null>(null)
  /**
   * Session-scoped tombstones: leagueIds that the user just deleted.
   * Filters any subsequent server response so replication lag / race conditions
   * can't resurrect a just-deleted league on `router.refresh()` or a polling fetch.
   * Persisted in sessionStorage so a hard reload within the same tab still blocks it.
   */
  const [deletedLeagueIds, setDeletedLeagueIds] = useState<Set<string>>(readSessionDeletedLeagueIds)
  const persistTombstones = useCallback((next: Set<string>) => {
    if (typeof window === 'undefined') return
    try {
      sessionStorage.setItem(
        'af_dashboard_deleted_leagues',
        JSON.stringify(Array.from(next)),
      )
    } catch {
      /* quota or privacy mode — in-memory filter still holds */
    }
  }, [])

  const [leagues, setLeagues] = useState<DashboardConnectedLeague[]>(() => {
    if (initialLeagueList == null) return []
    const tombstones =
      typeof window !== 'undefined'
        ? (() => {
            try {
              const raw = sessionStorage.getItem('af_dashboard_deleted_leagues')
              if (!raw) return new Set<string>()
              const parsed = JSON.parse(raw) as unknown
              return new Set<string>(
                Array.isArray(parsed)
                  ? parsed.filter((id): id is string => typeof id === 'string')
                  : [],
              )
            } catch {
              return new Set<string>()
            }
          })()
        : new Set<string>()
    return initialLeagueList.leagues
      .map((league) => mapLeague(league))
      .filter((league): league is DashboardConnectedLeague => Boolean(league))
      .filter((league) => !tombstones.has(league.id))
  })
  const [leaguesLoading, setLeaguesLoading] = useState(() => initialLeagueList == null)
  // Phase 2.5 — unified floating Communications (replaces the permanent left chat column + the old
  // mobile chat drawer). `commsRequestedTab` lets a CTA request a specific channel; null → context default.
  const [commsOpen, setCommsOpen] = useState(false)
  const [commsRequestedTab, setCommsRequestedTab] = useState<LeftChatInitialTab | null>(null)
  const [mobileRightOpen, setMobileRightOpen] = useState(false)
  const openComms = useCallback((tab: LeftChatInitialTab | null = null) => {
    setCommsRequestedTab(tab)
    setCommsOpen(true)
  }, [])
  const myLeaguesRail = useMyLeaguesRailCollapse()

  const selectedLeague = useMemo((): UserLeague | null => {
    if (!activeLeagueId) return null
    const found = leagues.find((l) => l.id === activeLeagueId)
    return found ?? null
  }, [leagues, activeLeagueId])

  useEffect(() => {
    if (!searchParams) return

    const draftOverlayRequested = searchParams.get('draftOverlay') === '1'
    const leagueId = searchParams.get('leagueId')?.trim() ?? ''
    const draftId = searchParams.get('draftId')?.trim() || undefined
    const dispersalDraftId = searchParams.get('dispersalDraftId')?.trim() || undefined

    if (!draftOverlayRequested || !leagueId) {
      setDraftOverlay(null)
      return
    }

    const leagueName = leagues.find((l) => l.id === leagueId)?.name ?? null
    const iframeSrc = buildDraftOverlayIframeSrc({ leagueId, draftId, dispersalDraftId })

    if (iframeSrc) {
      setDraftOverlay({
        leagueId,
        draftId,
        dispersalDraftId,
        iframeSrc,
        leagueName,
        loading: false,
        errorMessage: null,
      })
      return
    }

    let active = true
    setDraftOverlay({
      leagueId,
      iframeSrc: null,
      leagueName,
      loading: true,
      errorMessage: null,
    })

    fetchLiveDraftSessionIdForLeague(leagueId)
      .then((resolvedDraftId) => {
        if (!active) return
        if (!resolvedDraftId) {
          setDraftOverlay({
            leagueId,
            iframeSrc: null,
            leagueName,
            loading: false,
            errorMessage: 'Draft room is not available yet.',
          })
          return
        }
        setDraftOverlay({
          leagueId,
          draftId: resolvedDraftId,
          iframeSrc: buildDraftOverlayIframeSrc({ leagueId, draftId: resolvedDraftId }),
          leagueName,
          loading: false,
          errorMessage: null,
        })
      })
      .catch(() => {
        if (!active) return
        setDraftOverlay({
          leagueId,
          iframeSrc: null,
          leagueName,
          loading: false,
          errorMessage: 'Could not open the draft room.',
        })
      })

    return () => {
      active = false
    }
  }, [leagues, searchParams])

  const commissionerLeagues = useMemo(
    () =>
      leagues
        .filter((l) => l.isCommissioner)
        .map((l) => ({ id: l.id, name: l.name, teamCount: l.teamCount ?? 0 })),
    [leagues]
  )

  const handleDraftOverlayRequest = useCallback((payload: DashboardDraftOverlayBridgePayload) => {
    setDraftOverlay({
      leagueId: payload.leagueId,
      draftId: payload.draftId,
      dispersalDraftId: payload.dispersalDraftId,
      iframeSrc: buildDraftOverlayIframeSrc(payload),
      leagueName: leagues.find((l) => l.id === payload.leagueId)?.name ?? null,
      loading: !payload.draftId && !payload.dispersalDraftId,
      errorMessage: null,
    })
    router.replace(
      buildDashboardDraftOverlayUrl({
        leagueId: payload.leagueId,
        draftId: payload.draftId,
        dispersalDraftId: payload.dispersalDraftId,
      }),
      { scroll: false },
    )
  }, [leagues, router])

  const handleDraftOverlayClose = useCallback(() => {
    setDraftOverlay(null)
    router.replace('/dashboard', { scroll: false })
  }, [router])

  const handleDraftOverlayHome = useCallback(() => {
    setDraftOverlay(null)
    router.replace('/dashboard', { scroll: false })
  }, [router])

  /** My Leagues rows use `<Link href={getLeagueListDestinationHref}>` — do not `router.push` here or it overrides tournament (and other) URLs. */
  const handleSelectLeague = useCallback((league: UserLeague | null) => {
    if (!league) {
      router.push('/dashboard')
    }
  }, [router])

  useEffect(() => {
    // Phase 2.5: all "open chat" signals now open the unified floating Communications panel.
    // `af-dashboard-open-mobile-left` (legacy name, kept so existing dispatchers still work) opens
    // to the context default; the Chimmy-focused events request the Chimmy channel explicitly.
    const openDefault = () => openComms(null)
    const openChimmy = () => openComms('chimmy')
    window.addEventListener('af-dashboard-open-mobile-left', openDefault)
    window.addEventListener('af-dashboard-focus-left-chimmy', openChimmy)
    window.addEventListener('af-dashboard-open-chimmy', openChimmy)
    return () => {
      window.removeEventListener('af-dashboard-open-mobile-left', openDefault)
      window.removeEventListener('af-dashboard-focus-left-chimmy', openChimmy)
      window.removeEventListener('af-dashboard-open-chimmy', openChimmy)
    }
  }, [openComms])

  const applyLeaguesPayload = useCallback(
    (payload: unknown) => {
      const root = toRecord(payload)
      const rawLeagues =
        Array.isArray(root?.leagues) ? root?.leagues : Array.isArray(payload) ? payload : []
      const nextLeagues = rawLeagues
        .map((league) => mapLeague(league))
        .filter((league): league is DashboardConnectedLeague => Boolean(league))
        // Strip anything the user just deleted — the server may still be returning it
        // due to replication lag, an in-flight Sleeper re-sync, or a race on
        // `router.refresh()`. Tombstones clear at tab close (sessionStorage).
        .filter((league) => !deletedLeagueIds.has(league.id))
      setLeagues(nextLeagues)
    },
    [deletedLeagueIds],
  )

  /** Keep My Leagues in sync when RSC refreshes (router.refresh) or tombstones change — useState only runs once. */
  useEffect(() => {
    if (initialLeagueList == null) return
    setLeagues(mapPayloadLeagues(initialLeagueList.leagues, deletedLeagueIds))
    setLeaguesLoading(false)
  }, [initialLeagueList, deletedLeagueIds])

  useEffect(() => {
    if (initialLeagueList != null) return
    let active = true
    setLeaguesLoading(true)
    fetch('/api/league/list', { cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error('Failed to load leagues'))))
      .then((payload: unknown) => {
        if (!active) return
        applyLeaguesPayload(payload)
      })
      .catch(() => {
        if (!active) return
        setLeagues([])
      })
      .finally(() => {
        if (!active) return
        setLeaguesLoading(false)
      })

    return () => {
      active = false
    }
  }, [applyLeaguesPayload, initialLeagueList])

  const onLeaguesRefresh = useCallback(() => {
    fetch('/api/league/list', { cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error('Failed to load leagues'))))
      .then((payload: unknown) => {
        applyLeaguesPayload(payload)
      })
      .catch(() => {})
  }, [applyLeaguesPayload])

  const onLeagueRemoved = useCallback(
    (leagueId: string) => {
      setLeagues((prev) => prev.filter((l) => l.id !== leagueId))
      setDeletedLeagueIds((prev) => {
        if (prev.has(leagueId)) return prev
        const next = new Set(prev)
        next.add(leagueId)
        persistTombstones(next)
        return next
      })
      if (activeLeagueId === leagueId) {
        router.push('/dashboard')
      }
    },
    [activeLeagueId, persistTombstones, router]
  )

  const handleTriggerImport = () => {
    if (typeof window === 'undefined') return
    window.dispatchEvent(new CustomEvent('af-dashboard-open-import'))
    window.location.assign('/import?returnTo=/dashboard')
  }

  const handleOpenChimmy = () => {
    if (typeof window !== 'undefined') {
      // Kept so ChimmyChat (inside the panel) still receives its focus signal.
      window.dispatchEvent(new CustomEvent('af-dashboard-open-chimmy'))
    }
    openComms('chimmy')
  }

  const isLeagueRoute = Boolean(activeLeagueId)
  const geo = useGeoRestriction()

  return (
    <AppShell
      layoutMode="balanced-three-panel"
      rootClassName="h-[100dvh] min-h-[100dvh] overflow-hidden bg-[#0b0e2a]"
      rootProps={{ 'data-dashboard-user-id': userId }}
      rightRailCollapsed={myLeaguesRail.collapsed}
      onRightRailExpand={() => myLeaguesRail.setCollapsed(false)}
      rightRailCollapsedHint={leagues.length ? String(leagues.length) : undefined}
      hideLeftRail
      hideRightRail={!isLeagueRoute}
      leftPanel={null}
      rightPanel={
        <RightControlPanel
          leagues={leagues}
          leaguesLoading={leaguesLoading}
          selectedId={selectedLeague?.id ?? null}
          activeLeagueId={activeLeagueId}
          onSelectLeague={handleSelectLeague}
          userId={userId}
          userName={userName}
          userImage={userImage}
          onImport={handleTriggerImport}
          onLeaguesRefresh={onLeaguesRefresh}
          onLeagueRemoved={onLeagueRemoved}
          onRailCollapse={() => myLeaguesRail.setCollapsed(true)}
          hideLeagueList
        />
      }
    >
      <>
        {!emailVerified ? (
          <div
            className="shrink-0 border-b border-amber-500/25 bg-amber-500/10 px-4 py-2.5 text-center text-[11px] leading-snug text-amber-100 sm:text-xs md:px-6"
            role="status"
          >
            <span className="font-semibold">Verify your email</span> to unlock leagues, brackets, chat, and more.{' '}
            <Link href="/verify" className="font-medium text-cyan-300 underline">
              Verify now →
            </Link>
          </div>
        ) : null}
        {!geo.loading && geo.isPaidBlocked && geo.stateCode ? (
          <div
            className="shrink-0 border-b border-amber-500/25 bg-amber-500/10 px-4 py-2.5 text-center text-[11px] leading-snug text-amber-100 sm:text-xs md:px-6"
            role="status"
          >
            <span className="font-semibold">
              {t('dashboard.shell.geoAvailability')} ({geo.stateName ?? geo.stateCode}):
            </span>{' '}
            {t('dashboard.shell.geoPaidBlocked')}{' '}
            <Link href={`/paid-restricted?state=${encodeURIComponent(geo.stateCode)}`} className="font-medium text-cyan-300 underline">
              {t('dashboard.shell.learnMore')}
            </Link>
          </div>
        ) : null}
        {fantasyOsAccess?.allowed ? (
          <div className="shrink-0 px-4 pt-3 md:px-6" data-testid="dashboard-fantasy-os-entry">
            <FantasyOsLaunchCard reason={fantasyOsAccess.reason} />
          </div>
        ) : null}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="af-dashboard-topbar border-b px-3 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] md:hidden">
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => openComms(null)}
                className="touch-manipulation inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-[#ff3d81]/30 text-white shadow-[0_0_22px_-10px_rgba(255,61,129,0.85)] transition active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff3d81]/70"
                style={{ background: 'linear-gradient(135deg,rgba(255,61,129,0.18),rgba(255,138,61,0.12))' }}
                aria-label={t('dashboard.comms.open')}
              >
                <Bot className="h-5 w-5" aria-hidden />
              </button>
              <div className="min-w-0 flex-1 text-center">
                <p className="text-[9px] font-black uppercase italic tracking-[0.24em] text-[#ff8a3d]">
                  AllFantasy
                </p>
                <p className="truncate text-sm font-black text-white">
                  {isLeagueRoute ? selectedLeague?.name ?? t('dashboard.shell.leagueFallback') : t('dashboard.shell.title')}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <StartSitLauncher userId={userId} variant="compact" />
                <LanguageToggle />
                <button
                  type="button"
                  onClick={() => setMobileRightOpen(true)}
                  className="touch-manipulation inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-amber-300/25 bg-amber-300/[0.08] text-amber-50 shadow-[0_0_22px_-12px_rgba(251,191,36,0.8)] transition active:scale-95 active:bg-amber-300/[0.14] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/70"
                  aria-label={t('dashboard.shell.openMyLeagues')}
                >
                  <LayoutGrid className="h-5 w-5" aria-hidden />
                </button>
              </div>
            </div>
            {!isLeagueRoute ? (
              <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
                <DashboardLegacyRankBadge initialUserRankPayload={initialUserRankPayload} />
                <ThemeModeSelect size="sm" />
              </div>
            ) : null}
          </div>

          <div
            className="af-dashboard-topbar hidden border-b border-[#1c2153] px-6 py-3 md:flex md:items-center md:justify-between md:gap-3"
          >
            {/* Audit fix: removed the permanently-hidden "AllFantasy · Dashboard" <p>
                (dead node kept alive by a [&>p:first-child]:hidden hack). */}
            <div className="min-w-0">
              <p className="text-[10px] font-black uppercase italic tracking-[0.24em] text-[#ff8a3d]">
                AllFantasy Command Center
              </p>
              <p className="mt-0.5 truncate text-sm font-black italic text-[#f0f2ff]">
                {isLeagueRoute ? selectedLeague?.name ?? t('dashboard.shell.leagueFallback') : t('dashboard.shell.title')}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <StartSitLauncher userId={userId} />
              <div className="hidden md:block">
                <LanguageToggle />
              </div>
              <ThemeModeSelect size="sm" />
              {!isLeagueRoute ? (
                <DashboardLegacyRankBadge initialUserRankPayload={initialUserRankPayload} />
              ) : null}
              {/* Phase 3.8D: the dashboard's desktop right rail is removed, so its Create/Import
                  and profile/plan/account affordances are rehomed into the header. Only on the
                  dashboard overview — the embedded league route keeps its rail (and its footer). */}
              {!isLeagueRoute ? (
                <DashboardHeaderControls
                  userName={userName}
                  userImage={userImage}
                  onImport={handleTriggerImport}
                />
              ) : null}
            </div>
          </div>

        <div className="min-h-0 flex-1 overflow-hidden">
          {isLeagueRoute && activeLeagueId ? (
            <LeagueCenterContent
              leagueId={activeLeagueId}
              league={selectedLeague}
              leaguesLoading={leaguesLoading}
              onDraftOverlayRequest={handleDraftOverlayRequest}
            />
          ) : (
            <DashboardOverview
              userId={userId}
              userName={userName}
              leagues={leagues}
              leaguesLoading={leaguesLoading}
              onTriggerImport={handleTriggerImport}
              onOpenChimmy={handleOpenChimmy}
              initialUserRankPayload={initialUserRankPayload}
              initialCommissionerHealthSnapshots={initialCommissionerHealthSnapshots}
            />
          )}
        </div>
        </div>

      {/* Phase 2.5 — Unified floating Communications: one entry point + one on-demand panel
          (League / Chimmy / AF Huddle / DMs), replacing the permanent left chat column and the
          old mobile chat drawer. */}
      <FloatingCommunications
        open={commsOpen}
        requestedTab={commsRequestedTab}
        onOpen={() => openComms(null)}
        onClose={() => setCommsOpen(false)}
        userId={userId}
        userName={userName}
        userImage={userImage}
        leagues={leagues}
        activeLeagueId={activeLeagueId}
        discordConnected={discordConnected}
        commissionerLeagues={commissionerLeagues}
      />

      {mobileRightOpen ? (
        <div
          className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px] md:hidden"
          role="presentation"
          onClick={() => setMobileRightOpen(false)}
        >
          <div
            className="absolute inset-x-0 bottom-0 flex max-h-[90dvh] min-h-[50dvh] flex-col overflow-hidden rounded-t-[24px] border-t border-[#262c6a] bg-[#0b0e2a] pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-12px_48px_rgba(0,0,0,0.45)]"
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
                  leagues={leagues}
                  leaguesLoading={leaguesLoading}
                  selectedId={selectedLeague?.id ?? null}
                  activeLeagueId={activeLeagueId}
                  onSelectLeague={handleSelectLeague}
                  userId={userId}
                  userName={userName}
                  userImage={userImage}
                  onImport={handleTriggerImport}
                  onAfterLeagueNavigate={() => setMobileRightOpen(false)}
                  onSettingsNavigate={() => setMobileRightOpen(false)}
                  onLeaguesRefresh={onLeaguesRefresh}
                  onLeagueRemoved={onLeagueRemoved}
                  onRailCollapse={() => myLeaguesRail.setCollapsed(true)}
                />
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {leaguesLoading ? (
        <div className="pointer-events-none fixed inset-x-0 top-0 z-30 flex justify-center py-2">
          <div
            className="rounded-full border border-[var(--border)] px-3 py-1 text-xs"
            style={{ background: 'var(--panel)', color: 'var(--muted)' }}
          >
            {t('dashboard.shell.loadingLeagues')}
          </div>
        </div>
      ) : null}

      {draftOverlay ? (
        <DraftRoomOverlay
          leagueId={draftOverlay.leagueId}
          iframeSrc={draftOverlay.iframeSrc}
          leagueName={draftOverlay.leagueName}
          loading={draftOverlay.loading}
          errorMessage={draftOverlay.errorMessage}
          onClose={handleDraftOverlayClose}
          onHome={handleDraftOverlayHome}
        />
      ) : null}
      </>
    </AppShell>
  )
}
