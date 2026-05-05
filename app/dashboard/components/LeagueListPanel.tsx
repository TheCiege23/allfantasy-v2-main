'use client'

import { useRouter } from 'next/navigation'
import { Search } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { LeagueSidebarCard } from '@/components/league/LeagueSidebarCard'
import type { UserLeague } from '../types'

const FAVORITES_KEY = 'af-league-favorites'
const ORDER_KEY = 'af-league-order'
const SYNC_EVENT = 'af-dashboard-league-list-sync'

type LeagueListPanelProps = {
  leagues: UserLeague[]
  selectedId: string | null
  onSelect: (league: UserLeague) => void
  /** See `LeagueSidebarCard.inlineDashboardSelect` */
  inlineDashboardSelect?: boolean
  compact?: boolean
  loading?: boolean
  /** Refetch dashboard league list after a successful Sleeper refresh */
  onLeaguesRefresh?: () => void
  /** Remove a league from parent state after successful DELETE (My Leagues list) */
  onLeagueRemoved?: (leagueId: string) => void
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
}

function readStoredIds(key: string) {
  if (typeof window === 'undefined') return []

  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return isStringArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeStoredIds(key: string, value: string[]) {
  if (typeof window === 'undefined') return

  try {
    window.localStorage.setItem(key, JSON.stringify(value))
    window.dispatchEvent(new Event(SYNC_EVENT))
  } catch {}
}

function applySavedOrder(leagues: UserLeague[], orderedIds: string[]) {
  if (!orderedIds.length) return leagues

  const leagueMap = new Map(leagues.map((league) => [league.id, league] as const))
  const ordered: UserLeague[] = []
  const usedIds = new Set<string>()

  for (const leagueId of orderedIds) {
    const league = leagueMap.get(leagueId)
    if (!league || usedIds.has(leagueId)) continue
    ordered.push(league)
    usedIds.add(leagueId)
  }

  for (const league of leagues) {
    if (usedIds.has(league.id)) continue
    ordered.push(league)
  }

  return ordered
}

export function LeagueListPanel({
  leagues,
  selectedId,
  onSelect,
  inlineDashboardSelect = false,
  compact = false,
  loading = false,
  onLeaguesRefresh,
  onLeagueRemoved,
}: LeagueListPanelProps) {
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [refreshing, setRefreshing] = useState<Record<string, boolean>>({})
  const [refreshed, setRefreshed] = useState<Record<string, boolean>>({})
  const [favoriteIds, setFavoriteIds] = useState<string[]>([])
  const [orderedIds, setOrderedIds] = useState<string[]>([])
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dropTargetId, setDropTargetId] = useState<string | null>(null)
  const draggedLeagueIdRef = useRef<string | null>(null)
  const refreshInFlightRef = useRef<Set<string>>(new Set())
  const deleteInFlightRef = useRef<Set<string>>(new Set())
  const [deleting, setDeleting] = useState<Record<string, boolean>>({})
  const [rosterIssueCounts, setRosterIssueCounts] = useState<Record<string, number>>({})

  const refreshRosterIssueCounts = useCallback(async () => {
    try {
      const res = await fetch('/api/user/roster-legality-summary', { cache: 'no-store', credentials: 'include' })
      if (!res.ok) return
      const j = (await res.json()) as { counts?: Record<string, number> }
      if (j.counts && typeof j.counts === 'object') setRosterIssueCounts(j.counts)
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    void refreshRosterIssueCounts()
    const iv = window.setInterval(() => void refreshRosterIssueCounts(), 120_000)
    const onInv = () => void refreshRosterIssueCounts()
    window.addEventListener('af-roster-legality-summary-invalidate', onInv as EventListener)
    return () => {
      window.clearInterval(iv)
      window.removeEventListener('af-roster-legality-summary-invalidate', onInv as EventListener)
    }
  }, [refreshRosterIssueCounts])

  useEffect(() => {
    const syncFromStorage = () => {
      setFavoriteIds(readStoredIds(FAVORITES_KEY))
      setOrderedIds(readStoredIds(ORDER_KEY))
    }

    syncFromStorage()
    window.addEventListener('storage', syncFromStorage)
    window.addEventListener(SYNC_EVENT, syncFromStorage as EventListener)

    return () => {
      window.removeEventListener('storage', syncFromStorage)
      window.removeEventListener(SYNC_EVENT, syncFromStorage as EventListener)
    }
  }, [])

  const favoriteSet = useMemo(() => new Set(favoriteIds), [favoriteIds])

  const orderedLeagues = useMemo(() => applySavedOrder(leagues, orderedIds), [leagues, orderedIds])

  const favoriteSortedLeagues = useMemo(() => {
    const favorites: UserLeague[] = []
    const remaining: UserLeague[] = []

    for (const league of orderedLeagues) {
      if (favoriteSet.has(league.id)) {
        favorites.push(league)
      } else {
        remaining.push(league)
      }
    }

    return [...favorites, ...remaining]
  }, [favoriteSet, orderedLeagues])

  const displayedLeagues = useMemo(() => {
    if (compact || !search.trim()) return favoriteSortedLeagues

    const query = search.trim().toLowerCase()
    return favoriteSortedLeagues.filter((league) => league.name.toLowerCase().includes(query))
  }, [compact, favoriteSortedLeagues, search])

  const persistFavoriteIds = useCallback((nextFavoriteIds: string[]) => {
    setFavoriteIds(nextFavoriteIds)
    writeStoredIds(FAVORITES_KEY, nextFavoriteIds)
  }, [])

  const persistOrderedIds = useCallback((nextOrderedIds: string[]) => {
    setOrderedIds(nextOrderedIds)
    writeStoredIds(ORDER_KEY, nextOrderedIds)
  }, [])

  const handleFavoriteToggle = useCallback(
    (leagueId: string) => {
      const nextFavoriteIds = favoriteSet.has(leagueId)
        ? favoriteIds.filter((id) => id !== leagueId)
        : [...favoriteIds, leagueId]

      persistFavoriteIds(nextFavoriteIds)
    },
    [favoriteIds, favoriteSet, persistFavoriteIds]
  )

  const resetDragState = useCallback(() => {
    draggedLeagueIdRef.current = null
    setDraggingId(null)
    setDropTargetId(null)
  }, [])

  const handleDrop = useCallback(
    (targetLeagueId: string) => {
      const draggedLeagueId = draggedLeagueIdRef.current
      if (!draggedLeagueId || draggedLeagueId === targetLeagueId) {
        resetDragState()
        return
      }

      const visibleIds = displayedLeagues.map((league) => league.id)
      const draggedVisibleIndex = visibleIds.indexOf(draggedLeagueId)
      const targetVisibleIndex = visibleIds.indexOf(targetLeagueId)

      if (draggedVisibleIndex === -1 || targetVisibleIndex === -1) {
        resetDragState()
        return
      }

      const nextVisibleIds = [...visibleIds]
      ;[nextVisibleIds[draggedVisibleIndex], nextVisibleIds[targetVisibleIndex]] = [
        nextVisibleIds[targetVisibleIndex],
        nextVisibleIds[draggedVisibleIndex],
      ]

      const visibleSet = new Set(visibleIds)
      let nextVisibleIndex = 0
      const nextOrderedIds = favoriteSortedLeagues.map((league) => {
        if (!visibleSet.has(league.id)) return league.id
        const nextLeagueId = nextVisibleIds[nextVisibleIndex]
        nextVisibleIndex += 1
        return nextLeagueId
      })

      persistOrderedIds(nextOrderedIds)
      resetDragState()
    },
    [displayedLeagues, favoriteSortedLeagues, persistOrderedIds, resetDragState]
  )

  const handleRefresh = useCallback(
    async (e: React.MouseEvent, leagueId: string) => {
      e.stopPropagation()
      e.preventDefault()
      if (refreshInFlightRef.current.has(leagueId)) return
      refreshInFlightRef.current.add(leagueId)

      setRefreshing((prev) => ({ ...prev, [leagueId]: true }))
      try {
        const res = await fetch('/api/league/refresh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ leagueId }),
        })
        if (res.ok) {
          setRefreshed((prev) => ({ ...prev, [leagueId]: true }))
          window.setTimeout(() => {
            setRefreshed((prev) => ({ ...prev, [leagueId]: false }))
          }, 2000)
          onLeaguesRefresh?.()
        }
      } catch (err) {
        console.error('refresh failed', err)
      } finally {
        refreshInFlightRef.current.delete(leagueId)
        setRefreshing((prev) => ({ ...prev, [leagueId]: false }))
      }
    },
    [onLeaguesRefresh]
  )

  const handleDelete = useCallback(
    async (e: React.MouseEvent, leagueId: string) => {
      e.stopPropagation()
      e.preventDefault()
      if (deleteInFlightRef.current.has(leagueId)) return
      if (
        !window.confirm(
          'Remove this league from your AllFantasy list? This does not delete the league on Sleeper or other platforms.'
        )
      ) {
        return
      }
      deleteInFlightRef.current.add(leagueId)
      setDeleting((prev) => ({ ...prev, [leagueId]: true }))
      try {
        const res = await fetch(`/api/league/${encodeURIComponent(leagueId)}`, {
          method: 'DELETE',
          credentials: 'include',
        })
        if (res.ok || res.status === 404) {
          onLeagueRemoved?.(leagueId)
          persistFavoriteIds(favoriteIds.filter((id) => id !== leagueId))
          persistOrderedIds(orderedIds.filter((id) => id !== leagueId))
          onLeaguesRefresh?.()
        } else {
          const data = (await res.json().catch(() => ({}))) as { error?: string }
          window.alert(data.error ?? 'Could not remove league')
        }
      } catch (err) {
        console.error('delete league failed', err)
        window.alert('Could not remove league')
      } finally {
        deleteInFlightRef.current.delete(leagueId)
        setDeleting((prev) => ({ ...prev, [leagueId]: false }))
      }
    },
    [
      favoriteIds,
      onLeagueRemoved,
      onLeaguesRefresh,
      orderedIds,
      persistFavoriteIds,
      persistOrderedIds,
    ]
  )

  return (
    <div className="flex h-full min-w-0 w-full max-w-full flex-col overflow-hidden bg-[#0a0a1f]">
      {!compact ? (
        <div className="border-b border-white/[0.07] px-3 py-3">
          <div className="flex items-center rounded-xl border border-white/[0.07] bg-white/[0.05] px-3 py-2">
            <Search className="h-4 w-4 flex-shrink-0 text-white/35" />
            <input
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search leagues..."
              className="ml-2 w-full bg-transparent text-sm text-white outline-none placeholder:text-white/35"
            />
          </div>
        </div>
      ) : null}

      <div
        className={`min-h-0 min-w-0 w-full flex-1 overflow-y-auto overflow-x-hidden px-2 py-2 ${
          compact ? '' : '[scrollbar-gutter:stable]'
        }`}
      >
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, index) => (
              <div
                key={index}
                className={`rounded-xl bg-white/5 animate-pulse ${compact ? 'h-[52px]' : 'h-14'}`}
              />
            ))}
          </div>
        ) : displayedLeagues.length ? (
          <div className="w-full min-w-0 space-y-1.5">
            {displayedLeagues.map((league) => {
              const isDragging = draggingId === league.id
              const isDropTarget = dropTargetId === league.id && draggingId !== league.id

              return (
                <div
                  key={league.id}
                  onDragOver={(event) => {
                    event.preventDefault()
                    if (draggedLeagueIdRef.current && draggedLeagueIdRef.current !== league.id) {
                      setDropTargetId(league.id)
                    }
                  }}
                  onDrop={(event) => {
                    event.preventDefault()
                    handleDrop(league.id)
                  }}
                  className={`group relative w-full min-w-0 rounded-xl border transition-all duration-150 ${
                    isDropTarget ? 'border-cyan-500/50' : 'border-transparent'
                  }`}
                >
                  <LeagueSidebarCard
                    league={league}
                    rosterIssueCount={rosterIssueCounts[league.id] ?? 0}
                    isSelected={league.id === selectedId}
                    isFavorite={favoriteSet.has(league.id)}
                    onSelect={onSelect}
                    inlineDashboardSelect={inlineDashboardSelect}
                    onFavoriteToggle={handleFavoriteToggle}
                    isDragging={isDragging}
                    isDropTarget={isDropTarget}
                    compact={compact}
                    dragHandleProps={{
                      draggable: true,
                      title: 'Drag to reorder',
                      onDragStart: (e) => {
                        draggedLeagueIdRef.current = league.id
                        setDraggingId(league.id)
                        e.dataTransfer.effectAllowed = 'move'
                        e.dataTransfer.setData('text/plain', league.id)
                      },
                      onDragEnd: resetDragState,
                    }}
                    showRefreshButton={(league.platform || '').toLowerCase() === 'sleeper'}
                    isRefreshing={refreshing[league.id] ?? false}
                    isRefreshed={refreshed[league.id] ?? false}
                    onRefresh={handleRefresh}
                    onDelete={handleDelete}
                    isDeleting={deleting[league.id] ?? false}
                  />
                </div>
              )
            })}
          </div>
        ) : leagues.length === 0 ? (
          <div className="flex h-full min-h-[200px] flex-col items-center justify-center gap-3 px-3 py-6 text-center">
            <p className="text-2xl">🏆</p>
            <div>
              <p className="text-sm font-semibold text-white/75">No leagues yet</p>
              <p className="mt-1 text-[11px] text-white/40">
                Create a league or import one to get started
              </p>
            </div>
            <div className="flex w-full flex-col gap-1.5">
              <button
                type="button"
                onClick={() => router.push('/create-league')}
                className="rounded-xl bg-cyan-500/20 px-3 py-2 text-xs font-semibold text-cyan-300 transition hover:bg-cyan-500/30"
              >
                + Create League
              </button>
              <button
                type="button"
                onClick={() => router.push('/import?returnTo=/dashboard')}
                className="rounded-xl border border-white/[0.08] px-3 py-2 text-xs font-semibold text-white/50 transition hover:border-white/20 hover:text-white/70"
              >
                Import a League
              </button>
              <button
                type="button"
                onClick={() => router.push('/find-league')}
                className="text-[11px] text-white/30 transition hover:text-white/50"
              >
                Find a league to join
              </button>
            </div>
          </div>
        ) : (
          <div className="px-3 py-10 text-center text-sm text-white/45">No leagues match your search.</div>
        )}
      </div>
    </div>
  )
}
