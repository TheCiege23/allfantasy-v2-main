"use client"

import { useCallback, useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { Inbox, Loader2, ShieldAlert } from "lucide-react"
import { DiscoverySearchBar } from "./DiscoverySearchBar"
import { DiscoveryFilters } from "./DiscoveryFilters"
import { LeagueDiscoveryCard } from "./LeagueDiscoveryCard"
import { TrendingLeaguesSection } from "./TrendingLeaguesSection"
import { RecommendedLeaguesSection } from "./RecommendedLeaguesSection"
import { CreatorDiscoverySection } from "./CreatorDiscoverySection"
import type {
  DiscoveryCard,
  DiscoveryFormat,
  DiscoverySort,
  EntryFeeFilter,
  LeagueStyleFilter,
} from "@/lib/public-discovery/types"

export interface PublicLeagueDiscoveryPageProps {
  defaultSport?: string
}

interface DiscoveryResponse {
  leagues?: DiscoveryCard[]
  total?: number
  totalPages?: number
  hasMore?: boolean
  viewerTier?: number
  viewerTierName?: string
  hiddenByTierPolicy?: number
}

export function PublicLeagueDiscoveryPage({
  defaultSport = "",
}: PublicLeagueDiscoveryPageProps) {
  const searchParams = useSearchParams()
  const [searchInput, setSearchInput] = useState("")
  const [query, setQuery] = useState("")
  const [sport, setSport] = useState(defaultSport)
  const [format, setFormat] = useState<DiscoveryFormat>("all")
  const [style, setStyle] = useState<LeagueStyleFilter>("all")
  const [sort, setSort] = useState<DiscoverySort>("popularity")
  const [entryFee, setEntryFee] = useState<EntryFeeFilter>("all")
  const [page, setPage] = useState(1)
  const [leagues, setLeagues] = useState<DiscoveryCard[]>([])
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [viewerTier, setViewerTier] = useState<number | null>(null)
  const [viewerTierName, setViewerTierName] = useState<string | null>(null)
  const [hiddenByTierPolicy, setHiddenByTierPolicy] = useState(0)
  const [loading, setLoading] = useState(true)

  const fetchLeagues = useCallback(
    async (nextPage: number, nextQuery: string = query) => {
      setLoading(true)
      const params = new URLSearchParams()
      if (nextQuery.trim()) params.set("q", nextQuery.trim())
      if (sport) params.set("sport", sport)
      params.set("format", format)
      params.set("style", style)
      params.set("sort", sort)
      params.set("entryFee", entryFee)
      params.set("page", String(nextPage))
      params.set("limit", "12")

      try {
        const response = await fetch(`/api/discover/leagues?${params.toString()}`)
        const payload = (await response.json().catch(() => ({}))) as DiscoveryResponse
        setLeagues(Array.isArray(payload.leagues) ? payload.leagues : [])
        setTotal(payload.total ?? 0)
        setTotalPages(payload.totalPages ?? 1)
        setHasMore(payload.hasMore === true)
        setViewerTier(typeof payload.viewerTier === "number" ? payload.viewerTier : null)
        setViewerTierName(payload.viewerTierName ?? null)
        setHiddenByTierPolicy(payload.hiddenByTierPolicy ?? 0)
      } catch {
        setLeagues([])
        setTotal(0)
        setTotalPages(0)
        setHasMore(false)
        setHiddenByTierPolicy(0)
      } finally {
        setLoading(false)
      }
    },
    [entryFee, format, query, sort, sport, style]
  )

  useEffect(() => {
    fetchLeagues(page)
  }, [fetchLeagues, page])

  useEffect(() => {
    if (defaultSport) setSport(defaultSport)
  }, [defaultSport])

  useEffect(() => {
    const sportParam = searchParams?.get("sport") ?? ""
    const formatParam = (searchParams?.get("format") as DiscoveryFormat | null) ?? "all"
    const styleParam = (searchParams?.get("style") as LeagueStyleFilter | null) ?? "all"

    if (sportParam) setSport(sportParam)
    setFormat(formatParam)
    setStyle(styleParam)
  }, [searchParams])

  const refreshSearch = useCallback(() => {
    const nextQuery = searchInput.trim()
    setQuery(nextQuery)
    if (page === 1) {
      void fetchLeagues(1, nextQuery)
      return
    }
    setPage(1)
  }, [fetchLeagues, page, searchInput])

  return (
    <div className="space-y-8" data-testid="public-league-discovery-page">
      <section
        className="rounded-[28px] border p-5 sm:p-6"
        style={{
          borderColor: "var(--border)",
          background:
            "linear-gradient(145deg, color-mix(in srgb, var(--accent) 10%, var(--panel)) 0%, color-mix(in srgb, var(--panel2) 16%, var(--panel)) 100%)",
        }}
        data-testid="discovery-ranking-banner"
      >
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <p
              className="text-xs font-semibold uppercase tracking-[0.24em]"
              style={{ color: "var(--muted)" }}
            >
              Rank-matched discovery
            </p>
            <h2 className="mt-2 text-xl font-semibold" style={{ color: "var(--text)" }}>
              Discover leagues built for your current level
            </h2>
            <p className="mt-2 text-sm" style={{ color: "var(--muted)" }}>
              {viewerTierName
                ? `You are currently Tier ${viewerTier} - ${viewerTierName}. You can browse and join leagues within two levels of yours, above or below. A commissioner can still let you into a league outside that range.`
                : "Your AllFantasy ranking controls which public leagues appear here. Commissioner invites can still unlock leagues outside your normal range."}
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:min-w-[280px]">
            <div
              className="rounded-2xl border px-4 py-3"
              style={{ borderColor: "var(--border)", background: "rgba(255,255,255,0.04)" }}
            >
              <p className="text-xs uppercase tracking-[0.18em]" style={{ color: "var(--muted)" }}>
                Your tier
              </p>
              <p className="mt-2 text-lg font-semibold" style={{ color: "var(--text)" }}>
                {viewerTier != null ? `Tier ${viewerTier}` : "Tier loading"}
              </p>
              {viewerTierName ? (
                <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
                  {viewerTierName}
                </p>
              ) : null}
            </div>

            <div
              className="rounded-2xl border px-4 py-3"
              style={{ borderColor: "var(--border)", background: "rgba(255,255,255,0.04)" }}
            >
              <p className="text-xs uppercase tracking-[0.18em]" style={{ color: "var(--muted)" }}>
                Hidden by rank
              </p>
              <p
                className="mt-2 text-lg font-semibold"
                style={{ color: hiddenByTierPolicy > 0 ? "rgb(251, 146, 60)" : "var(--text)" }}
              >
                {hiddenByTierPolicy}
              </p>
              <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
                Leagues outside your current join window
              </p>
            </div>
          </div>
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px] xl:items-start">
        <DiscoverySearchBar value={searchInput} onChange={setSearchInput} onSubmit={refreshSearch} />
        <DiscoveryFilters
          sport={sport}
          format={format}
          style={style}
          sort={sort}
          entryFee={entryFee}
          onSportChange={(value) => {
            setSport(value)
            setPage(1)
          }}
          onFormatChange={(value) => {
            setFormat(value)
            setPage(1)
          }}
          onStyleChange={(value) => {
            setStyle(value)
            setPage(1)
          }}
          onSortChange={(value) => {
            setSort(value)
            setPage(1)
          }}
          onEntryFeeChange={(value) => {
            setEntryFee(value)
            setPage(1)
          }}
        />
      </div>

      <TrendingLeaguesSection sport={sport || undefined} limit={6} />
      <RecommendedLeaguesSection sport={sport || undefined} limit={6} />
      <CreatorDiscoverySection sport={sport || undefined} limit={6} />

      <section data-testid="discovery-results-section">
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold" style={{ color: "var(--text)" }}>
              All leagues
            </h2>
            <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
              {loading ? "Refreshing rank-matched leagues..." : `${total} leagues available in your current discovery pool.`}
            </p>
          </div>

          {hiddenByTierPolicy > 0 ? (
            <div
              className="inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold"
              style={{
                borderColor: "rgba(251, 146, 60, 0.35)",
                background: "rgba(251, 146, 60, 0.12)",
                color: "rgb(251, 146, 60)",
              }}
            >
              <ShieldAlert className="h-3.5 w-3.5" />
              {hiddenByTierPolicy} leagues need a commissioner invite
            </div>
          ) : null}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12" data-testid="discovery-loading-state">
            <Loader2 className="h-8 w-8 animate-spin" style={{ color: "var(--muted)" }} />
          </div>
        ) : leagues.length === 0 ? (
          <div
            className="rounded-3xl border border-dashed p-12 text-center"
            style={{ borderColor: "var(--border)" }}
            data-testid="discovery-empty-state"
          >
            <Inbox className="mx-auto mb-3 h-12 w-12" style={{ color: "var(--muted)" }} />
            <p className="font-medium" style={{ color: "var(--text)" }}>
              No leagues match your filters
            </p>
            <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
              Try another sport, switch league style, or widen the search terms.
            </p>
          </div>
        ) : (
          <>
            <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3" data-testid="discovery-results-grid">
              {leagues.map((league) => (
                <LeagueDiscoveryCard key={`${league.source}-${league.id}`} league={league} />
              ))}
            </div>

            {totalPages > 1 ? (
              <div
                className="mt-6 flex flex-wrap items-center justify-center gap-2"
                data-testid="discovery-pagination"
              >
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                  data-testid="discovery-pagination-prev"
                  className="rounded-xl border px-3.5 py-2.5 text-sm font-medium disabled:opacity-50"
                  style={{ borderColor: "var(--border)", color: "var(--text)" }}
                >
                  Previous
                </button>
                <span className="px-3 py-2 text-sm" style={{ color: "var(--muted)" }}>
                  Page {page} of {totalPages}
                </span>
                <button
                  type="button"
                  disabled={page >= totalPages}
                  onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                  data-testid="discovery-pagination-next"
                  className="rounded-xl border px-3.5 py-2.5 text-sm font-medium disabled:opacity-50"
                  style={{ borderColor: "var(--border)", color: "var(--text)" }}
                >
                  Next
                </button>
              </div>
            ) : hasMore ? (
              <div className="mt-6 flex justify-center" data-testid="discovery-pagination">
                <button
                  type="button"
                  onClick={() => setPage((current) => current + 1)}
                  data-testid="discovery-pagination-next"
                  className="rounded-xl border px-3.5 py-2.5 text-sm font-medium"
                  style={{ borderColor: "var(--border)", color: "var(--text)" }}
                >
                  Load more
                </button>
              </div>
            ) : null}
          </>
        )}
      </section>
    </div>
  )
}
