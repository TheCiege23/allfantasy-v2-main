'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
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

export type LeagueTabProps = {
  league: UserLeague
  teams: LeagueTeamSlot[]
  seasonSnapshot?: LeagueSeasonSnapshot | null
  leagueDashboard: LeagueDashboardView
  isOwner?: boolean
  isCommissioner?: boolean
  inviteToken?: string
  idpLeagueUi?: boolean
  /** Current user's team in the league — used by the home hero. Plumbed from LeagueShell. */
  userTeam?: { id: string; teamName?: string | null } | null
  /** Dashboard iframe — draft entry posts to parent for full-screen overlay. */
  dashboardEmbed?: boolean
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

// ─── League Rules Summary Card ───────────────────────────────────────────────

type RuleItem = { icon: React.ReactNode; label: string; value: string }

function safeStr(v: unknown, fallback = '—'): string {
  if (v == null) return fallback
  const s = String(v).trim()
  return s.length > 0 ? s : fallback
}

function resolveWaiverType(settings: Record<string, unknown> | null | undefined): string {
  if (!settings) return '—'
  const wt = settings.waiver_type ?? settings.waiverType
  if (wt == null) return '—'
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
  return '—'
}

function resolvePlayoffTeams(settings: Record<string, unknown> | null | undefined): string {
  if (!settings) return '—'
  const p = settings.playoff_teams ?? settings.playoffTeams ?? settings.num_playoff_teams
  if (p == null) return '—'
  const n = Number(p)
  return Number.isFinite(n) && n > 0 ? String(n) : safeStr(p)
}

function resolveTradeDeadline(settings: Record<string, unknown> | null | undefined): string {
  if (!settings) return '—'
  const td = settings.trade_deadline ?? settings.tradeDeadline
  if (td == null) return '—'
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
  return '—'
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
      icon: <Zap className="h-3.5 w-3.5 text-cyan-400" aria-hidden />,
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
  ].filter((r) => r.value !== '—')

  if (rules.length === 0) return null

  return (
    <section
      className="overflow-hidden rounded-2xl border border-white/[0.08] bg-[#1e2436]"
      aria-label="League rules summary"
      data-testid="league-rules-summary"
    >
      <div className="flex items-center justify-between border-b border-white/[0.07] px-4 py-3 sm:px-5">
        <h2 className="text-[14px] font-bold text-white sm:text-[15px]">League Rules</h2>
        <Link
          href={`/league/${encodeURIComponent(leagueId)}?view=settings`}
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/[0.1] bg-[#12192e] text-white/55 transition hover:bg-white/[0.06] hover:text-cyan-200"
          aria-label="Open league settings"
        >
          <Settings className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden />
        </Link>
      </div>
      <div className="grid grid-cols-2 gap-px bg-white/[0.04] sm:grid-cols-3">
        {rules.map((rule) => (
          <div
            key={rule.label}
            className="flex flex-col gap-1 bg-[#1e2436] px-4 py-3"
          >
            <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-white/40">
              {rule.icon}
              {rule.label}
            </div>
            <p className="text-[13px] font-semibold leading-tight text-white/90">{rule.value}</p>
          </div>
        ))}
      </div>
    </section>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

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
  if (category === 'trade') return 'bg-cyan-400'
  if (category === 'waiver') return 'bg-sky-400'
  if (category === 'add_drop') return 'bg-emerald-400'
  if (category === 'draft') return 'bg-violet-400'
  if (category === 'announcement') return 'bg-amber-400'
  if (category === 'scoring') return 'bg-blue-400'
  return 'bg-white/35'
}

function LeagueActivityFeed({ leagueId }: { leagueId: string }) {
  const [rows, setRows] = useState<LeagueActivityFeedRow[] | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/leagues/${encodeURIComponent(leagueId)}/activity`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('activity'))))
      .then((data: unknown) => {
        if (cancelled) return
        const parsed = Array.isArray(data)
          ? data
              .map(normalizeLeagueActivityItem)
              .filter((x): x is LeagueActivityItem => x != null)
              .map(mapActivityRow)
          : []
        setRows(parsed.slice(0, 10))
      })
      .catch(() => {
        if (!cancelled) setRows([])
      })
    return () => {
      cancelled = true
    }
  }, [leagueId])

  return (
    <section
      className="overflow-hidden rounded-2xl border border-white/[0.08] bg-[#121826]"
      aria-label="League activity feed"
      data-testid="league-activity-feed"
    >
      <div className="border-b border-white/[0.07] px-4 py-3 sm:px-5">
        <h2 className="text-[14px] font-bold text-white sm:text-[15px]">League Activity Feed</h2>
      </div>
      {rows === null ? (
        <div className="space-y-2 px-4 py-4 sm:px-5">
          <div className="h-12 animate-pulse rounded-lg bg-white/[0.04]" />
          <div className="h-12 animate-pulse rounded-lg bg-white/[0.04]" />
        </div>
      ) : rows.length === 0 ? (
        <div className="px-4 py-6 text-center sm:px-5">
          <p className="text-[13px] font-semibold text-white/80">No league activity yet</p>
          <p className="mt-1 text-[12px] text-white/45">
            Activity will appear here after trades, waiver claims, adds/drops, draft pick moves, or commissioner posts.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-white/[0.06]">
          {rows.map((row) => (
            <li key={row.id} className="px-4 py-3 sm:px-5">
              <div className="flex items-start gap-2.5">
                <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${activityDotClass(row.category)}`} aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12px] font-semibold text-white/90">{row.title}</p>
                  <p className="mt-0.5 text-[11px] text-white/45">{row.subtitle}</p>
                </div>
                <span className="shrink-0 text-[10px] text-white/35">{row.timestamp || 'Now'}</span>
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
      className="overflow-hidden rounded-2xl border border-white/[0.08] bg-[#121826]"
      aria-label="League members preview"
      data-testid="league-members-preview"
    >
      <div className="flex items-center justify-between border-b border-white/[0.07] px-4 py-3 sm:px-5">
        <h2 className="text-[14px] font-bold text-white sm:text-[15px]">League Members</h2>
        <span className="rounded-full border border-white/[0.1] px-2 py-0.5 text-[10px] font-semibold text-white/55">
          {league.isPaid ? 'Paid' : 'Free'}
        </span>
      </div>
      {sortedTeams.length === 0 ? (
        <p className="px-4 py-5 text-[12px] text-white/45 sm:px-5">Managers will appear here once teams are synced.</p>
      ) : (
        <ul className="divide-y divide-white/[0.06]">
          {sortedTeams.map((team, i) => {
            const src = teamAvatarSrc(team.avatarUrl)
            const hasRecord = team.wins > 0 || team.losses > 0 || team.ties > 0
            const record = team.ties > 0 ? `${team.wins}-${team.losses}-${team.ties}` : `${team.wins}-${team.losses}`
            const role = String(team.role ?? '').toLowerCase()
            const isCommissioner = role.includes('commish') || role.includes('commissioner')
            return (
              <li key={team.id} className="px-4 py-3 sm:px-5">
                <div className="flex items-center gap-2.5">
                  <span className="w-5 shrink-0 text-center text-[11px] font-bold text-white/55">{i + 1}</span>
                  <div className="relative h-8 w-8 shrink-0 overflow-hidden rounded-full bg-white/10">
                    {src ? (
                      <img src={src} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <span className="flex h-full w-full items-center justify-center text-[10px] font-bold text-white/70">
                        {teamInitials(team)}
                      </span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="truncate text-[12px] font-semibold text-white/90">{team.teamName || 'Team'}</p>
                      {isCommissioner ? (
                        <span className="rounded border border-amber-400/35 bg-amber-500/12 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-200">
                          Commish
                        </span>
                      ) : null}
                    </div>
                    <p className="truncate text-[11px] text-white/45">@{(team.ownerName || 'manager').replace(/^@/, '')}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-[11px] font-semibold text-white/85">{hasRecord ? record : '—'}</p>
                    <p className="text-[10px] text-white/35">PF {team.pointsFor > 0 ? team.pointsFor.toFixed(1) : '—'}</p>
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

function ScoringRow({ label, value, highlight, valueTone }: ScoringRowProps) {
  const valueClass =
    valueTone === 'positive'
      ? 'text-cyan-300'
      : valueTone === 'negative'
        ? 'text-red-400/95'
        : 'text-white/65'
  return (
    <div
      className={`flex items-center justify-between gap-3 px-4 py-2 ${
        highlight
          ? 'mx-2 rounded-lg border border-yellow-200/25 bg-[#fef9c3]/12'
          : 'border-b border-white/[0.05] last:border-b-0'
      }`}
    >
      <span
        className={`min-w-0 text-[12px] ${highlight ? 'text-amber-50/95' : 'text-white/50'}`}
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
  dashboardEmbed = false,
}: LeagueTabProps) {
  const scoring = leagueDashboard.scoring
  const previewSeason =
    typeof league.season === 'number'
      ? league.season
      : typeof league.season === 'string'
        ? Number.parseInt(league.season, 10) || new Date().getFullYear()
        : new Date().getFullYear()
  const previewWeek = league.currentWeek ?? 1

  // Hero is gated — Tournament hubs, Zombie universes (beta_trio / alpha_hex),
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

  return (
    <div className="space-y-4 p-5">
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
      {/* Sleeper-style standings preview — compact card before draft/activity */}
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

      {/* Sleeper-style rules snapshot — scoring, waivers, trade deadline, etc. */}
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
        dashboardEmbed={dashboardEmbed}
      />

      <section
        className="overflow-hidden rounded-2xl border border-white/[0.08] bg-[#1e2436]"
        aria-label="League settings"
        data-testid="league-settings-summary"
      >
        <div className="flex items-center justify-between border-b border-white/[0.07] px-4 py-3 sm:px-5">
          <h2 className="text-[14px] font-bold text-white sm:text-[15px]">League Settings</h2>
          <Link
            href={`/league/${encodeURIComponent(league.id)}?view=settings`}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/[0.1] bg-[#12192e] text-white/55 transition hover:bg-white/[0.06] hover:text-cyan-200"
            aria-label="Open league settings"
            data-testid="league-settings-summary-gear"
          >
            <Settings className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden />
          </Link>
        </div>
        <div className="max-h-[min(520px,55vh)] overflow-y-auto [scrollbar-gutter:stable]">
          <div className="divide-y divide-white/[0.06]">
            {leagueDashboard.settingsRows.map((row) => (
              <div
                key={row.label}
                className={`flex gap-3 px-4 py-3 sm:px-5 ${row.multiline ? 'items-start' : 'items-center justify-between'}`}
              >
                <span className="min-w-0 shrink text-[12px] text-white/55">{row.label}</span>
                <span
                  className={`text-right text-[12px] font-semibold text-white/95 ${
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
        className="overflow-hidden rounded-2xl border border-white/[0.07] bg-[#0c0c1e]"
        aria-label="Scoring settings"
        data-testid="league-scoring-summary"
      >
        <div className="flex items-center justify-between border-b border-white/[0.07] px-4 py-3 sm:px-5">
          <h2 className="text-[14px] font-bold text-white">Scoring</h2>
          <Link
            href={`/league/${encodeURIComponent(league.id)}?view=settings`}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/[0.1] bg-[#12192e] text-white/55 transition hover:bg-white/[0.06] hover:text-cyan-200"
            aria-label="Open league settings to edit scoring"
            data-testid="league-scoring-summary-gear"
          >
            <Settings className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden />
          </Link>
        </div>

        <p className="border-b border-white/[0.05] px-4 py-2.5 text-[11px] leading-snug text-white/45 sm:px-5">
          {scoring == null ? (
            <>Scoring details are unavailable for this league.</>
          ) : scoring.nonStandardCount > 0 ? (
            <>
              Non-standard scoring settings (vs this format’s defaults) are{' '}
              <span className="text-yellow-100/90">highlighted</span>.
            </>
          ) : (
            <>
              Matches the <span className="text-white/70">{scoring.formatType}</span> template defaults
              for this sport — change scoring in League Settings to customize.
            </>
          )}
        </p>

        {!scoring || scoring.sections.length === 0 ? (
          <p className="px-4 py-4 text-[12px] text-white/45 sm:px-5">
            {scoring ? 'No scoring rules to display.' : 'Could not load scoring configuration.'}
          </p>
        ) : (
          <div className="pb-2">
            {scoring.sections.map((section) => (
              <div key={section.title} className="px-0 pb-1">
                <p className="px-4 pt-3 text-[10px] font-bold uppercase tracking-wider text-white/45 sm:px-5">
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
