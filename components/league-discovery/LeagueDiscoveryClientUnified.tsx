'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { Search, Trophy, TrendingUp, Sparkles, UserPlus, ChevronRight, Loader2, Wand2 } from 'lucide-react'
import { SUPPORTED_SPORTS } from '@/lib/sport-scope'
import { trackDiscoveryJoinClick } from '@/lib/discovery-analytics/client'
import { getFanCredBoundaryDisclosureShort } from '@/lib/legal/FanCredBoundaryDisclosure'
import type {
  DiscoveryCard,
  DiscoveryFormat,
  DiscoverySort,
  EntryFeeFilter,
  LeagueStyleFilter,
} from '@/lib/public-discovery/types'

const SORT_OPTIONS = [
  { value: 'popularity', label: 'Popular' },
  { value: 'newest', label: 'Newest' },
  { value: 'filling_fast', label: 'Filling fast' },
]
const FORMAT_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'fantasy', label: 'Fantasy' },
  { value: 'bracket', label: 'Bracket' },
  { value: 'creator', label: 'Creator' },
]
const STYLE_OPTIONS = [
  { value: 'all', label: 'Any style' },
  { value: 'dynasty', label: 'Dynasty' },
  { value: 'redraft', label: 'Redraft' },
  { value: 'best_ball', label: 'Best Ball' },
  { value: 'keeper', label: 'Keeper' },
  { value: 'survivor', label: 'Survivor' },
  { value: 'bracket', label: 'Bracket' },
  { value: 'community', label: 'Community' },
]
const ENTRY_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'free', label: 'Free' },
  { value: 'paid', label: 'Paid' },
]

interface OrphanCard {
  id: string
  name: string
  sport: string
  leagueSize: number
  isDynasty: boolean
  joinUrl: string
  fillPct: number
  memberCount: number
}

interface RecommendationCard {
  league: DiscoveryCard
  explanation: string | null
  reasons?: string[]
  explanationSource?: 'deterministic' | 'ai'
}

function DiscoveryCardItem({ card, showJoin }: { card: DiscoveryCard; showJoin?: boolean }) {
  const hasAI = Array.isArray(card.aiFeatures) && card.aiFeatures.length > 0
  const paidBoundaryDisclosure = getFanCredBoundaryDisclosureShort()
  return (
    <Link
      href={showJoin ? card.joinUrl : card.detailUrl}
      onClick={() => {
        if (!showJoin) return
        trackDiscoveryJoinClick({
          leagueId: card.id,
          source: card.source,
          leagueName: card.name,
          sport: card.sport,
          joinUrl: card.joinUrl,
        })
      }}
      className="block rounded-xl border border-white/10 bg-gradient-to-br from-[#0b1731] to-[#081124] p-3 sm:p-4 hover:bg-white/[0.06] transition"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-sm sm:text-base text-white truncate">{card.name}</h3>
          <p className="text-xs text-white/50 mt-0.5">{card.memberCount}/{card.maxMembers} teams</p>
          <div className="flex flex-wrap gap-1 mt-1.5 sm:mt-2">
            <span className="text-[11px] px-1.5 sm:px-2 py-0.5 rounded-full bg-white/10 text-white/80">{card.sport}</span>
            <span className="text-[11px] px-1.5 sm:px-2 py-0.5 rounded-full bg-sky-500/20 text-sky-200 capitalize">
              {String(card.leagueStyle ?? card.leagueType ?? card.source).replace(/_/g, " ")}
            </span>
            {card.isPaid && (
              <span
                className="text-[11px] px-1.5 sm:px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300"
                title={paidBoundaryDisclosure}
              >
                Paid
              </span>
            )}
            {!card.isPaid && (
              <span className="text-[11px] px-1.5 sm:px-2 py-0.5 rounded-full bg-white/10 text-white/70">Free</span>
            )}
            <span className="text-[11px] px-1.5 sm:px-2 py-0.5 rounded-full bg-white/10 text-white/70">{card.fillPct}% full</span>
            {hasAI && (
              <span className="inline-flex items-center gap-1 text-[11px] px-1.5 sm:px-2 py-0.5 rounded-full bg-violet-500/20 text-violet-200">
                <Sparkles className="h-3 w-3" />
                AI-enabled
              </span>
            )}
          </div>
          {card.isPaid ? (
            <p className="mt-1 text-[11px] text-amber-200/75">Paid dues and payouts are external via FanCred.</p>
          ) : null}
        </div>
        <ChevronRight className="h-[18px] w-[18px] sm:h-5 sm:w-5 text-white/30 shrink-0" />
      </div>
    </Link>
  )
}

function OrphanCardItem({ card }: { card: OrphanCard }) {
  return (
    <Link
      href={card.joinUrl}
      className="block rounded-xl border border-violet-500/20 bg-violet-500/5 p-3 sm:p-4 hover:bg-violet-500/10 transition"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <UserPlus className="h-4 w-4 text-violet-400 shrink-0" />
            <h3 className="font-semibold text-sm sm:text-base text-white truncate">{card.name}</h3>
          </div>
          <p className="text-xs text-white/50 mt-0.5">
            {card.sport} · {card.memberCount}/{card.leagueSize} · {card.isDynasty ? 'Dynasty' : 'Redraft'}
          </p>
          <span className="text-[11px] px-1.5 sm:px-2 py-0.5 rounded-full bg-violet-500/20 text-violet-300 mt-1.5 sm:mt-2 inline-block">
            Seeking manager
          </span>
        </div>
        <ChevronRight className="h-[18px] w-[18px] sm:h-5 sm:w-5 text-violet-400/70 shrink-0" />
      </div>
    </Link>
  )
}

export default function LeagueDiscoveryClientUnified() {
  const [trending, setTrending] = useState<DiscoveryCard[]>([])
  const [recommended, setRecommended] = useState<RecommendationCard[]>([])
  const [orphans, setOrphans] = useState<OrphanCard[]>([])
  const [browse, setBrowse] = useState<DiscoveryCard[]>([])
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(0)
  const [loadingTrending, setLoadingTrending] = useState(true)
  const [loadingRec, setLoadingRec] = useState(true)
  const [loadingOrphans, setLoadingOrphans] = useState(true)
  const [loadingBrowse, setLoadingBrowse] = useState(false)
  const [sport, setSport] = useState('')
  const [format, setFormat] = useState<DiscoveryFormat>('all')
  const [style, setStyle] = useState<LeagueStyleFilter>('all')
  const [entryFee, setEntryFee] = useState<EntryFeeFilter>('all')
  const [sort, setSort] = useState<DiscoverySort>('popularity')
  const [searchInput, setSearchInput] = useState('')
  const [appliedQuery, setAppliedQuery] = useState('')
  const [recommendationAiExplainEnabled, setRecommendationAiExplainEnabled] = useState(false)
  const [page, setPage] = useState(1)
  const limit = 12

  useEffect(() => {
    setLoadingTrending(true)
    const params = new URLSearchParams()
    params.set('limit', '6')
    if (sport) params.set('sport', sport)
    fetch(`/api/discover/trending?${params.toString()}`)
      .then((r) => r.json())
      .then((d) => setTrending(d.leagues ?? []))
      .finally(() => setLoadingTrending(false))
  }, [sport])

  useEffect(() => {
    setLoadingRec(true)
    const params = new URLSearchParams()
    params.set('limit', '6')
    if (sport) params.set('sport', sport)
    if (recommendationAiExplainEnabled) params.set('aiExplain', '1')
    fetch(`/api/discover/recommendations?${params.toString()}`)
      .then((r) => r.json())
      .then((d) => {
        if (!Array.isArray(d.leagues)) {
          setRecommended([])
          return
        }
        setRecommended(
          d.leagues.map((item: RecommendationCard) => ({
            league: item.league,
            explanation: item.explanation ?? null,
            reasons: Array.isArray(item.reasons) ? item.reasons.slice(0, 2) : [],
            explanationSource: item.explanationSource === 'ai' ? 'ai' : 'deterministic',
          }))
        )
      })
      .finally(() => setLoadingRec(false))
  }, [recommendationAiExplainEnabled, sport])

  useEffect(() => {
    setLoadingOrphans(true)
    const params = new URLSearchParams()
    params.set('limit', '6')
    if (sport) params.set('sport', sport)
    fetch(`/api/discover/orphans?${params.toString()}`)
      .then((r) => r.json())
      .then((d) => setOrphans(d.leagues ?? []))
      .finally(() => setLoadingOrphans(false))
  }, [sport])

  const fetchBrowse = useCallback(
    (requestedPage: number) => {
      setLoadingBrowse(true)
      const params = new URLSearchParams()
      if (appliedQuery.trim()) params.set('q', appliedQuery.trim())
      if (sport) params.set('sport', sport)
      if (format !== 'all') params.set('format', format)
      if (style !== 'all') params.set('style', style)
      if (entryFee !== 'all') params.set('entryFee', entryFee)
      params.set('sort', sort)
      params.set('page', String(requestedPage))
      params.set('limit', String(limit))
      fetch(`/api/discover/leagues?${params.toString()}`)
        .then((r) => r.json())
        .then((d) => {
          setBrowse(d.leagues ?? [])
          setTotal(d.total ?? 0)
          setTotalPages(d.totalPages ?? 1)
        })
        .finally(() => setLoadingBrowse(false))
    },
    [appliedQuery, sport, format, style, entryFee, sort]
  )

  useEffect(() => {
    fetchBrowse(page)
  }, [page, fetchBrowse])

  return (
    <div className="space-y-8">
      {/* Trending */}
      <section>
        <h2 className="flex items-center gap-2 text-sm font-semibold text-white mb-3">
          <TrendingUp className="h-4 w-4 text-amber-400" />
          Trending
        </h2>
        {loadingTrending ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-white/40" />
          </div>
        ) : trending.length === 0 ? (
          <p className="text-sm text-white/50">No trending leagues right now.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {trending.map((card) => (
              <DiscoveryCardItem key={`${card.source}-${card.id}`} card={card} showJoin />
            ))}
          </div>
        )}
      </section>

      {/* Recommended (AI / personalized) */}
      <section>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
            <Sparkles className="h-4 w-4 text-cyan-400" />
            Recommended for you
          </h2>
          <button
            type="button"
            onClick={() => setRecommendationAiExplainEnabled((value) => !value)}
            className="inline-flex items-center gap-1 rounded-lg border border-white/20 px-2.5 py-1.5 text-[11px] font-semibold text-white/80 hover:bg-white/5"
            data-testid="discovery-recommendations-ai-toggle"
          >
            <Wand2 className="h-3.5 w-3.5" />
            {recommendationAiExplainEnabled ? 'AI explanations on' : 'AI explanations off'}
          </button>
        </div>
        <p className="text-[11px] text-white/50 mb-3">
          Deterministic-first recommendations from your sports, league history, draft activity, league types, and AI usage.
        </p>
        {loadingRec ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-white/40" />
          </div>
        ) : recommended.length === 0 ? (
          <p className="text-sm text-white/50">Sign in for personalized picks, or browse below.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {recommended.map((item, i) => (
              <div key={`rec-${item.league.source}-${item.league.id}-${i}`}>
                <DiscoveryCardItem card={item.league} showJoin />
                {item.explanation && (
                  <p className="mt-1 text-[11px] text-white/50 line-clamp-2">{item.explanation}</p>
                )}
                {Array.isArray(item.reasons) && item.reasons.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {item.reasons.map((reason) => (
                      <span
                        key={`${item.league.id}-${reason}`}
                        className="rounded-full border border-white/15 px-2 py-0.5 text-[11px] text-white/70"
                      >
                        {reason}
                      </span>
                    ))}
                  </div>
                )}
                <p className="mt-1 text-[11px] uppercase tracking-[0.08em] text-white/35">
                  {item.explanationSource === 'ai' ? 'AI-enhanced explanation' : 'Deterministic explanation'}
                </p>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Orphan teams */}
      <section>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
            <UserPlus className="h-4 w-4 text-violet-400" />
            Orphan teams
          </h2>
          {sport ? (
            <span className="rounded-lg border border-white/10 bg-black/20 px-2.5 py-1 text-[11px] text-white/70">
              Sport filter: {sport}
            </span>
          ) : null}
        </div>
        <p className="text-xs text-white/50 mb-3">Leagues seeking a manager. Join and take over an open team.</p>
        {loadingOrphans ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-white/40" />
          </div>
        ) : orphans.length === 0 ? (
          <p className="text-sm text-white/50">No orphan leagues listed right now.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {orphans.map((card) => (
              <OrphanCardItem key={card.id} card={card} />
            ))}
          </div>
        )}
      </section>

      {/* Browse with filters */}
      <section>
        <h2 className="flex items-center gap-2 text-sm font-semibold text-white mb-3">
          <Trophy className="h-4 w-4 text-emerald-400" />
          Browse public leagues
        </h2>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            setPage(1)
            setAppliedQuery(searchInput.trim())
          }}
          className="space-y-3 mb-4"
        >
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <div className="relative flex-1 min-w-[140px] sm:min-w-[180px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/40 pointer-events-none" />
              <input
                type="search"
                placeholder="Search leagues..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="w-full rounded-lg border border-white/10 bg-black/30 pl-9 pr-3 py-2.5 text-sm text-white placeholder:text-white/40"
                aria-label="Search"
              />
            </div>
            <button
              type="submit"
              className="rounded-lg border border-cyan-500/40 bg-cyan-500/20 px-4 py-2.5 text-sm font-medium text-cyan-200 hover:bg-cyan-500/30 min-h-[40px]"
            >
              Search
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={sport}
              onChange={(e) => {
                setSport(e.target.value)
                setPage(1)
              }}
              className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white min-h-[40px]"
              aria-label="Sport"
            >
              <option value="">All sports</option>
              {SUPPORTED_SPORTS.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <select
              value={format}
              onChange={(e) => {
                setFormat(e.target.value as DiscoveryFormat)
                setPage(1)
              }}
              className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white min-h-[40px]"
              aria-label="Type"
            >
              {FORMAT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <select
              value={style}
              onChange={(e) => {
                setStyle(e.target.value as LeagueStyleFilter)
                setPage(1)
              }}
              className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white min-h-[40px]"
              aria-label="League style"
            >
              {STYLE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <select
              value={entryFee}
              onChange={(e) => {
                setEntryFee(e.target.value as EntryFeeFilter)
                setPage(1)
              }}
              className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white min-h-[40px]"
              aria-label="Paid / Free"
            >
              {ENTRY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <select
              value={sort}
              onChange={(e) => {
                setSort(e.target.value as DiscoverySort)
                setPage(1)
              }}
              className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white min-h-[40px]"
              aria-label="Sort"
            >
              {SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => {
                setSport('')
                setFormat('all')
                setStyle('all')
                setEntryFee('all')
                setSort('popularity')
                setSearchInput('')
                setAppliedQuery('')
                setPage(1)
              }}
              className="rounded-lg border border-white/15 bg-white/[0.04] px-3 py-2 text-sm text-white/75 hover:bg-white/[0.08]"
              data-testid="discovery-clear-filters-button"
            >
              Clear filters
            </button>
          </div>
        </form>
        {loadingBrowse ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-white/40" />
          </div>
        ) : browse.length === 0 ? (
          <p className="text-sm text-white/50 py-6">No leagues match your filters.</p>
        ) : (
          <>
            <p className="text-xs text-white/50 mb-3">{total} league{total !== 1 ? 's' : ''} found</p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {browse.map((card) => (
                <DiscoveryCardItem key={`${card.source}-${card.id}`} card={card} showJoin />
              ))}
            </div>
            {totalPages > 1 && (
              <nav className="flex flex-wrap items-center justify-center gap-2 pt-6" aria-label="Pagination">
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="rounded-lg border border-white/20 px-3 py-2 text-sm text-white disabled:opacity-40"
                >
                  Previous
                </button>
                <span className="text-sm text-white/50">Page {page} of {totalPages}</span>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="rounded-lg border border-white/20 px-3 py-2 text-sm text-white disabled:opacity-40"
                >
                  Next
                </button>
              </nav>
            )}
          </>
        )}
      </section>
    </div>
  )
}
