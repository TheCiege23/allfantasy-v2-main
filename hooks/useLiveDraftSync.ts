'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { MutableRefObject } from 'react'
import type { DraftSessionSnapshot, QueueEntry } from '@/lib/live-draft-engine/types'
import type { DraftChatMessage } from '@/components/app/draft-room/DraftChatPanel'
import { mergeDraftSessionSnapshot } from '@/lib/draft-room/mergeDraftSessionSnapshot'

const POLL_MS = 8000
const POLL_MS_BACKGROUND = 30000
const SESSION_POLL_FAILS_FOR_DEGRADED = 5
const CONNECTION_DEGRADED_SHOW_DELAY_MS = 1600
const AI_ADP_POLL_SKIP_MS = 30 * 60 * 1000
const QUEUE_POLL_EVERY_N_TICKS = 2
const SETTINGS_POLL_EVERY_N_TICKS = 3
const CHAT_POLL_EVERY_N_TICKS = 2
const POOL_POLL_EVERY_N_TICKS = 3

function mergeDraftChatWire(
  prev: DraftChatMessage[],
  incoming: DraftChatMessage[],
): DraftChatMessage[] {
  const map = new Map<string, DraftChatMessage>()
  for (const m of prev) map.set(m.id, m)
  for (const m of incoming) map.set(m.id, m)
  return Array.from(map.values()).sort(
    (a, b) => new Date(a.at).getTime() - new Date(b.at).getTime(),
  )
}

export type UseLiveDraftSyncProps = {
  leagueId: string
  sessionRef: MutableRefObject<DraftSessionSnapshot | null>
  controlActionInflightRef: MutableRefObject<number>
  pollSessionFailStreakRef: MutableRefObject<number>
  connectionDegradedTimerRef: MutableRefObject<number | null>
  currentUserRosterId: string | null | undefined
  showCommissionerModal: boolean
  chatSyncActive: boolean
  aiAdpEnabled: boolean | null | undefined
  aiAdpComputedAt: number
  sessionStatus: string | null | undefined
  timerStatus: string | null | undefined
  setSession: React.Dispatch<React.SetStateAction<DraftSessionSnapshot | null>>
  setQueue: React.Dispatch<React.SetStateAction<QueueEntry[]>>
  setChatMessages: React.Dispatch<React.SetStateAction<DraftChatMessage[]>>
  setChatSyncActive: React.Dispatch<React.SetStateAction<boolean>>
  setConnectionDegraded: React.Dispatch<React.SetStateAction<boolean>>
  fetchSession: () => Promise<unknown>
  fetchDraftSettings: () => Promise<unknown>
  fetchDraftAssistantContext: () => Promise<unknown>
  fetchDraftPool: () => Promise<unknown>
  fetchLeagueAiAdp: () => Promise<unknown>
}

export function useLiveDraftSync({
  leagueId,
  sessionRef,
  controlActionInflightRef,
  pollSessionFailStreakRef,
  connectionDegradedTimerRef,
  currentUserRosterId,
  showCommissionerModal,
  chatSyncActive,
  aiAdpEnabled,
  aiAdpComputedAt,
  sessionStatus,
  timerStatus,
  setSession,
  setQueue,
  setChatMessages,
  setChatSyncActive,
  setConnectionDegraded,
  fetchSession,
  fetchDraftSettings,
  fetchDraftAssistantContext,
  fetchDraftPool,
  fetchLeagueAiAdp,
}: UseLiveDraftSyncProps): void {
  const [pollInterval, setPollInterval] = useState(POLL_MS)
  const refetchOnceRef = useRef<(() => void) | null>(null)
  const pollTickRef = useRef(0)
  const pollInFlightRef = useRef(false)

  const fetchLiveSync = useCallback(
    async (opts: { since?: string; includeQueue: boolean; includeChat: boolean }): Promise<boolean> => {
      try {
        const sp = new URLSearchParams()
        if (opts.since) sp.set('since', opts.since)
        if (!opts.includeQueue) sp.set('queue', '0')
        if (!opts.includeChat) sp.set('chat', '0')
        const res = await fetch(
          `/api/leagues/${encodeURIComponent(leagueId)}/draft/live-sync?${sp.toString()}`,
          { cache: 'no-store' },
        )
        const data = await res.json().catch(() => ({}))
        if (!res.ok) return false

        if (data.session && controlActionInflightRef.current === 0) {
          setSession((prev) => mergeDraftSessionSnapshot(prev, data.session as DraftSessionSnapshot))
        }

        if (opts.includeQueue && Array.isArray(data.queue)) {
          const next = data.queue as QueueEntry[]
          setQueue((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next))
        }

        if (opts.includeChat && Array.isArray(data.messages)) {
          const incoming = data.messages as DraftChatMessage[]
          setChatMessages((prev) => {
            const merged = mergeDraftChatWire(prev, incoming)
            return JSON.stringify(prev) === JSON.stringify(merged) ? prev : merged
          })
          if (typeof data.syncActive === 'boolean') setChatSyncActive(data.syncActive)
        }

        return true
      } catch {
        return false
      }
    },
    [leagueId],
  )

  useEffect(() => {
    if (!leagueId) return
    const run = async () => {
      if (pollInFlightRef.current) return
      pollInFlightRef.current = true
      const tick = pollTickRef.current + 1
      pollTickRef.current = tick
      try {
        const since = sessionRef.current?.updatedAt
        const onClockForCurrentUser = Boolean(
          sessionRef.current?.currentPick?.rosterId &&
          currentUserRosterId &&
          sessionRef.current.currentPick.rosterId === currentUserRosterId
        )
        const shouldRefreshQueue = (tick % QUEUE_POLL_EVERY_N_TICKS) === 0 || onClockForCurrentUser
        const shouldRefreshSettings = (tick % SETTINGS_POLL_EVERY_N_TICKS) === 0 || showCommissionerModal
        const shouldRefreshChat = chatSyncActive || (tick % CHAT_POLL_EVERY_N_TICKS) === 0
        const shouldRefreshPool = (tick % POOL_POLL_EVERY_N_TICKS) === 0

        const sessionPollOk = await fetchLiveSync({
          since,
          includeQueue: shouldRefreshQueue,
          includeChat: shouldRefreshChat,
        })

        const secondary: Promise<unknown>[] = []
        if (shouldRefreshSettings) secondary.push(fetchDraftSettings())
        if (shouldRefreshSettings) secondary.push(fetchDraftAssistantContext())
        if (shouldRefreshPool) secondary.push(fetchDraftPool())

        const skipAiAdp = aiAdpEnabled && aiAdpComputedAt && Date.now() - aiAdpComputedAt < AI_ADP_POLL_SKIP_MS
        if (aiAdpEnabled && !skipAiAdp) secondary.push(fetchLeagueAiAdp())
        await Promise.all(secondary)

        if (!sessionPollOk) {
          pollSessionFailStreakRef.current += 1
          if (pollSessionFailStreakRef.current >= SESSION_POLL_FAILS_FOR_DEGRADED && connectionDegradedTimerRef.current == null) {
            connectionDegradedTimerRef.current = window.setTimeout(() => {
              connectionDegradedTimerRef.current = null
              setConnectionDegraded(true)
            }, CONNECTION_DEGRADED_SHOW_DELAY_MS)
          }
        } else {
          pollSessionFailStreakRef.current = 0
          if (connectionDegradedTimerRef.current != null) {
            clearTimeout(connectionDegradedTimerRef.current)
            connectionDegradedTimerRef.current = null
          }
          setConnectionDegraded(false)
        }
      } finally {
        pollInFlightRef.current = false
      }
    }
    refetchOnceRef.current = () => { void run() }
  }, [
    leagueId,
    fetchLiveSync,
    fetchDraftSettings,
    fetchDraftAssistantContext,
    fetchDraftPool,
    fetchLeagueAiAdp,
    aiAdpEnabled,
    aiAdpComputedAt,
    showCommissionerModal,
    chatSyncActive,
    currentUserRosterId,
  ])

  useEffect(() => {
    if (typeof document === 'undefined') return
    const compute = () => {
      const hidden = document.hidden
      if (hidden) {
        setPollInterval(POLL_MS_BACKGROUND)
        return
      }
      refetchOnceRef.current?.()
      const active = sessionStatus === 'in_progress'
      const ts = timerStatus
      if (active && (ts === 'running' || ts === 'expired')) {
        setPollInterval(2000)
      } else {
        setPollInterval(POLL_MS)
      }
    }
    compute()
    document.addEventListener('visibilitychange', compute)
    return () => document.removeEventListener('visibilitychange', compute)
  }, [sessionStatus, timerStatus])

  useEffect(() => {
    if (typeof document === 'undefined') return
    const onVisibility = () => {
      if (document.hidden) return
      void fetchSession().then((ok) => {
        if (ok) {
          pollSessionFailStreakRef.current = 0
          if (connectionDegradedTimerRef.current != null) {
            clearTimeout(connectionDegradedTimerRef.current)
            connectionDegradedTimerRef.current = null
          }
          setConnectionDegraded(false)
        }
      })
      refetchOnceRef.current?.()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [fetchSession])

  useEffect(() => {
    if (!leagueId) return
    const id = setInterval(() => {
      refetchOnceRef.current?.()
    }, pollInterval)
    return () => clearInterval(id)
  }, [leagueId, pollInterval])
}
