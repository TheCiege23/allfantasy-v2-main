'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Settings, Zap, RotateCcw, Calendar, Trophy, Users, ClipboardList, CreditCard } from 'lucide-react'
import { DepthChartPanel } from '@/components/sports/DepthChartPanel'
import type { LeagueTeamSlot, UserLeague } from '@/app/dashboard/types'
import type { LeagueSeasonSnapshot } from '@/lib/league/sort-teams-standings'
import { sortTeamsForManagerListing } from '@/lib/league/sort-teams-standings'
import type { LeagueDashboardView } from '@/app/league/[leagueId]/league-dashboard-types'
import { DraftTab } from '@/app/league/[leagueId]/tabs/DraftTab'
import { LeagueHomeHero } from '@/components/league-home/LeagueHomeHero'
import { LeagueHomeQuickCards } from '@/components/league-home/LeagueHomeQuickCards'
import LeagueScoringPreviews from '@/components/league/LeagueScoringPreviews'
import SpecialtyLeagueAutomationSection from '@/components/specialty-automation/SpecialtyLeagueAutomationSection'
import { isExcludedFromHomeHero, resolveLeagueAccent } from '@/lib/league-home/accent-resolver'
import { resolveLeagueMedia } from '@/lib/league-home/league-media-resolver'
import { LeagueManagersStandingsSection } from '@/app/league/[leagueId]/components/LeagueManagersStandingsSection'
import { LeagueRecentActivity } from '@/app/league/[leagueId]/components/LeagueRecentActivity'
import type { LeagueActivityItem, LeagueActivityLine } from '@/components/league/types'
import { useLeagueRealtimeRefresh } from '@/hooks/useLeagueRealtimeRefresh'
import LeaguePulseCard from '@/components/decision-os/LeaguePulseCard'
import { buildLeagueHomePulse } from '@/lib/decision-os/league-pulse'
import ManagerDnaCard from '@/components/decision-os/ManagerDnaCard'
import DecisionRecommendationsCard from '@/components/decision-os/DecisionRecommendationsCard'
import UserOsCard from '@/components/decision-os/UserOsCard'
import { buildManagerDnaViewModel } from '@/lib/decision-os/manager-dna'
import { buildDecisionRecommendationsViewModel } from '@/lib/decision-os/recommendations'
import type { ManagerIntelligencePayload } from '@/lib/decision-os/dashboard-intelligence'
import type { UserOsSnapshot } from '@/lib/decision-os/userOs'

export type LeagueTabProps = {
  league: UserLeague
  teams: LeagueTeamSlot[]
  seasonSnapshot?: LeagueSeasonSnapshot | null
  leagueDashboard: LeagueDashboardView
  isOwner?: boolean
  isCommissioner?: boolean
  inviteToken?: string
  idpLeagueUi?: boolean
  /** Current user's team in the league - used by the home hero. Plumbed from LeagueShell. */
  userTeam?: { id: string; teamName?: string | null } | null
}

type ScoringRowProps = {
  label: string
  value: string
  highlight?: boolean
  valueTone: 'positive' | 'negative' | 'neutral'
}

type LeagueActivityFeedRow = {
  id: string
  category: 'trade' | 'waiver' | 'add_drop' | 'draft' | 'announcement' | 'scoring' | 'generic'
  title: string
  subtitle: string
  timestamp: string
}

// League Rules Summary Card

type RuleItem = { icon: React.ReactNode; label: string; value: string }

function safeStr(v: unknown, fallback = '-'): string {
  if (v == null) return fallback
  const s = String(v).trim()
  return s.length > 0 ? s : fallback
}

function resolveWaiverType(settings: Record<string, unknown> | null | undefined): string {
  if (!settings) return '-'
  const wt = settings.waiver_type ?? settings.waiverType
  if (wt == null) return '-'
  const n = Number(wt)
  if (n === 0) return 'Free (FCFS)'
  if (n === 1) return 'FAAB'
  if (n === 2) return 'Rolling'
  return safeStr(wt)
}

function resolveDraftType(settings: Record<string, unknown> | null | undefined, league: UserLeague): string {
  if (settings) {
    const dt = settings.draft_type ?? settings.draftType
    if (dt != null) {
      const s = String(dt).toLowerCase()
      if (s === 'snake') return 'Snake'
      if (s === 'auction') return 'Auction'
      if (s === 'linear') return 'Linear'
      if (s === 'bestball') return 'Best Ball'
      if (s.length > 0) return safeStr(dt)
    }
  }
  if (league.leagueType === 'dynasty') return 'Dynasty'
  if (league.leagueType === 'keeper') return 'Keeper'
  if (league.bestBallMode) return 'Best Ball'
  return '-'
}

function resolvePlayoffTeams(settings: Record<string, unknown> | null | undefined): string {
  if (!settings) return '-'
  const p = settings.playoff_teams ?? settings.playoffTeams ?? settings.num_playoff_teams
  if (p == null) return '-'
  const n = Number(p)
  return Number.isFinite(n) && n > 0 ? String(n) : safeStr(p)
}

function resolveTradeDeadline(settings: Record<string, unknown> | null | undefined): string {
  if (!settings) return '-'
  const td = settings.trade_deadline ?? settings.tradeDeadline
  if (td == null) return '-'
  const n = Number(td)
  if (Number.isFinite(n)) {
    if (n === 0) return 'No deadline'
    return `Week ${n}`
  }
  return safeStr(td)
}

function resolveRosterFormat(league: UserLeague, settings: Record<string, unknown> | null | undefined): string {
  if (league.bestBallMode) return 'Best Ball'
  if (league.isDynasty) return 'Dynasty'
  if (league.leagueType === 'keeper' || league.keeperPhaseActive) return 'Keeper'
  if (settings) {
    const rf = settings.roster_type ?? settings.rosterType ?? settings.format
    if (rf) return safeStr(rf)
  }
  if (league.format) return safeStr(league.format)
  return '-'
}

function LeagueRulesSummaryCard({
  league,
  leagueId,
}: {
  league: UserLeague
  leagueId: string
}) {
  const settings =
    league.settings && typeof league.settings === 'object' && !Array.isArray(league.settings)
      ? (league.settings as Record<string, unknown>)
      : null

  const rules: RuleItem[] = [
    {
      icon: <Zap className="h-3.5 w-3.5 text-[#ff3d81]" aria-hidden />,
      label: 'Scoring',
      value: safeStr(league.scoring),
    },
    {
      icon: <RotateCcw className="h-3.5 w-3.5 text-violet-400" aria-hidden />,
      label: 'Waivers',
      value: resolveWaiverType(settings),
    },
    {
      icon: <Calendar className="h-3.5 w-3.5 text-amber-400" aria-hidden />,
      label: 'Trade Deadline',
      value: resolveTradeDeadline(settings),
    },
    {
      icon: <Trophy className="h-3.5 w-3.5 text-yellow-400" aria-hidden />,
      label: 'Playoff Teams',
      value: resolvePlayoffTeams(settings),
    },
    {
      icon: <ClipboardList className="h-3.5 w-3.5 text-emerald-400" aria-hidden />,
      label: 'Roster Format',
      value: resolveRosterFormat(league, settings),
    },
    {
      icon: <Users className="h-3.5 w-3.5 text-blue-400" aria-hidden />,
      label: 'Draft Type',
      value: resolveDraftType(settings, league),
    },
    ...(league.isPaid || (league.entryFee != null && league.entryFee > 0)
      ? [
          {
            icon: <CreditCard className="h-3.5 w-3.5 text-rose-400" aria-hidden />,
            label: 'Entry Fee',
            value:
              league.entryFee != null && league.entryFee > 0
                ? `$${league.entryFee}`
                : 'Paid league',
          },
        ]
      : []),
  ].filter((r) => r.value !== '-')

  if (rules.length === 0) return null

  return (
    <section
      className="card-premium overflow-hidden"
      aria-label="League rules summary"
      data-testid="league-rules-summary"
    >
      <div className="flex items-center justify-between border-b border-subtle px-4 py-3 sm:px-5">
        <h2 className="text-[14px] font-bold text-primary sm:text-[15px]">League Rules</h2>
        <Link
          href={`/league/${encodeURIComponent(leagueId)}?view=settings`}
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-subtle bg-surface-muted text-muted transition hover:bg-surface-hover hover:text-brand-primary"
          aria-label="Open league settings"
        >
          <Settings className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden />
        </Link>
      </div>
      <div className="grid grid-cols-2 gap-px bg-surface-muted sm:grid-cols-3">
        {rules.map((rule) => (
          <div
            key={rule.label}
            className="flex flex-col gap-1 bg-surface px-4 py-3"
          >
            <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-muted">
              {rule.icon}
              {rule.label}
            </div>
            <p className="text-[13px] font-semibold leading-tight text-primary">{rule.value}</p>
          </div>
        ))}
      </div>
    </section>
  )
}

// League tab body

function showSpecialtyAutomationStrip(league: UserLeague): boolean {
  const lt = String((league as { leagueType?: string | null }).leagueType ?? '').toLowerCase()
  const v = String(league.leagueVariant ?? '').toLowerCase()
  if (v && v !== 'standard' && v !== 'redraft' && v !== '') return true
  return ['guillotine', 'survivor', 'zombie', 'tournament', 'big_brother', 'devy', 'c2c', 'royal', 'pirate', 'vampire', 'koth', 'king'].some(
    (k) => lt.includes(k),
  )
}

function teamAvatarSrc(avatarUrl: string | null): string | null {
  if (!avatarUrl?.trim()) return null
  const t = avatarUrl.trim()
  if (t.startsWith('http://') || t.startsWith('https://')) return t
  return `https://sleepercdn.com/avatars/${t}`
}

function teamInitials(team: LeagueTeamSlot): string {
  const raw = team.teamName.trim() || team.ownerName.trim() || '?'
  const parts = raw.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) {
    return (parts[0]![0]! + parts[1]![0]!).toUpperCase()
  }
  return raw.slice(0, 2).toUpperCase()
}

function normalizeActivityLine(value: unknown): LeagueActivityLine | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const r = value as Record<string, unknown>
  const typeRaw = String(r.type ?? '').trim().toLowerCase()
  const type: LeagueActivityLine['type'] =
    typeRaw === 'add' ? 'add' : typeRaw === 'drop' ? 'drop' : 'note'
  return {
    type,
    label: String(r.label ?? ''),
    playerName: typeof r.playerName === 'string' ? r.playerName : null,
    playerMeta: typeof r.playerMeta === 'string' ? r.playerMeta : null,
  }
}

function normalizeLeagueActivityItem(value: unknown): LeagueActivityItem | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const r = value as Record<string, unknown>
  const typeRaw = String(r.type ?? '').trim().toLowerCase()
  const type: LeagueActivityItem['type'] =
    typeRaw === 'waiver' || typeRaw === 'trade' || typeRaw === 'message' ? typeRaw : 'message'
  const lines = Array.isArray(r.lines)
    ? r.lines.map(normalizeActivityLine).filter((x): x is LeagueActivityLine => x != null)
    : []
  return {
    id: String(r.id ?? `evt-${Math.random().toString(36).slice(2)}`),
    type,
    managerName: String(r.managerName ?? 'League'),
    badge: String(r.badge ?? ''),
    badgeTone: 'neutral',
    timestamp: String(r.timestamp ?? ''),
    amountLabel: typeof r.amountLabel === 'string' ? r.amountLabel : null,
    summary: typeof r.summary === 'string' ? r.summary : null,
    lines,
  }
}

function mapActivityRow(item: LeagueActivityItem): LeagueActivityFeedRow {
  const lines = Array.isArray(item.lines) ? item.lines : []
  const addCount = lines.filter((l) => l.type === 'add').length
  const dropCount = lines.filter((l) => l.type === 'drop').length
  const summary = String(item.summary ?? '').trim()
  const combined = `${summary} ${item.badge} ${lines.map((l) => `${l.label} ${l.playerName ?? ''}`).join(' ')}`.toLowerCase()

  if (item.type === 'trade') {
    return {
      id: item.id,
      category: 'trade',
      title: summary.length > 0 ? summary : `${item.managerName} completed a trade`,
      subtitle: 'Recent trade activity',
      timestamp: item.timestamp,
    }
  }

  if (item.type === 'waiver') {
    const kind = item.badge.toLowerCase().includes('free') ? 'Free-agent move' : 'Waiver claim'
    return {
      id: item.id,
      category: addCount > 0 || dropCount > 0 ? 'add_drop' : 'waiver',
      title: `${item.managerName} ${kind.toLowerCase()}`,
      subtitle:
        addCount > 0 || dropCount > 0
          ? `${addCount > 0 ? `${addCount} add${addCount > 1 ? 's' : ''}` : '0 adds'}${dropCount > 0 ? ` · ${dropCount} drop${dropCount > 1 ? 's' : ''}` : ''}`
          : (item.amountLabel ?? kind),
      timestamp: item.timestamp,
    }
  }

  if (combined.includes('draft') || combined.includes('pick')) {
    return {
      id: item.id,
      category: 'draft',
      title: summary.length > 0 ? summary : `${item.managerName} draft pick update`,
      subtitle: 'Draft / pick movement',
      timestamp: item.timestamp,
    }
  }

  if (combined.includes('announcement') || combined.includes('commissioner') || combined.includes('commish')) {
    return {
      id: item.id,
      category: 'announcement',
      title: summary.length > 0 ? summary : `${item.managerName} posted an announcement`,
      subtitle: 'Commissioner / league message',
      timestamp: item.timestamp,
    }
  }

  if (combined.includes('matchup') || combined.includes('score') || combined.includes('scoring')) {
    return {
      id: item.id,
      category: 'scoring',
      title: summary.length > 0 ? summary : 'Scoring update',
      subtitle: 'Matchup / scoring activity',
      timestamp: item.timestamp,
    }
  }

  return {
    id: item.id,
    category: 'generic',
    title: summary.length > 0 ? summary : `${item.managerName} activity update`,
    subtitle: 'League feed event',
    timestamp: item.timestamp,
  }
}

function activityDotClass(category: LeagueActivityFeedRow['category']): string {
  if (category === 'trade') return 'bg-[#ff3d81]'
  if (category === 'waiver') return 'bg-sky-400'
  if (category === 'add_drop') return 'bg-emerald-400'
  if (category === 'draft') return 'bg-violet-400'
  if (category === 'announcement') return 'bg-amber-400'
  if (category === 'scoring') return 'bg-blue-400'
  return 'bg-white/35'
}

type ActivityFeedItem = {
  id: string
  type: string
  title?: string | null
  message: string
  category?: string | null
  createdAt: string
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function mapFeedItemToRow(item: ActivityFeedItem): LeagueActivityFeedRow {
  const cat = String(item.category ?? item.type ?? '').toLowerCase()
  let category: LeagueActivityFeedRow['category'] = 'generic'
  if (cat.includes('trade')) category = 'trade'
  else if (cat.includes('waiver') || cat.includes('add') || cat.includes('drop')) category = 'add_drop'
  else if (cat.includes('draft')) category = 'draft'
  else if (cat.includes('announce') || cat.includes('commissioner')) category = 'announcement'
  else if (cat.includes('score') || cat.includes('matchup')) category = 'scoring'

  return {
    id: item.id,
    category,
    title: item.title?.trim() || item.message?.slice(0, 80) || 'League event',
    subtitle: item.message?.slice(0, 100) ?? '',
    timestamp: relativeTime(item.createdAt),
  }
}

function LeagueActivityFeed({ leagueId }: { leagueId: string }) {
  const [rows, setRows] = useState<LeagueActivityFeedRow[] | null>(null)

  const loadFeed = useCallback(async () => {
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/activity-feed`, { credentials: 'include', cache: 'no-store' })
      if (!res.ok) { setRows([]); return }
      const data = (await res.json()) as { items?: ActivityFeedItem[] }
      const items = Array.isArray(data.items) ? data.items : []
      setRows(items.slice(0, 12).map(mapFeedItemToRow))
    } catch {
      setRows([])
    }
  }, [leagueId])

  useEffect(() => { void loadFeed() }, [loadFeed])

  useLeagueRealtimeRefresh(leagueId, (env) => {
    const t = String(env.eventType ?? '')
    if (t.includes('score') || t.includes('trade') || t.includes('waiver') || t.includes('matchup') || t.includes('player') || t === 'league_changed') {
      void loadFeed()
    }
  })

  return (
    <section
      className="card-premium overflow-hidden"
      aria-label="League activity feed"
      data-testid="league-live-event-feed"
    >
      <div className="border-b border-subtle px-4 py-3 sm:px-5">
        <h2 className="text-[14px] font-bold text-primary sm:text-[15px]">League Activity Feed</h2>
      </div>
      {rows === null ? (
        <div className="space-y-2 px-4 py-4 sm:px-5">
          <div className="h-12 animate-pulse rounded-lg bg-surface-muted" />
          <div className="h-12 animate-pulse rounded-lg bg-surface-muted" />
        </div>
      ) : rows.length === 0 ? (
        <div className="px-4 py-6 text-center sm:px-5">
          <p className="text-[13px] font-semibold text-secondary">No league activity yet</p>
          <p className="mt-1 text-[12px] text-muted">
            Activity will appear here after trades, waiver claims, adds/drops, draft pick moves, or commissioner posts.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-subtle">
          {rows.map((row) => (
            <li key={row.id} className="px-4 py-3 sm:px-5">
              <div className="flex items-start gap-2.5">
                <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${activityDotClass(row.category)}`} aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12px] font-semibold text-primary">{row.title}</p>
                  <p className="mt-0.5 text-[11px] text-muted">{row.subtitle}</p>
                </div>
                <span className="shrink-0 text-[10px] text-muted">{row.timestamp || 'Now'}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function LeagueMembersPreview({
  league,
  teams,
  seasonSnapshot,
}: {
  league: UserLeague
  teams: LeagueTeamSlot[]
  seasonSnapshot: LeagueSeasonSnapshot | null
}) {
  const sortedTeams = useMemo(
    () => sortTeamsForManagerListing(teams, league, seasonSnapshot).slice(0, 10),
    [teams, league, seasonSnapshot],
  )

  return (
    <section
      className="card-premium overflow-hidden"
      aria-label="League members preview"
      data-testid="league-members-preview"
    >
      <div className="flex items-center justify-between border-b border-subtle px-4 py-3 sm:px-5">
        <h2 className="text-[14px] font-bold text-primary sm:text-[15px]">League Members</h2>
        <span className="rounded-full border border-subtle bg-surface-muted px-2 py-0.5 text-[10px] font-semibold text-secondary">
          {league.isPaid ? 'Paid' : 'Free'}
        </span>
      </div>
      {sortedTeams.length === 0 ? (
        <p className="px-4 py-5 text-[12px] text-muted sm:px-5">Managers will appear here once teams are synced.</p>
      ) : (
        <ul className="divide-y divide-subtle">
          {sortedTeams.map((team, i) => {
            const src = teamAvatarSrc(team.avatarUrl)
            const hasRecord = team.wins > 0 || team.losses > 0 || team.ties > 0
            const record = team.ties > 0 ? `${team.wins}-${team.losses}-${team.ties}` : `${team.wins}-${team.losses}`
            const role = String(team.role ?? '').toLowerCase()
            const isCommissioner = role.includes('commish') || role.includes('commissioner')
            return (
              <li key={team.id} className="px-4 py-3 sm:px-5">
                <div className="flex items-center gap-2.5">
                  <span className="w-5 shrink-0 text-center text-[11px] font-bold text-secondary">{i + 1}</span>
                  <div className="relative h-8 w-8 shrink-0 overflow-hidden rounded-full bg-surface-muted">
                    {src ? (
                      <img src={src} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <span className="flex h-full w-full items-center justify-center text-[10px] font-bold text-secondary">
                        {teamInitials(team)}
                      </span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="truncate text-[12px] font-semibold text-primary">{team.teamName || 'Team'}</p>
                      {isCommissioner ? (
                        <span className="rounded border border-amber-400/35 bg-amber-500/12 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-700">
                          Commish
                        </span>
                      ) : null}
                    </div>
                    <p className="truncate text-[11px] text-muted">@{(team.ownerName || 'manager').replace(/^@/, '')}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-[11px] font-semibold text-primary">{hasRecord ? record : '-'}</p>
                    <p className="text-[10px] text-muted">PF {team.pointsFor > 0 ? team.pointsFor.toFixed(1) : '-'}</p>
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

// Phase V1.3: `label`'s highlighted-row text was `text-amber-50/95` — near-white — sitting on a
// near-white `bg-[#fef9c3]/12` highlighted background, i.e. barely-visible text on a barely-visible
// tint. `valueClass`'s "positive" tone was `text-[#ff9ec0]`, the same recurring light-pastel pattern
// fixed repeatedly since V1.0. Both swapped to readable, saturated shades; hues and the highlight
// background are unchanged (a contrast fix, not a meaning change).
function ScoringRow({ label, value, highlight, valueTone }: ScoringRowProps) {
  const valueClass =
    valueTone === 'positive'
      ? 'text-cyan-600'
      : valueTone === 'negative'
        ? 'text-red-600'
        : 'text-secondary'
  return (
    <div
      className={`flex items-center justify-between gap-3 px-4 py-2 ${
        highlight
          ? 'mx-2 rounded-lg border border-yellow-200/25 bg-[#fef9c3]/12'
          : 'border-b border-subtle last:border-b-0'
      }`}
    >
      <span
        className={`min-w-0 text-[12px] ${highlight ? 'text-amber-800' : 'text-muted'}`}
      >
        {label}
      </span>
      <span className={`shrink-0 text-right text-[12px] font-medium ${valueClass}`}>{value}</span>
    </div>
  )
}

export function LeagueTab({
  league,
  teams,
  seasonSnapshot = null,
  leagueDashboard,
  isOwner = false,
  isCommissioner = false,
  inviteToken,
  idpLeagueUi = false,
  userTeam = null,
}: LeagueTabProps) {
  const scoring = leagueDashboard.scoring
  const previewSeason =
    typeof league.season === 'number'
      ? league.season
      : typeof league.season === 'string'
        ? Number.parseInt(league.season, 10) || new Date().getFullYear()
        : new Date().getFullYear()
  const previewWeek = league.currentWeek ?? 1

  // Hero is gated - Tournament hubs, Zombie universes (beta_trio / alpha_hex),
  // and Big Brother leagues use their own specialty homepages.
  const showHomeHero = !isExcludedFromHomeHero(
    (league as { leagueType?: string | null }).leagueType ?? null,
    (league as { leagueVariant?: string | null }).leagueVariant ?? null
  )
  const accent = resolveLeagueAccent(
    (league as { leagueType?: string | null }).leagueType ?? null,
    (league as { leagueVariant?: string | null }).leagueVariant ?? null
  )
  const media = resolveLeagueMedia(
    String(league.sport ?? 'NFL'),
    (league as { leagueType?: string | null }).leagueType ?? null,
    (league as { leagueVariant?: string | null }).leagueVariant ?? null
  )
  const [managerIntelligence, setManagerIntelligence] = useState<ManagerIntelligencePayload | null>(null)
  useEffect(() => {
    let cancelled = false
    void fetch(`/api/decision-os/manager-intelligence?leagueId=${encodeURIComponent(league.id)}`, {
      credentials: 'same-origin',
      cache: 'no-store',
    })
      .then((res) => (res.ok ? (res.json() as Promise<ManagerIntelligencePayload>) : null))
      .then((data) => {
        if (!cancelled) setManagerIntelligence(data)
      })
      .catch(() => {
        if (!cancelled) setManagerIntelligence(null)
      })
    return () => {
      cancelled = true
    }
  }, [league.id])
  // Honesty Pack: sufficiency is decided by the ENGINE, not here. buildLeagueHomePulse
  // returns an explicit insufficient-data pulse (e.g. zero claimed teams) and
  // LeaguePulseCard renders that state honestly — no UI-side predicate can disagree.
  const leaguePulse = useMemo(
    () =>
      buildLeagueHomePulse({
        league,
        teams,
        isCommissioner: Boolean(isCommissioner),
        managerDna: managerIntelligence?.managerDna ?? null,
      }),
    [isCommissioner, league, teams, managerIntelligence]
  )
  const managerDna = useMemo(
    () => buildManagerDnaViewModel({ source: managerIntelligence?.managerDna ?? null }),
    [managerIntelligence],
  )
  const recommendations = useMemo(
    () => buildDecisionRecommendationsViewModel({ source: managerIntelligence?.recommendations ?? null }),
    [managerIntelligence],
  )
  const [userOs, setUserOs] = useState<UserOsSnapshot | null>(null)
  useEffect(() => {
    let cancelled = false
    void fetch(`/api/decision-os/user-os?leagueId=${encodeURIComponent(league.id)}`, {
      credentials: 'same-origin',
      cache: 'no-store',
    })
      .then((res) => (res.ok ? (res.json() as Promise<UserOsSnapshot>) : null))
      .then((data) => {
        if (!cancelled) setUserOs(data)
      })
      .catch(() => {
        if (!cancelled) setUserOs(null)
      })
    return () => {
      cancelled = true
    }
  }, [league.id])

  return (
    <div className="space-y-4 p-5">
      {/* Decision OS launchers — Manager Intelligence (all members; entry shown only when the
          hub client flag is on) + Commissioner "League Intelligence" (member-readable; the
          commissioner-only cards are API-gated with 403 + an honest restricted state in the hub).
          League home is the LAUNCHER — it does not duplicate hub contents.
          Phase V1.1: heading/detail text was `text-violet-100`/`text-[#ffd7e5]` and `text-*-200/60` —
          a light pastel palette tuned for a dark background, the same class of light-mode contrast bug
          found and fixed on Commissioner Hub in Phase V1.0 (docs/os/VISUAL_OS_V1_AUDIT.md Finding 3/4).
          Body text now routes through `text-primary`/`text-secondary`; only the icon+arrow keep a
          readable, saturated accent color instead of a light one, preserving the violet/cyan visual
          distinction between the two launchers. */}
      <section className="grid gap-3 sm:grid-cols-2" aria-label="League intelligence">
        {process.env.NEXT_PUBLIC_MANAGER_INTELLIGENCE_HUB_ENABLED === 'true' ? (
          <Link
            href={`/league/${league.id}/manager-hub`}
            data-testid="nav-manager-intelligence"
            className="focus-ring flex items-start justify-between gap-3 rounded-2xl border border-violet-500/25 bg-violet-500/10 px-4 py-3 hover:bg-violet-500/15"
          >
            <span className="min-w-0">
              <span className="flex items-center gap-2 text-[13px] font-semibold text-primary">
                <Zap className="h-4 w-4 shrink-0 text-violet-600" aria-hidden /> Manager Intelligence
              </span>
              <span className="mt-0.5 block text-[11px] text-secondary">
                Roster health, weekly outlook, transactions, and historical decision patterns.
              </span>
            </span>
            <span aria-hidden className="shrink-0 text-violet-600">-&gt;</span>
          </Link>
        ) : null}
        <Link
          href={`/league/${league.id}/intelligence`}
          data-testid="nav-commissioner-intelligence"
          className="focus-ring flex items-start justify-between gap-3 rounded-2xl border border-status-info/25 bg-status-info/10 px-4 py-3 hover:bg-status-info/15"
        >
          <span className="min-w-0">
            <span className="flex items-center gap-2 text-[13px] font-semibold text-primary">
              <Trophy className="h-4 w-4 shrink-0 text-status-info" aria-hidden /> League Intelligence
            </span>
            <span className="mt-0.5 block text-[11px] text-secondary">
              League health, activity, trade-review workload, rules, and audit history.
            </span>
          </span>
          <span aria-hidden className="shrink-0 text-status-info">-&gt;</span>
        </Link>
      </section>
      {showHomeHero ? (
        <>
          <LeagueHomeHero
            league={league}
            teams={teams}
            accent={accent}
            media={media}
            userTeam={userTeam}
          />
          <LeagueHomeQuickCards
            leagueId={league.id}
            accent={accent}
            myTeamId={userTeam?.id ?? null}
          />
        </>
      ) : null}
      <LeaguePulseCard pulse={leaguePulse} variant="league" compact />
      <section className="grid gap-4 xl:grid-cols-2" aria-label="Manager guidance">
        <ManagerDnaCard profile={managerDna} variant="league" compact />
        <DecisionRecommendationsCard model={recommendations} variant="league" compact />
      </section>
      <UserOsCard snapshot={userOs} variant="league" />
      <LeagueScoringPreviews leagueId={league.id} season={previewSeason} week={previewWeek} />
      {showSpecialtyAutomationStrip(league) ? (
        <SpecialtyLeagueAutomationSection
          leagueId={league.id}
          season={previewSeason}
          week={previewWeek}
          isCommissioner={Boolean(isCommissioner)}
          conceptLabel={String((league as { leagueType?: string | null }).leagueType ?? 'Specialty format')}
        />
      ) : null}
      {/* Sleeper-style standings preview - compact card before draft/activity */}
      {teams.length > 0 ? (
        <LeagueManagersStandingsSection
          league={league}
          leagueId={league.id}
          teams={teams}
          seasonSnapshot={seasonSnapshot ?? null}
          standingsPresentation={leagueDashboard.standings}
          showDraftPositions={false}
        />
      ) : null}

      {/* Recent transactions / activity feed */}
      <LeagueRecentActivity leagueId={league.id} />

      {/* Sleeper-style dense feed with defensive fallback for unavailable event types. */}
      <LeagueActivityFeed leagueId={league.id} />

      {/* Compact league member roll-up: avatar, role, standing/record hints. */}
      <LeagueMembersPreview league={league} teams={teams} seasonSnapshot={seasonSnapshot ?? null} />

      {/* Sleeper-style rules snapshot - scoring, waivers, trade deadline, etc. */}
      <LeagueRulesSummaryCard league={league} leagueId={league.id} />

      <DraftTab
        mode="league"
        league={league}
        teams={teams}
        isOwner={isOwner}
        isCommissioner={isCommissioner}
        inviteToken={inviteToken}
        idpLeagueUi={idpLeagueUi}
        seasonSnapshot={seasonSnapshot}
        standingsPresentation={leagueDashboard.standings}
      />

      <section
        className="card-premium overflow-hidden"
        aria-label="League settings"
        data-testid="league-settings-summary"
      >
        <div className="flex items-center justify-between border-b border-subtle px-4 py-3 sm:px-5">
          <h2 className="text-[14px] font-bold text-primary sm:text-[15px]">League Settings</h2>
          <Link
            href={`/league/${encodeURIComponent(league.id)}?view=settings`}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-subtle bg-surface-muted text-muted transition hover:bg-surface-hover hover:text-brand-primary"
            aria-label="Open league settings"
            data-testid="league-settings-summary-gear"
          >
            <Settings className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden />
          </Link>
        </div>
        <div className="max-h-[min(520px,55vh)] overflow-y-auto [scrollbar-gutter:stable]">
          <div className="divide-y divide-subtle">
            {leagueDashboard.settingsRows.map((row) => (
              <div
                key={row.label}
                className={`flex gap-3 px-4 py-3 sm:px-5 ${row.multiline ? 'items-start' : 'items-center justify-between'}`}
              >
                <span className="min-w-0 shrink text-[12px] text-secondary">{row.label}</span>
                <span
                  className={`text-right text-[12px] font-semibold text-primary ${
                    row.multiline ? 'max-w-[min(100%,20rem)] whitespace-pre-line' : 'min-w-0'
                  }`}
                >
                  {row.value}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section
        className="card-premium overflow-hidden"
        aria-label="Scoring settings"
        data-testid="league-scoring-summary"
      >
        <div className="flex items-center justify-between border-b border-subtle px-4 py-3 sm:px-5">
          <h2 className="text-[14px] font-bold text-primary">Scoring</h2>
          <Link
            href={`/league/${encodeURIComponent(league.id)}?view=settings`}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-subtle bg-surface-muted text-muted transition hover:bg-surface-hover hover:text-brand-primary"
            aria-label="Open league settings to edit scoring"
            data-testid="league-scoring-summary-gear"
          >
            <Settings className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden />
          </Link>
        </div>

        <p className="border-b border-subtle px-4 py-2.5 text-[11px] leading-snug text-muted sm:px-5">
          {scoring == null ? (
            <>Scoring details are unavailable for this league.</>
          ) : scoring.nonStandardCount > 0 ? (
            <>
              Non-standard scoring settings (vs this format's defaults) are{' '}
              <span className="text-amber-700">highlighted</span>.
            </>
          ) : (
            <>
              Matches the <span className="text-secondary">{scoring.formatType}</span> template defaults
              for this sport - change scoring in League Settings to customize.
            </>
          )}
        </p>

        {!scoring || scoring.sections.length === 0 ? (
          <p className="px-4 py-4 text-[12px] text-muted sm:px-5">
            {scoring ? 'No scoring rules to display.' : 'Could not load scoring configuration.'}
          </p>
        ) : (
          <div className="pb-2">
            {scoring.sections.map((section) => (
              <div key={section.title} className="px-0 pb-1">
                <p className="px-4 pt-3 text-[10px] font-bold uppercase tracking-wider text-muted sm:px-5">
                  {section.title}
                </p>
                <div className="mt-1 space-y-0.5">
                  {section.rows.map((row, idx) => (
                    <ScoringRow
                      key={`${section.title}-${row.label}-${idx}`}
                      label={row.label}
                      value={row.value}
                      highlight={row.highlight}
                      valueTone={row.valueTone}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Depth Chart panel */}
      <DepthChartPanel sport={String(league.sport)} team={teams[0]?.teamName ?? undefined} />
    </div>
  )
}
