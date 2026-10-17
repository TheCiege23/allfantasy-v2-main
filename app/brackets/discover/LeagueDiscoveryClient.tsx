"use client"

import { useState, useEffect, useCallback } from "react"
import Link from "next/link"
import { Search, Trophy, Users, ChevronRight, Loader2 } from "lucide-react"
import { getLeagueFilterOptions } from "@/lib/league-discovery/LeagueFilterResolver"
import type { LeagueCard } from "@/lib/league-discovery/types"
import { getFanCredBoundaryDisclosureShort } from "@/lib/legal/FanCredBoundaryDisclosure"
import { resolveBracketChallengeLabel, resolveBracketSportUI } from "@/lib/bracket-challenge"

const SCORING_LABELS: Record<string, string> = {
  fancred_edge: "AF Edge",
  momentum: "Momentum",
  accuracy_boldness: "Accuracy + Boldness",
  streak_survival: "Streak & Survival",
}

export default function LeagueDiscoveryClient() {
  const paidBoundaryDisclosure = getFanCredBoundaryDisclosureShort()
  const [query, setQuery] = useState("")
  const [sport, setSport] = useState("")
  const [leagueType, setLeagueType] = useState("")
  const [entryFee, setEntryFee] = useState("")
  const [visibility, setVisibility] = useState("")
  const [difficulty, setDifficulty] = useState("")
  const [page, setPage] = useState(1)
  const [leagues, setLeagues] = useState<LeagueCard[]>([])
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(0)
  const [loading, setLoading] = useState(true)

  const options = getLeagueFilterOptions()

  const fetchLeagues = useCallback(async (p: number) => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (query.trim()) params.set("q", query.trim())
      if (sport) params.set("sport", sport)
      if (leagueType) params.set("leagueType", leagueType)
      if (entryFee) params.set("entryFee", entryFee)
      if (visibility) params.set("visibility", visibility)
      if (difficulty) params.set("difficulty", difficulty)
      params.set("page", String(p))
      params.set("limit", "12")
      const res = await fetch(`/api/bracket/discover?${params.toString()}`)
      if (res.ok) {
        const data = await res.json()
        setLeagues(data.leagues ?? [])
        setTotal(data.total ?? 0)
        setTotalPages(data.totalPages ?? 1)
      }
    } catch {
      setLeagues([])
      setTotal(0)
      setTotalPages(0)
    } finally {
      setLoading(false)
    }
  }, [query, sport, leagueType, entryFee, visibility, difficulty])

  useEffect(() => {
    fetchLeagues(page)
  }, [page, fetchLeagues])

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setPage(1)
    fetchLeagues(1)
  }

  return (
    <div className="space-y-6">
      <form onSubmit={handleSearchSubmit} className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: "var(--muted)" }} />
          <input
            type="search"
            placeholder="Search by league or tournament name..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full rounded-xl border pl-10 pr-4 py-2.5 text-sm"
            style={{ borderColor: "var(--border)", background: "var(--panel)", color: "var(--text)" }}
          />
        </div>
        <button
          type="submit"
          className="rounded-xl border px-4 py-2.5 text-sm font-medium"
          style={{ borderColor: "var(--border)", color: "var(--text)" }}
        >
          Search
        </button>
      </form>

      <div className="flex flex-wrap gap-3">
        <select
          value={sport}
          onChange={(e) => { setSport(e.target.value); setPage(1) }}
          className="rounded-lg border px-3 py-2 text-sm"
          style={{ borderColor: "var(--border)", background: "var(--panel)", color: "var(--text)" }}
          aria-label="Filter by sport"
        >
          <option value="">All sports</option>
          {options.sports.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <select
          value={leagueType}
          onChange={(e) => { setLeagueType(e.target.value); setPage(1) }}
          className="rounded-lg border px-3 py-2 text-sm"
          style={{ borderColor: "var(--border)", background: "var(--panel)", color: "var(--text)" }}
          aria-label="Filter by league type"
        >
          <option value="">All types</option>
          {options.leagueTypes.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <select
          value={entryFee}
          onChange={(e) => { setEntryFee(e.target.value); setPage(1) }}
          className="rounded-lg border px-3 py-2 text-sm"
          style={{ borderColor: "var(--border)", background: "var(--panel)", color: "var(--text)" }}
          aria-label="Filter by entry fee"
        >
          {options.entryFees.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <select
          value={visibility}
          onChange={(e) => { setVisibility(e.target.value); setPage(1) }}
          className="rounded-lg border px-3 py-2 text-sm"
          style={{ borderColor: "var(--border)", background: "var(--panel)", color: "var(--text)" }}
          aria-label="Filter by visibility"
        >
          {options.visibilities.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <select
          value={difficulty}
          onChange={(e) => { setDifficulty(e.target.value); setPage(1) }}
          className="rounded-lg border px-3 py-2 text-sm"
          style={{ borderColor: "var(--border)", background: "var(--panel)", color: "var(--text)" }}
          aria-label="Filter by difficulty"
        >
          {options.difficulties.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin" style={{ color: "var(--muted)" }} />
        </div>
      ) : leagues.length === 0 ? (
        <div className="rounded-2xl border p-12 text-center" style={{ borderColor: "var(--border)" }}>
          <Trophy className="h-12 w-12 mx-auto mb-3" style={{ color: "var(--muted)" }} />
          <p className="font-medium" style={{ color: "var(--text)" }}>No pools found</p>
          <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
            Try changing filters or search terms.
          </p>
        </div>
      ) : (
        <>
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            {total} league{total !== 1 ? "s" : ""} found
          </p>
          <ul className="grid gap-4 sm:grid-cols-2">
            {leagues.map((league) => {
              const sportUI = resolveBracketSportUI(league.sport)
              const challengeLabel = resolveBracketChallengeLabel({
                sport: league.sport,
                bracketType: league.bracketType,
                challengeType: league.challengeType,
              })
              return (
                <li key={league.id}>
                <Link
                  href={`/brackets/leagues/${league.id}`}
                  className="block rounded-xl border p-4 transition hover:opacity-90 touch-manipulation min-h-[44px]"
                  style={{ borderColor: "var(--border)", background: "color-mix(in srgb, var(--panel) 80%, transparent)", color: "var(--text)" }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <h3 className="font-semibold truncate">{league.name}</h3>
                      <p className="text-xs mt-0.5 truncate" style={{ color: "var(--muted)" }}>
                        {league.tournamentName}
                        {league.season ? ` · ${league.season}` : ""}
                      </p>
                      <p className="text-[11px] mt-1 truncate" style={{ color: "var(--muted)" }}>
                        {challengeLabel}
                      </p>
                      <div className="flex flex-wrap gap-2 mt-2">
                        <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full" style={{ background: "color-mix(in srgb, var(--accent) 15%, transparent)", color: "var(--accent)" }}>
                          <span className="font-semibold">{sportUI.badge}</span>
                          <span>{sportUI.shortLabel}</span>
                        </span>
                        <span className="text-[11px] px-2 py-0.5 rounded-full" style={{ background: "var(--panel2)", color: "var(--muted)" }}>
                          {SCORING_LABELS[league.scoringMode] ?? league.scoringMode}
                        </span>
                        {league.isPaidLeague && (
                          <span
                            className="text-[11px] px-2 py-0.5 rounded-full"
                            style={{ background: "color-mix(in srgb, #22c55e 12%, transparent)", color: "#22c55e" }}
                            title={paidBoundaryDisclosure}
                          >
                            Paid
                          </span>
                        )}
                        {league.isPrivate && (
                          <span className="text-[11px] px-2 py-0.5 rounded-full" style={{ color: "var(--muted)" }}>Private</span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-2 text-xs" style={{ color: "var(--muted)" }}>
                        <span className="inline-flex items-center gap-1">
                          <Users className="h-3.5 w-3.5" />
                          {league.memberCount}/{league.maxManagers}
                        </span>
                        <span>by {league.ownerName}</span>
                      </div>
                      {league.isPaidLeague ? (
                        <p className="mt-2 text-[11px]" style={{ color: "rgba(250, 204, 21, 0.75)" }}>
                          Paid league dues and payouts are managed externally via FanCred.
                        </p>
                      ) : null}
                    </div>
                    <ChevronRight className="h-5 w-5 shrink-0" style={{ color: "var(--muted)" }} />
                  </div>
                </Link>
                </li>
              )
            })}
          </ul>

          {totalPages > 1 && (
            <nav className="flex flex-wrap items-center justify-center gap-2 pt-6" aria-label="Pagination">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="rounded-lg border px-3 py-2.5 min-h-[44px] text-sm font-medium disabled:opacity-40 touch-manipulation"
                style={{ borderColor: "var(--border)", color: "var(--text)" }}
              >
                Previous
              </button>
              <span className="text-sm px-2" style={{ color: "var(--muted)" }}>
                Page {page} of {totalPages}
              </span>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="rounded-lg border px-3 py-2.5 min-h-[44px] text-sm font-medium disabled:opacity-40 touch-manipulation"
                style={{ borderColor: "var(--border)", color: "var(--text)" }}
              >
                Next
              </button>
            </nav>
          )}
        </>
      )}
    </div>
  )
}
