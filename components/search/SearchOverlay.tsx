"use client"

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import { ChevronRight, Search, X } from "lucide-react"
import {
  ALL_SPORT_SEARCH_FILTER,
  getCommandPaletteShortcut,
  getGroupedStaticResults,
  getSportSearchFilterOptions,
  getUniversalLiveResults,
  getUniversalSearchPayload,
  mergeSearchResults,
  shouldShowSportFilter,
  type QuickActionItem,
  type SearchResultCategory,
  type SearchResultItem,
  type SportFilterOption,
  type SportFilterValue,
} from "@/lib/search"
import { EmptyStateRenderer, ErrorStateRenderer } from "@/components/ui-states"
import { resolveNoResultsState, resolveRecoveryActions } from "@/lib/ui-state"

type FlatItem = {
  type: "quick" | "result"
  id: string
  href: string
  label: string
  description?: string
  category: SearchResultCategory | "quick_action"
}

type CategoryFilter = "all" | "quick_action" | SearchResultCategory

const CATEGORY_FILTERS: Array<{ id: CategoryFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "quick_action", label: "Quick actions" },
  { id: "league", label: "Leagues" },
  { id: "player", label: "Players" },
  { id: "tool", label: "Tools" },
  { id: "page", label: "Pages" },
]

const CATEGORY_LABELS: Record<string, string> = {
  quick_action: "Quick actions",
  tool: "Tools",
  page: "Pages",
  league: "Leagues",
  player: "Players",
}

function categoryMatches(filter: CategoryFilter, category: SearchResultCategory | "quick_action"): boolean {
  return filter === "all" || filter === category
}

function sportMatchesFilter(item: SearchResultItem, sportFilter: SportFilterValue): boolean {
  if (!sportFilter) return true
  if (item.category !== "league" && item.category !== "player") return true
  if (!item.sport) return true
  return item.sport.toUpperCase() === sportFilter
}

interface SearchOverlayProps {
  open: boolean
  onClose: () => void
}

export function SearchOverlay({ open, onClose }: SearchOverlayProps) {
  const router = useRouter()
  const [query, setQuery] = useState("")
  const [highlight, setHighlight] = useState(0)
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all")
  const [sportFilter, setSportFilter] = useState<SportFilterValue>(null)
  const [liveResults, setLiveResults] = useState<{ leagues: SearchResultItem[]; players: SearchResultItem[] }>({
    leagues: [],
    players: [],
  })
  const [liveLoading, setLiveLoading] = useState(false)
  const [liveError, setLiveError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const payload = useMemo(() => getUniversalSearchPayload(query), [query])
  const sportFilterOptions = useMemo(() => getSportSearchFilterOptions(), [])
  const showSportFilter = shouldShowSportFilter("league") || shouldShowSportFilter("player")

  useEffect(() => {
    if (!open || !payload.suggestLiveSearch) {
      setLiveResults({ leagues: [], players: [] })
      setLiveLoading(false)
      setLiveError(null)
      return
    }

    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      setLiveLoading(true)
      try {
        const next = await getUniversalLiveResults(payload.query, {
          sportFilter,
          signal: controller.signal,
        })
        if (!controller.signal.aborted) {
          setLiveResults(next)
          setLiveError(next.hasError ? "Search is partially unavailable. You can retry now." : null)
        }
      } catch {
        if (!controller.signal.aborted) {
          setLiveResults({ leagues: [], players: [] })
          setLiveError("Search is temporarily unavailable. You can retry now.")
        }
      } finally {
        if (!controller.signal.aborted) {
          setLiveLoading(false)
        }
      }
    }, 160)

    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [open, payload.query, payload.suggestLiveSearch, sportFilter])

  const mergedResults = useMemo(
    () => mergeSearchResults(payload.staticResults, liveResults),
    [liveResults, payload.staticResults]
  )

  const visibleQuickActions = useMemo(
    () => payload.quickActions.filter((action) => categoryMatches(categoryFilter, "quick_action")),
    [categoryFilter, payload.quickActions]
  )

  const visibleResults = useMemo(
    () =>
      mergedResults.filter(
        (item) => categoryMatches(categoryFilter, item.category) && sportMatchesFilter(item, sportFilter)
      ),
    [categoryFilter, mergedResults, sportFilter]
  )

  const grouped = useMemo(
    () => (visibleResults.length > 0 ? getGroupedStaticResults(visibleResults) : null),
    [visibleResults]
  )

  const flatItems = useMemo(() => {
    const list: FlatItem[] = []
    for (const action of visibleQuickActions) {
      list.push({
        type: "quick",
        id: action.id,
        href: action.href,
        label: action.label,
        description: action.description,
        category: "quick_action",
      })
    }
    if (grouped) {
      for (const [, items] of grouped) {
        for (const result of items as SearchResultItem[]) {
          list.push({
            type: "result",
            id: result.id,
            href: result.href,
            label: result.label,
            description: result.description,
            category: result.category,
          })
        }
      }
    }
    return list
  }, [grouped, visibleQuickActions])

  const navigate = useCallback(
    (href: string) => {
      onClose()
      setQuery("")
      setHighlight(0)
      setCategoryFilter("all")
      setSportFilter(null)
      setLiveResults({ leagues: [], players: [] })
      router.push(href)
    },
    [onClose, router]
  )

  const clearQuery = useCallback(() => {
    setQuery("")
    setHighlight(0)
    setLiveResults({ leagues: [], players: [] })
    setLiveError(null)
    inputRef.current?.focus()
  }, [])

  const retryLiveSearch = useCallback(async () => {
    if (!payload.suggestLiveSearch) return
    setLiveLoading(true)
    setLiveError(null)
    try {
      const next = await getUniversalLiveResults(payload.query, { sportFilter })
      setLiveResults(next)
      setLiveError(next.hasError ? "Search is partially unavailable. You can retry now." : null)
    } catch {
      setLiveError("Search is temporarily unavailable. You can retry now.")
    } finally {
      setLiveLoading(false)
    }
  }, [payload.query, payload.suggestLiveSearch, sportFilter])

  const onSubmitSearch = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      const entry = flatItems[highlight] ?? flatItems[0]
      if (!entry) return
      navigate(entry.href)
    },
    [flatItems, highlight, navigate]
  )

  useEffect(() => {
    if (!open) return
    setQuery("")
    setHighlight(0)
    setCategoryFilter("all")
    setSportFilter(null)
    setLiveResults({ leagues: [], players: [] })
    setLiveError(null)
    const timer = window.setTimeout(() => inputRef.current?.focus(), 20)
    return () => window.clearTimeout(timer)
  }, [open])

  useEffect(() => {
    setHighlight(0)
  }, [categoryFilter, query, sportFilter])

  useEffect(() => {
    if (highlight >= flatItems.length && flatItems.length > 0) setHighlight(flatItems.length - 1)
  }, [flatItems.length, highlight])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault()
        onClose()
        return
      }
      if (e.key === "ArrowDown") {
        e.preventDefault()
        if (!flatItems.length) return
        setHighlight((i) => (i < flatItems.length - 1 ? i + 1 : 0))
        return
      }
      if (e.key === "ArrowUp") {
        e.preventDefault()
        if (!flatItems.length) return
        setHighlight((i) => (i > 0 ? i - 1 : flatItems.length - 1))
        return
      }
      if (e.key === "Enter" && flatItems[highlight]) {
        e.preventDefault()
        navigate(flatItems[highlight]!.href)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, flatItems, highlight, navigate, onClose])

  useEffect(() => {
    if (highlight < 0 || !listRef.current) return
    const el = listRef.current.querySelector(`[data-highlight-index="${highlight}"]`)
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" })
  }, [highlight])

  if (!open) return null

  return (
    <>
      <div
        className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm"
        data-testid="search-overlay-backdrop"
        aria-hidden
        onClick={onClose}
      />
      <div
        className="fixed left-1/2 top-[8%] z-[101] w-[min(100vw-1.25rem,760px)] -translate-x-1/2 rounded-2xl border shadow-2xl"
        data-testid="search-overlay-dialog"
        style={{
          background: "var(--panel)",
          borderColor: "var(--border)",
        }}
        role="dialog"
        aria-modal="true"
        aria-label="Search"
      >
        <form
          className="flex items-center gap-2 border-b px-3 py-2"
          style={{ borderColor: "var(--border)" }}
          onSubmit={onSubmitSearch}
        >
          <Search className="h-5 w-5 shrink-0" style={{ color: "var(--muted)" }} />
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search leagues, players, tools, pages, settings, and AI..."
            className="flex-1 bg-transparent py-2 text-sm outline-none"
            style={{ color: "var(--text)" }}
            autoComplete="off"
            aria-label="Universal search input"
          />
          {query ? (
            <button
              type="button"
              onClick={clearQuery}
              className="rounded-lg px-2 py-1.5 text-xs font-semibold transition hover:bg-white/10"
              style={{ color: "var(--muted)" }}
              aria-label="Clear search"
            >
              Clear
            </button>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 transition hover:bg-white/10"
            style={{ color: "var(--muted)" }}
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </form>

        <div className="border-b px-3 py-2" style={{ borderColor: "var(--border)" }}>
          <div className="flex flex-wrap gap-1.5">
            {CATEGORY_FILTERS.map((filter) => (
              <button
                key={filter.id}
                type="button"
                onClick={() => setCategoryFilter(filter.id)}
                data-search-category={filter.id}
                className="rounded-full border px-2.5 py-1 text-xs font-semibold transition"
                style={{
                  borderColor:
                    categoryFilter === filter.id
                      ? "color-mix(in srgb, var(--accent-cyan) 40%, var(--border))"
                      : "var(--border)",
                  background:
                    categoryFilter === filter.id
                      ? "color-mix(in srgb, var(--accent-cyan) 20%, transparent)"
                      : "transparent",
                  color: categoryFilter === filter.id ? "var(--accent-cyan-strong)" : "var(--muted)",
                }}
              >
                {filter.label}
              </button>
            ))}
          </div>
          {showSportFilter && payload.suggestLiveSearch ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {sportFilterOptions.map((option: SportFilterOption) => {
                const isAll = option.value === ALL_SPORT_SEARCH_FILTER
                const active = isAll ? !sportFilter : sportFilter === option.value
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setSportFilter(isAll ? null : option.value)}
                    data-search-sport={option.value}
                    className="rounded-full border px-2.5 py-1 text-[11px] font-semibold transition"
                    style={{
                      borderColor: active
                        ? "color-mix(in srgb, var(--accent-cyan) 40%, var(--border))"
                        : "var(--border)",
                      background: active
                        ? "color-mix(in srgb, var(--accent-cyan) 20%, transparent)"
                        : "transparent",
                      color: active ? "var(--accent-cyan-strong)" : "var(--muted)",
                    }}
                  >
                    {option.label}
                  </button>
                )
              })}
            </div>
          ) : null}
        </div>

        <div className="max-h-[58vh] overflow-y-auto p-2" ref={listRef}>
          {liveLoading ? (
            <p className="px-3 py-2 text-xs" style={{ color: "var(--muted)" }}>
              Searching leagues and players...
            </p>
          ) : null}

          {liveError ? (
            <ErrorStateRenderer
              compact
              title="Live search unavailable"
              message={liveError}
              onRetry={() => void retryLiveSearch()}
              actions={resolveRecoveryActions("search").map((action) => ({
                id: action.id,
                label: action.label,
                href: action.href,
              }))}
              testId="search-live-error-state"
            />
          ) : null}

          {flatItems.length === 0 && query.length >= 2 && !liveLoading && !liveError ? (
            <EmptyStateRenderer
              compact
              testId="search-no-results-state"
              title={resolveNoResultsState({ context: "search", query }).title}
              description={resolveNoResultsState({ context: "search", query }).description}
              actions={resolveNoResultsState({ context: "search", query }).actions.map((action) => ({
                id: action.id,
                label: action.label,
                href: action.href,
                onClick:
                  action.action === "clear_query"
                    ? clearQuery
                    : action.action === "clear_filters"
                      ? () => setSportFilter(null)
                      : undefined,
              }))}
            />
          ) : null}

          {flatItems.length === 0 && query.length < 2 && !liveError ? (
            <EmptyStateRenderer
              compact
              testId="search-initial-empty-state"
              title={resolveNoResultsState({ context: "search" }).title}
              description={`${resolveNoResultsState({ context: "search" }).description} Press ${getCommandPaletteShortcut()} to open quickly.`}
              actions={resolveNoResultsState({ context: "search" }).actions.map((action) => ({
                id: action.id,
                label: action.label,
                href: action.href,
              }))}
            />
          ) : null}

          {visibleQuickActions.length > 0 ? (
            <section className="mb-2">
              <h3 className="px-2 py-1 text-xs font-medium uppercase" style={{ color: "var(--muted)" }}>
                Quick actions
              </h3>
              <ul className="space-y-0.5">
                {visibleQuickActions.map((action: QuickActionItem) => {
                  const idx = flatItems.findIndex((e) => e.type === "quick" && e.id === action.id)
                  const isHighlight = idx === highlight
                  return (
                    <li key={action.id}>
                      <button
                        type="button"
                        data-highlight-index={idx}
                        data-search-quick-action={action.id}
                        onClick={() => navigate(action.href)}
                        className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition"
                        style={{
                          background: isHighlight
                            ? "color-mix(in srgb, var(--accent-cyan) 15%, transparent)"
                            : "transparent",
                          color: isHighlight ? "var(--accent-cyan-strong)" : "var(--text)",
                        }}
                      >
                        <div className="min-w-0">
                          <p className="truncate font-medium">{action.label}</p>
                          {action.description ? (
                            <p className="truncate text-xs opacity-80">{action.description}</p>
                          ) : null}
                        </div>
                        <ChevronRight className="ml-auto h-4 w-4 opacity-50" />
                      </button>
                    </li>
                  )
                })}
              </ul>
            </section>
          ) : null}

          {grouped ? (
            <>
              {Array.from(grouped.entries()).map(([cat, items]) => (
                <section key={cat} className="mb-2">
                  <h3 className="px-2 py-1 text-xs font-medium uppercase" style={{ color: "var(--muted)" }}>
                    {CATEGORY_LABELS[cat] ?? cat}
                  </h3>
                  <ul className="space-y-0.5">
                    {(items as SearchResultItem[]).map((item) => {
                      const idx = flatItems.findIndex((e) => e.type === "result" && e.id === item.id)
                      const isHighlight = idx === highlight
                      return (
                        <li key={item.id}>
                          <button
                            type="button"
                            data-highlight-index={idx}
                            data-search-result={item.id}
                            onClick={() => navigate(item.href)}
                            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition"
                            style={{
                              background: isHighlight
                                ? "color-mix(in srgb, var(--accent-cyan) 15%, transparent)"
                                : "transparent",
                              color: isHighlight ? "var(--accent-cyan-strong)" : "var(--text)",
                            }}
                          >
                            <div className="min-w-0">
                              <p className="truncate font-medium">{item.label}</p>
                              {item.description ? (
                                <p className="truncate text-xs opacity-80">{item.description}</p>
                              ) : null}
                            </div>
                            <ChevronRight className="ml-auto h-4 w-4 opacity-50" />
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                </section>
              ))}
            </>
          ) : null}
        </div>
        <div className="border-t px-3 py-2 text-xs" style={{ borderColor: "var(--border)", color: "var(--muted)" }}>
          <kbd className="rounded border px-1.5 py-0.5" style={{ borderColor: "var(--border)" }}>
            {getCommandPaletteShortcut()}
          </kbd>{" "}
          to open · ↑↓ to move · Enter to go · Esc to close
        </div>
      </div>
    </>
  )
}
