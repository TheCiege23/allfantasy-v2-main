'use client'

/**
 * app/dashboard/universal/UniversalLeaguesBoard.tsx
 *
 * The universal B2C league board (prototype). Renders every league the user plays —
 * across all platforms and sports — with filters, grouping, per-league health / next
 * action, and a "connect more platforms" strip.
 *
 * Insights here are honest, rule-based signals derived from real league fields
 * (status, draft date, roster legality, commissioner role, trade deadline). They are a
 * deliberate starting point that the Decision OS replaces with deeper analysis later —
 * nothing is fabricated.
 */

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  Search,
  Trophy,
  ShieldCheck,
  AlertTriangle,
  Layers,
  Globe2,
  Plus,
} from 'lucide-react'
import type { UserLeague } from '@/app/dashboard/types'
import { PriorityByPlatform } from './components/PriorityByPlatform'
import { DynastyPlanetSearch } from './components/DynastyPlanetSearch'
import { PortfolioAnalytics } from './components/PortfolioAnalytics'
import { LeagueCards } from './components/LeagueCards'
import { LegacyModules } from './components/LegacyModules'
import { PremiumToolsPreview } from './components/PremiumToolsPreview'

type BoardLeague = UserLeague & { navigationLeagueId?: string | null }

type GroupMode = 'none' | 'sport' | 'platform'

// ---------------------------------------------------------------------------
// Platform + sport presentation
// ---------------------------------------------------------------------------

const PLATFORM_LABELS: Record<string, string> = {
  sleeper: 'Sleeper',
  espn: 'ESPN',
  yahoo: 'Yahoo',
  cbs: 'CBS',
  fantrax: 'Fantrax',
  mfl: 'MyFantasyLeague',
  fleaflicker: 'Fleaflicker',
  nfl: 'NFL.com',
  underdog: 'Underdog',
  leaguetycoon: 'League Tycoon',
  allfantasy: 'AllFantasy',
  af: 'AllFantasy',
  manual: 'AllFantasy',
}

function platformLabel(platform: string | undefined): string {
  const key = String(platform ?? '').toLowerCase()
  return PLATFORM_LABELS[key] ?? (platform ? String(platform) : 'Other')
}

function sportLabel(sport: string | undefined): string {
  const s = String(sport ?? '').trim()
  if (!s) return '—'
  return s.toUpperCase()
}

// Full connect catalog reflecting the universal vision. `importable` platforms route
// to the existing /import flow; others are shown honestly as upcoming.
const CONNECT_CATALOG: { id: string; label: string; importable: boolean }[] = [
  { id: 'sleeper', label: 'Sleeper', importable: true },
  { id: 'espn', label: 'ESPN', importable: true },
  { id: 'yahoo', label: 'Yahoo', importable: true },
  { id: 'fantrax', label: 'Fantrax', importable: true },
  { id: 'mfl', label: 'MyFantasyLeague', importable: true },
  { id: 'fleaflicker', label: 'Fleaflicker', importable: true },
  { id: 'cbs', label: 'CBS Sports', importable: false },
  { id: 'nfl', label: 'NFL.com', importable: false },
  { id: 'leaguetycoon', label: 'League Tycoon', importable: false },
  { id: 'underdog', label: 'Underdog', importable: false },
]

// ---------------------------------------------------------------------------
// Derived per-league signal
// ---------------------------------------------------------------------------

type SignalTone = 'attention' | 'info' | 'good'

interface LeagueSignal {
  tone: SignalTone
  label: string
}

function statusLabel(status: string | undefined | null): string {
  const s = String(status ?? '').toLowerCase()
  if (s === 'pre_draft' || s === 'predraft' || s === 'setup') return 'Pre-draft'
  if (s === 'drafting') return 'Drafting'
  if (s === 'in_season' || s === 'inseason') return 'In season'
  if (s === 'complete' || s === 'completed') return 'Complete'
  if (s === 'playoffs') return 'Playoffs'
  if (!s) return '—'
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function deriveSignal(league: BoardLeague, rosterIssues: number): LeagueSignal {
  if (rosterIssues > 0) {
    return {
      tone: 'attention',
      label: `${rosterIssues} lineup issue${rosterIssues === 1 ? '' : 's'} to fix`,
    }
  }

  const status = String(league.status ?? league.lifecycleState ?? '').toLowerCase()

  if (status === 'pre_draft' || status === 'predraft' || status === 'setup') {
    if (league.draftDate) {
      const when = formatDate(league.draftDate)
      return { tone: 'info', label: when ? `Draft ${when}` : 'Draft scheduled' }
    }
    return { tone: 'attention', label: 'Draft not scheduled' }
  }

  if (status === 'drafting') {
    return { tone: 'attention', label: 'Draft in progress' }
  }

  if (status === 'in_season' || status === 'inseason' || status === 'playoffs') {
    if (typeof league.currentWeek === 'number' && league.currentWeek > 0) {
      return { tone: 'good', label: `In season · Week ${league.currentWeek}` }
    }
    return { tone: 'good', label: statusLabel(status) }
  }

  if (status === 'complete' || status === 'completed') {
    return { tone: 'info', label: 'Season complete' }
  }

  return { tone: 'info', label: statusLabel(league.status) }
}

function formatDate(iso: string | null | undefined): string | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return null
  try {
    return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function UniversalLeaguesBoard({
  leagues,
  guestSleeperUsername = null,
}: {
  leagues: BoardLeague[]
  guestSleeperUsername?: string | null
}) {
  const [search, setSearch] = useState('')
  const [sportFilter, setSportFilter] = useState<string | null>(null)
  const [platformFilter, setPlatformFilter] = useState<string | null>(null)
  const [groupMode, setGroupMode] = useState<GroupMode>('sport')
  const [rosterIssues, setRosterIssues] = useState<Record<string, number>>({})

  // Real "needs attention" signal — same source the sidebar league list uses.
  useEffect(() => {
    let cancelled = false
    fetch('/api/user/roster-legality-summary', { cache: 'no-store', credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { counts?: Record<string, number> } | null) => {
        if (!cancelled && j?.counts && typeof j.counts === 'object') setRosterIssues(j.counts)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const sports = useMemo(() => {
    const set = new Set<string>()
    for (const l of leagues) set.add(sportLabel(l.sport))
    return Array.from(set).sort()
  }, [leagues])

  const platforms = useMemo(() => {
    const set = new Set<string>()
    for (const l of leagues) set.add(String(l.platform ?? '').toLowerCase())
    return Array.from(set).filter(Boolean).sort()
  }, [leagues])

  const connectedPlatformSet = useMemo(() => new Set(platforms), [platforms])

  const commissionerCount = useMemo(
    () => leagues.filter((l) => l.isCommissioner || l.userRole === 'commissioner').length,
    [leagues],
  )

  const attentionCount = useMemo(
    () =>
      leagues.filter((l) => deriveSignal(l, rosterIssues[l.id] ?? 0).tone === 'attention').length,
    [leagues, rosterIssues],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return leagues.filter((l) => {
      if (sportFilter && sportLabel(l.sport) !== sportFilter) return false
      if (platformFilter && String(l.platform ?? '').toLowerCase() !== platformFilter) return false
      if (q) {
        const hay = `${l.name ?? ''} ${platformLabel(l.platform)} ${sportLabel(l.sport)}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [leagues, search, sportFilter, platformFilter])

  const groups = useMemo(() => {
    if (groupMode === 'none') {
      return [{ key: 'All leagues', items: filtered }]
    }
    const map = new Map<string, BoardLeague[]>()
    for (const l of filtered) {
      const key = groupMode === 'sport' ? sportLabel(l.sport) : platformLabel(l.platform)
      const arr = map.get(key)
      if (arr) arr.push(l)
      else map.set(key, [l])
    }
    return Array.from(map.entries())
      .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
      .map(([key, items]) => ({ key, items }))
  }, [filtered, groupMode])

  return (
    <div className="text-white">
      <div>
        {/* Summary tiles */}
        <section className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile icon={Trophy} label="Leagues" value={leagues.length} />
          <StatTile icon={Globe2} label="Platforms" value={connectedPlatformSet.size} />
          <StatTile icon={Layers} label="Sports" value={sports.length} />
          <StatTile
            icon={ShieldCheck}
            label="You commission"
            value={commissionerCount}
          />
        </section>

        {leagues.length === 0 ? (
          <EmptyState guestMode={Boolean(guestSleeperUsername)} />
        ) : (
          <>
            <PriorityByPlatform leagues={leagues} rosterIssues={rosterIssues} />
            <div className="mt-8">
              <DynastyPlanetSearch leagues={leagues} />
            </div>
            <div className="mt-8">
              <PortfolioAnalytics leagues={leagues} />
            </div>

            {/* Controls */}
            <section className="mb-5 space-y-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="relative w-full max-w-sm">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" />
                  <input
                    type="search"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search leagues, platforms, sports…"
                    className="w-full rounded-xl border border-white/[0.09] bg-white/[0.04] py-2.5 pl-9 pr-3 text-[13px] text-white placeholder:text-white/35 focus:border-cyan-400/40 focus:outline-none"
                  />
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="mr-1 text-[11px] font-semibold uppercase tracking-wider text-white/35">
                    Group by
                  </span>
                  {(['sport', 'platform', 'none'] as GroupMode[]).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setGroupMode(mode)}
                      className={`rounded-full border px-3 py-1 text-[11px] font-semibold capitalize transition ${
                        groupMode === mode
                          ? 'border-cyan-400/50 bg-cyan-500/15 text-cyan-100'
                          : 'border-white/10 bg-white/[0.03] text-white/50 hover:border-white/20'
                      }`}
                    >
                      {mode === 'none' ? 'Flat' : mode}
                    </button>
                  ))}
                </div>
              </div>

              {(attentionCount > 0 || sports.length > 1 || platforms.length > 1) && (
                <div className="flex flex-wrap items-center gap-1.5">
                  {attentionCount > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/25 bg-amber-500/10 px-2.5 py-1 text-[11px] font-semibold text-amber-200">
                      <AlertTriangle className="h-3 w-3" aria-hidden />
                      {attentionCount} need attention
                    </span>
                  )}
                  <FilterChip
                    active={sportFilter === null && platformFilter === null}
                    onClick={() => {
                      setSportFilter(null)
                      setPlatformFilter(null)
                    }}
                    label="All"
                  />
                  {sports.map((s) => (
                    <FilterChip
                      key={`sport-${s}`}
                      active={sportFilter === s}
                      onClick={() => setSportFilter(sportFilter === s ? null : s)}
                      label={s}
                    />
                  ))}
                  {platforms.map((p) => (
                    <FilterChip
                      key={`plat-${p}`}
                      active={platformFilter === p}
                      onClick={() => setPlatformFilter(platformFilter === p ? null : p)}
                      label={platformLabel(p)}
                    />
                  ))}
                </div>
              )}
            </section>

            {/* Groups */}
            {filtered.length === 0 ? (
              <p className="rounded-2xl border border-white/[0.07] bg-white/[0.02] px-4 py-10 text-center text-[13px] text-white/40">
                No leagues match your filters.
              </p>
            ) : (
              <div className="space-y-7">
                {groups.map((group) => (
                  <section key={group.key}>
                    {groupMode !== 'none' && (
                      <div className="mb-3 flex items-center gap-2">
                        <h2 className="text-[13px] font-bold uppercase tracking-wider text-white/70">
                          {group.key}
                        </h2>
                        <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[11px] font-semibold text-white/40">
                          {group.items.length}
                        </span>
                      </div>
                    )}
                    <LeagueCards leagues={group.items} rosterIssues={rosterIssues} />
                  </section>
                ))}
              </div>
            )}
          </>
        )}

        <div className="mt-8">
          <LegacyModules leagues={leagues} guestSleeperUsername={guestSleeperUsername} />
        </div>
        <PremiumToolsPreview />

        {/* Connect strip */}
        <section className="mt-10 rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5">
          <div className="mb-1 flex items-center gap-2">
            <Globe2 className="h-4 w-4 text-cyan-300" aria-hidden />
            <h2 className="text-[13px] font-bold uppercase tracking-wider text-white/70">
              Connect more platforms
            </h2>
          </div>
          <p className="mb-4 text-[12px] text-white/45">
            Pull in leagues from every platform you play. Connected platforms sync automatically;
            more are on the way.
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {CONNECT_CATALOG.map((p) => {
              const connected = connectedPlatformSet.has(p.id)
              return (
                <div
                  key={p.id}
                  className="flex items-center justify-between gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2.5"
                >
                  <span className="min-w-0 truncate text-[12px] font-semibold text-white/80">
                    {p.label}
                  </span>
                  {connected ? (
                    <span className="shrink-0 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold uppercase text-emerald-300">
                      Synced
                    </span>
                  ) : p.importable ? (
                    <Link
                      href="/import?returnTo=/dashboard/universal"
                      className="inline-flex shrink-0 items-center gap-0.5 rounded-full border border-cyan-400/30 bg-cyan-500/10 px-2 py-0.5 text-[10px] font-bold uppercase text-cyan-200 hover:bg-cyan-500/20"
                    >
                      <Plus className="h-3 w-3" aria-hidden />
                      Connect
                    </Link>
                  ) : (
                    <span className="shrink-0 rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] font-bold uppercase text-white/35">
                      Soon
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        </section>

        <p className="mt-5 text-center text-[11px] text-white/30">
          Insights shown are live status signals from your real leagues. Deeper, settings-aware
          recommendations and manager-tendency history layer on next.
        </p>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Subcomponents
// ---------------------------------------------------------------------------

function StatTile({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Trophy
  label: string
  value: number
}) {
  return (
    <div className="rounded-2xl border border-white/[0.07] bg-white/[0.03] px-4 py-3">
      <div className="flex items-center gap-1.5 text-white/40">
        <Icon className="h-3.5 w-3.5" aria-hidden />
        <span className="text-[10px] font-bold uppercase tracking-wider">{label}</span>
      </div>
      <p className="mt-1 text-[24px] font-black leading-none text-white">{value}</p>
    </div>
  )
}

function FilterChip({
  active,
  onClick,
  label,
}: {
  active: boolean
  onClick: () => void
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold transition ${
        active
          ? 'border-cyan-400/50 bg-cyan-500/15 text-cyan-100'
          : 'border-white/10 bg-white/[0.03] text-white/50 hover:border-white/20'
      }`}
    >
      {label}
    </button>
  )
}

function EmptyState({ guestMode }: { guestMode: boolean }) {
  if (guestMode) {
    return (
      <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] px-6 py-14 text-center">
        <Trophy className="mx-auto h-8 w-8 text-white/25" aria-hidden />
        <h2 className="mt-3 text-[16px] font-bold text-white">No Sleeper leagues found for that username</h2>
        <p className="mx-auto mt-1 max-w-sm text-[13px] text-white/45">
          Your Legacy Score below is real — pulled from your Sleeper history. Sign up free to save this preview
          and connect more leagues from ESPN, Yahoo, and more.
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <Link
            href="/signup?next=%2Fdashboard%2Funiversal"
            className="rounded-xl bg-cyan-500/90 px-4 py-2 text-[13px] font-bold text-[#04121a] hover:bg-cyan-400"
          >
            Sign up free
          </Link>
        </div>
      </div>
    )
  }
  return (
    <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] px-6 py-14 text-center">
      <Trophy className="mx-auto h-8 w-8 text-white/25" aria-hidden />
      <h2 className="mt-3 text-[16px] font-bold text-white">No leagues connected yet</h2>
      <p className="mx-auto mt-1 max-w-sm text-[13px] text-white/45">
        Import your leagues from Sleeper, ESPN, Yahoo, and more — then see them all in one place with
        health and next-action insight.
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        <Link
          href="/import?returnTo=/dashboard/universal"
          className="rounded-xl bg-cyan-500/90 px-4 py-2 text-[13px] font-bold text-[#04121a] hover:bg-cyan-400"
        >
          Import a league
        </Link>
        <Link
          href="/create-league"
          className="rounded-xl border border-white/12 px-4 py-2 text-[13px] font-semibold text-white/80 hover:bg-white/[0.05]"
        >
          Create a league
        </Link>
      </div>
    </div>
  )
}
